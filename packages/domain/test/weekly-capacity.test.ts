import { describe, expect, it } from "vitest";

import { unsafeIdentifier } from "../src/identifiers.js";
import type { EmployeeId } from "../src/identifiers.js";
import { EUROPE_BERLIN } from "../src/planning-week.js";
import { TimeInterval } from "../src/time-interval.js";
import {
  aggregateWeeklyLoad,
  blocksPublication,
  evaluateCapacity,
  findCapacityIssues,
  NO_CAPACITY_LIMIT,
  projectWeeks,
  type CapacityEntry,
} from "../src/weekly-capacity.js";

const ANNA = unsafeIdentifier<EmployeeId>("00000000-0000-0000-0000-00000000aaa1");
const BEN = unsafeIdentifier<EmployeeId>("00000000-0000-0000-0000-00000000bbb2");

function shift(employeeId: EmployeeId, startIso: string, endIso: string): CapacityEntry {
  const result = TimeInterval.create(new Date(startIso), new Date(endIso));
  if (!result.ok) throw new Error(`Fixture ungueltig: ${result.error}`);
  return { employeeId, interval: result.interval };
}

/** Acht Stunden an einem Tag der Woche 32 bzw. 33. */
function week32(employeeId: EmployeeId, day: number): CapacityEntry {
  const d = String(day).padStart(2, "0");
  return shift(employeeId, `2026-08-${d}T06:00:00Z`, `2026-08-${d}T14:00:00Z`);
}

describe("aggregateWeeklyLoad", () => {
  it("gruppiert je Mitarbeiter UND Woche", () => {
    const loads = aggregateWeeklyLoad(
      [week32(ANNA, 3), week32(ANNA, 4), week32(BEN, 3)],
      EUROPE_BERLIN,
    );
    expect(loads).toHaveLength(2);
    const anna = loads.find((l) => l.employeeId === ANNA);
    expect(anna?.minutes).toBe(960);
    expect(anna?.entryCount).toBe(2);
    expect(anna?.weekKey).toBe("2026-W32");
  });

  it("ist unabhaengig von der Eingabereihenfolge", () => {
    const entries = [week32(BEN, 5), week32(ANNA, 3), week32(ANNA, 4)];
    const forward = aggregateWeeklyLoad(entries, EUROPE_BERLIN);
    const backward = aggregateWeeklyLoad([...entries].reverse(), EUROPE_BERLIN);
    expect(forward).toEqual(backward);
  });

  it("ist bei leerer Eingabe leer", () => {
    expect(aggregateWeeklyLoad([], EUROPE_BERLIN)).toEqual([]);
  });

  it("zaehlt die Fruehschicht am Montag in die Montagswoche", () => {
    // 00:30-08:30 Ortszeit; aus startUtc allein waere das die Vorwoche.
    const loads = aggregateWeeklyLoad(
      [shift(ANNA, "2026-08-02T22:30:00Z", "2026-08-03T06:30:00Z")],
      EUROPE_BERLIN,
    );
    expect(loads[0]?.weekKey).toBe("2026-W32");
  });
});

describe("Regression FIND-003 — zwei zulaessige Wochen ergeben keine Ueberplanung", () => {
  // Der Prototyp summierte ueber alle uebergebenen Einsaetze hinweg. Vier
  // Achtstundenschichten in Woche 32 plus vier in Woche 33 sind je Woche
  // 1920 Minuten (32 h) und damit unter der Blockgrenze — zusammen aber 3840,
  // was mit der alten Logik blockiert haette.
  const limit = { warnAtMinutes: 2400, blockAtMinutes: 2700 };
  const entries = [
    week32(ANNA, 3),
    week32(ANNA, 4),
    week32(ANNA, 5),
    week32(ANNA, 6),
    week32(ANNA, 10),
    week32(ANNA, 11),
    week32(ANNA, 12),
    week32(ANNA, 13),
  ];

  it("bildet zwei getrennte Wochen", () => {
    const loads = aggregateWeeklyLoad(entries, EUROPE_BERLIN);
    expect(loads.map((l) => l.weekKey)).toEqual(["2026-W32", "2026-W33"]);
    expect(loads.map((l) => l.minutes)).toEqual([1920, 1920]);
  });

  it("blockiert nicht — die Gesamtsumme ist irrelevant", () => {
    expect(blocksPublication(entries, EUROPE_BERLIN, limit)).toBe(false);
    expect(findCapacityIssues(entries, EUROPE_BERLIN, limit)).toEqual([]);
  });

  it("blockiert sehr wohl, wenn EINE Woche die Grenze reisst", () => {
    const overloaded = [...entries, week32(ANNA, 7), week32(ANNA, 8)];
    const issues = findCapacityIssues(overloaded, EUROPE_BERLIN, limit);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.weekKey).toBe("2026-W32");
    expect(issues[0]?.verdict).toBe("BLOCKING");
    expect(blocksPublication(overloaded, EUROPE_BERLIN, limit)).toBe(true);
  });
});

describe("evaluateCapacity — Warnung und Blocker sind getrennt", () => {
  it("meldet OK, solange keine Grenze aktiviert ist", () => {
    expect(evaluateCapacity(100_000, NO_CAPACITY_LIMIT)).toBe("OK");
  });

  it("warnt, ohne zu blockieren, wenn nur die Warngrenze aktiv ist", () => {
    const limit = { warnAtMinutes: 2400, blockAtMinutes: null };
    expect(evaluateCapacity(2399, limit)).toBe("OK");
    expect(evaluateCapacity(2400, limit)).toBe("WARNING");
    expect(evaluateCapacity(999_999, limit)).toBe("WARNING");
  });

  it("blockiert ab der Blockgrenze, auch ohne Warngrenze", () => {
    const limit = { warnAtMinutes: null, blockAtMinutes: 2700 };
    expect(evaluateCapacity(2699, limit)).toBe("OK");
    expect(evaluateCapacity(2700, limit)).toBe("BLOCKING");
  });

  it("laesst die Blockgrenze die Warngrenze schlagen", () => {
    const limit = { warnAtMinutes: 2400, blockAtMinutes: 2700 };
    expect(evaluateCapacity(2400, limit)).toBe("WARNING");
    expect(evaluateCapacity(2700, limit)).toBe("BLOCKING");
  });
});

describe("projectWeeks — dieselben Werte wie die Wochenansicht", () => {
  it("filtert das bestehende Aggregat, statt neu zu rechnen", () => {
    const entries = [week32(ANNA, 3), week32(ANNA, 10), week32(BEN, 3)];
    const all = aggregateWeeklyLoad(entries, EUROPE_BERLIN);
    const projected = projectWeeks(all, ["2026-W32"]);

    expect(projected.every((l) => l.weekKey === "2026-W32")).toBe(true);
    // Identitaet statt Gleichheit: es sind dieselben Objekte, also kann kein
    // zweiter Rechenweg abweichen.
    for (const load of projected) {
      expect(all).toContain(load);
    }
  });

  it("liefert bei leerem Fenster nichts", () => {
    const all = aggregateWeeklyLoad([week32(ANNA, 3)], EUROPE_BERLIN);
    expect(projectWeeks(all, [])).toEqual([]);
  });
});

describe("DST — eine Woche mit Zeitumstellung", () => {
  it("zaehlt verstrichene Zeit, nicht Wanduhrdifferenz", () => {
    // Sonntag 2026-03-29, 01:00-04:00 Ortszeit: die Wanduhr zeigt 3 h,
    // verstrichen sind 2 h. Die Kapazitaet zaehlt die verstrichene Zeit.
    const loads = aggregateWeeklyLoad(
      [shift(ANNA, "2026-03-29T00:00:00Z", "2026-03-29T02:00:00Z")],
      EUROPE_BERLIN,
    );
    expect(loads[0]?.minutes).toBe(120);
    expect(loads[0]?.weekKey).toBe("2026-W13");
  });
});
