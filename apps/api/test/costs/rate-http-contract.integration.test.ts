/**
 * Vertragstreue der Kostenantworten an der echten Naht (EYT-108).
 *
 * ## Warum es diese Datei zusaetzlich zum Repository-Test braucht
 *
 * `RateVersionRecord` traegt kein `status` — das ergaenzt erst der Controller.
 * Ein Repository-Test kann deshalb nie gegen `RateVersionDtoSchema` pruefen,
 * und genau dieses Schema hat der Browser verworfen. Hier laeuft der volle Weg:
 * echtes PostgreSQL, echtes Repository, echter Controller, echte Serialisierung
 * — und dann urteilt der VERTRAG ueber die Antwort, kein nachgebautes Muster.
 *
 * ## Was ersetzt wird und was nicht
 *
 * Ersetzt sind ausschliesslich Identitaet und Rechte (sonst braeuchte der Test
 * einen laufenden Auth-Server). Repository, Verbindung, SQL-Projektion und
 * Controller sind die echten — sonst pruefte der Test seine eigene Nachbildung.
 */
import {
  IDEMPOTENCY_HEADER,
  RateHistorySchema,
  RateVersionDtoSchema,
  newIdempotencyKey,
} from "@easytree/contracts";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import { TENANT_QUERY_RUNNER } from "../../src/platform/database/tenant-query-runner.provider";
import { PgTenantQueryRunner } from "../../src/platform/database/tenant-query-runner";
import { API_BASE_PATH } from "../../src/common/api-base-path";
import { DATABASE_PING, type DatabasePing } from "../../src/health/readiness";
import { SESSION_ORGANISATIONS } from "../../src/modules/tenancy";
import { REQUEST_IDENTITY } from "../../src/platform/auth/request-identity";
import { SESSION_LIVENESS } from "../../src/platform/auth/session-liveness";
import { TOKEN_VERIFIER } from "../../src/platform/auth/token-verifier";
import { FailClosedGate, ORG_ALPHA, probeDatabase, USER_A } from "../tenant-context.helper";

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
const gate = new FailClosedGate("rate-http-contract", TENANT_TESTS_MODE, "EYT-108");

// Eigener Mitarbeiter je Testdatei: vitest faehrt Dateien PARALLEL, und zwei
// offene Satzintervalle derselben Person kollidieren am EXCLUDE-Constraint.
// Diese Datei nutzt die zweite Seed-Person (supabase/seed.sql).
const EMPLOYEE_ALPHA = "00000000-0000-4000-8000-0000004011a1";
const MARKE = "Vertragstest kanonischer Zeitstempel";
const DREI_STELLEN = /\.\d{3}Z$/;

let dbAvailable = false;
let admin: Client;
let runner: PgTenantQueryRunner;
let app: INestApplication | null = null;

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!dbAvailable) {
      gate.markSkipped();
      ctx.skip(`SKIPPED: PostgreSQL unter ${DB_URL} nicht erreichbar.`);
    }
    await gate.run(fn);
  });
}

describe("Kostenantworten sind vertragskonform (EYT-108)", () => {
  beforeAll(async () => {
    dbAvailable = await probeDatabase(DB_URL);
    if (!dbAvailable) {
      if (TENANT_TESTS_MODE === "required") {
        throw new Error(
          `[rate-http-contract] fail-closed: Pflichttests koennen nicht laufen — DB unter ${DB_URL} nicht erreichbar (EYT-108).`,
        );
      }
      console.warn(
        `[rate-http-contract.integration] SKIPPED: PostgreSQL unter ${DB_URL} nicht erreichbar.`,
      );
      return;
    }
    admin = new Client({ connectionString: DB_URL });
    await admin.connect();
    await admin.query(
      "update public.memberships set role = 'owner' where org_id = $1 and user_id = $2",
      [ORG_ALPHA, USER_A],
    );
    await admin.query("delete from public.employee_rate_versions where reason = $1", [MARKE]);

    // Nur die VERBINDUNG zeigt auf die Testdatenbank: `apps/api/test/setup.ts`
    // setzt eine DATABASE_URL ohne Zugangsdaten, mit der das AppModule keine
    // echte Verbindung aufbauen kann. Repository, SQL-Projektion und
    // Controller bleiben unveraendert die echten.
    runner = PgTenantQueryRunner.fromConnection({ databaseUrl: DB_URL, sslRootCert: undefined });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TENANT_QUERY_RUNNER)
      .useValue(runner)
      .overrideProvider(DATABASE_PING)
      .useValue({ ping: () => Promise.resolve(true) } satisfies DatabasePing)
      // Nur Identitaet und Rechte werden gestellt — alles darunter ist echt.
      .overrideProvider(REQUEST_IDENTITY)
      .useValue({ identify: () => Promise.resolve({ userId: USER_A, sessionId: "test-sitzung" }) })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue({ verify: () => Promise.resolve({ userId: USER_A, sessionId: "test-sitzung" }) })
      .overrideProvider(SESSION_LIVENESS)
      .useValue({ assertAlive: () => Promise.resolve() })
      .overrideProvider(SESSION_ORGANISATIONS)
      .useValue({
        organisationsFor: () =>
          Promise.resolve([
            {
              organisationId: ORG_ALPHA,
              organisationName: "Org Alpha",
              role: "owner" as const,
              permissions: ["costs.read", "costs.manage_rates"],
            },
          ]),
      })
      .compile();

    const anwendung = moduleRef.createNestApplication();
    anwendung.setGlobalPrefix(API_BASE_PATH, { exclude: ["health", "ready"] });
    await anwendung.init();
    app = anwendung;
  });

  afterAll(async () => {
    if (dbAvailable) {
      await app?.close();
      await admin.query("delete from public.employee_rate_versions where reason = $1", [MARKE]);
      await admin.end().catch(() => undefined);
      await runner.close().catch(() => undefined);
    }
    app = null;
  });

  afterAll(() => {
    process.stdout.write(gate.reportLine());
    gate.assertOrThrow();
  });

  dbIt("POST liefert eine Antwort, die RateVersionDtoSchema akzeptiert", async () => {
    // Gegenmutation: `.MS` aus der RETURNING-Projektion entfernen -> rot.
    const antwort = await request(app!.getHttpServer())
      .post("/api/v1/kosten/stundensaetze")
      .set(IDEMPOTENCY_HEADER, newIdempotencyKey())
      .send({
        employeeId: EMPLOYEE_ALPHA,
        amountMinorUnits: "3850",
        currency: "EUR",
        validFrom: "2030-01-01",
        validTo: null,
        reason: MARKE,
        expectedActiveVersionId: null,
      })
      .expect(201);

    const geprueft = RateVersionDtoSchema.safeParse(antwort.body);
    expect(
      geprueft.success,
      geprueft.success ? "" : JSON.stringify(geprueft.error.issues.map((i) => i.path.join("."))),
    ).toBe(true);
    if (!geprueft.success) return;

    expect(geprueft.data.createdAt).toMatch(DREI_STELLEN);
    expect(geprueft.data.amountMinorUnits).toBe("3850");
    expect(geprueft.data.currency).toBe("EUR");
    expect(geprueft.data.validFrom).toBe("2030-01-01");
    expect(["aktiv", "kommend", "abgelaufen"]).toContain(geprueft.data.status);
    // `z.strictObject` haette ein unbekanntes Feld schon oben abgelehnt; diese
    // Zeile macht die Aussage sichtbar, statt sie im Schema zu verstecken.
    expect(Object.keys(antwort.body).sort()).toEqual(Object.keys(geprueft.data).sort());
  });

  dbIt("GET liefert eine Historie, die RateHistorySchema akzeptiert", async () => {
    // Gegenmutation: `.MS` aus der SELECT-Projektion entfernen -> rot.
    const antwort = await request(app!.getHttpServer())
      .get(`/api/v1/kosten/stundensaetze/${EMPLOYEE_ALPHA}`)
      .expect(200);

    const geprueft = RateHistorySchema.safeParse(antwort.body);
    expect(
      geprueft.success,
      geprueft.success ? "" : JSON.stringify(geprueft.error.issues.map((i) => i.path.join("."))),
    ).toBe(true);
    if (!geprueft.success) return;

    const unsere = geprueft.data.versions.filter((version) => version.reason === MARKE);
    expect(unsere.length).toBe(1);
    for (const version of geprueft.data.versions) {
      expect(version.createdAt).toMatch(DREI_STELLEN);
    }
    expect(unsere[0]?.amountMinorUnits).toBe("3850");
    // Aktive Version und Liste muessen zueinander passen.
    if (geprueft.data.activeVersionId !== null) {
      expect(geprueft.data.versions.map((v) => v.id)).toContain(geprueft.data.activeVersionId);
    }
  });
});
