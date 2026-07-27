/**
 * Zeitliche Randfaelle (EYT-61 AK6).
 *
 * AK6 nennt vier Faelle woertlich: Sommerzeitluecke, doppelte Winterzeitstunde,
 * Mitternachtswechsel, Effective Dates. Diese Datei deckt die ersten drei ab,
 * und zwar an den Stellen, die vorher NICHT geprueft waren.
 *
 * ## Was vorher schon geprueft war, und warum das nicht genuegt
 *
 * `time-interval.test.ts` prueft die DAUER ueber beide Umstellungen, und
 * `planning-week.test.ts` prueft die Wochenzuordnung ueber die Maerzgrenze.
 * Ungeprueft blieb die Zuordnung selbst am Oktoberdatum — also der Fall, in
 * dem ZWEI verschiedene Instants dieselbe Wanduhrzeit tragen — und beide
 * exakten Tagesgrenzen.
 *
 * ## Die Umstellungstermine, nachgerechnet statt uebernommen
 *
 * Europe/Berlin, 2026:
 *   Fruehjahr  So 2026-03-29, 02:00 CET  -> 03:00 CEST   (01:00 UTC)
 *   Herbst     So 2026-10-25, 03:00 CEST -> 02:00 CET    (01:00 UTC)
 *
 * Daraus folgt fuer den Oktober: die Ortszeit 02:30 kommt zweimal vor, einmal
 * um 00:30 UTC (noch CEST, +2) und einmal um 01:30 UTC (schon CET, +1). Genau
 * diese beiden Instants sind unten die Probe. Die Zusicherungen unter
 * "Voraussetzung" belegen das im Test selbst — ohne sie waere alles Weitere
 * eine Behauptung ueber die Zeitzonendatenbank der ausfuehrenden Maschine.
 */
import { describe, expect, it } from "vitest";

import {
  aggregateWeeklyLoad,
  EUROPE_BERLIN,
  isoWeekOfLocalDate,
  localBusinessDate,
  planningWeekKey,
  planningWeekOf,
  TimeInterval,
  unsafeIdentifier,
} from "../src/index.js";
import type { EmployeeId } from "../src/index.js";

const ANNA = unsafeIdentifier<EmployeeId>("00000000-0000-0000-0000-0000004010a1");

function interval(startIso: string, endIso: string): TimeInterval {
  const result = TimeInterval.create(new Date(startIso), new Date(endIso));
  if (!result.ok) throw new Error(`Fixture ungueltig: ${result.error}`);
  return result.interval;
}

/** Ortszeit als `HH:MM` in der Pilotzone — die Sicht, die der Mensch hat. */
function berlinClock(instant: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: EUROPE_BERLIN,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

/** Offset gegen UTC in Minuten, aus der Zone gelesen statt angenommen. */
function berlinOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EUROPE_BERLIN,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(raw);
  if (match === null) throw new Error(`Offset nicht lesbar: "${raw}"`);
  const [, sign, hours, minutes] = match;
  const magnitude = Number(hours) * 60 + Number(minutes);
  return sign === "-" ? -magnitude : magnitude;
}

// ===========================================================================
// Voraussetzung: die Umstellungstermine stimmen wirklich
// ===========================================================================
describe("Umstellungstermine 2026 in Europe/Berlin", () => {
  it("stellt am 29. Maerz vor und am 25. Oktober zurueck", () => {
    // Jeweils eine Stunde vor und nach dem Wechsel um 01:00 UTC.
    expect(berlinOffsetMinutes(new Date("2026-03-29T00:30:00Z"))).toBe(60);
    expect(berlinOffsetMinutes(new Date("2026-03-29T01:30:00Z"))).toBe(120);
    expect(berlinOffsetMinutes(new Date("2026-10-25T00:30:00Z"))).toBe(120);
    expect(berlinOffsetMinutes(new Date("2026-10-25T01:30:00Z"))).toBe(60);
  });

  it("laesst die Ortszeit 02:30 im Oktober zweimal vorkommen", () => {
    // Das ist die doppelte Winterzeitstunde: gleiche Wanduhr, zwei Instants.
    expect(berlinClock(new Date("2026-10-25T00:30:00Z"))).toBe("02:30");
    expect(berlinClock(new Date("2026-10-25T01:30:00Z"))).toBe("02:30");
  });
});

// ===========================================================================
// AK6(b) — doppelte Winterzeitstunde
// ===========================================================================
describe("doppelte Winterzeitstunde (AK6b)", () => {
  const firstPass = new Date("2026-10-25T00:30:00Z"); // 02:30 CEST
  const secondPass = new Date("2026-10-25T01:30:00Z"); // 02:30 CET

  it("ordnet beide Durchlaeufe demselben Kalendertag zu", () => {
    // Der Kalendertag darf nicht davon abhaengen, welcher der beiden
    // gleichnamigen Zeitpunkte gemeint ist — sonst waere die Tagesabgrenzung
    // an einem Tag im Jahr nicht eindeutig.
    expect(localBusinessDate(firstPass, EUROPE_BERLIN)).toEqual({
      year: 2026,
      month: 10,
      day: 25,
    });
    expect(localBusinessDate(secondPass, EUROPE_BERLIN)).toEqual({
      year: 2026,
      month: 10,
      day: 25,
    });
  });

  it("ordnet beide Durchlaeufe derselben Planungswoche zu", () => {
    const a = planningWeekOf(
      interval("2026-10-25T00:30:00Z", "2026-10-25T00:45:00Z"),
      EUROPE_BERLIN,
    );
    const b = planningWeekOf(
      interval("2026-10-25T01:30:00Z", "2026-10-25T01:45:00Z"),
      EUROPE_BERLIN,
    );
    expect(planningWeekKey(a)).toBe(planningWeekKey(b));
    // Sonntag ist der LETZTE Tag der ISO-Woche. Der 2026-10-25 gehoert damit
    // zu W43, nicht zur beginnenden W44 — die haeufigste Verwechslung.
    expect(planningWeekKey(a)).toBe("2026-W43");
  });

  it("zaehlt eine Schicht ueber die Faltung mit der verstrichenen, nicht der abgelesenen Zeit", () => {
    // 00:00-03:00 UTC ist die Wanduhr von 02:00 bis 04:00 — zwei Stunden
    // Anzeige, drei Stunden Arbeit. Wer die Wanduhr zaehlt, bezahlt eine
    // Stunde nicht.
    const shift = interval("2026-10-25T00:00:00Z", "2026-10-25T03:00:00Z");
    expect(berlinClock(shift.startUtc)).toBe("02:00");
    expect(berlinClock(shift.endUtc)).toBe("04:00");

    const load = aggregateWeeklyLoad([{ employeeId: ANNA, interval: shift }], EUROPE_BERLIN);
    expect(load).toHaveLength(1);
    const only = load[0];
    if (only === undefined) throw new Error("Aggregat leer — Fixture kaputt.");
    expect(only.minutes).toBe(180);
    expect(planningWeekKey(only.week)).toBe("2026-W43");
  });
});

// ===========================================================================
// AK6(a) — Sommerzeitluecke
// ===========================================================================
describe("Sommerzeitluecke (AK6a)", () => {
  it("laesst die Ortszeit 02:30 im Maerz gar nicht vorkommen", () => {
    // Die Gegenprobe zur Faltung: hier fehlt eine Stunde. Kein Instant
    // zwischen 00:00 und 02:00 UTC traegt die Wanduhr 02:30.
    const clocks = new Set<string>();
    for (let minute = 0; minute < 120; minute += 5) {
      clocks.add(berlinClock(new Date(Date.UTC(2026, 2, 29, 0, minute))));
    }
    expect(clocks.has("01:30")).toBe(true);
    expect(clocks.has("03:30")).toBe(true);
    expect(clocks.has("02:30")).toBe(false);
  });

  it("ordnet eine Schicht ueber die Luecke der Woche ihres Beginns zu", () => {
    // 2026-03-29 ist ein Sonntag und damit der LETZTE Tag von W13.
    const shift = interval("2026-03-29T00:00:00Z", "2026-03-29T02:00:00Z");
    expect(planningWeekKey(planningWeekOf(shift, EUROPE_BERLIN))).toBe("2026-W13");
  });
});

// ===========================================================================
// AK6(c) — Mitternachtswechsel, an den exakten Grenzen
// ===========================================================================
describe("Mitternachtswechsel (AK6c)", () => {
  // 2026-08-03 ist ein Montag; Europe/Berlin liegt im August auf UTC+2.
  // Ortszeit 00:00:00.000 des 3. August ist daher 2026-08-02T22:00:00.000Z.
  const midnightLocal = new Date("2026-08-02T22:00:00.000Z");
  const lastMillisecondLocal = new Date("2026-08-03T21:59:59.999Z");

  it("zaehlt die erste Millisekunde des Tages schon zum neuen Tag", () => {
    expect(localBusinessDate(midnightLocal, EUROPE_BERLIN)).toEqual({
      year: 2026,
      month: 8,
      day: 3,
    });
    // Eine Millisekunde davor ist noch der Vortag — ohne diese Gegenprobe
    // waere die Zusicherung oben auch dann gruen, wenn die Grenze woanders
    // laege.
    expect(localBusinessDate(new Date(midnightLocal.getTime() - 1), EUROPE_BERLIN)).toEqual({
      year: 2026,
      month: 8,
      day: 2,
    });
  });

  it("zaehlt die letzte Millisekunde des Tages noch zum alten Tag", () => {
    expect(localBusinessDate(lastMillisecondLocal, EUROPE_BERLIN)).toEqual({
      year: 2026,
      month: 8,
      day: 3,
    });
    expect(localBusinessDate(new Date(lastMillisecondLocal.getTime() + 1), EUROPE_BERLIN)).toEqual({
      year: 2026,
      month: 8,
      day: 4,
    });
  });

  it("wechselt die Woche genau am Sonntagmitternacht, nicht am UTC-Mitternacht", () => {
    // Sonntag 2026-08-09 23:59:59.999 Ortszeit gehoert noch zu W32,
    // Montag 2026-08-10 00:00:00.000 Ortszeit zu W33. Beide Instants liegen
    // am selben UTC-Tag (der 9. August, 21:59 bzw. 22:00 UTC) — genau daran
    // scheitert eine Rechnung, die den UTC-Tag fuer den Kalendertag haelt.
    const sundayEnd = new Date("2026-08-09T21:59:59.999Z");
    const mondayStart = new Date("2026-08-09T22:00:00.000Z");
    expect(sundayEnd.getUTCDate()).toBe(mondayStart.getUTCDate());

    expect(planningWeekKey(isoWeekOfLocalDate(localBusinessDate(sundayEnd, EUROPE_BERLIN)))).toBe(
      "2026-W32",
    );
    expect(planningWeekKey(isoWeekOfLocalDate(localBusinessDate(mondayStart, EUROPE_BERLIN)))).toBe(
      "2026-W33",
    );
  });
});
