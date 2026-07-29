import { EUROPE_BERLIN, TimeInterval, unsafeIdentifier } from "@easytree/domain";
import type { AssignmentId, EmployeeId, OrgId, WorksiteId } from "@easytree/domain";
import { describe, expect, it } from "vitest";

import { conflictsWithExisting, validateDraft } from "../src/modules/planning";
import type { AssignmentDraft } from "../src/modules/planning";

const ALPHA = unsafeIdentifier<OrgId>("00000000-0000-4000-8000-0000000000a1");
const BETA = unsafeIdentifier<OrgId>("00000000-0000-4000-8000-0000000000b2");
const ANNA = unsafeIdentifier<EmployeeId>("00000000-0000-4000-8000-00000000aaa1");
const BEN = unsafeIdentifier<EmployeeId>("00000000-0000-4000-8000-00000000bbb2");
const SITE = unsafeIdentifier<WorksiteId>("00000000-0000-4000-8000-0000000011c1");

function at(startIso: string, endIso: string): TimeInterval {
  const result = TimeInterval.create(new Date(startIso), new Date(endIso));
  if (!result.ok) throw new Error(`Fixture ungueltig: ${result.error}`);
  return result.interval;
}

function draft(
  id: string,
  employeeId: EmployeeId,
  interval: TimeInterval,
  orgId: OrgId = ALPHA,
): AssignmentDraft {
  return {
    id: unsafeIdentifier<AssignmentId>(id),
    orgId,
    employeeId,
    worksiteId: SITE,
    interval,
  };
}

const morning = draft("a1", ANNA, at("2026-08-03T08:00:00Z", "2026-08-03T12:00:00Z"));

describe("conflictsWithExisting", () => {
  it("meldet eine Ueberschneidung derselben Person", () => {
    const clash = draft("a2", ANNA, at("2026-08-03T11:00:00Z", "2026-08-03T15:00:00Z"));
    expect(conflictsWithExisting(clash, [morning], null)).toBe(true);
  });

  it("meldet den Baustellenwechsel um 12:00 NICHT — halb-offenes Intervall", () => {
    const afternoon = draft("a2", ANNA, at("2026-08-03T12:00:00Z", "2026-08-03T16:00:00Z"));
    expect(conflictsWithExisting(afternoon, [morning], null)).toBe(false);
  });

  it("trennt Personen", () => {
    const bensClash = draft("a2", BEN, at("2026-08-03T11:00:00Z", "2026-08-03T15:00:00Z"));
    expect(conflictsWithExisting(bensClash, [morning], null)).toBe(false);
  });

  it("trennt Mandanten — eine fremde Organisation loest keinen Konflikt aus", () => {
    // Ohne den orgId-Vergleich waere dies ein Konflikt: gleiche Person-Id,
    // ueberlappendes Intervall, andere Organisation.
    const foreign = draft("a2", ANNA, at("2026-08-03T11:00:00Z", "2026-08-03T15:00:00Z"), BETA);
    expect(conflictsWithExisting(foreign, [morning], null)).toBe(false);
    expect(conflictsWithExisting(morning, [foreign], null)).toBe(false);
  });

  it("schliesst beim Bearbeiten genau die genannte Zuweisung aus", () => {
    const edited = draft("a1", ANNA, at("2026-08-03T09:00:00Z", "2026-08-03T13:00:00Z"));
    expect(conflictsWithExisting(edited, [morning], morning.id)).toBe(false);
    expect(conflictsWithExisting(edited, [morning], null)).toBe(true);
  });

  it("findet den Konflikt auch bei gleichen Platzhalter-Ids", () => {
    // Regression: die frueherer Selbstausschluss ueber `other.id !== draft.id`
    // war hier fail-open — zwei ungespeicherte Entwuerfe mit derselben
    // Platzhalter-Id schlossen sich gegenseitig von der Pruefung aus.
    const a = draft("", ANNA, at("2026-08-03T08:00:00Z", "2026-08-03T12:00:00Z"));
    const b = draft("", ANNA, at("2026-08-03T10:00:00Z", "2026-08-03T14:00:00Z"));
    expect(conflictsWithExisting(b, [a], null)).toBe(true);
  });

  it("meldet bei leerer Bestandsliste keinen Konflikt", () => {
    expect(conflictsWithExisting(morning, [], null)).toBe(false);
  });
});

describe("validateDraft — Ueberschneidung und Wochenkapazitaet zusammen", () => {
  const limit = { warnAtMinutes: 1800, blockAtMinutes: 2400 }; // 30 h / 40 h

  function validate(draftUnderTest: AssignmentDraft, existing: readonly AssignmentDraft[]) {
    return validateDraft({
      draft: draftUnderTest,
      existing,
      excludeId: null,
      timeZone: EUROPE_BERLIN,
      capacityLimit: limit,
    });
  }

  /** Achtstundenschicht am angegebenen Augusttag 2026. */
  function day(id: string, dayOfMonth: number): AssignmentDraft {
    const d = String(dayOfMonth).padStart(2, "0");
    return draft(id, ANNA, at(`2026-08-${d}T06:00:00Z`, `2026-08-${d}T14:00:00Z`));
  }

  it("meldet nichts bei freier Woche", () => {
    expect(validate(day("neu", 3), [])).toEqual([]);
  });

  it("meldet die Ueberschneidung als blockierend", () => {
    const conflicts = validate(day("neu", 3), [day("a1", 3)]);
    expect(conflicts).toContainEqual({ code: "EMPLOYEE_INTERVAL_OVERLAP", blocking: true });
  });

  it("warnt ab der Warngrenze, ohne zu blockieren", () => {
    // 3 Bestandsschichten + Entwurf = 4 x 8 h = 32 h >= 30 h Warngrenze.
    const conflicts = validate(day("neu", 7), [day("a1", 3), day("a2", 4), day("a3", 5)]);
    expect(conflicts).toEqual([{ code: "EMPLOYEE_WEEKLY_CAPACITY", blocking: false }]);
  });

  it("blockiert ab der Blockgrenze", () => {
    // 4 Bestandsschichten + Entwurf = 5 x 8 h = 40 h >= 40 h Blockgrenze.
    const conflicts = validate(day("neu", 7), [
      day("a1", 3),
      day("a2", 4),
      day("a3", 5),
      day("a4", 6),
    ]);
    expect(conflicts).toContainEqual({ code: "EMPLOYEE_WEEKLY_CAPACITY", blocking: true });
  });

  it("zaehlt eine zweite Woche NICHT zur ersten — Regression FIND-003", () => {
    // 4 Schichten in Woche 32 plus 4 in Woche 33; der Entwurf faellt in Woche 33.
    // Ueber alles summiert waeren das 72 h, je Woche aber 32 h bzw. 40 h.
    const existing = [
      day("a1", 3),
      day("a2", 4),
      day("a3", 5),
      day("a4", 6),
      day("b1", 10),
      day("b2", 11),
    ];
    const conflicts = validate(day("neu", 12), existing);
    // Woche 33: 2 Bestand + Entwurf = 24 h, unter beiden Grenzen.
    expect(conflicts).toEqual([]);
  });

  it("beruecksichtigt den Entwurf selbst in der Kapazitaet", () => {
    // Ohne den Entwurf waeren es 32 h (nur Warnung); mit ihm 40 h.
    const existing = [day("a1", 3), day("a2", 4), day("a3", 5), day("a4", 6)];
    const withDraft = validate(day("neu", 7), existing);
    expect(withDraft.some((c) => c.code === "EMPLOYEE_WEEKLY_CAPACITY" && c.blocking)).toBe(true);
  });
});
