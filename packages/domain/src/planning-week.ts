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

/** Planungswoche nach ISO-8601. `isoYear` weicht am Jahreswechsel bewusst vom Kalenderjahr ab. */
export interface PlanningWeek {
  readonly isoYear: number;
  /** 1–53. */
  readonly isoWeek: number;
}

/**
 * ISO-8601-Woche eines lokalen Kalendertags.
 *
 * Rechnung bewusst in UTC-Millisekunden über `Date.UTC`: das ist an dieser
 * Stelle reine Kalenderarithmetik auf einem bereits lokalisierten Datum, keine
 * Zeitzonenumrechnung. Der Donnerstag derselben Woche bestimmt das ISO-Jahr —
 * so fällt der 1. Januar automatisch in die letzte Woche des Vorjahres, wenn er
 * vor dem ersten Donnerstag liegt.
 */
export function isoWeekOfLocalDate(date: LocalBusinessDate): PlanningWeek {
  const utcMidnight = Date.UTC(date.year, date.month - 1, date.day);
  // Montag = 0 … Sonntag = 6.
  const weekdayIndex = (new Date(utcMidnight).getUTCDay() + 6) % 7;
  const thursdayMs = utcMidnight + (3 - weekdayIndex) * DAY_MS;
  const thursday = new Date(thursdayMs);
  const isoYear = thursday.getUTCFullYear();
  const firstThursdayWeekStart = Date.UTC(isoYear, 0, 1);
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
