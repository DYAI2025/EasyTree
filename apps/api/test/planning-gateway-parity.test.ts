/**
 * Vertragsparität: derselbe kanonische Fallsatz gegen den echten HTTP-Pfad
 * (EYT-103).
 *
 * Die Suite selbst kommt aus dem ausdrücklich test-only exportierten Subpfad
 * `@easytree/contracts/testing/*`. `packages/contracts` kennt NestJS nicht;
 * dieses Harness stellt ausschließlich den echten Controller, Filter und
 * HTTP-Client bereit. RLS und PostgreSQL bleiben Aufgabe der
 * Planning-Integrationstests und des read-through-Jobs.
 */
import { HttpPlanningGateway, type PlanningGateway } from "@easytree/contracts";
import {
  PLANNING_GATEWAY_CONTRACT_FIXTURE as FIXTURE,
  PLANNING_VALIDATION_CODE,
  planningGatewayContractSuite,
  type PlanningGatewayContractHarness,
} from "@easytree/contracts/testing/planning-gateway-contract";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AppModule } from "../src/app.module";
import { API_BASE_PATH } from "../src/common/api-base-path";
import { TENANT_SUBJECT_RESOLVER, type TenantSubjectResolver } from "../src/common/tenant-subject";
import { DATABASE_PING, type DatabasePing } from "../src/health/readiness";
import {
  PLANNING_ACCESS_POLICY,
  PLANNING_QUERIES_FACTORY,
  PLANNING_WRITES_FACTORY,
  type CreatedAssignmentRow,
  type PlanningAccessPolicy,
  type PlanningQueriesFactory,
  type PlanningWritesFactory,
} from "../src/modules/planning";

const SUBJECT = "00000000-0000-4000-8000-00000000aaa1";
const PLAN_VERSION_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3300";
const CREATED_ASSIGNMENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3304";
const RESOURCES = {
  employees: [{ id: FIXTURE.employeeId, label: "Beschaeftigte A", active: true }],
  worksites: [{ id: FIXTURE.worksiteId, label: "Baustelle A", active: true }],
};

function overlapsExisting(startsAtUtc: Date, endsAtUtc: Date): boolean {
  const existingStart = new Date(FIXTURE.existingInterval.startUtc);
  const existingEnd = new Date(FIXTURE.existingInterval.endUtc);
  return existingStart < endsAtUtc && startsAtUtc < existingEnd;
}

function fingerprint(input: {
  readonly weekKey: string;
  readonly employeeId: string;
  readonly worksiteId: string;
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date;
}): string {
  return JSON.stringify({
    weekKey: input.weekKey,
    employeeId: input.employeeId,
    worksiteId: input.worksiteId,
    startsAtUtc: input.startsAtUtc.toISOString(),
    endsAtUtc: input.endsAtUtc.toISOString(),
  });
}

/**
 * Frischer echter NestJS-Server pro Vertragsfall.
 *
 * Die Ports sind deterministische Testdoubles. Der Test misst die HTTP-Naht:
 * Pfad, Methode, Header, Status, Problem-Type und Antwortschema.
 */
async function httpGatewayHarness(): Promise<PlanningGatewayContractHarness> {
  const idempotency = new Map<
    string,
    { readonly fingerprint: string; readonly assignment: CreatedAssignmentRow }
  >();

  const queries: PlanningQueriesFactory = () => ({
    planningWindow: (weekKey) =>
      Promise.resolve({
        ok: true,
        window: {
          weekKey,
          timeZone: "Europe/Berlin",
          assignments: [
            {
              id: FIXTURE.existingAssignmentId,
              employeeId: FIXTURE.employeeId,
              worksiteId: FIXTURE.worksiteId,
              startsAtUtc: new Date(FIXTURE.existingInterval.startUtc),
              endsAtUtc: new Date(FIXTURE.existingInterval.endUtc),
            },
          ],
          sourceVersion: { id: PLAN_VERSION_ID, state: "published" },
          publishedVersionId: PLAN_VERSION_ID,
          resources: RESOURCES,
        },
      }),
  });

  const writes: PlanningWritesFactory = () => ({
    validateDraft: (input) => {
      if (overlapsExisting(input.startsAtUtc, input.endsAtUtc)) {
        return Promise.resolve({
          ok: true,
          conflicts: [
            {
              code: PLANNING_VALIDATION_CODE.overlap,
              blocking: true,
              message: "Mitarbeitende Person ist in diesem Zeitraum bereits eingeplant.",
            },
          ],
          publishable: false,
        });
      }
      return Promise.resolve({ ok: true, conflicts: [], publishable: true });
    },
    createAssignment: (input) => {
      const requestFingerprint = fingerprint(input);
      const previous = idempotency.get(input.idempotencyKey);
      if (previous !== undefined) {
        return Promise.resolve(
          previous.fingerprint === requestFingerprint
            ? { ok: true, replayed: true, assignment: previous.assignment }
            : { ok: false, problem: { kind: "IDEMPOTENCY_KEY_REUSED" } },
        );
      }

      if (overlapsExisting(input.startsAtUtc, input.endsAtUtc)) {
        return Promise.resolve({
          ok: false,
          problem: {
            kind: "OVERLAPPING_ASSIGNMENT",
            overlap: {
              assignmentId: FIXTURE.existingAssignmentId,
              startsAtUtc: new Date(FIXTURE.existingInterval.startUtc),
              endsAtUtc: new Date(FIXTURE.existingInterval.endUtc),
            },
          },
        });
      }

      const assignment: CreatedAssignmentRow = {
        id: CREATED_ASSIGNMENT_ID,
        planVersionId: PLAN_VERSION_ID,
        employeeId: input.employeeId,
        worksiteId: input.worksiteId,
        startsAtUtc: input.startsAtUtc,
        endsAtUtc: input.endsAtUtc,
      };
      idempotency.set(input.idempotencyKey, {
        fingerprint: requestFingerprint,
        assignment,
      });
      return Promise.resolve({ ok: true, replayed: false, assignment });
    },
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

  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix(API_BASE_PATH, { exclude: ["health", "ready"] });
  await app.listen(0);

  const url = await app.getUrl();
  const gateway: PlanningGateway = new HttpPlanningGateway({
    baseUrl: `${url.replace("[::1]", "127.0.0.1").replace("0.0.0.0", "127.0.0.1")}/${API_BASE_PATH}`,
    fetchImpl: globalThis.fetch,
  });

  return {
    gateway,
    close: async () => {
      await app.close();
    },
  };
}

planningGatewayContractSuite("HttpPlanningGateway mit echtem NestJS-Server", httpGatewayHarness);
