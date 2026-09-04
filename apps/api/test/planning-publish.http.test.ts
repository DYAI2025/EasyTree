/**
 * HTTP-Naht des Veroeffentlichens (EYT-107).
 *
 * ## Warum diese Suite den Fehler-`type` prueft und nicht nur den Status
 *
 * `HttpPlanningGateway.publishPlan` bildet **jeden** 409 auf `STALE_VERSION`
 * ab (`conflictAs`). Fuer die Oberflaeche sind „veralteter Stand", „bereits
 * veroeffentlicht", „blockierender Konflikt" und „Zuweisung in der falschen
 * Woche" ohne den `type` also ein und derselbe Zustand. Ein Test, der nur
 * `expect(409)` prueft, waere gruen, waehrend die Oberflaeche vier
 * verschiedene Ablehnungen nicht auseinanderhalten kann.
 *
 * ## Was hier NICHT ersetzt wird
 *
 * Die `PlanningAccessPolicy` laeuft echt. Gestellt werden nur Identitaet,
 * Mitgliedschaft und der Schreibport — also die Aussenwelt, nicht die
 * Entscheidung. Ein Test mit gestellter Policy wuerde die Berechtigung
 * vorgeben, die er beweisen soll.
 *
 * Gegenmutationen, die diese Datei rot machen:
 *   - im Controller `planning.publish` durch `planning.write` ersetzen
 *     -> „lehnt ohne planning.publish ab" faellt;
 *   - die Idempotenzschluessel-Pruefung entfernen -> „ohne Schluessel 400" faellt;
 *   - `problemFor` fuer einen der vier Publish-Zweige auf denselben `type`
 *     legen -> der jeweilige Fall faellt.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { API_BASE_PATH } from "../src/common/api-base-path";
import { DATABASE_PING, type DatabasePing } from "../src/health/readiness";
import {
  PLANNING_ERROR_TYPE,
  PLANNING_WRITES_FACTORY,
  type PlanningWriteProblem,
  type PlanningWrites,
  type PlanningWritesFactory,
  type PublishPlanResult,
  type PublishedPlanVersionRow,
} from "../src/modules/planning";
import { mitPlanungsIdentitaet, TEST_ORG, TEST_ORG_B } from "./planning-identity.helper";

const url = `/${API_BASE_PATH}/planung/versionen`;
const SCHLUESSEL = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const VERSION_ID = "00000000-0000-4000-8000-0000006010a1";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-0000007010a1";
const WOCHE = "2026-W32";

const VEROEFFENTLICHT: PublishedPlanVersionRow = {
  versionId: VERSION_ID,
  weekKey: WOCHE,
  publishedAtUtc: new Date("2026-08-03T10:00:00.000Z"),
  assignmentIds: [ASSIGNMENT_ID],
};

const GUELTIGER_KOERPER = { weekKey: WOCHE, expectedVersionId: VERSION_ID };

let app: INestApplication | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

interface BootOptions {
  readonly ergebnis?: PublishPlanResult;
  /** Vorgabe: alle drei Planungsrechte. */
  readonly permissions?: readonly string[];
  readonly subject?: string | null;
  readonly organisationen?: readonly { organisationId: string; permissions: readonly string[] }[];
  /** Sammelt, was der Port tatsaechlich zu sehen bekam. */
  readonly gesehen?: unknown[];
}

async function boot(options: BootOptions = {}): Promise<INestApplication> {
  const writes: PlanningWritesFactory = () =>
    ({
      validateDraft: () => Promise.reject(new Error("in dieser Suite nicht benutzt")),
      createAssignment: () => Promise.reject(new Error("in dieser Suite nicht benutzt")),
      planWorksiteDay: () => Promise.reject(new Error("in dieser Suite nicht benutzt")),
      publishPlan: (eingabe) => {
        options.gesehen?.push(eingabe);
        return Promise.resolve(
          options.ergebnis ?? { ok: true, version: VEROEFFENTLICHT, replayed: false },
        );
      },
    }) satisfies PlanningWrites;

  const moduleRef = await mitPlanungsIdentitaet(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_PING)
      .useValue({ ping: (): Promise<boolean> => Promise.resolve(true) } satisfies DatabasePing)
      .overrideProvider(PLANNING_WRITES_FACTORY)
      .useValue(writes),
    {
      subject: options.subject,
      permissions: options.permissions,
      organisationen: options.organisationen,
    },
  ).compile();

  const built = moduleRef.createNestApplication();
  built.setGlobalPrefix(API_BASE_PATH, { exclude: ["health", "ready"] });
  await built.init();
  app = built;
  return built;
}

const mitSchluessel = (server: unknown): request.Test =>
  request(server as never)
    .post(url)
    .set("Idempotency-Key", SCHLUESSEL);

describe("POST /planung/versionen — Zugang", () => {
  it("antwortet ohne Anmeldung mit 401", async () => {
    const server = (await boot({ subject: null })).getHttpServer();
    await mitSchluessel(server).send(GUELTIGER_KOERPER).expect(401);
  });

  it("lehnt ohne planning.publish mit 403 ab, obwohl read und write vorliegen", async () => {
    // Die Trennung der Rechte ist die PO-Entscheidung vom 03.08.2026. Ohne
    // diesen Fall waere sie im HTTP-Pfad unbelegt.
    const server = (
      await boot({ permissions: ["planning.read", "planning.write"] })
    ).getHttpServer();
    await mitSchluessel(server).send(GUELTIGER_KOERPER).expect(403);
  });

  it("laesst mit planning.publish durch", async () => {
    // Gegenprobe: ohne sie waere die Ablehnung oben auch dann gruen, wenn
    // grundsaetzlich nichts durchginge.
    const server = (await boot({ permissions: ["planning.publish"] })).getHttpServer();
    await mitSchluessel(server).send(GUELTIGER_KOERPER).expect(201);
  });

  it("lehnt bei mehreren Organisationen ohne stille Auswahl ab", async () => {
    const server = (
      await boot({
        organisationen: [
          { organisationId: TEST_ORG, permissions: ["planning.publish"] },
          { organisationId: TEST_ORG_B, permissions: ["planning.publish"] },
        ],
      })
    ).getHttpServer();
    const antwort = await mitSchluessel(server).send(GUELTIGER_KOERPER).expect(403);
    expect(antwort.body.type).toBe(PLANNING_ERROR_TYPE.AMBIGUOUS_ORGANISATION);
  });

  it("prueft die Berechtigung VOR dem Vertrag", async () => {
    // Ein kaputter Koerper darf einem Unberechtigten nicht die Form des
    // Vertrags verraten: 403, nicht 400.
    const server = (await boot({ permissions: [] })).getHttpServer();
    await mitSchluessel(server).send({ unsinn: true }).expect(403);
  });
});

describe("POST /planung/versionen — Vertrag", () => {
  it("verlangt einen Idempotenzschluessel", async () => {
    const server = (await boot()).getHttpServer();
    const antwort = await request(server).post(url).send(GUELTIGER_KOERPER).expect(400);
    expect(antwort.body.type).toBe(PLANNING_ERROR_TYPE.MISSING_IDEMPOTENCY_KEY);
  });

  it("lehnt einen unbrauchbaren Idempotenzschluessel ab", async () => {
    const server = (await boot()).getHttpServer();
    await request(server)
      .post(url)
      .set("Idempotency-Key", "zu-kurz")
      .send(GUELTIGER_KOERPER)
      .expect(400);
  });

  it("verlangt expectedVersionId als Feld, auch wenn null erlaubt ist", async () => {
    const server = (await boot()).getHttpServer();
    await mitSchluessel(server).send({ weekKey: WOCHE }).expect(400);
  });

  it("nimmt expectedVersionId = null an", async () => {
    const gesehen: unknown[] = [];
    const server = (await boot({ gesehen })).getHttpServer();
    await mitSchluessel(server).send({ weekKey: WOCHE, expectedVersionId: null }).expect(201);
    expect(gesehen[0]).toMatchObject({ expectedVersionId: null });
  });

  it("lehnt eine unmoegliche ISO-Woche ab", async () => {
    const server = (await boot()).getHttpServer();
    await mitSchluessel(server)
      .send({ weekKey: "2025-W53", expectedVersionId: VERSION_ID })
      .expect(400);
  });

  it("reicht Woche, Version und Schluessel unveraendert an den Port", async () => {
    const gesehen: unknown[] = [];
    const server = (await boot({ gesehen })).getHttpServer();
    await mitSchluessel(server).send(GUELTIGER_KOERPER).expect(201);
    expect(gesehen).toEqual([
      { weekKey: WOCHE, expectedVersionId: VERSION_ID, idempotencyKey: SCHLUESSEL },
    ]);
  });

  it("antwortet vertragskonform mit 201", async () => {
    const server = (await boot()).getHttpServer();
    const antwort = await mitSchluessel(server).send(GUELTIGER_KOERPER).expect(201);
    expect(antwort.body).toEqual({
      versionId: VERSION_ID,
      weekKey: WOCHE,
      publishedAtUtc: "2026-08-03T10:00:00.000Z",
      assignmentIds: [ASSIGNMENT_ID],
    });
  });

  it("meldet einen Vertragsbruch der EIGENEN Antwort als 500", async () => {
    // Der Server prueft seine eigene Ausgabe. Ohne diesen Zweig wanderte eine
    // kaputte Antwort als CONTRACT_VIOLATION zum Client, und niemand saehe
    // die Ursache.
    const server = (
      await boot({
        ergebnis: {
          ok: true,
          replayed: false,
          version: { ...VEROEFFENTLICHT, versionId: "keine-uuid" },
        },
      })
    ).getHttpServer();
    await mitSchluessel(server).send(GUELTIGER_KOERPER).expect(500);
  });
});

describe("POST /planung/versionen — die vier Ablehnungen sind unterscheidbar", () => {
  const faelle: ReadonlyArray<readonly [string, PlanningWriteProblem, string]> = [
    [
      "veralteter Stand",
      { kind: "STALE_VERSION", aktuelleVersionId: VERSION_ID },
      PLANNING_ERROR_TYPE.STALE_VERSION,
    ],
    [
      "bereits veroeffentlicht",
      { kind: "ALREADY_PUBLISHED", versionId: VERSION_ID },
      PLANNING_ERROR_TYPE.ALREADY_PUBLISHED,
    ],
    [
      "blockierender Konflikt",
      {
        kind: "BLOCKING_CONFLICT",
        conflicts: [
          { code: "EMPLOYEE_INTERVAL_OVERLAP", blocking: true, message: "ueberschneidet sich" },
        ],
      },
      PLANNING_ERROR_TYPE.BLOCKING_CONFLICT,
    ],
    [
      "Zuweisung in fremder Woche",
      { kind: "ASSIGNMENT_OUTSIDE_WEEK", tatsaechlicheWoche: "2026-W33" },
      PLANNING_ERROR_TYPE.ASSIGNMENT_OUTSIDE_WEEK,
    ],
  ];

  it.each(faelle)("%s -> 409 mit eigenem type", async (_name, problem, erwarteterTyp) => {
    const server = (await boot({ ergebnis: { ok: false, problem } })).getHttpServer();
    const antwort = await mitSchluessel(server).send(GUELTIGER_KOERPER).expect(409);
    expect(antwort.body.type).toBe(erwarteterTyp);
  });

  it("vergibt vier VERSCHIEDENE types", async () => {
    // Die eigentliche Aussage: nicht „jeder Fall antwortet 409", sondern
    // „jeder Fall ist unterscheidbar". Ohne diese Zeile waere ein
    // Copy-Paste-Fehler in `problemFor` unauffaellig.
    const typen = new Set(faelle.map(([, , typ]) => typ));
    expect(typen.size).toBe(4);
  });

  it("nennt bei einem blockierenden Konflikt den Konfliktcode", async () => {
    const server = (
      await boot({
        ergebnis: {
          ok: false,
          problem: {
            kind: "BLOCKING_CONFLICT",
            conflicts: [
              { code: "EMPLOYEE_INTERVAL_OVERLAP", blocking: true, message: "irgendwas" },
            ],
          },
        },
      })
    ).getHttpServer();
    const antwort = await mitSchluessel(server).send(GUELTIGER_KOERPER).expect(409);
    expect(antwort.body.detail).toContain("EMPLOYEE_INTERVAL_OVERLAP");
  });

  it("meldet einen wiederverwendeten Schluessel als 409", async () => {
    const server = (
      await boot({ ergebnis: { ok: false, problem: { kind: "IDEMPOTENCY_KEY_REUSED" } } })
    ).getHttpServer();
    const antwort = await mitSchluessel(server).send(GUELTIGER_KOERPER).expect(409);
    expect(antwort.body.type).toBe(PLANNING_ERROR_TYPE.IDEMPOTENCY_KEY_REUSED);
  });
});
