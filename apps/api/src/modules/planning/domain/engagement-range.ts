/**
 * Einsatzgrenzen und Tagesarbeitszeit als reine Regeln (EYT-120, D-003/D-009).
 *
 * Alles hier ist frei von Datenbank und Uhr: `now` kommt herein, die Zone kommt herein.
 * Lokale Wanduhrzeiten loest `utcInstantOfLocalWallTime` fail-closed auf — nicht
 * existente und mehrdeutige Sommerzeit-Zeiten werden BENANNT, nie geraten. Es gibt hier
 * keine Funktion, die eine Arbeitszeit an eine Grenze anpasst: Clipping ist verboten.
 */
import { utcInstantOfLocalWallTime, type IanaTimeZone } from "@easytree/domain";

export interface LocalDateTimeInput {
  readonly date: string; // JJJJ-MM-TT, vertraglich geprueft
  readonly time: string; // HH:MM, vertraglich geprueft
}

export interface EngagementBounds {
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date | null;
}

export type EngagementRangeProblem =
  | { readonly kind: "LOCAL_TIME_NONEXISTENT"; readonly feld: string }
  | { readonly kind: "LOCAL_TIME_AMBIGUOUS"; readonly feld: string }
  | { readonly kind: "ENGAGEMENT_START_IN_PAST" }
  | { readonly kind: "ENGAGEMENT_END_NOT_AFTER_START" };

type Result<T> =
  ({ readonly ok: true } & T) | { readonly ok: false; readonly problem: EngagementRangeProblem };

function wallTimeParts(value: LocalDateTimeInput): {
  date: { year: number; month: number; day: number };
  hour: number;
  minute: number;
} {
  const [y, m, d] = value.date.split("-").map(Number);
  const [h, min] = value.time.split(":").map(Number);
  if ([y, m, d, h, min].some((n) => n === undefined || Number.isNaN(n))) {
    throw new Error("EYT-120: unvertragliche lokale Zeit erreichte die Domain.");
  }
  return {
    date: { year: y as number, month: m as number, day: d as number },
    hour: h as number,
    minute: min as number,
  };
}

/** Wanduhrzeit -> Instant, mit benanntem Feld im Fehlerfall. */
export function resolveLocalDateTime(
  value: LocalDateTimeInput,
  zone: IanaTimeZone,
  feld: string,
): Result<{ readonly instant: Date }> {
  const r = utcInstantOfLocalWallTime(wallTimeParts(value), zone);
  if (!r.ok) {
    return {
      ok: false,
      problem: {
        kind:
          r.error === "AMBIGUOUS_LOCAL_TIME" ? "LOCAL_TIME_AMBIGUOUS" : "LOCAL_TIME_NONEXISTENT",
        feld,
      },
    };
  }
  return { ok: true, instant: r.instant };
}

/**
 * Einsatzgrenzen aufloesen. Reihenfolge: erst die Aufloesbarkeit BEIDER Zeiten (sonst ist
 * "vor jetzt" keine sinnvolle Aussage), dann Vergangenheit (Gleichheit passt), dann Ordnung.
 */
export function resolveEngagementBounds(
  input: { readonly startAt: LocalDateTimeInput; readonly endAt: LocalDateTimeInput | null },
  zone: IanaTimeZone,
  now: Date,
): Result<{ readonly bounds: EngagementBounds }> {
  const start = resolveLocalDateTime(input.startAt, zone, "startAt");
  if (!start.ok) return start;
  let endsAtUtc: Date | null = null;
  if (input.endAt !== null) {
    const ende = resolveLocalDateTime(input.endAt, zone, "endAt");
    if (!ende.ok) return ende;
    endsAtUtc = ende.instant;
  }
  if (start.instant.getTime() < now.getTime()) {
    return { ok: false, problem: { kind: "ENGAGEMENT_START_IN_PAST" } };
  }
  if (endsAtUtc !== null && endsAtUtc.getTime() <= start.instant.getTime()) {
    return { ok: false, problem: { kind: "ENGAGEMENT_END_NOT_AFTER_START" } };
  }
  return { ok: true, bounds: { startsAtUtc: start.instant, endsAtUtc } };
}

export interface WorkingInterval {
  readonly start: Date;
  readonly end: Date;
}

/** Arbeitszeit eines Tages -> halb-offenes Instant-Intervall; DST fail-closed je Grenze. */
export function resolveWorkingInterval(
  localDate: string,
  workingTime: { readonly from: string; readonly to: string },
  zone: IanaTimeZone,
): Result<{ readonly interval: WorkingInterval }> {
  const von = resolveLocalDateTime(
    { date: localDate, time: workingTime.from },
    zone,
    `days[${localDate}].workingTime.from`,
  );
  if (!von.ok) return von;
  const bis = resolveLocalDateTime(
    { date: localDate, time: workingTime.to },
    zone,
    `days[${localDate}].workingTime.to`,
  );
  if (!bis.ok) return bis;
  return { ok: true, interval: { start: von.instant, end: bis.instant } };
}

/** D-009: vollstaendig innerhalb [Beginn, Ende]; offenes Ende hat keine Obergrenze. */
export function workingIntervalWithinBounds(
  interval: WorkingInterval,
  bounds: EngagementBounds,
): boolean {
  if (interval.start.getTime() < bounds.startsAtUtc.getTime()) return false;
  if (bounds.endsAtUtc !== null && interval.end.getTime() > bounds.endsAtUtc.getTime())
    return false;
  return true;
}
