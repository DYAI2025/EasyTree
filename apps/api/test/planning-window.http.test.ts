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
import { mitPlanungsIdentitaet } from "./planning-identity.helper";
import { DATABASE_PING, type DatabasePing } from "../src/health/readiness";
import {
  PLANNING_QUERIES_FACTORY,
  type PlanningQueries,
  type PlanningQueriesFactory,
  type PlanningWindowResult,
} from "../src/modules/planning";

const SUBJECT = "00000000-0000-4000-8000-00000000aaa1";

const EMPTY_WINDOW: PlanningWindowResult = {
  ok: true,
  window: {
    weekKey: "2026-W32",
    timeZone: "Europe/Berlin",
    assignments: [],
    sourceVersion: null,
    publishedVersionId: null,
    resources: { employees: [], worksites: [] },
  },
};

let app: INestApplication | null = null;

/** Baut die App mit ersetztem Subjekt und ersetztem Leseport. */
async function boot(options: {
  subject: string | null;
  result?: PlanningWindowResult;
  seenSubjects?: string[];
  /**
   * Default: berechtigt.
   *
   * Seit EYT-107 steuert das nicht mehr eine gestellte Policy, sondern die
   * RECHTE der gestellten Mitgliedschaft. Die echte Policy entscheidet daraus
   * — sonst pruefte dieser Test nur seine eigene Attrappe.
   */
  darfLesen?: boolean;
  darfSchreiben?: boolean;
}): Promise<INestApplication> {
  const factory: PlanningQueriesFactory = (subjectUserId) => {
    options.seenSubjects?.push(subjectUserId);
    return {
      planningWindow: (): Promise<PlanningWindowResult> =>
        Promise.resolve(options.result ?? EMPTY_WINDOW),
      // EYT-109: nicht Gegenstand dieser Naht — /planung/fenster ruft sie nicht.
      // Bewusst ein Wurf und keine leere Antwort: eine Attrappe, die `[]`
      // liefert, faerbt einen kuenftigen Test gruen, der diese Route versehentlich
      // ueber den Leseport fuehrt.
      publishedVersions: () => {
        throw new Error("publishedVersions ist in diesem Test nicht gestellt (EYT-109).");
      },
      publishedAssignments: () => {
        throw new Error("publishedAssignments ist in diesem Test nicht gestellt (EYT-109).");
      },
    } satisfies PlanningQueries;
  };

  // Die POLICY wird NICHT ersetzt — sie ist der zu pruefende Teil. Statt
  // „darf lesen: ja/nein" wird die MITGLIEDSCHAFT gestellt, und die echte
  // Policy leitet daraus ab. Ein Test, der die Antwort vorgibt, misst nichts.
  const rechte: string[] = [];
  if (options.darfLesen ?? true) rechte.push("planning.read");
  if (options.darfSchreiben ?? true) rechte.push("planning.write");

  const moduleRef = await mitPlanungsIdentitaet(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_PING)
      .useValue({ ping: (): Promise<boolean> => Promise.resolve(true) } satisfies DatabasePing)
      .overrideProvider(PLANNING_QUERIES_FACTORY)
      .useValue(factory),
    { subject: options.subject, permissions: rechte },
  ).compile();

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
      sourceVersion: null,
      publishedVersionId: null,
      // Auch die leere Woche traegt das Feld. Es fehlen zu lassen waere kein
      // Sparbetrieb, sondern zwei Antwortformen fuer denselben Vertrag — die
      // Oberflaeche muesste dann raten, ob eine leere Auswahlliste "keine
      // Stammdaten" oder "Feld nicht geliefert" bedeutet.
      resources: { employees: [], worksites: [] },
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
            sourceVersion: {
              id: "55555555-5555-4555-8555-555555555555",
              state: "draft",
            },
            publishedVersionId: "44444444-4444-4444-8444-444444444444",
            // Beide Ids der Zuweisung; ohne sie verwirft der Vertrag die
            // Antwort als nicht aufloesbar.
            resources: {
              employees: [
                {
                  id: "22222222-2222-4222-8222-222222222222",
                  label: "Beschaeftigte A",
                  active: true,
                },
              ],
              worksites: [
                {
                  id: "33333333-3333-4333-8333-333333333333",
                  label: "Baustelle A",
                  active: true,
                },
              ],
            },
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
    // Der Kern der Provenienz: die Zuweisungen stammen aus einem ENTWURF,
    // obwohl daneben eine veroeffentlichte Version gemeldet wird. Ohne dieses
    // Feld saehe die Oberflaeche "Veroeffentlichte Version X" ueber Daten, die
    // gar nicht zu X gehoeren.
    expect(response.body.sourceVersion).toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      state: "draft",
    });
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

  it("lehnt ein verifiziertes, aber nicht berechtigtes Subjekt mit 403 ab", async () => {
    // Verifiziert heisst nicht berechtigt. Ohne diese Trennung saehe jede
    // beschaeftigte Person die Wochenplanung ihrer Organisation.
    const seenSubjects: string[] = [];
    const server = (
      await boot({ subject: SUBJECT, darfLesen: false, seenSubjects })
    ).getHttpServer();
    await request(server).get(url).query({ weekKey: "2026-W32" }).expect(403);
    // Und das Repository wurde gar nicht erst gefragt.
    expect(seenSubjects).toEqual([]);
  });

  it("lehnt Wochenschluessel ausserhalb 01-53 ab", async () => {
    const server = (await boot({ subject: SUBJECT })).getHttpServer();
    for (const weekKey of ["2026-W00", "2026-W54", "2026-W99"]) {
      await request(server).get(url).query({ weekKey }).expect(400);
    }
    // Gegenprobe: die Grenzen selbst sind gueltig.
    for (const weekKey of ["2026-W01", "2026-W53"]) {
      await request(server).get(url).query({ weekKey }).expect(200);
    }
  });

  it("laesst health unter dem unversionierten Pfad", async () => {
    // Gegenprobe zur Praefixsetzung im Test selbst.
    const server = (await boot({ subject: SUBJECT })).getHttpServer();
    await request(server).get("/health").expect(200);
  });
});
