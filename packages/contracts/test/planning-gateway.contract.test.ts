import { describe, expect, it } from "vitest";

import { MockPlanningGateway } from "../src/mock/planning.js";
import {
  PLANNING_GATEWAY_CONTRACT_FIXTURE,
  PLANNING_VALIDATION_CODE,
  planningGatewayContractSuite,
} from "../src/testing/planning-gateway-contract.js";

/**
 * Vertragssuite fuer PlanningGateway.
 *
 * Bewusst gegen die Schnittstelle geschrieben, nicht gegen die Implementierung:
 * derselbe Block laeuft spaeter gegen `HttpPlanningGateway`, sobald es einen
 * Server gibt (EYT-50). Jede Antwort wird gegen das veroeffentlichte Schema
 * geparst — eine Implementierung, die etwas anderes liefert, faellt hier durch.
 *
 * **Evidenzgrenze.** Diese Datei prueft den Mock. Dieselbe exportierte Suite
 * laeuft in der API gegen `HttpPlanningGateway` und einen echten NestJS-Testserver.
 */
const VERSION_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3300";
const ASSIGNMENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const EMPLOYEE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const WORKSITE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const INTERVAL = { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T14:00:00.000Z" };

function makeMock(): MockPlanningGateway {
  return new MockPlanningGateway({
    timeZone: "Europe/Berlin",
    // Beide Ids der Woche W32 muessen hier auftauchen, sonst verwirft
    // `PlanningWindowSchema` die Antwort als nicht aufloesbar. Genau das ist
    // die Absicht: der Mock kann keine Zuweisung mehr auf jemanden zeigen
    // lassen, den die Auswahlliste nicht kennt.
    resources: {
      employees: [{ id: EMPLOYEE_ID, label: "Beschaeftigte A", active: true }],
      worksites: [{ id: WORKSITE_ID, label: "Baustelle A", active: true }],
    },
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
    validation: (input) =>
      input.draft.interval.startUtc ===
      PLANNING_GATEWAY_CONTRACT_FIXTURE.overlappingInterval.startUtc
        ? {
            conflicts: [
              {
                code: PLANNING_VALIDATION_CODE.overlap,
                blocking: true,
                message: "Mitarbeitende Person ist in diesem Zeitraum bereits eingeplant.",
              },
            ],
            publishable: false,
          }
        : { conflicts: [], publishable: true },
    nextAssignmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3304",
  });
}

planningGatewayContractSuite("MockPlanningGateway", () => ({ gateway: makeMock() }));

describe("weitere Mock-Zustände", () => {
  it("liefert eine leere Woche als leere Liste, nicht als Fehler", async () => {
    const result = await makeMock().getPlanningWindow({ weekKey: "2026-W40" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assignments).toEqual([]);
  });

  it("veroeffentlicht auf dem erwarteten Stand", async () => {
    const result = await makeMock().publishPlan({
      weekKey: "2026-W32",
      expectedVersionId: VERSION_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.versionId).toBe(VERSION_ID);
  });

  it("lehnt eine Veroeffentlichung auf veraltetem Stand ab", async () => {
    const result = await makeMock().publishPlan({
      weekKey: "2026-W32",
      expectedVersionId: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("STALE_VERSION");
    expect(result.problem?.status).toBe(409);
  });

  it("modelliert Fehlerzustaende ueber den Port, nicht ueber Ausnahmen", async () => {
    const mock = makeMock();
    mock.induce("FORBIDDEN");
    const result = await mock.getPlanningWindow({ weekKey: "2026-W32" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("FORBIDDEN");
    expect(result.problem?.status).toBe(403);
  });

  it("faellt nach einem induzierten Fehler wieder auf den Normalfall zurueck", async () => {
    const mock = makeMock();
    mock.induce("UNAVAILABLE");
    await mock.getPlanningWindow({ weekKey: "2026-W32" });
    const second = await mock.getPlanningWindow({ weekKey: "2026-W32" });
    expect(second.ok).toBe(true);
  });
});

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
