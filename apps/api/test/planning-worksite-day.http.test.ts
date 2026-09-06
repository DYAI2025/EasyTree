/**
 * HTTP-Schnittstelle fuer den ersten WorksiteDay-Write (EYT-152).
 *
 * Dieser erste RED-Fall beweist bewusst nur den vertikalen Eintrittspunkt:
 * eine verifizierte Planerin mit `planning.write` kann einen gueltigen,
 * nicht-leeren Baustellentag ueber den vertraglich publizierten Pfad anlegen.
 * Die Datenbank-Invarianten folgen in der Integrationssuite, sobald der Port
 * und sein PostgreSQL-Adapter existieren.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { API_BASE_PATH } from "../src/common/api-base-path";
import { mitPlanungsIdentitaet } from "./planning-identity.helper";
import { DATABASE_PING, type DatabasePing } from "../src/health/readiness";
import {
  PLANNING_WRITES_FACTORY,
  type PlanningWrites,
  type PlanningWritesFactory,
} from "../src/modules/planning";

const SUBJECT = "00000000-0000-4000-8000-00000000aaa1";
const url = `/${API_BASE_PATH}/planung/baustellentage`;
const idempotencyKey = "11111111-1111-4111-8111-111111111111";

const gueltigerBaustellentag = {
  weekKey: "2026-W32",
  worksiteId: "00000000-0000-4000-8000-0000005010a1",
  localDate: "2026-08-03",
  team: [
    {
      employeeId: "00000000-0000-4000-8000-0000004010a1",
      interval: {
        startUtc: "2026-08-03T06:00:00.000Z",
        endUtc: "2026-08-03T14:00:00.000Z",
      },
    },
  ],
};

let app: INestApplication | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function boot(
  options: { subject?: string | null; permissions?: readonly string[] } = {},
): Promise<INestApplication> {
  const writes: PlanningWritesFactory = () =>
    ({
      validateDraft: () => Promise.reject(new Error("nicht Teil dieses HTTP-RED-Falls")),
      createAssignment: () => Promise.reject(new Error("nicht Teil dieses HTTP-RED-Falls")),
      planWorksiteDay: (input) =>
        Promise.resolve({
          ok: true,
          replayed: false,
          worksiteDay: {
            worksiteDayId: "00000000-0000-4000-8000-0000007010a1",
            configurationId: "00000000-0000-4000-8000-0000008010a1",
            worksiteId: input.worksiteId,
            localDate: input.localDate,
            lockVersion: 0,
            team: input.team.map((member, index) => ({
              assignmentId: `00000000-0000-4000-8000-00000090${String(index).padStart(2, "0")}a1`,
              employeeId: member.employeeId,
              startsAtUtc: member.startsAtUtc,
              endsAtUtc: member.endsAtUtc,
            })),
          },
        }),
      publishPlan: () => Promise.reject(new Error("nicht Teil dieses HTTP-RED-Falls")),
    }) satisfies PlanningWrites;

  const moduleRef = await mitPlanungsIdentitaet(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_PING)
      .useValue({ ping: (): Promise<boolean> => Promise.resolve(true) } satisfies DatabasePing)
      .overrideProvider(PLANNING_WRITES_FACTORY)
      .useValue(writes),
    {
      subject: options.subject === undefined ? SUBJECT : options.subject,
      permissions: options.permissions ?? ["planning.write"],
    },
  ).compile();

  const built = moduleRef.createNestApplication();
  built.setGlobalPrefix(API_BASE_PATH, { exclude: ["health", "ready"] });
  await built.init();
  app = built;
  return built;
}

describe("POST /planung/baustellentage", () => {
  it("legt einen gueltigen Baustellentag ueber den vertraglichen HTTP-Pfad an", async () => {
    const server = (await boot()).getHttpServer();

    const response = await request(server)
      .post(url)
      .set("Idempotency-Key", idempotencyKey)
      .send(gueltigerBaustellentag)
      .expect(201);

    expect(response.body).toMatchObject({
      worksiteId: gueltigerBaustellentag.worksiteId,
      localDate: gueltigerBaustellentag.localDate,
    });
  });

  it("weist fehlende Identität vor Vertragsprüfung mit 401 zurück", async () => {
    const server = (await boot({ subject: null })).getHttpServer();
    await request(server).post(url).send({}).expect(401);
  });

  it("weist fehlendes planning.write vor jeder Repository-Mutation mit 403 zurück", async () => {
    const server = (await boot({ permissions: [] })).getHttpServer();
    await request(server)
      .post(url)
      .set("Idempotency-Key", idempotencyKey)
      .send(gueltigerBaustellentag)
      .expect(403);
  });
});
