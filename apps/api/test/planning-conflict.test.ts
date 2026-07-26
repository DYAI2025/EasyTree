import { createTimeInterval, unsafeIdentifier } from "@easytree/domain";
import type { AssignmentId, EmployeeId, OrgId, TimeInterval, WorksiteId } from "@easytree/domain";
import { describe, expect, it } from "vitest";

import { conflictsWithExisting } from "../src/modules/planning";
import type { AssignmentDraft } from "../src/modules/planning";

const ORG = unsafeIdentifier<OrgId>("00000000-0000-0000-0000-0000000000a1");
const ANNA = unsafeIdentifier<EmployeeId>("00000000-0000-0000-0000-00000000aaa1");
const BEN = unsafeIdentifier<EmployeeId>("00000000-0000-0000-0000-00000000bbb2");
const SITE = unsafeIdentifier<WorksiteId>("00000000-0000-0000-0000-0000000011c1");

function at(startIso: string, endIso: string): TimeInterval {
  const result = createTimeInterval(new Date(startIso), new Date(endIso));
  if (!result.ok) throw new Error(`Fixture ungueltig: ${result.error}`);
  return result.interval;
}

function draft(id: string, employeeId: EmployeeId, interval: TimeInterval): AssignmentDraft {
  return {
    id: unsafeIdentifier<AssignmentId>(id),
    orgId: ORG,
    employeeId,
    worksiteId: SITE,
    interval,
  };
}

describe("conflictsWithExisting", () => {
  const morning = draft("a1", ANNA, at("2026-08-03T08:00:00Z", "2026-08-03T12:00:00Z"));

  it("meldet eine Ueberschneidung derselben Person", () => {
    const clash = draft("a2", ANNA, at("2026-08-03T11:00:00Z", "2026-08-03T15:00:00Z"));
    expect(conflictsWithExisting(clash, [morning])).toBe(true);
  });

  it("meldet den Baustellenwechsel um 12:00 NICHT — halb-offenes Intervall", () => {
    const afternoon = draft("a2", ANNA, at("2026-08-03T12:00:00Z", "2026-08-03T16:00:00Z"));
    expect(conflictsWithExisting(afternoon, [morning])).toBe(false);
  });

  it("trennt Personen", () => {
    const bensClash = draft("a2", BEN, at("2026-08-03T11:00:00Z", "2026-08-03T15:00:00Z"));
    expect(conflictsWithExisting(bensClash, [morning])).toBe(false);
  });

  it("vergleicht einen Entwurf nicht mit sich selbst", () => {
    expect(conflictsWithExisting(morning, [morning])).toBe(false);
  });

  it("meldet bei leerer Bestandsliste keinen Konflikt", () => {
    expect(conflictsWithExisting(morning, [])).toBe(false);
  });
});
