/**
 * Planungswoche und lokales Geschäftsdatum (EYT-74, `FIND-003` High).
 *
 * ## Der Fehler
 *
 * Die Konfliktengine des Prototyps summierte alle übergebenen Einsätze einer
 * Person in **eine** `employeeWeeklyHours`-Map, ohne nach Woche zu gruppieren.
 * Wer zwei Wochen gleichzeitig auswertete, bekam Überstundenwarnungen oder
 * blockierende Konflikte für Planungen, die je Woche zulässig waren.
 *
 * ## Warum dafür eine Zeitzone nötig ist
 *
 * Ein Einsatz ist ein Paar UTC-Instants. Eine Woche ist ein Kalenderbegriff.
 * Zwischen beidem liegt die Zeitzone, und ohne sie ist die Zuordnung schlicht
 * falsch: `2026-08-03 00:30–08:30` Europe/Berlin ist
 * `2026-08-02T22:30Z–2026-08-03T06:30Z`. Wer die Woche aus `startUtc` ableitet,
 * legt diese Montagsschicht in die **Vorwoche**. Genau deshalb verlangt
 * `docs/audit/INTEGRATION_ARCHITECTURE.md` „UTC-Instants **plus** IANA-Zeitzone
 * und lokale Geschäftsdaten" — vor diesem Modul gab es im Repository keinerlei
 * Zeitzonenbehandlung.
 *
 * ## Festgelegte Regeln
 *
 * 1. **Wochenregel: ISO-8601.** Woche beginnt Montag; Woche 1 ist die Woche mit
 *    dem ersten Donnerstag des Jahres. Damit ist der Jahreswechsel eindeutig —
 *    der 1. Januar gehört regelmäßig noch zur letzten Woche des Vorjahres.
 * 2. **Ein Einsatz gehört in die Woche seines *Beginns*.** Eine Schicht über
 *    Mitternacht wird nicht aufgeteilt. Das ist die übliche Konvention in der
 *    Schichtplanung und die einzige, die ohne Aufteilung der Dauer auskommt;
 *    sie ist hier ausdrücklich festgeschrieben, damit Wochenansicht und
 *    Vier-Wochen-Projektion garantiert dieselbe Zuordnung verwenden.
 * 3. **Die Zeitzone ist ein expliziter Parameter, kein globaler Zustand.** Es
 *    gibt bewusst keinen Standardwert: eine implizite Server- oder
 *    Browserzeitzone wäre exakt die Klasse Fehler, die dieses Modul behebt.
 *
 * Für den Pilotbetrieb in Deutschland ist {@link EUROPE_BERLIN} vorbereitet.
 * Der Wert wird pro Organisation konfiguriert, sobald das Fachschema ihn trägt
 * (EYT-86) — bis dahin übergibt der Aufrufer ihn ausdrücklich.
 */
import type { TimeInterval } from "./time-interval.js";

declare const timeZoneBrand: unique symbol;

/**
 * Geprüfte IANA-Zeitzonenkennung, z. B. `Europe/Berlin`.
 *
 * Gebrandet, damit ein beliebiger String nicht als Zeitzone durchgeht. Anders
 * als bei {@link TimeInterval} genügt hier ein Brand: der Wert ist ein
 * unveränderlicher String, es gibt keinen Zustand, der nachträglich brechen
 * könnte, und jede Verwendung läuft ohnehin durch `Intl`, das eine ungültige
 * Kennung selbst ablehnt.
 */
export type IanaTimeZone = string & { readonly [timeZoneBrand]: "IanaTimeZone" };

export type TimeZoneResult =
  | { readonly ok: true; readonly timeZone: IanaTimeZone }
  | { readonly ok: false; readonly error: "TIME_ZONE_UNKNOWN" };

/**
 * Prüft eine Zeitzonenkennung gegen die Laufzeit-Datenbank.
 *
 * `Intl.DateTimeFormat` wirft bei unbekannter Kennung — das ist die einzige
 * Quelle, die wirklich weiss, welche Zonen diese Laufzeit kennt. Eine eigene
 * Liste wäre sofort veraltet.
 */
export function createTimeZone(id: string): TimeZoneResult {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: id }).format(0);
    return { ok: true, timeZone: id as IanaTimeZone };
  } catch {
    return { ok: false, error: "TIME_ZONE_UNKNOWN" };
  }
}

/** Pilotzeitzone. Wird pro Organisation konfigurierbar, sobald EYT-86 sie trägt. */
export const EUROPE_BERLIN: IanaTimeZone = "Europe/Berlin" as IanaTimeZone;

/**
 * Lokales Geschäftsdatum — der Kalendertag, den ein Mensch vor Ort sieht.
 * Bewusst kein `Date`: ein Kalendertag hat keine Uhrzeit und keinen Offset.
 */
export interface LocalBusinessDate {
  readonly year: number;
  /** 1–12, nicht nullbasiert. */
  readonly month: number;
  /** 1–31. */
  readonly day: number;
}

const DAY_MS = 86_400_000;

/**
 * Kalendertag eines Instants in der angegebenen Zone.
 *
 * `formatToParts` statt String-Parsing: das Ausgabeformat von `format` hängt
 * vom Gebietsschema ab, die Teile nicht.
 */
export function localBusinessDate(instant: Date, timeZone: IanaTimeZone): LocalBusinessDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const read = (type: string): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined) {
      throw new RangeError(`Intl lieferte keinen Teil "${type}" fuer Zone ${timeZone}.`);
    }
    return Number.parseInt(value, 10);
  };

  return { year: read("year"), month: read("month"), day: read("day") };
}

/**
 * Offset der Zone gegenueber UTC zu einem konkreten Instant, in Millisekunden.
 *
 * Nicht konstant und nicht ableitbar: Europe/Berlin ist im Januar +1 h und im
 * Juli +2 h. Deshalb wird der Offset FUER DEN INSTANT bestimmt, indem die
 * lokalen Bestandteile zurueckgelesen und wieder als UTC zusammengesetzt
 * werden. Die Differenz ist der Offset.
 */
function zonenOffsetMs(instant: Date, timeZone: IanaTimeZone): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const read = (type: string): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined) {
      throw new RangeError(`Intl lieferte keinen Teil "${type}" fuer Zone ${timeZone}.`);
    }
    return Number.parseInt(value, 10);
  };

  const alsUtc = new Date(0);
  alsUtc.setUTCFullYear(read("year"), read("month") - 1, read("day"));
  alsUtc.setUTCHours(read("hour"), read("minute"), read("second"), 0);
  // Millisekunden gehen verloren; deshalb wird nur der Sekundenanteil des
  // Instants abgezogen, nicht der volle Wert.
  return alsUtc.getTime() - (instant.getTime() - (instant.getTime() % 1000));
}

/** Wanduhrzeit an einem lokalen Kalendertag. Stunden 0–23, Minuten 0–59. */
export interface LocalWallTime {
  readonly date: LocalBusinessDate;
  readonly hour: number;
  readonly minute: number;
}

export type WallTimeResult =
  | { readonly ok: true; readonly instant: Date }
  /** Der Zeitpunkt existiert nicht — Sommerzeitbeginn hat ihn uebersprungen. */
  | { readonly ok: false; readonly error: "NONEXISTENT_LOCAL_TIME" }
  /** Der Zeitpunkt existiert zweimal — Sommerzeitende hat ihn wiederholt. */
  | { readonly ok: false; readonly error: "AMBIGUOUS_LOCAL_TIME" };

/**
 * Wanduhrzeit einer Zone -> UTC-Instant. Die Gegenrichtung zu
 * {@link localBusinessDate}, gebraucht, sobald ein Mensch eine Zeit EINGIBT.
 *
 * ## Warum das nicht trivial ist
 *
 * Die Abbildung Wanduhr -> Instant ist weder total noch eindeutig. Zweimal im
 * Jahr bricht sie:
 *
 * - **Sommerzeitbeginn**: `2026-03-29 02:30` Europe/Berlin existiert nicht.
 *   Die Uhr springt von 02:00 auf 03:00. Jede Bibliothek, die hier still
 *   03:30 oder 01:30 zurueckgibt, hat einen Zeitpunkt erfunden.
 * - **Sommerzeitende**: `2026-10-25 02:30` existiert zweimal, einmal mit
 *   +02:00 und einmal mit +01:00. Wer einen davon still waehlt, verschiebt
 *   einen Einsatz um eine Stunde, ohne dass es jemand sieht.
 *
 * Beide Faelle werden deshalb als Fehler gemeldet und nicht geraten. Eine
 * Planerin bekommt eine Rueckfrage; ein stiller Griff ins Ungefaehre waere
 * genau die Klasse Fehler, die dieses Modul verhindert.
 *
 * ## Verfahren
 *
 * Die gewuenschte Wanduhrzeit wird zunaechst gelesen, als waere sie UTC. Von
 * diesem Naeherungswert wird der Zonenoffset abgezogen; weil der Offset selbst
 * vom Instant abhaengt, wird der Schritt einmal mit dem verbesserten Wert
 * wiederholt. Anschliessend wird durch RUECKLESEN geprueft, ob der Kandidat
 * tatsaechlich die gewuenschte Wanduhrzeit zeigt — nur das schliesst die Luecke
 * aus. Fuer die Doppeldeutigkeit werden beide Offsets der Umstellung
 * ausprobiert; bestehen zwei verschiedene Instants die Rueckleseprobe, ist die
 * Eingabe mehrdeutig.
 *
 * @throws {RangeError} bei einem Jahr kleiner als 1 oder unmoeglichen Feldern.
 */
export function utcInstantOfLocalWallTime(
  wall: LocalWallTime,
  timeZone: IanaTimeZone,
): WallTimeResult {
  const { date, hour, minute } = wall;
  if (!Number.isInteger(date.year) || date.year < 1) {
    throw new RangeError(`utcInstantOfLocalWallTime: Jahr ${date.year} ist nicht darstellbar.`);
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`utcInstantOfLocalWallTime: Stunde ${hour} liegt ausserhalb 0–23.`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError(`utcInstantOfLocalWallTime: Minute ${minute} liegt ausserhalb 0–59.`);
  }

  // Zwischenvariable statt `new Date(utcMidnightOfCalendarDay(…))`: der
  // Waechter `no-local-time-construction` erkennt in der verschachtelten Form
  // faelschlich eine Ortszeit-Konstruktion, weil sein Muster am ersten `)`
  // endet und die Kommas des inneren Aufrufs sieht. Die entschachtelte Form
  // ist ohnehin lesbarer — der Waechter bleibt dafuer unangetastet scharf.
  const mitternachtMs = utcMidnightOfCalendarDay(date.year, date.month, date.day);
  const naiv = new Date(mitternachtMs);
  naiv.setUTCHours(hour, minute, 0, 0);
  const naivMs = naiv.getTime();

  /** Zeigt dieser Instant in der Zone genau die gewuenschte Wanduhrzeit? */
  const zeigtGewuenschteZeit = (kandidatMs: number): boolean => {
    const kandidat = new Date(kandidatMs);
    const tag = localBusinessDate(kandidat, timeZone);
    if (tag.year !== date.year || tag.month !== date.month || tag.day !== date.day) return false;
    // Ein Instant, dessen zurueckgelesener Offset ihn wieder auf `naivMs`
    // abbildet, zeigt genau die gesuchte Wanduhrzeit — inklusive Stunde und
    // Minute, ohne sie zweitweise formatieren zu muessen.
    return kandidatMs + zonenOffsetMs(kandidat, timeZone) === naivMs;
  };

  const ersterVersuch = naivMs - zonenOffsetMs(naiv, timeZone);
  const zweiterVersuch = naivMs - zonenOffsetMs(new Date(ersterVersuch), timeZone);

  // Die Iteration allein findet die Doppeldeutigkeit NICHT: sie konvergiert auf
  // genau einen Zweig und meldet ihn als eindeutig. Deshalb werden zusaetzlich
  // die Offsets von 24 Stunden davor und danach ausprobiert. Jede Umstellung
  // liegt innerhalb dieses Fensters, also sind damit beide Offsets des Tages
  // vertreten — und am Rueckstellungstag bestehen zwei verschiedene Instants
  // die Rueckleseprobe.
  const EIN_TAG_MS = 86_400_000;
  const randOffsets = [naivMs - EIN_TAG_MS, naivMs + EIN_TAG_MS].map(
    (ms) => naivMs - zonenOffsetMs(new Date(ms), timeZone),
  );

  const treffer = [ersterVersuch, zweiterVersuch, ...randOffsets].filter(zeigtGewuenschteZeit);
  const eindeutig = [...new Set(treffer)];

  if (eindeutig.length === 0) return { ok: false, error: "NONEXISTENT_LOCAL_TIME" };
  if (eindeutig.length > 1) return { ok: false, error: "AMBIGUOUS_LOCAL_TIME" };
  const gefunden = eindeutig[0];
  if (gefunden === undefined) return { ok: false, error: "NONEXISTENT_LOCAL_TIME" };
  return { ok: true, instant: new Date(gefunden) };
}

/** Planungswoche nach ISO-8601. `isoYear` weicht am Jahreswechsel bewusst vom Kalenderjahr ab. */
export interface PlanningWeek {
  readonly isoYear: number;
  /** 1–53. */
  readonly isoWeek: number;
}

/**
 * UTC-Mitternacht eines Kalendertags — ohne die 1900-Umdeutung.
 *
 * Hier stand `Date.UTC(jahr, monat - 1, tag)`. Das ist für moderne Jahre
 * richtig und für Jahre 0 bis 99 falsch: `Date.UTC(99, 0, 1)` ergibt **1999**,
 * nicht das Jahr 99. Die Umdeutung ist stumm — kein Fehler, nur ein um 1900
 * Jahre verschobenes Ergebnis.
 *
 * Aufgefallen ist das bei EYT-88: `packages/contracts` prüft Wochenschlüssel
 * seither über `setUTCFullYear`, und ein Paritätsanspruch zwischen beiden
 * Seiten wäre für kleine Jahreszahlen schlicht falsch gewesen. Die Domain zieht
 * hier nach, damit die Behauptung „beide rechnen dieselbe Woche" auch an den
 * Rändern trägt.
 */
function utcMidnightOfCalendarDay(year: number, month1to12: number, day: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month1to12 - 1, day);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * ISO-8601-Woche eines lokalen Kalendertags.
 *
 * Reine Kalenderarithmetik auf einem bereits lokalisierten Datum, keine
 * Zeitzonenumrechnung. Der Donnerstag derselben Woche bestimmt das ISO-Jahr —
 * so fällt der 1. Januar automatisch in die letzte Woche des Vorjahres, wenn er
 * vor dem ersten Donnerstag liegt.
 *
 * Das Jahr 0 wird abgelehnt statt umgedeutet: PostgreSQL kennt kein Jahr null,
 * und eine Woche, die nur eine der beiden Seiten darstellen kann, ist keine
 * gemeinsame Regel. Dieselbe Grenze zieht
 * `packages/contracts/src/planning/iso-week.ts`.
 *
 * @throws {RangeError} bei einem Jahr kleiner als 1.
 */
export function isoWeekOfLocalDate(date: LocalBusinessDate): PlanningWeek {
  if (!Number.isInteger(date.year) || date.year < 1) {
    throw new RangeError(
      `isoWeekOfLocalDate: Jahr ${date.year} ist nicht darstellbar (kein Jahr null, keine negativen Jahre).`,
    );
  }
  const utcMidnight = utcMidnightOfCalendarDay(date.year, date.month, date.day);
  // Montag = 0 … Sonntag = 6.
  const weekdayIndex = (new Date(utcMidnight).getUTCDay() + 6) % 7;
  const thursdayMs = utcMidnight + (3 - weekdayIndex) * DAY_MS;
  const thursday = new Date(thursdayMs);
  const isoYear = thursday.getUTCFullYear();
  const firstThursdayWeekStart = utcMidnightOfCalendarDay(isoYear, 1, 1);
  const isoWeek = Math.floor((thursdayMs - firstThursdayWeekStart) / (7 * DAY_MS)) + 1;
  return { isoYear, isoWeek };
}

/**
 * Planungswoche eines Einsatzes.
 *
 * Massgeblich ist der **Beginn**, umgerechnet in die angegebene Zone. Siehe
 * Regel 2 im Dateikopf: eine Schicht über Mitternacht wird nicht aufgeteilt.
 */
export function planningWeekOf(interval: TimeInterval, timeZone: IanaTimeZone): PlanningWeek {
  return isoWeekOfLocalDate(localBusinessDate(interval.startUtc, timeZone));
}

/**
 * Stabiler Schlüssel `2026-W32` — sortierbar und als Map-Schlüssel geeignet.
 * Wochenansicht und Vier-Wochen-Projektion verwenden denselben Schlüssel, damit
 * sie nicht auseinanderlaufen koennen (EYT-74 AK 5).
 */
export function planningWeekKey(week: PlanningWeek): string {
  return `${String(week.isoYear).padStart(4, "0")}-W${String(week.isoWeek).padStart(2, "0")}`;
}

/** Gleichheit zweier Planungswochen. */
export function isSameWeek(a: PlanningWeek, b: PlanningWeek): boolean {
  return a.isoYear === b.isoYear && a.isoWeek === b.isoWeek;
}
