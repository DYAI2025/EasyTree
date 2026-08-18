import { describe, expect, it } from "vitest";

import { dayAfter, dayBefore } from "../src/local-business-date.js";
import type { PlanningWeek } from "../src/planning-week.js";
import {
  createTimeZone,
  EUROPE_BERLIN,
  isoWeekOfLocalDate,
  isSameWeek,
  localBusinessDate,
  planningWeekDateRange,
  planningWeekKey,
  planningWeekOf,
  shiftPlanningWeek,
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

// ---------------------------------------------------------------------------
// EYT-140 M2 — Wochenarithmetik. Siehe Befund B3 des Plans
// docs/plans/2026-08-18-eyt-140-planungswerkbank.md: 2026 hat 53 ISO-Wochen,
// 2025 und 2027 haben 52. Daran zerbricht jede `isoWeek ± 1`-Rechnung.
// ---------------------------------------------------------------------------

/** Die naheliegende FALSCHE Implementierung — hier als Vergleichsmassstab. */
function naiveVerschiebung(week: PlanningWeek, delta: number): PlanningWeek {
  return { isoYear: week.isoYear, isoWeek: week.isoWeek + delta };
}

describe("shiftPlanningWeek — ueber den Montag gerechnet, nicht ueber isoWeek + delta", () => {
  it("traegt ueber die Jahresgrenze — die drei Randvektoren aus B3", () => {
    expect(planningWeekKey(shiftPlanningWeek({ isoYear: 2027, isoWeek: 1 }, -1))).toBe("2026-W53");
    expect(planningWeekKey(shiftPlanningWeek({ isoYear: 2026, isoWeek: 53 }, 1))).toBe("2027-W01");
    expect(planningWeekKey(shiftPlanningWeek({ isoYear: 2025, isoWeek: 52 }, 1))).toBe("2026-W01");
  });

  it("weicht an der 53-Wochen-Grenze nachweislich von isoWeek + delta ab", () => {
    // Der unterscheidende Gegenfall: waere die Regel "ueber den Montag" nicht
    // in Kraft, lieferte die Funktion genau diese drei Werte — und zwei davon
    // bezeichnen keine reale Woche.
    const jahresende2026 = { isoYear: 2026, isoWeek: 53 } as const;
    const jahresanfang2027 = { isoYear: 2027, isoWeek: 1 } as const;
    const jahresende2025 = { isoYear: 2025, isoWeek: 52 } as const;

    expect(planningWeekKey(naiveVerschiebung(jahresende2026, 1))).toBe("2026-W54");
    expect(planningWeekKey(naiveVerschiebung(jahresanfang2027, -1))).toBe("2027-W00");
    expect(planningWeekKey(naiveVerschiebung(jahresende2025, 1))).toBe("2025-W53");

    expect(shiftPlanningWeek(jahresende2026, 1)).not.toEqual(naiveVerschiebung(jahresende2026, 1));
    expect(shiftPlanningWeek(jahresanfang2027, -1)).not.toEqual(
      naiveVerschiebung(jahresanfang2027, -1),
    );
    expect(shiftPlanningWeek(jahresende2025, 1)).not.toEqual(naiveVerschiebung(jahresende2025, 1));

    // 2026 hat 53 Wochen: 52 Schritte ab 2026-W01 landen deshalb NICHT in 2027.
    // Ein Zaehler, der stillschweigend 52 Wochen pro Jahr annimmt, waere hier
    // um genau eine Woche daneben.
    expect(planningWeekKey(shiftPlanningWeek({ isoYear: 2026, isoWeek: 1 }, 52))).toBe("2026-W53");
    expect(planningWeekKey(shiftPlanningWeek({ isoYear: 2026, isoWeek: 1 }, 53))).toBe("2027-W01");
  });

  it("ist bei delta 0 die Identitaet und in beiden Richtungen umkehrbar", () => {
    const woche = { isoYear: 2026, isoWeek: 53 } as const;
    expect(shiftPlanningWeek(woche, 0)).toEqual(woche);
    expect(shiftPlanningWeek(shiftPlanningWeek(woche, 7), -7)).toEqual(woche);
    expect(shiftPlanningWeek(shiftPlanningWeek(woche, -104), 104)).toEqual(woche);
  });

  it("lehnt eine im ISO-Jahr nicht existierende Woche ab, statt sie fortzurechnen", () => {
    // 2025 hat 52 Wochen (B3) — "2025-W53" gibt es nicht.
    expect(() => shiftPlanningWeek({ isoYear: 2025, isoWeek: 53 }, 1)).toThrow(RangeError);
    expect(() => shiftPlanningWeek({ isoYear: 2027, isoWeek: 53 }, -1)).toThrow(RangeError);
    expect(() => shiftPlanningWeek({ isoYear: 2026, isoWeek: 0 }, 1)).toThrow(RangeError);
    expect(() => shiftPlanningWeek({ isoYear: 2026, isoWeek: 54 }, 1)).toThrow(RangeError);
    // Dieselbe Jahresgrenze wie isoWeekOfLocalDate: kein Jahr null.
    expect(() => shiftPlanningWeek({ isoYear: 0, isoWeek: 1 }, 1)).toThrow(RangeError);
    expect(() => shiftPlanningWeek({ isoYear: 2026, isoWeek: 1.5 }, 1)).toThrow(RangeError);
    // Und delta selbst muss eine ganze Zahl sein — sonst entstuende ein
    // Zeitpunkt mitten in der Woche, aus dem stillschweigend eine Woche wuerde.
    expect(() => shiftPlanningWeek({ isoYear: 2026, isoWeek: 1 }, 0.5)).toThrow(RangeError);
    expect(() => shiftPlanningWeek({ isoYear: 2026, isoWeek: 1 }, Number.NaN)).toThrow(RangeError);
  });
});

describe("planningWeekDateRange — Kalendertage, keine Instants (E4)", () => {
  it("liefert Montag und Sonntag der Woche als Kalendertage", () => {
    expect(planningWeekDateRange({ isoYear: 2026, isoWeek: 32 })).toEqual({
      monday: { year: 2026, month: 8, day: 3 },
      sunday: { year: 2026, month: 8, day: 9 },
    });
    // Die 53. Woche 2026 laeuft ueber den Jahreswechsel hinaus.
    expect(planningWeekDateRange({ isoYear: 2026, isoWeek: 53 })).toEqual({
      monday: { year: 2026, month: 12, day: 28 },
      sunday: { year: 2027, month: 1, day: 3 },
    });
    // Woche 1 eines Jahres kann im Vorjahr beginnen.
    expect(planningWeekDateRange({ isoYear: 2020, isoWeek: 1 }).monday).toEqual({
      year: 2019,
      month: 12,
      day: 30,
    });
  });

  it("grenzt die Woche exakt ab — der Vortag und der Folgetag liegen in anderen Wochen", () => {
    // Der unterscheidende Gegenfall: waere der Zeitraum um einen Tag verschoben
    // oder um einen Tag zu breit, traegt einer dieser vier Vergleiche es zutage.
    // Orakel ist ausschliesslich die vorbestehende `isoWeekOfLocalDate` samt
    // `dayBefore`/`dayAfter` — keine der beiden neuen Funktionen.
    for (const woche of [
      { isoYear: 2026, isoWeek: 32 },
      { isoYear: 2026, isoWeek: 53 },
      { isoYear: 2020, isoWeek: 1 },
    ] as const) {
      const { monday, sunday } = planningWeekDateRange(woche);
      expect(isoWeekOfLocalDate(monday), planningWeekKey(woche)).toEqual(woche);
      expect(isoWeekOfLocalDate(sunday), planningWeekKey(woche)).toEqual(woche);
      expect(isSameWeek(isoWeekOfLocalDate(dayBefore(monday)), woche)).toBe(false);
      expect(isSameWeek(isoWeekOfLocalDate(dayAfter(sunday)), woche)).toBe(false);
    }
  });

  it("lehnt eine im ISO-Jahr nicht existierende Woche ab, statt einen Zeitraum zu erfinden", () => {
    expect(() => planningWeekDateRange({ isoYear: 2025, isoWeek: 53 })).toThrow(RangeError);
    expect(() => planningWeekDateRange({ isoYear: 2026, isoWeek: 54 })).toThrow(RangeError);
    expect(() => planningWeekDateRange({ isoYear: 2026, isoWeek: 0 })).toThrow(RangeError);
    expect(() => planningWeekDateRange({ isoYear: 0, isoWeek: 1 })).toThrow(RangeError);
  });
});

describe("Sweep — 520 Verschiebungen ab 2020-W01", () => {
  it("erzeugt 520 reale Wochen, jede genau sieben Kalendertage nach der vorigen", () => {
    const WOHLGEFORMT = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
    const start = { isoYear: 2020, isoWeek: 1 } as const;
    let vorigerMontag: { year: number; month: number; day: number } | null = null;
    let geprueft = 0;

    for (let delta = 0; delta < 520; delta += 1) {
      const woche = shiftPlanningWeek(start, delta);
      const schluessel = planningWeekKey(woche);
      expect(WOHLGEFORMT.test(schluessel), schluessel).toBe(true);

      const { monday } = planningWeekDateRange(woche);
      // Unabhaengiges Orakel: `isoWeekOfLocalDate` ist vorbestehend und wird in
      // apps/api/test/iso-week-parity.test.ts gegen packages/contracts gemessen.
      expect(isoWeekOfLocalDate(monday), schluessel).toEqual(woche);

      if (vorigerMontag !== null) {
        // Sieben Schritte reiner Kalenderarithmetik aus local-business-date.ts —
        // ohne jede Wochenrechnung.
        let tag = vorigerMontag;
        for (let i = 0; i < 7; i += 1) tag = dayAfter(tag);
        expect(tag, schluessel).toEqual(monday);
      }
      vorigerMontag = monday;
      geprueft += 1;
    }

    // Nicht-Leerlauf-Bremse: eine leere Schleife waere sonst still gruen.
    expect(geprueft).toBe(520);
    // Der Sweep laeuft von 2020-W01 bis 2029-W50 und ueberquert damit BEIDE
    // 53-Wochen-Jahre des Fensters (2020 und 2026) — er misst also nicht nur
    // Jahresmitten. Der Endwert ist unabhaengig nachgerechnet, nicht geraten:
    // Montag von 2020-W01 ist der 30.12.2019, plus 519 * 7 Tage = 10.12.2029.
    expect(planningWeekKey(shiftPlanningWeek(start, 519))).toBe("2029-W50");
  });
});
