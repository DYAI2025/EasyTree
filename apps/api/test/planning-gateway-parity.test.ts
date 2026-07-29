/**
 * Vertragsparitaet: derselbe Fallsatz gegen Mock UND echten Server (EYT-92).
 *
 * ## Warum diese Datei in apps/api liegt und nicht in packages/contracts
 *
 * `packages/contracts` darf NestJS nicht kennen — `contracts-transport-only`
 * verbietet es, und ein Testserver im Vertragspaket waere genau die Kopplung,
 * die die Regel verhindert. Der Vertrag stellt die Faelle, `apps/api` stellt
 * den Server.
 *
 * ## Was hier bewiesen wird — und was nicht
 *
 * Die Suite in `packages/contracts/test/planning-gateway.contract.test.ts`
 * laeuft ausschliesslich gegen `MockPlanningGateway`. Sie belegt Vertragstreue
 * des Ports, aber nicht, dass irgendein Server ihn bedient — genau die
 * Konstellation, die `docs/traceability.md` unter REQ-009 als „gruen gegen den
 * Mock" fuehrt. Hier laufen dieselben Faelle zusaetzlich gegen
 * `HttpPlanningGateway` mit einem echten NestJS-Server.
 *
 * **Grenze, ausdruecklich:** der Leseport und das Repository sind hier durch
 * DI ersetzt. Bewiesen wird die HTTP-Naht — Pfad, Methode, Header, Statuscode,
 * Antwortform, Fehlerabbildung. Dass die Query unter RLS das Richtige liest,
 * ist eine andere Aussage und steht in `planning-write.integration.test.ts`
 * und im CI-Job `read-through`.
 *
 * ## Gegenmutation
 *
 * Aendert man im Controller den Pfad `entwuerfe/validierung` oder den
 * Statuscode 200, wird „validateDraft liefert ein vertragskonformes
 * Pruefergebnis" gegen HTTP rot, waehrend derselbe Fall gegen den Mock gruen
 * bleibt. Genau diese Differenz konnte die alte Suite nicht sehen.
 */
import {
  AssignmentDtoSchema,
  HttpPlanningGateway,
  PlanValidationResultSchema,
  PlanningWindowSchema,
  newIdempotencyKey,
  type PlanningGateway,
} from "@easytree/contracts";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { API_BASE_PATH } from "../src/common/api-base-path";
import { TENANT_SUBJECT_RESOLVER, type TenantSubjectResolver } from "../src/common/tenant-subject";
import { DATABASE_PING, type DatabasePing } from "../src/health/readiness";
import {
  PLANNING_ACCESS_POLICY,
  PLANNING_QUERIES_FACTORY,
  PLANNING_WRITES_FACTORY,
  type PlanningAccessPolicy,
  type PlanningQueriesFactory,
  type PlanningWritesFactory,
} from "../src/modules/planning";

const SUBJECT = "00000000-0000-4000-8000-00000000aaa1";
const EMPLOYEE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const WORKSITE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const ASSIGNMENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PLAN_VERSION_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3300";
const INTERVAL = { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T14:00:00.000Z" };
const RESOURCES = {
  employees: [{ id: EMPLOYEE_ID, label: "Beschaeftigte A", active: true }],
  worksites: [{ id: WORKSITE_ID, label: "Baustelle A", active: true }],
};

let app: INestApplication | null = null;

/**
 * Echter NestJS-Server mit ersetzten Ports.
 *
 * Ersetzt sind ausdruecklich NUR Subjekt, Berechtigung und die beiden
 * Repository-Ports — also alles, was eine Datenbank braeuchte. Controller,
 * Routing, Filter, Schemapruefung und Fehlerabbildung sind die echten.
 */
async function httpGateway(): Promise<PlanningGateway> {
  const queries: PlanningQueriesFactory = () => ({
    planningWindow: (weekKey) =>
      Promise.resolve({
        ok: true,
        window: {
          weekKey,
          timeZone: "Europe/Berlin",
          assignments: [
            {
              id: ASSIGNMENT_ID,
              employeeId: EMPLOYEE_ID,
              worksiteId: WORKSITE_ID,
              startsAtUtc: new Date(INTERVAL.startUtc),
              endsAtUtc: new Date(INTERVAL.endUtc),
            },
          ],
          sourceVersion: { id: PLAN_VERSION_ID, state: "published" },
          publishedVersionId: PLAN_VERSION_ID,
          resources: RESOURCES,
        },
      }),
  });

  const writes: PlanningWritesFactory = () => ({
    validateDraft: () => Promise.resolve({ ok: true, conflicts: [], publishable: true }),
    createAssignment: (input) =>
      Promise.resolve({
        ok: true,
        replayed: false,
        assignment: {
          id: ASSIGNMENT_ID,
          planVersionId: PLAN_VERSION_ID,
          employeeId: input.employeeId,
          worksiteId: input.worksiteId,
          startsAtUtc: input.startsAtUtc,
          endsAtUtc: input.endsAtUtc,
        },
      }),
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_PING)
    .useValue({ ping: (): Promise<boolean> => Promise.resolve(true) } satisfies DatabasePing)
    .overrideProvider(TENANT_SUBJECT_RESOLVER)
    .useValue({ resolve: (): string => SUBJECT } satisfies TenantSubjectResolver)
    .overrideProvider(PLANNING_QUERIES_FACTORY)
    .useValue(queries)
    .overrideProvider(PLANNING_WRITES_FACTORY)
    .useValue(writes)
    .overrideProvider(PLANNING_ACCESS_POLICY)
    .useValue({
      mayReadPlanning: (): Promise<boolean> => Promise.resolve(true),
      mayWritePlanning: (): Promise<boolean> => Promise.resolve(true),
    } satisfies PlanningAccessPolicy)
    .compile();

  const built = moduleRef.createNestApplication();
  built.setGlobalPrefix(API_BASE_PATH, { exclude: ["health", "ready"] });
  await built.listen(0);
  app = built;

  const url = await built.getUrl();
  return new HttpPlanningGateway({
    // `getUrl()` liefert unter Node 22 gelegentlich die IPv6-Wildcard `::1`
    // in der Form `http://[::1]:PORT`; `fetch` kommt damit klar, `0.0.0.0`
    // nicht. Deshalb wird die Wildcard ausdruecklich ersetzt.
    baseUrl: `${url.replace("[::1]", "127.0.0.1").replace("0.0.0.0", "127.0.0.1")}/${API_BASE_PATH}`,
    fetchImpl: globalThis.fetch,
  });
}

afterAll(async () => {
  await app?.close();
  app = null;
});

/**
 * ## Offene Grenze: die Kopplung an den Mock fehlt noch
 *
 * Der Product Owner hat verlangt, DIESELBEN Faelle gegen `MockPlanningGateway`
 * UND `HttpPlanningGateway` laufen zu lassen. Der HTTP-Teil steht hier; der
 * Mock-Teil steht weiterhin in
 * `packages/contracts/test/planning-gateway.contract.test.ts`.
 *
 * **Beide sind nicht mechanisch gekoppelt** — driftet einer, faellt es nicht
 * auf. Das ist eine echte Luecke und keine Formalie.
 *
 * Der Grund ist eine Paketgrenze: `MockPlanningGateway` wird bewusst NICHT aus
 * `@easytree/contracts` exportiert (`test/public-surface.test.ts` haelt das
 * fest, damit kein Mock im Produktionsbuendel landet), und `package.json` hat
 * keinen `./mock`-Subpfad. `apps/api` kann ihn deshalb gar nicht importieren.
 * Die saubere Loesung ist ein eigener Subpfad-Export — der laege in
 * `packages/contracts/package.json` und damit ausserhalb der bestaetigten
 * Allowed-change-Liste. Diese Entscheidung gehoert dem Product Owner, nicht mir.
 */
describe("Vertragsfaelle gegen den ECHTEN NestJS-Server", () => {
  let gateway: PlanningGateway;

  beforeAll(async () => {
    gateway = await httpGateway();
  });

  it("liefert ein vertragskonformes Planungsfenster", async () => {
    const result = await gateway.getPlanningWindow({ weekKey: "2026-W32" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => PlanningWindowSchema.parse(result.value)).not.toThrow();
    expect(result.value.weekKey).toBe("2026-W32");
    expect(result.value.assignments[0]?.id).toBe(ASSIGNMENT_ID);
    // Die Stammdaten reisen mit — beide Implementierungen, nicht nur eine.
    expect(result.value.resources.employees.map((e) => e.id)).toContain(EMPLOYEE_ID);
  });

  it("liefert ein vertragskonformes Pruefergebnis", async () => {
    const result = await gateway.validateDraft({
      weekKey: "2026-W32",
      draft: { employeeId: EMPLOYEE_ID, worksiteId: WORKSITE_ID, interval: INTERVAL },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => PlanValidationResultSchema.parse(result.value)).not.toThrow();
    expect(result.value.publishable).toBe(true);
  });

  it("legt einen vertragskonformen Einsatz an", async () => {
    const result = await gateway.createAssignment(
      { weekKey: "2026-W32", employeeId: EMPLOYEE_ID, worksiteId: WORKSITE_ID, interval: INTERVAL },
      { idempotencyKey: newIdempotencyKey() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => AssignmentDtoSchema.parse(result.value)).not.toThrow();
    expect(result.value.interval).toEqual(INTERVAL);
  });

  it("meldet einen ungueltigen Wochenschluessel als Fehler und nicht als leere Woche", async () => {
    // `2025-W53` existiert nicht (2025 hat 52 ISO-Wochen). Beide
    // Implementierungen muessen das ablehnen — der Mock ueber das Schema, der
    // Server zur Laufzeit.
    const result = await gateway.getPlanningWindow({ weekKey: "2025-W53" as never });
    expect(result.ok).toBe(false);
  });
});
