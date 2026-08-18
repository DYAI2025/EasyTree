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
 * ## Zwei Faelle, die als `fehlerhaft` enden — und warum sie trotzdem einen Weg tragen
 *
 * 1. **`parameter-unbrauchbar`.** Was in der Adresse steht, ist keine Woche.
 *    Zwei Wege fuehren hierher, und sie teilen sich den Grund bewusst: ein
 *    mehrfach angegebener `weekKey` (Next liefert dann ein Array — eine
 *    mehrdeutige Angabe, deren stilles Reduzieren auf den ersten Wert eine
 *    Antwort auf eine nicht gestellte Frage waere; die Regel stammt unveraendert
 *    aus `app/planung/page.tsx`), und ein vorhandener, aber ungueltiger
 *    Schluessel. Fuer die Planerin ist der Unterschied keiner, auf den sie
 *    anders reagieren koennte.
 * 2. **`woche-ohne-nachbarwoche`.** `9999-W52` und `0001-W01` sind fuer sich
 *    GUELTIGE Schluessel und koennen in der Adresse stehen, aber ihre
 *    Nachbarwoche liegt ausserhalb der Vertragsgrenze 0001–9999;
 *    `shiftPlanningWeek` wirft dort (gemessen 18.08.2026). Ein durchgereichter
 *    Fehler wuerde die Server-Komponente sprengen, ein halbes Modell mit einem
 *    Link, der nirgends hinfuehrt, waere die stille Variante. Also: entweder ein
 *    vollstaendig benutzbares Navigationsmodell oder keins.
 *
 * Dass diese beiden Faelle ueberhaupt unterscheidbar sind, ist Korrekturbefund
 * `B3`: bis dahin sah eine gueltige Randwoche fuer die Planerin genauso aus wie
 * ein Tippfehler. Das Modell trennt sie jetzt; ob die Darstellung den
 * Unterschied zeigt, entscheidet M4 — der M4-Abnahmevertrag sagt heute nichts
 * darueber, und diese Datei behauptet deshalb auch nichts darueber.
 *
 * **Beide Fehlerfaelle tragen `heuteUrl`** (Korrekturbefund `K8`). Der
 * M4-Abnahmevertrag verlangt aus dem Parameterfehler heraus den Klick auf
 * „Heute" zurueck zur laufenden Woche. Traege die Fehlervariante nur `art`,
 * muesste M4 sich dieses Ziel woanders holen: entweder ueber eine eigene
 * Wochenableitung — genau die zweite Wochenregel, gegen die diese Datei gebaut
 * ist — oder ueber ein zweites hartkodiertes `/planung`. Deshalb wird die
 * laufende Woche VOR jeder Ablehnung abgeleitet, und der Rueckweg kommt aus
 * derselben Quelle wie jede andere Adresse hier.
 *
 * Ein FEHLENDER Parameter ist etwas anderes als ein ungueltiger: er ergibt die
 * laufende Woche (`AC-003`), ein vorhandener, aber ungueltiger bleibt
 * `fehlerhaft` (`E2`).
 *
 * ## Was diese Datei NICHT zusichert
 *
 * - **Fremde Adressparameter gehen verloren** (Korrekturbefund `B6`). Die
 *   Funktion bekommt ausschliesslich `weekKeyAusUrl`, nicht die ganze Abfrage,
 *   und jede erzeugte Adresse traegt genau einen Parameter. Heute ist das
 *   schadenfrei, weil `/planung` nur `weekKey` liest. Das ist eine bewusste
 *   Zusage fuer M3/M4 und kein Versehen — sobald die Seite einen zweiten
 *   Parameter liest, muss die Eingabe erweitert werden, sonst wirft das
 *   Blaettern ihn still weg.
 * - **Die Einengung auf `RangeError` ist heute ungemessen** (Korrekturbefund
 *   `B4`). Im `try` stehen ausschliesslich Domainaufrufe, die nur `RangeError`
 *   werfen; ein blankes `catch { … }` liesse den ganzen Testsatz gruen. Die
 *   Einengung steht trotzdem da, weil ein anderer Fehler ein echter Defekt
 *   waere und nicht als „ungueltige Eingabe" getarnt werden darf — aber sie ist
 *   eine Absicht, kein Nachweis. Wer im `try` etwas ergaenzt, das anders wirft,
 *   schuldet dieser Zeile einen Test.
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
/**
 * Warum die Woche nicht dargestellt werden kann. Zwei Werte, nicht drei: der
 * mehrfach angegebene und der ungueltige Parameter teilen sich bewusst einen
 * Grund (siehe Dateikopf).
 */
export type Fehlergrund = "parameter-unbrauchbar" | "woche-ohne-nachbarwoche";

export type Wochenmodell =
  | {
      readonly art: "fehlerhaft";
      readonly grund: Fehlergrund;
      /**
       * Auch der Fehlerfall traegt den Rueckweg zur LAUFENDEN Woche — sonst
       * waere er eine Sackgasse und M4 muesste sich das Ziel selbst ausrechnen.
       */
      readonly heuteUrl: string;
    }
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
 * @returns Ein vollstaendiges Navigationsmodell, oder die Fehlervariante mit
 *   `grund` und dem Rueckweg `heuteUrl` — nie ein halbes Modell.
 */
export function wochenmodell(eingabe: WochenmodellEingabe): Wochenmodell {
  const { weekKeyAusUrl, jetzt, zone } = eingabe;

  // Die laufende Woche steht VOR jeder Ablehnung: sie ist der Rueckweg, den
  // auch der Fehlerfall tragen muss (`K8`). Sie haengt an keiner Eingabe aus
  // der Adresse und kann deshalb hier oben nicht scheitern.
  const laufende = isoWeekOfLocalDate(localBusinessDate(jetzt, zone));
  const heuteUrl = planungsUrl(planningWeekKey(laufende));
  const fehlerhaft = (grund: Fehlergrund): Wochenmodell => ({
    art: "fehlerhaft",
    grund,
    heuteUrl,
  });

  // Fall 1a: mehrdeutige Angabe. Vor jeder weiteren Auswertung, damit der
  // Rohwert gar nicht erst auf einen Einzelwert reduziert wird.
  if (Array.isArray(weekKeyAusUrl)) return fehlerhaft("parameter-unbrauchbar");

  let angezeigt: PlanningWeek;
  if (weekKeyAusUrl === undefined) {
    angezeigt = laufende;
  } else {
    // Fall 1b: vorhanden, aber keine Woche.
    const geprueft = parseIsoWeekKey(weekKeyAusUrl);
    if (!geprueft.ok) return fehlerhaft("parameter-unbrauchbar");
    angezeigt = geprueft.week;
  }

  // Fall 2: die Nachbarwochen. Nur `RangeError` wird abgefangen — das ist die
  // Klasse, mit der die Domain eine unerreichbare Woche meldet. Jede andere
  // Ausnahme waere ein echter Defekt und darf nicht als „ungueltige Eingabe"
  // getarnt werden; dass heute kein Test diese Einengung einloest, steht im
  // Dateikopf (`B4`).
  //
  // Die tragende Bedingung ist die GEMEINSAME BEWACHUNG, nicht die Reihenfolge
  // (`B5`, korrigiert 19.08.2026): `planningWeekDateRange({ isoYear: 9999,
  // isoWeek: 52 })` wirft nicht, sondern liefert als Sonntag den 02.01.10000 —
  // gemessen gegen `packages/domain/dist`. Unerreichbar bleibt dieser Sonntag,
  // weil `shiftPlanningWeek(angezeigt, 1)` im selben `try` wirft und das
  // `return` erst NACH allen drei Zuweisungen steht. An einer umgeordneten
  // Fassung gemessen (Zeitraumzeile zuerst): der Testsatz bleibt vollstaendig
  // gruen — die Reihenfolge traegt nichts.
  // Gefaehrlich ist deshalb etwas anderes: die Zeitraumzeile aus diesem Block
  // herauszuziehen — vor das `try`, hinter das `catch` oder in den Rueckgabe-
  // ausdruck. Dann steht der fuenfstellige Jahreswert vor der Planerin, ohne
  // dass ein Test es meldet.
  let vorherige: PlanningWeek;
  let naechste: PlanningWeek;
  let zeitraum: PlanningWeekDateRange;
  try {
    vorherige = shiftPlanningWeek(angezeigt, -1);
    naechste = shiftPlanningWeek(angezeigt, 1);
    zeitraum = planningWeekDateRange(angezeigt);
  } catch (fehler) {
    if (fehler instanceof RangeError) return fehlerhaft("woche-ohne-nachbarwoche");
    throw fehler;
  }

  return {
    art: "woche",
    schluessel: planningWeekKey(angezeigt),
    isoWochenText: `KW ${zweistellig(angezeigt.isoWeek)} · ${vierstellig(angezeigt.isoYear)}`,
    zeitraumText: `${tagText(zeitraum.monday)} – ${tagText(zeitraum.sunday)}`,
    vorherigeUrl: planungsUrl(planningWeekKey(vorherige)),
    naechsteUrl: planungsUrl(planningWeekKey(naechste)),
    heuteUrl,
    istAktuelleWoche: isSameWeek(angezeigt, laufende),
  };
}
