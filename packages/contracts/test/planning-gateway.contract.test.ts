import { beforeEach, describe, expect, it } from "vitest";

import { MockPlanningGateway } from "../src/mock/planning.js";
import type { PlanningGateway } from "../src/planning/gateway.js";
import {
  AssignmentDtoSchema,
  PlanValidationResultSchema,
  PlanningWindowSchema,
  PublishedPlanVersionSchema,
} from "../src/planning/schemas.js";

/**
 * Vertragssuite fuer PlanningGateway.
 *
 * Bewusst gegen die Schnittstelle geschrieben, nicht gegen die Implementierung:
 * derselbe Block laeuft spaeter gegen `HttpPlanningGateway`, sobald es einen
 * Server gibt (EYT-50). Jede Antwort wird gegen das veroeffentlichte Schema
 * geparst — eine Implementierung, die etwas anderes liefert, faellt hier durch.
 *
 * **Evidenzgrenze.** Heute ist der Mock die einzige Implementierung. Diese Suite
 * beweist Vertragstreue und Zustandsmodell, NICHT dass ein Backend existiert.
 */
const VERSION_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3300";
const ASSIGNMENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const EMPLOYEE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const WORKSITE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const INTERVAL = { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T14:00:00.000Z" };

function makeMock(): MockPlanningGateway {
  return new MockPlanningGateway({
    timeZone: "Europe/Berlin",
    weeks: new Map([
      [
        "2026-W32",
        [
          {
            id: ASSIGNMENT_ID,
            employeeId: EMPLOYEE_ID,
            worksiteId: WORKSITE_ID,
            interval: INTERVAL,
          },
        ],
      ],
    ]),
    publishedVersionId: VERSION_ID,
    validation: {
      conflicts: [
        { code: "EMPLOYEE_WEEKLY_CAPACITY", blocking: false, message: "32 h in dieser Woche" },
      ],
      publishable: true,
    },
    publishResult: {
      versionId: VERSION_ID,
      weekKey: "2026-W32",
      publishedAtUtc: "2026-08-01T09:00:00.000Z",
      assignmentIds: [ASSIGNMENT_ID],
    },
    nextAssignmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3304",
  });
}

describe.each([["MockPlanningGateway", makeMock]])(
  "PlanningGateway-Vertrag: %s",
  (_name, factory) => {
    let gateway: PlanningGateway;
    let mock: MockPlanningGateway;

    beforeEach(() => {
      mock = factory();
      gateway = mock;
    });

    it("liefert ein vertragskonformes Planungsfenster", async () => {
      const result = await gateway.getPlanningWindow({ weekKey: "2026-W32" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(() => PlanningWindowSchema.parse(result.value)).not.toThrow();
      expect(result.value.assignments).toHaveLength(1);
    });

    it("liefert eine leere Woche als leere Liste, nicht als Fehler", async () => {
      const result = await gateway.getPlanningWindow({ weekKey: "2026-W40" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.assignments).toEqual([]);
    });

    it("liefert ein vertragskonformes Pruefergebnis", async () => {
      const result = await gateway.validateDraft({
        weekKey: "2026-W32",
        draft: { employeeId: EMPLOYEE_ID, worksiteId: WORKSITE_ID, interval: INTERVAL },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(() => PlanValidationResultSchema.parse(result.value)).not.toThrow();
      // Warnung blockiert nicht (EYT-74).
      expect(result.value.conflicts[0]?.blocking).toBe(false);
      expect(result.value.publishable).toBe(true);
    });

    it("legt einen vertragskonformen Einsatz an", async () => {
      const result = await gateway.createAssignment({
        employeeId: EMPLOYEE_ID,
        worksiteId: WORKSITE_ID,
        interval: INTERVAL,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(() => AssignmentDtoSchema.parse(result.value)).not.toThrow();
      expect(result.value.interval).toEqual(INTERVAL);
    });

    it("veroeffentlicht auf dem erwarteten Stand", async () => {
      const result = await gateway.publishPlan({
        weekKey: "2026-W32",
        expectedVersionId: VERSION_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(() => PublishedPlanVersionSchema.parse(result.value)).not.toThrow();
    });

    it("lehnt eine Veroeffentlichung auf veraltetem Stand ab", async () => {
      const result = await gateway.publishPlan({ weekKey: "2026-W32", expectedVersionId: null });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure).toBe("STALE_VERSION");
      expect(result.problem?.status).toBe(409);
    });

    it("modelliert Fehlerzustaende ueber den Port, nicht ueber Ausnahmen", async () => {
      mock.induce("FORBIDDEN");
      const result = await gateway.getPlanningWindow({ weekKey: "2026-W32" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure).toBe("FORBIDDEN");
      expect(result.problem?.status).toBe(403);
    });

    it("faellt nach einem induzierten Fehler wieder auf den Normalfall zurueck", async () => {
      mock.induce("UNAVAILABLE");
      await gateway.getPlanningWindow({ weekKey: "2026-W32" });
      const second = await gateway.getPlanningWindow({ weekKey: "2026-W32" });
      expect(second.ok).toBe(true);
    });
  },
);

describe("Mock-Ehrlichkeit", () => {
  it("merkt sich den geprueften Entwurf, rechnet ihn aber nicht", () => {
    const mock = makeMock();
    expect(mock.lastValidated).toBeNull();
    const command = {
      weekKey: "2026-W32",
      draft: { employeeId: EMPLOYEE_ID, worksiteId: WORKSITE_ID, interval: INTERVAL },
    };
    void mock.validateDraft(command);
    expect(mock.lastValidated).toEqual(command);
  });
});
