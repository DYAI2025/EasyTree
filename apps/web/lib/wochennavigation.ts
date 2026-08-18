/**
 * Wochenableitung der Planungswerkbank (EYT-140 M3, `REQ-002` / `AC-003`, `AC-004`).
 *
 * ## Was diese Datei ist — und was sie bewusst nicht ist
 *
 * Eine reine Funktion. Kein React, keine Uhr, keine Formatierung ueber die
 * Gebietsschema-Bibliothek der Laufzeit. Der Zeitpunkt kommt als Parameter
 * `jetzt` herein, die Zone als benannter Parameter — beides ausdruecklich, weil
 * „welche Woche ist heute" sonst weder deterministisch pruefbar noch an einer
 * einzigen Stelle nachlesbar waere. Die einzige Uhrzeit-Lesestelle des Slices
 * bleibt die Server-Komponente `app/planung/page.tsx` (Entwurfsentscheidung
 * `E3` des Plans).
 *
 * ## Warum hier nicht gerechnet wird
 *
 * Es entstehen sonst zwei Wochenregeln. Woche ± n und der Zeitraum einer Woche
 * kommen vollstaendig aus `@easytree/domain`
 * (`shiftPlanningWeek`, `planningWeekDateRange`), das Pruefen eines
 * Wochenschluessels vollstaendig aus `@easytree/contracts`
 * (`parseIsoWeekKey`, EYT-88). Der naheliegende Weg — die Wochennummer um eins
 * hoch- oder herunterzuzaehlen — ist in der Jahresmitte fehlerfrei und an den
 * Jahresgrenzen falsch: 2026 hat 53 ISO-Wochen, 2025 und 2027 haben 52.
 * Diese Datei formatiert und verlinkt, sie rechnet nicht.
 *
 * ## Der Zeitraum ist zonenfrei, die Frage „welche Woche ist heute" nicht
 *
 * Welche sieben Kalendertage eine ISO-Woche ausmacht, folgt allein aus ISO-Jahr
 * und Wochennummer. Eine Zone braucht erst die Ableitung der laufenden Woche
 * aus einem Zeitpunkt — dort und nur dort wird sie verwendet
 * (Entwurfsentscheidung `E4`).
 *
 * ## Zwei Faelle, die als `fehlerhaft` enden
 *
 * 1. **Mehrfach angegebener Parameter.** Steht `weekKey` mehrfach in der
 *    Adresse, liefert Next ein Array. Das ist eine mehrdeutige Angabe und keine
 *    Woche; ein stilles Reduzieren auf den ersten Wert waere eine Antwort auf
 *    eine Frage, die so nicht gestellt wurde. Die Regel stammt unveraendert aus
 *    `app/planung/page.tsx`.
 * 2. **Eine Woche ohne darstellbaren Nachbarn.** `9999-W52` und `0001-W01` sind
 *    fuer sich gueltige Schluessel und koennen in der Adresse stehen, aber ihre
 *    Nachbarwoche liegt ausserhalb der Vertragsgrenze 0001–9999;
 *    `shiftPlanningWeek` wirft dort (gemessen 18.08.2026). Ein
 *    durchgereichter Fehler wuerde die Server-Komponente sprengen, ein halbes
 *    Modell mit einem Link, der nirgends hinfuehrt, waere die stille Variante.
 *    Also: entweder ein vollstaendig benutzbares Navigationsmodell oder keins.
 *
 * Ein FEHLENDER Parameter ist etwas anderes als ein ungueltiger: er ergibt die
 * laufende Woche (`AC-003`), ein vorhandener, aber ungueltiger bleibt
 * `fehlerhaft` (`E2`).
 */
import {
  isSameWeek,
  isoWeekOfLocalDate,
  localBusinessDate,
  planningWeekDateRange,
  planningWeekKey,
  shiftPlanningWeek,
} from "@easytree/domain";
import type {
  IanaTimeZone,
  LocalBusinessDate,
  PlanningWeek,
  PlanningWeekDateRange,
} from "@easytree/domain";
import { parseIsoWeekKey } from "@easytree/contracts";

/** Eingabe der Wochenableitung. Alle drei Werte sind ausdruecklich, keiner implizit. */
export interface WochenmodellEingabe {
  /** Rohwert aus der Adresse. Ein Array bedeutet: mehrfach angegeben. */
  readonly weekKeyAusUrl: string | string[] | undefined;
  /** Der Zeitpunkt, aus dem die laufende Woche abgeleitet wird. */
  readonly jetzt: Date;
  /** Die Zone, in der dieser Zeitpunkt einem Kalendertag zugeordnet wird. */
  readonly zone: IanaTimeZone;
}

/**
 * Das Ergebnis der Ableitung — ein reines Datenobjekt.
 *
 * Bewusst serialisierbar: es ueberquert in M5 die Grenze von der Server- zur
 * Client-Komponente. Eine Funktion oder eine Klasse koennte das nicht.
 */
export type Wochenmodell =
  | { readonly art: "fehlerhaft" }
  | {
      readonly art: "woche";
      /** Kanonischer Schluessel der angezeigten Woche, etwa `2026-W32`. */
      readonly schluessel: string;
      /** Beschriftung der Woche, etwa `KW 32 · 2026`. */
      readonly isoWochenText: string;
      /** Montag und Sonntag der Woche, etwa `03.08.2026 – 09.08.2026`. */
      readonly zeitraumText: string;
      readonly vorherigeUrl: string;
      readonly naechsteUrl: string;
      /** Zielt auf die LAUFENDE Woche, nicht auf die angezeigte. */
      readonly heuteUrl: string;
      readonly istAktuelleWoche: boolean;
    };

const FEHLERHAFT: Wochenmodell = { art: "fehlerhaft" };

function zweistellig(wert: number): string {
  return String(wert).padStart(2, "0");
}

function vierstellig(wert: number): string {
  return String(wert).padStart(4, "0");
}

/** Ein Kalendertag als `TT.MM.JJJJ` — handgeschrieben und damit gebietsschemafrei. */
function tagText(tag: LocalBusinessDate): string {
  return `${zweistellig(tag.day)}.${zweistellig(tag.month)}.${vierstellig(tag.year)}`;
}

/**
 * Adresse der Planungsseite fuer eine Woche.
 *
 * Ueber `URLSearchParams` statt ueber Zeichenkettenverkettung: der Schluessel
 * ist zwar nachweislich adresssicher, aber eine handgeschriebene Kodierung an
 * dieser Stelle waere eine Zusage, die niemand prueft.
 */
function planungsUrl(schluessel: string): string {
  return `/planung?${new URLSearchParams({ weekKey: schluessel }).toString()}`;
}

/**
 * Leitet Beschriftung, Zeitraum und Ziel-Adressen einer Planungswoche ab.
 *
 * @param eingabe Rohparameter aus der Adresse, Zeitpunkt und Zone.
 * @returns Ein vollstaendiges Navigationsmodell oder `{ art: "fehlerhaft" }`.
 */
export function wochenmodell(eingabe: WochenmodellEingabe): Wochenmodell {
  const { weekKeyAusUrl, jetzt, zone } = eingabe;

  // Fall 1: mehrdeutige Angabe. Vor jeder weiteren Auswertung, damit der
  // Rohwert gar nicht erst auf einen Einzelwert reduziert wird.
  if (Array.isArray(weekKeyAusUrl)) return FEHLERHAFT;

  const laufende = isoWeekOfLocalDate(localBusinessDate(jetzt, zone));

  let angezeigt: PlanningWeek;
  if (weekKeyAusUrl === undefined) {
    angezeigt = laufende;
  } else {
    const geprueft = parseIsoWeekKey(weekKeyAusUrl);
    if (!geprueft.ok) return FEHLERHAFT;
    angezeigt = geprueft.week;
  }

  // Fall 2: die Nachbarwochen. Nur `RangeError` wird abgefangen — das ist die
  // Klasse, mit der die Domain eine unerreichbare Woche meldet. Jede andere
  // Ausnahme waere ein echter Defekt und darf nicht als „ungueltige Eingabe"
  // getarnt werden.
  let vorherige: PlanningWeek;
  let naechste: PlanningWeek;
  let zeitraum: PlanningWeekDateRange;
  try {
    vorherige = shiftPlanningWeek(angezeigt, -1);
    naechste = shiftPlanningWeek(angezeigt, 1);
    zeitraum = planningWeekDateRange(angezeigt);
  } catch (fehler) {
    if (fehler instanceof RangeError) return FEHLERHAFT;
    throw fehler;
  }

  return {
    art: "woche",
    schluessel: planningWeekKey(angezeigt),
    isoWochenText: `KW ${zweistellig(angezeigt.isoWeek)} · ${vierstellig(angezeigt.isoYear)}`,
    zeitraumText: `${tagText(zeitraum.monday)} – ${tagText(zeitraum.sunday)}`,
    vorherigeUrl: planungsUrl(planningWeekKey(vorherige)),
    naechsteUrl: planungsUrl(planningWeekKey(naechste)),
    heuteUrl: planungsUrl(planningWeekKey(laufende)),
    istAktuelleWoche: isSameWeek(angezeigt, laufende),
  };
}
