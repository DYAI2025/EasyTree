import { beforeEach, describe, expect, it } from "vitest";

import { MockPlanningGateway } from "../src/mock/planning.js";
import { newIdempotencyKey } from "../src/primitives.js";
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
        {
          assignments: [
            {
              id: ASSIGNMENT_ID,
              employeeId: EMPLOYEE_ID,
              worksiteId: WORKSITE_ID,
              interval: INTERVAL,
            },
          ],
          publishedVersionId: VERSION_ID,
          publishResult: {
            versionId: VERSION_ID,
            weekKey: "2026-W32",
            publishedAtUtc: "2026-08-01T09:00:00.000Z",
            assignmentIds: [ASSIGNMENT_ID],
          },
        },
      ],
      [
        // Zweite, noch unveroeffentlichte Woche. Ohne sie waere nicht pruefbar,
        // dass Version und Publish-Ergebnis pro Fenster gelten.
        "2026-W33",
        {
          assignments: [],
          publishedVersionId: null,
          publishResult: {
            versionId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
            weekKey: "2026-W33",
            publishedAtUtc: "2026-08-08T09:00:00.000Z",
            assignmentIds: [],
          },
        },
      ],
    ]),
    validation: {
      conflicts: [
        { code: "EMPLOYEE_WEEKLY_CAPACITY", blocking: false, message: "32 h in dieser Woche" },
      ],
      publishable: true,
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
      const result = await gateway.createAssignment(
        { employeeId: EMPLOYEE_ID, worksiteId: WORKSITE_ID, interval: INTERVAL },
        { idempotencyKey: newIdempotencyKey() },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(() => AssignmentDtoSchema.parse(result.value)).not.toThrow();
      expect(result.value.interval).toEqual(INTERVAL);
    });

    it("veroeffentlicht auf dem erwarteten Stand", async () => {
      const result = await gateway.publishPlan(
        { weekKey: "2026-W32", expectedVersionId: VERSION_ID },
        { idempotencyKey: newIdempotencyKey() },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(() => PublishedPlanVersionSchema.parse(result.value)).not.toThrow();
    });

    it("lehnt eine Veroeffentlichung auf veraltetem Stand ab", async () => {
      const result = await gateway.publishPlan(
        { weekKey: "2026-W32", expectedVersionId: null },
        { idempotencyKey: newIdempotencyKey() },
      );
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

describe("Planversion gilt pro Woche", () => {
  it("meldet fuer eine unveroeffentlichte Woche keine fremde Version", async () => {
    const gateway = makeMock();
    const w33 = await gateway.getPlanningWindow({ weekKey: "2026-W33" });
    expect(w33.ok).toBe(true);
    if (!w33.ok) return;
    expect(w33.value.publishedVersionId).toBeNull();
  });

  it("veroeffentlicht in Woche 33 das Ergebnis von Woche 33", async () => {
    const gateway = makeMock();
    const published = await gateway.publishPlan({ weekKey: "2026-W33", expectedVersionId: null });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.value.weekKey).toBe("2026-W33");
  });

  it("meldet Stale-Version anhand der ANGEFRAGTEN Woche", async () => {
    const gateway = makeMock();
    // Die Version aus Woche 32 ist fuer Woche 33 kein gueltiger Erwartungswert.
    const wrong = await gateway.publishPlan({ weekKey: "2026-W33", expectedVersionId: VERSION_ID });
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.failure).toBe("STALE_VERSION");
  });

  it("lehnt ein unbekanntes Planungsfenster ab, statt eine fremde Version zu liefern", async () => {
    const gateway = makeMock();
    const unknown = await gateway.publishPlan({ weekKey: "2026-W40", expectedVersionId: null });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.failure).toBe("REJECTED");
  });
});
