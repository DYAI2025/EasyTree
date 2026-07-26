import { TimeInterval, unsafeIdentifier } from "@easytree/domain";
import type { AssignmentId, EmployeeId, OrgId, WorksiteId } from "@easytree/domain";
import { describe, expect, it } from "vitest";

import { conflictsWithExisting } from "../src/modules/planning";
import type { AssignmentDraft } from "../src/modules/planning";

const ALPHA = unsafeIdentifier<OrgId>("00000000-0000-0000-0000-0000000000a1");
const BETA = unsafeIdentifier<OrgId>("00000000-0000-0000-0000-0000000000b2");
const ANNA = unsafeIdentifier<EmployeeId>("00000000-0000-0000-0000-00000000aaa1");
const BEN = unsafeIdentifier<EmployeeId>("00000000-0000-0000-0000-00000000bbb2");
const SITE = unsafeIdentifier<WorksiteId>("00000000-0000-0000-0000-0000000011c1");

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
