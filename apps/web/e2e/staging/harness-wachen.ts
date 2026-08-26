import { writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import {
  EUROPE_BERLIN,
  isSameWeek,
  isoWeekOfLocalDate,
  localBusinessDate,
  planningWeekDateRange,
  planningWeekKey,
  shiftPlanningWeek,
} from "@easytree/domain";
import type { LocalBusinessDate, PlanningWeek } from "@easytree/domain";
import { parseIsoWeekKey } from "@easytree/contracts";

/**
 * Wachen der Staging-Kernreise (EYT-142, Reparatur 26.08.2026).
 *
 * ## Warum diese Datei existiert
 *
 * Die Abnahme vom 25.08.2026 ist gelaufen und ihr Evidenzpaket ist
 * abgeschlossen — aber die Reise selbst war danach nicht gefahrlos
 * wiederholbar: ein unsicheres HTTP-Ziel als Vorgabewert, fest verdrahtete und
 * damit bereits VERBRAUCHTE Schreibwochen (veroeffentlichte Wochen sind per
 * DB-Trigger unloeschbar), ein `ids.json`, das auch ein fehlgeschlagener Lauf
 * ueberschrieb, und Negativ-Zusicherungen, die ein HTTP 500 als Erfolg
 * durchgelassen haetten. Jede dieser Fallen steht hier als reine, in
 * `apps/web/test/staging-harness-wachen.test.ts` deterministisch geprüfte
 * Funktion — die Reise und ihre Konfiguration rufen sie auf, statt die Regeln
 * inline zu wiederholen.
 *
 * ## Was hier bewusst NICHT passiert
 *
 * Kein Datenbankzugriff, kein Netz, keine Uhr ausser als Parameter `jetzt`:
 * die Wochensemantik kommt vollstaendig aus `@easytree/domain`
 * (`isoWeekOfLocalDate`, `localBusinessDate`, `EUROPE_BERLIN`) — dieselben
 * Funktionen, mit denen `app/planung/page.tsx` die laufende Woche bestimmt.
 * Eine zweite Wochenregel im Testharness waere genau der Fehler, gegen den
 * `lib/wochennavigation.ts` gebaut ist.
 */

/** Kanonische Staging-Origin der Abnahme (Runbook §3: Staging braucht HTTPS). */
export const KANONISCHE_STAGING_URL = "https://srv1308064.hstgr.cloud";

/**
 * Das abgeschlossene Evidenzpaket vom 25.08.2026 bleibt byte-unveraendert —
 * ein neuer Lauf darf dort niemals hineinschreiben.
 */
export const HISTORISCHES_EVIDENZ_VERZEICHNIS = "docs/evidence/2026-08-25-eyt-142-staging";

/** Gemessener Vertrag der Satz-fehlt-Ablehnung (Abnahme 25.08.2026). */
export const SATZ_FEHLT_PROBLEM_TYPE = "urn:easytree:costs:rate-not-found";

/**
 * Kanonischer Anzeigename des Satz-fehlt-Mitarbeiters — die Identitaet kommt
 * aus dem Repository, nicht aus dem Gedaechtnis eines Operators: Employee
 * `…e212` in `apps/web/e2e/auth-journey/fixtures.sql` (EYT-142, Reparatur
 * 26.08.2026). `EYT_SATZ_FEHLT_MITARBEITER` bleibt als bewusste Uebersteuerung
 * fuer einen Stack, dessen Altbestand die UUID unter anderem Namen traegt —
 * der reproduzierbare Vorgabepfad ist der kanonische Name.
 */
export const KANONISCHER_SATZ_FEHLT_MITARBEITER = "E2E-Mitarbeiter Ohne Satz";

/**
 * Obergrenze fuer den Abstand einer Schreibwoche zur laufenden Woche. Die
 * Reise navigiert per Klick vorwaerts; eine Woche jenseits dieser Schranke
 * ist mit hoher Wahrscheinlichkeit ein Tippfehler, kein Plan.
 */
export const MAX_WOCHEN_ABSTAND = 12;

/**
 * Prueft das Staging-Ziel, BEVOR ein Browser startet.
 *
 * Ohne Angabe gilt die kanonische HTTPS-Origin. Eine ausdruecklich gesetzte
 * Adresse muss HTTPS sein: ueber plain HTTP scheitert jeder Schreibvorgang im
 * Browser still, weil `crypto.randomUUID()` einen Secure Context verlangt
 * (gemessen 25.08.2026, Runbook §3). Es gibt keinen stillen Rueckfall — eine
 * unbrauchbare Angabe bricht hier ab, statt spaeter in einen Timeout zu
 * laufen.
 */
export function pruefeStagingUrl(rohwert: string | undefined): string {
  if (rohwert === undefined || rohwert === "") return KANONISCHE_STAGING_URL;
  let url: URL;
  try {
    url = new URL(rohwert);
  } catch {
    throw new Error(
      `[staging] EYT_STAGING_URL "${rohwert}" ist keine absolute URL. ` +
        `Erwartet wird eine HTTPS-Origin wie ${KANONISCHE_STAGING_URL}.`,
    );
  }
  if (url.protocol !== "https:") {
    throw new Error(
      `[staging] EYT_STAGING_URL "${rohwert}" ist nicht HTTPS. Die Schreibreise braucht einen ` +
        `Secure Context (crypto.randomUUID); ueber plain HTTP scheitert jeder Schreibvorgang ` +
        `still — gemessen 25.08.2026, Runbook §3. Kein stiller Rueckfall auf die Vorgabe.`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(
      `[staging] EYT_STAGING_URL enthaelt Zugangsdaten in der Adresse — nicht zulaessig.`,
    );
  }
  return rohwert;
}

/**
 * Die laufende ISO-Woche zu einem Zeitpunkt — mit exakt der Zeitzonen- und
 * Wochensemantik der Anwendung (`Europe/Berlin`, `@easytree/domain`).
 */
export function laufendeWoche(jetzt: Date): PlanningWeek {
  return isoWeekOfLocalDate(localBusinessDate(jetzt, EUROPE_BERLIN));
}

/** `JJJJ-MM-TT` — zonenfrei aus einem Kalendertag, ohne Gebietsschema. */
function datumText(tag: LocalBusinessDate): string {
  const zwei = (wert: number): string => String(wert).padStart(2, "0");
  return `${String(tag.year).padStart(4, "0")}-${zwei(tag.month)}-${zwei(tag.day)}`;
}

function pflichtWoche(name: string, rohwert: string | undefined): PlanningWeek {
  if (rohwert === undefined || rohwert === "") {
    throw new Error(
      `[staging] ${name} fehlt. Veroeffentlichte Wochen sind per DB-Trigger unloeschbar; jede ` +
        `Schreibreise braucht eine ausdruecklich benannte FRISCHE ISO-Woche (z. B. ` +
        `${name}=2026-W41). Es gibt bewusst keinen Vorgabewert — ein fester Wert waere nach dem ` +
        `ersten Lauf verbraucht und liefe beim zweiten in die Unveraenderlichkeit.`,
    );
  }
  const geprueft = parseIsoWeekKey(rohwert);
  if (!geprueft.ok) {
    throw new Error(
      `[staging] ${name} "${rohwert}" ist kein gueltiger ISO-Wochenschluessel ` +
        `(${geprueft.reason}). Erwartet wird z. B. 2026-W41.`,
    );
  }
  return geprueft.week;
}

/**
 * Wie viele "Naechste Woche"-Klicks von `von` nach `nach` fuehren.
 * `0` = dieselbe Woche, `-1` = nicht innerhalb von {@link MAX_WOCHEN_ABSTAND}
 * Schritten VORWAERTS erreichbar (also vergangen oder zu weit entfernt).
 */
export function wochenAbstandNachVorn(von: PlanningWeek, nach: PlanningWeek): number {
  if (isSameWeek(von, nach)) return 0;
  let lauf = von;
  for (let schritt = 1; schritt <= MAX_WOCHEN_ABSTAND; schritt += 1) {
    lauf = shiftPlanningWeek(lauf, 1);
    if (isSameWeek(lauf, nach)) return schritt;
  }
  return -1;
}

/**
 * Ein Kalendertag INNERHALB der gegebenen Woche. Ohne Angabe der Montag der
 * Woche — abgeleitet, nicht geraten, damit Wochen- und Datumsangabe nicht
 * auseinanderlaufen koennen. Eine ausdrueckliche Angabe ausserhalb der Woche
 * ist ein Widerspruch und bricht ab.
 */
export function datumInWoche(
  woche: PlanningWeek,
  rohwert: string | undefined,
  name: string,
): string {
  const zeitraum = planningWeekDateRange(woche);
  const montag = datumText(zeitraum.monday);
  const sonntag = datumText(zeitraum.sunday);
  if (rohwert === undefined || rohwert === "") return montag;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rohwert)) {
    throw new Error(`[staging] ${name} "${rohwert}" ist kein Datum im Format JJJJ-MM-TT.`);
  }
  if (rohwert < montag || rohwert > sonntag) {
    throw new Error(
      `[staging] ${name} "${rohwert}" liegt nicht in der Woche ${planningWeekKey(woche)} ` +
        `(${montag} bis ${sonntag}). Wochen- und Datumsangabe muessen zusammenpassen.`,
    );
  }
  return rohwert;
}

/**
 * Exakter Autorisierungsvertrag der beiden Negativreisen: authentifizierte,
 * aber unberechtigte Zugriffe werden mit GENAU HTTP 403 abgelehnt (gemessen
 * 25.08.2026). `null` = eingehalten, sonst die Abweichung als Text.
 *
 * Ein `>= 403` stand hier vorher — und haette ein HTTP 500 als
 * Sicherheitsnachweis gewertet. Ein Serverfehler beweist keine Autorisierung.
 */
export function autorisierungsVerdikt(status: number): string | null {
  if (status === 403) return null;
  return (
    `HTTP ${status} statt exakt 403 — nur die ausdrueckliche Ablehnung ist ein ` +
    `Autorisierungsnachweis; ein 5xx waere ein Serverfehler, kein Sicherheitsbeleg.`
  );
}

/**
 * Exakter Vertrag der Satz-fehlt-Ablehnung: GENAU HTTP 409 mit
 * `problem.type` = {@link SATZ_FEHLT_PROBLEM_TYPE} (gemessen 25.08.2026).
 * `null` = eingehalten, sonst die Abweichung als Text. Ein blosses `>= 400`
 * liess vorher auch ein HTTP 500 als fail-closed-Nachweis durchgehen.
 */
export function satzFehltVerdikt(status: number, problemType: unknown): string | null {
  if (status !== 409) {
    return `HTTP ${status} statt exakt 409 — nur die typisierte Ablehnung zaehlt als Nachweis.`;
  }
  if (problemType !== SATZ_FEHLT_PROBLEM_TYPE) {
    return `problem.type ${JSON.stringify(problemType)} statt "${SATZ_FEHLT_PROBLEM_TYPE}".`;
  }
  return null;
}

/** Ein Eintrag der Mitarbeiterliste, wie `GET /api/v1/kosten/mitarbeiter` ihn liefert. */
export interface MitarbeiterEintrag {
  readonly id: string;
  readonly displayName: string;
  readonly active: boolean;
}

/**
 * Pre-flight, Haelfte 1: der Satz-fehlt-Mitarbeiter muss in der
 * Mitarbeiterliste der Reiseorganisation stehen, aktiv sein und seinen
 * Anzeigenamen exakt einmal tragen — die Reise waehlt ihn per
 * `selectOption({ label })`, und ein doppelter Name waere dort mehrdeutig.
 *
 * Laeuft VOR jedem Publish: eine fehlende Fixture bricht die Reise ab, BEVOR
 * irgendeine frische Woche veroeffentlicht und damit verbraucht ist. Vorher
 * fiel das erst in der letzten Station auf — nach zwei verbrauchten Wochen.
 */
export function satzFehltMitarbeiterBefund(
  mitarbeiter: readonly MitarbeiterEintrag[],
  gesuchterName: string,
): { readonly ok: true; readonly id: string } | { readonly ok: false; readonly grund: string } {
  const treffer = mitarbeiter.filter((m) => m.displayName === gesuchterName);
  if (treffer.length === 0) {
    return {
      ok: false,
      grund:
        `Kein Mitarbeiter "${gesuchterName}" in der Reiseorganisation. Die kanonische Fixture ` +
        `legt ihn an: apps/web/e2e/auth-journey/fixtures.sql (Employee …e212, EYT-142). ` +
        `Abbruch VOR dem ersten Publish — keine Woche wurde verbraucht.`,
    };
  }
  if (treffer.length > 1) {
    return {
      ok: false,
      grund:
        `Anzeigename "${gesuchterName}" ist ${treffer.length}-fach vergeben — die Auswahl per ` +
        `Label waere mehrdeutig, die Reise koennte den falschen Mitarbeiter treffen.`,
    };
  }
  const einziger = treffer[0];
  if (einziger === undefined || !einziger.active) {
    return {
      ok: false,
      grund:
        `Mitarbeiter "${gesuchterName}" existiert, ist aber inaktiv — das Einsatzformular ` +
        `boete ihn nicht an.`,
    };
  }
  return { ok: true, id: einziger.id };
}

/**
 * Pre-flight, Haelfte 2: die definierende Eigenschaft. Der Mitarbeiter hat
 * exakt NULL Satzversionen — nicht "keine aktive", sondern KEINE. `null` =
 * eingehalten, sonst die Abweichung als Text. Hat er inzwischen einen Satz
 * bekommen, wuerde der Snapshot angelegt statt abgelehnt; das faellt hier auf,
 * bevor die Satz-fehlt-Woche veroeffentlicht und damit verbraucht wird.
 */
export function satzFehltFixtureVerdikt(anzahlSatzVersionen: number): string | null {
  if (anzahlSatzVersionen === 0) return null;
  return (
    `${anzahlSatzVersionen} Satzversion(en) statt exakt 0 — der Satz-fehlt-Mitarbeiter hat ` +
    `einen Satz erworben. Die Negativreise wuerde einen Snapshot ERZEUGEN statt die typisierte ` +
    `Ablehnung zu messen. Abbruch vor dem Publish; Fixture bereinigen oder per ` +
    `EYT_SATZ_FEHLT_MITARBEITER einen satzlosen Mitarbeiter benennen.`
  );
}

/** Die Segmentfolge des historischen Pakets — Wegstueck, nicht Zeichenkette. */
const HISTORISCHE_SEGMENTE = HISTORISCHES_EVIDENZ_VERZEICHNIS.split("/");

/**
 * Der Vorfahr von `zielAbsolut`, der das historische Evidenzpaket IST — oder
 * `null`, wenn der Pfad es weder ist noch darunter liegt.
 *
 * Verglichen wird SEGMENTWEISE auf dem bereits durch `resolve()`
 * normalisierten Pfad, nicht auf der rohen Zeichenkette. Beides ist
 * notwendig:
 *
 * - `resolve()` erledigt `.`, `..`, doppelte und abschliessende Trenner sowie
 *   den Bezug auf das Arbeitsverzeichnis. Genau diese Normalisierung nimmt
 *   `join()` in {@link schreibeEvidenz} spaeter ohnehin vor — eine Wache, die
 *   davor prueft, prueft einen anderen Pfad als den, der geschrieben wird.
 * - Der Segmentvergleich unterscheidet Nachfahre von Namensvetter:
 *   `…-staging/rerun` liegt im Paket, `…-staging-rerun` ist ein anderes
 *   Verzeichnis. Ein `startsWith` verwechselt beide.
 *
 * Bewusst OHNE feste Projektwurzel und damit ohne einzelnes `relative()`: das
 * abgeschlossene Paket ist in JEDEM Klon dasselbe Verzeichnis, und die Wache
 * kennt die Wurzel des Klons nicht, in dem der Operator gerade steht. Der
 * Segmentlauf ist die klon-unabhaengige Form derselben Aussage — er findet
 * das Paket unter jeder Wurzel, statt unter genau einer.
 *
 * Symlinks bleiben aussen vor: die Wache fasst das Dateisystem nicht an und
 * ist damit deterministisch und in Tests ohne Ablage pruefbar.
 */
function historischesPaketIn(zielAbsolut: string): string | null {
  const segmente = zielAbsolut.split(sep);
  for (let i = 0; i + HISTORISCHE_SEGMENTE.length <= segmente.length; i += 1) {
    if (HISTORISCHE_SEGMENTE.every((teil, versatz) => segmente[i + versatz] === teil)) {
      return segmente.slice(0, i + HISTORISCHE_SEGMENTE.length).join(sep);
    }
  }
  return null;
}

/**
 * Prueft das Evidenz-Zielverzeichnis. Das historische, abgeschlossene Paket
 * vom 25.08.2026 ist als Ziel verboten — es bleibt byte-unveraendert.
 *
 * Die geltende Invariante ist eine ueber den AUFGELOESTEN Pfad, nicht ueber
 * die eingegebene Zeichenkette: das Ziel darf das historische Verzeichnis
 * weder SEIN noch UNTERHALB davon liegen. Ein `endsWith` auf dem Rohwert
 * liess `…/2026-08-25-eyt-142-staging/rerun` und `…/2026-08-25-eyt-142-staging/.`
 * durch — beide fuehrt `join()` in {@link schreibeEvidenz} anschliessend
 * wieder in das Paket hinein.
 *
 * Zurueck kommt der EINGEGEBENE Pfad, nicht der aufgeloeste: die Aufloesung
 * ist Mittel der Pruefung, nicht ihr Ergebnis — der Aufrufer soll mit dem
 * Pfad weiterarbeiten, den der Operator gesetzt hat.
 */
export function pruefeEvidenzVerzeichnis(rohwert: string | undefined): string {
  const verzeichnis = rohwert === undefined || rohwert === "" ? "/tmp/eyt-142-evidence" : rohwert;
  const paket = historischesPaketIn(resolve(verzeichnis));
  if (paket !== null) {
    throw new Error(
      `[staging] EYT_EVIDENCE_DIR "${verzeichnis}" loest sich in das abgeschlossene historische ` +
        `Evidenzpaket ${HISTORISCHES_EVIDENZ_VERZEICHNIS} auf (${paket}) — das bleibt ` +
        `byte-unveraendert, samt allem darunter. Ein neuer Lauf braucht ein eigenes ` +
        `Verzeichnis ausserhalb dieses Pakets.`,
    );
  }
  return verzeichnis;
}

export interface EvidenzErgebnis {
  readonly datei: string;
  readonly kanonisch: boolean;
}

/**
 * Schreibt das ID-Protokoll eines Laufs — aber `ids.json` (den letzten als gut
 * bekannten Stand) NUR, wenn der Lauf vollstaendig und gruen war. Ein
 * fehlgeschlagener oder abgebrochener Lauf landet in einer eindeutig
 * benannten `ids.partial-…`-Datei und laesst das kanonische `ids.json`
 * unangetastet.
 */
export function schreibeEvidenz(
  verzeichnis: string,
  protokoll: Record<string, unknown>,
  laufVollstaendigGruen: boolean,
  stempel: string = new Date().toISOString().replace(/[:.]/g, "-"),
): EvidenzErgebnis {
  const inhalt = JSON.stringify(protokoll, null, 2);
  const datei = laufVollstaendigGruen
    ? join(verzeichnis, "ids.json")
    : join(verzeichnis, `ids.partial-${stempel}.json`);
  writeFileSync(datei, inhalt);
  return { datei, kanonisch: laufVollstaendigGruen };
}

/** Alle Eingaben der Reise, gelesen und auf Widerspruchsfreiheit geprueft. */
export interface ReiseEingaben {
  readonly laufendeWocheKey: string;
  readonly vorherigeWocheKey: string;
  readonly naechsteWocheKey: string;
  readonly reisewocheKey: string;
  /** Anzahl "Naechste Woche"-Klicks von der laufenden zur Reisewoche (>= 1). */
  readonly reiseOffset: number;
  /** Schluessel jeder Zwischenwoche auf dem Klickweg, in Reihenfolge. */
  readonly reiseKlickWochen: readonly string[];
  readonly einsatzDatum: string;
  readonly satzFehltWocheKey: string;
  readonly satzFehltDatum: string;
  readonly satzFehltMitarbeiter: string;
  readonly evidenzVerzeichnis: string;
}

/**
 * Liest und prueft alle Reise-Eingaben — beim LADEN der Testdatei, also vor
 * jedem Login und jedem Schreibversuch. Fehlende oder widerspruechliche
 * Eingaben brechen hier mit einer praezisen Meldung ab, statt spaeter halb
 * gefahren an der Unveraenderlichkeit veroeffentlichter Wochen zu scheitern.
 */
export function leseReiseEingaben(
  env: Record<string, string | undefined>,
  jetzt: Date,
): ReiseEingaben {
  const laufende = laufendeWoche(jetzt);
  const laufendeKey = planningWeekKey(laufende);

  const reisewoche = pflichtWoche("EYT_JOURNEY_WOCHE", env["EYT_JOURNEY_WOCHE"]);
  const reiseOffset = wochenAbstandNachVorn(laufende, reisewoche);
  if (reiseOffset < 1) {
    throw new Error(
      `[staging] EYT_JOURNEY_WOCHE ${planningWeekKey(reisewoche)} muss 1 bis ` +
        `${MAX_WOCHEN_ABSTAND} Wochen NACH der laufenden Woche ${laufendeKey} liegen: ` +
        `veroeffentlichte Wochen sind unloeschbar, die laufende oder eine vergangene Woche kann ` +
        `bereits verbraucht sein, und die Reise navigiert per Klick vorwaerts.`,
    );
  }

  const satzFehltWoche = pflichtWoche("EYT_SATZ_FEHLT_WOCHE", env["EYT_SATZ_FEHLT_WOCHE"]);
  const satzOffset = wochenAbstandNachVorn(laufende, satzFehltWoche);
  if (satzOffset < 1) {
    throw new Error(
      `[staging] EYT_SATZ_FEHLT_WOCHE ${planningWeekKey(satzFehltWoche)} muss 1 bis ` +
        `${MAX_WOCHEN_ABSTAND} Wochen NACH der laufenden Woche ${laufendeKey} liegen — auch die ` +
        `Satz-fehlt-Reise veroeffentlicht ihre Woche und verbraucht sie damit.`,
    );
  }
  if (isSameWeek(satzFehltWoche, reisewoche)) {
    throw new Error(
      `[staging] EYT_SATZ_FEHLT_WOCHE und EYT_JOURNEY_WOCHE bezeichnen dieselbe Woche ` +
        `${planningWeekKey(reisewoche)}. Ein Entwurf je Woche und Organisation ist die geltende ` +
        `Invariante — die Satz-fehlt-Reise braucht ihre eigene frische Woche.`,
    );
  }

  // Vorgabewert statt Pflicht-Eingabe (Reparatur 26.08.2026): der Mitarbeiter
  // ist seither kanonische Fixture-Wahrheit (`fixtures.sql`, Employee `…e212`),
  // kein manuell erinnerter Umgebungszustand mehr. Ob er wirklich existiert
  // und wirklich satzlos ist, prueft die Reise VOR jedem Publish ueber
  // {@link satzFehltMitarbeiterBefund} und {@link satzFehltFixtureVerdikt}.
  const rohMitarbeiter = env["EYT_SATZ_FEHLT_MITARBEITER"];
  const satzFehltMitarbeiter =
    rohMitarbeiter === undefined || rohMitarbeiter === ""
      ? KANONISCHER_SATZ_FEHLT_MITARBEITER
      : rohMitarbeiter;

  const klickWochen: string[] = [];
  let lauf = laufende;
  for (let schritt = 1; schritt <= reiseOffset; schritt += 1) {
    lauf = shiftPlanningWeek(lauf, 1);
    klickWochen.push(planningWeekKey(lauf));
  }

  return {
    laufendeWocheKey: laufendeKey,
    vorherigeWocheKey: planningWeekKey(shiftPlanningWeek(laufende, -1)),
    naechsteWocheKey: planningWeekKey(shiftPlanningWeek(laufende, 1)),
    reisewocheKey: planningWeekKey(reisewoche),
    reiseOffset,
    reiseKlickWochen: klickWochen,
    einsatzDatum: datumInWoche(reisewoche, env["EYT_JOURNEY_DATUM"], "EYT_JOURNEY_DATUM"),
    satzFehltWocheKey: planningWeekKey(satzFehltWoche),
    satzFehltDatum: datumInWoche(satzFehltWoche, undefined, "EYT_SATZ_FEHLT_WOCHE"),
    satzFehltMitarbeiter,
    evidenzVerzeichnis: pruefeEvidenzVerzeichnis(env["EYT_EVIDENCE_DIR"]),
  };
}
