/**
 * HTTP-Verhalten von `GET /api/v1/planung/fenster` (EYT-50).
 *
 * Ohne Datenbank: der Leseport wird per DI ersetzt, genau wie `DATABASE_PING`
 * (EYT-58). Geprueft wird die NAHT — Reihenfolge der Pruefungen, Statuscodes,
 * Antwortform. Dass die Query gegen echtes Postgres unter RLS das Richtige
 * liest, ist eine andere Aussage und gehoert in die Integrationssuite.
 */
import { PlanningWindowSchema } from "@easytree/contracts";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { API_BASE_PATH } from "../src/common/api-base-path";
import { TENANT_SUBJECT_RESOLVER, type TenantSubjectResolver } from "../src/common/tenant-subject";
import { DATABASE_PING, type DatabasePing } from "../src/health/readiness";
import {
  PLANNING_QUERIES_FACTORY,
  type PlanningQueries,
  type PlanningQueriesFactory,
  type PlanningWindowResult,
} from "../src/modules/planning";

const SUBJECT = "00000000-0000-0000-0000-00000000aaa1";

const EMPTY_WINDOW: PlanningWindowResult = {
  ok: true,
  window: {
    weekKey: "2026-W32",
    timeZone: "Europe/Berlin",
    assignments: [],
    publishedVersionId: null,
  },
};

let app: INestApplication | null = null;

/** Baut die App mit ersetztem Subjekt und ersetztem Leseport. */
async function boot(options: {
  subject: string | null;
  result?: PlanningWindowResult;
  seenSubjects?: string[];
}): Promise<INestApplication> {
  const factory: PlanningQueriesFactory = (subjectUserId) => {
    options.seenSubjects?.push(subjectUserId);
    return {
      planningWindow: (): Promise<PlanningWindowResult> =>
        Promise.resolve(options.result ?? EMPTY_WINDOW),
    } satisfies PlanningQueries;
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_PING)
    .useValue({ ping: (): Promise<boolean> => Promise.resolve(true) } satisfies DatabasePing)
    .overrideProvider(TENANT_SUBJECT_RESOLVER)
    .useValue({ resolve: (): string | null => options.subject } satisfies TenantSubjectResolver)
    .overrideProvider(PLANNING_QUERIES_FACTORY)
    .useValue(factory)
    .compile();

  const built = moduleRef.createNestApplication();
  built.setGlobalPrefix(API_BASE_PATH, { exclude: ["health", "ready"] });
  await built.init();
  app = built;
  return built;
}

const url = `/${API_BASE_PATH}/planung/fenster`;

afterEach(async () => {
  await app?.close();
  app = null;
});

describe("GET /planung/fenster", () => {
  it("antwortet ohne verifiziertes Subjekt mit 401", async () => {
    const server = (await boot({ subject: null })).getHttpServer();
    await request(server).get(url).query({ weekKey: "2026-W32" }).expect(401);
  });

  it("fragt ohne Subjekt gar nicht erst ab", async () => {
    // Der Kern der Reihenfolge: eine Query ohne Subjekt liefe mit leerem
    // app.user_org_ids() und lieferte ein LEERES Fenster — das saehe aus wie
    // "diese Woche ist nicht geplant" statt wie eine Ablehnung.
    const seenSubjects: string[] = [];
    const server = (await boot({ subject: null, seenSubjects })).getHttpServer();
    await request(server).get(url).query({ weekKey: "2026-W32" }).expect(401);
    expect(seenSubjects).toEqual([]);
  });

  it("lehnt einen unbrauchbaren weekKey mit 400 ab", async () => {
    const server = (await boot({ subject: SUBJECT })).getHttpServer();
    for (const weekKey of ["", "2026-32", "irgendwas", "2026-W3"]) {
      await request(server).get(url).query({ weekKey }).expect(400);
    }
    await request(server).get(url).expect(400);
  });

  it("liefert eine leere Woche als 200 mit leerer Liste, nicht als 404", async () => {
    // Eine Woche ohne Plan ist eine gueltige, leere Woche. 404 hiesse "diese
    // Woche gibt es nicht", und das ist falsch.
    const server = (await boot({ subject: SUBJECT })).getHttpServer();
    const response = await request(server).get(url).query({ weekKey: "2026-W32" }).expect(200);
    expect(response.body).toEqual({
      weekKey: "2026-W32",
      timeZone: "Europe/Berlin",
      assignments: [],
      publishedVersionId: null,
    });
    expect(() => PlanningWindowSchema.parse(response.body)).not.toThrow();
  });

  it("reicht das Subjekt an den Leseport durch", async () => {
    const seenSubjects: string[] = [];
    const server = (await boot({ subject: SUBJECT, seenSubjects })).getHttpServer();
    await request(server).get(url).query({ weekKey: "2026-W32" }).expect(200);
    expect(seenSubjects).toEqual([SUBJECT]);
  });

  it("bildet Zuweisungen auf die Vertragsform ab", async () => {
    const server = (
      await boot({
        subject: SUBJECT,
        result: {
          ok: true,
          window: {
            weekKey: "2026-W32",
            timeZone: "Europe/Berlin",
            assignments: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                employeeId: "22222222-2222-4222-8222-222222222222",
                worksiteId: "33333333-3333-4333-8333-333333333333",
                startsAtUtc: new Date("2026-08-03T06:00:00.000Z"),
                endsAtUtc: new Date("2026-08-03T14:00:00.000Z"),
              },
            ],
            publishedVersionId: "44444444-4444-4444-8444-444444444444",
          },
        },
      })
    ).getHttpServer();

    const response = await request(server).get(url).query({ weekKey: "2026-W32" }).expect(200);
    expect(() => PlanningWindowSchema.parse(response.body)).not.toThrow();
    expect(response.body.assignments[0].interval).toEqual({
      startUtc: "2026-08-03T06:00:00.000Z",
      endUtc: "2026-08-03T14:00:00.000Z",
    });
    expect(response.body.publishedVersionId).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("antwortet bei fehlender Organisation mit 403", async () => {
    const server = (
      await boot({ subject: SUBJECT, result: { ok: false, problem: "NO_ORGANISATION" } })
    ).getHttpServer();
    await request(server).get(url).query({ weekKey: "2026-W32" }).expect(403);
  });

  it("waehlt bei mehreren Organisationen KEINE aus, sondern lehnt ab", async () => {
    // Eine zu nehmen, weil sie die erste ist, waere eine erfundene
    // Mandantenentscheidung — und sie fiele niemandem auf, weil das Ergebnis
    // plausibel aussieht.
    const server = (
      await boot({ subject: SUBJECT, result: { ok: false, problem: "AMBIGUOUS_ORGANISATION" } })
    ).getHttpServer();
    await request(server).get(url).query({ weekKey: "2026-W32" }).expect(403);
  });

  it("laesst health unter dem unversionierten Pfad", async () => {
    // Gegenprobe zur Praefixsetzung im Test selbst.
    const server = (await boot({ subject: SUBJECT })).getHttpServer();
    await request(server).get("/health").expect(200);
  });
});
