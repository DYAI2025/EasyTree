import { describe, expect, it } from "vitest";

import {
  createTimeZone,
  EUROPE_BERLIN,
  isoWeekOfLocalDate,
  isSameWeek,
  localBusinessDate,
  planningWeekKey,
  planningWeekOf,
} from "../src/planning-week.js";
import { TimeInterval } from "../src/time-interval.js";

function interval(startIso: string, endIso: string): TimeInterval {
  const result = TimeInterval.create(new Date(startIso), new Date(endIso));
  if (!result.ok) throw new Error(`Fixture ungueltig: ${result.error}`);
  return result.interval;
}

function weekKeyOf(startIso: string, endIso: string): string {
  return planningWeekKey(planningWeekOf(interval(startIso, endIso), EUROPE_BERLIN));
}

describe("createTimeZone", () => {
  it("nimmt eine bekannte Zone an", () => {
    const result = createTimeZone("Europe/Berlin");
    expect(result.ok).toBe(true);
  });

  it("lehnt eine unbekannte Zone ab, statt still auf UTC zu fallen", () => {
    const result = createTimeZone("Europa/Buxtehude");
    expect(result).toEqual({ ok: false, error: "TIME_ZONE_UNKNOWN" });
  });

  it("lehnt einen leeren String ab", () => {
    expect(createTimeZone("").ok).toBe(false);
  });
});

describe("localBusinessDate", () => {
  it("liefert den Kalendertag vor Ort, nicht den UTC-Tag", () => {
    // 00:30 Ortszeit am Montag ist in UTC noch Sonntagabend.
    expect(localBusinessDate(new Date("2026-08-02T22:30:00Z"), EUROPE_BERLIN)).toEqual({
      year: 2026,
      month: 8,
      day: 3,
    });
  });

  it("liefert fuer denselben Instant in einer anderen Zone einen anderen Tag", () => {
    const instant = new Date("2026-08-02T22:30:00Z");
    const utc = createTimeZone("UTC");
    expect(utc.ok).toBe(true);
    if (!utc.ok) return;
    expect(localBusinessDate(instant, utc.timeZone).day).toBe(2);
    expect(localBusinessDate(instant, EUROPE_BERLIN).day).toBe(3);
  });
});

describe("isoWeekOfLocalDate — belegte Grenzfaelle", () => {
  // Alle Erwartungen wurden gegen die ISO-8601-Regel nachgerechnet, nicht geraten.
  const cases: ReadonlyArray<readonly [number, number, number, string]> = [
    [2026, 1, 1, "2026-W01"], // Donnerstag — Woche 1 enthaelt den ersten Donnerstag
    [2025, 12, 29, "2026-W01"], // Montag, gehoert schon zur Woche 1 des Folgejahres
    [2026, 1, 4, "2026-W01"], // Sonntag, letzter Tag der Woche 1
    [2026, 1, 5, "2026-W02"],
    [2026, 8, 3, "2026-W32"], // Montag
    [2026, 8, 9, "2026-W32"], // Sonntag derselben Woche
    [2026, 8, 10, "2026-W33"], // Montag darauf
    [2026, 12, 31, "2026-W53"], // Donnerstag
    [2027, 1, 1, "2026-W53"], // Freitag, gehoert noch ins Vorjahr
    [2027, 1, 3, "2026-W53"], // Sonntag, ebenso
    [2027, 1, 4, "2027-W01"], // Montag, neue Woche 1
  ];

  it.each(cases)("%s-%s-%s ist %s", (year, month, day, expected) => {
    expect(planningWeekKey(isoWeekOfLocalDate({ year, month, day }))).toBe(expected);
  });

  it("erkennt gleiche Wochen ueber die Jahresgrenze hinweg", () => {
    expect(
      isSameWeek(
        isoWeekOfLocalDate({ year: 2026, month: 12, day: 31 }),
        isoWeekOfLocalDate({ year: 2027, month: 1, day: 1 }),
      ),
    ).toBe(true);
  });
});

describe("planningWeekOf — der Zeitzonenfehler aus FIND-003", () => {
  it("legt eine Montags-Fruehschicht in die Montagswoche, nicht in die Vorwoche", () => {
    // 2026-08-03 00:30-08:30 Europe/Berlin == 2026-08-02T22:30Z-2026-08-03T06:30Z.
    // Aus startUtc allein abgeleitet waere das der 2. August (Sonntag) und damit
    // 2026-W31 — eine Montagsschicht in der Vorwoche.
    expect(weekKeyOf("2026-08-02T22:30:00Z", "2026-08-03T06:30:00Z")).toBe("2026-W32");
    // Gegenprobe: derselbe Instant nach UTC-Kalender waere die Vorwoche.
    expect(planningWeekKey(isoWeekOfLocalDate({ year: 2026, month: 8, day: 2 }))).toBe("2026-W31");
  });

  it("laesst eine Schicht ueber Mitternacht in der Woche ihres Beginns", () => {
    // Sonntag 22:00 bis Montag 06:00 Ortszeit — die Woche richtet sich nach dem
    // Beginn, die Schicht wird nicht aufgeteilt (dokumentierte Regel 2).
    expect(weekKeyOf("2026-08-09T20:00:00Z", "2026-08-10T04:00:00Z")).toBe("2026-W32");
  });

  it("ordnet die Wochengrenze Sonntag/Montag korrekt zu", () => {
    expect(weekKeyOf("2026-08-09T08:00:00Z", "2026-08-09T16:00:00Z")).toBe("2026-W32");
    expect(weekKeyOf("2026-08-10T08:00:00Z", "2026-08-10T16:00:00Z")).toBe("2026-W33");
  });

  it("ordnet ueber den Jahreswechsel korrekt zu", () => {
    expect(weekKeyOf("2026-12-31T08:00:00Z", "2026-12-31T16:00:00Z")).toBe("2026-W53");
    expect(weekKeyOf("2027-01-01T08:00:00Z", "2027-01-01T16:00:00Z")).toBe("2026-W53");
    expect(weekKeyOf("2027-01-04T08:00:00Z", "2027-01-04T16:00:00Z")).toBe("2027-W01");
  });

  it("ordnet ueber die Sommerzeitgrenze korrekt zu", () => {
    // 2026-03-29 ist der Umstellungssonntag und der letzte Tag von 2026-W13.
    expect(weekKeyOf("2026-03-29T00:00:00Z", "2026-03-29T02:00:00Z")).toBe("2026-W13");
    expect(weekKeyOf("2026-03-30T06:00:00Z", "2026-03-30T14:00:00Z")).toBe("2026-W14");
  });
});
