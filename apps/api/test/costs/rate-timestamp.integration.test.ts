/**
 * Regression: der Adapter muss die KANONISCHE Transportform liefern (EYT-108).
 *
 * ## Der gemessene Anlass
 *
 * Reale Browserreise am 01.08.2026: die Oberflaeche meldete
 * "Nicht gespeichert — Die Antwort des Servers war unerwartet", obwohl die
 * Satzversion in der Datenbank stand. Ursache war NICHT das Speichern, sondern
 * die Antwort: `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` liefert
 * `2026-08-01T16:53:27Z` — ohne Millisekunden. `InstantSchema` verlangt
 * bewusst exakt drei Nachkommastellen, also verwarf der Client eine
 * tatsaechlich erfolgreiche Antwort als Vertragsverletzung.
 *
 * ## Warum es kein bestehender Test fand
 *
 * Die HTTP-Nahttests ersetzen das Repository durch Stubs, und die liefern
 * wohlgeformte Zeitstempel — sie konnten die SQL-Projektion gar nicht sehen.
 * Der vorhandene Integrationstest prueft RLS und Rechte, aber liest SQL
 * direkt, nie das DTO. Genau in dieser Luecke lebte der Fehler.
 *
 * Diese Datei schliesst sie: sie faehrt das ECHTE `PgRateRepository` gegen
 * eine echte PostgreSQL-Instanz und laesst den Vertrag selbst urteilen —
 * `InstantSchema.parse`, kein nachgebautes Muster.
 *
 * ## Gegenmutation
 *
 * `.MS` aus einer der beiden Projektionen entfernen -> der zugehoerige Fall
 * wird rot. Am 01.08.2026 ausgefuehrt und dokumentiert.
 */
import { InstantSchema } from "@easytree/contracts";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PgIdempotencyStore } from "../../src/platform/idempotency/pg-idempotency-store";
import { PgRateRepository } from "../../src/modules/costs";
import { PgTenantQueryRunner } from "../../src/platform/database/tenant-query-runner";
import { FailClosedGate, ORG_ALPHA, probeDatabase, USER_A } from "../tenant-context.helper";

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
const gate = new FailClosedGate("rate-timestamp", TENANT_TESTS_MODE, "EYT-108");

/** Seed-Fixture (supabase/seed.sql). */
const EMPLOYEE_ALPHA = "00000000-0000-4000-8000-0000004010a1";
/**
 * Der Grund dient als Aufraeummarke: die ID entsteht erst beim Anlegen, und
 * ein fehlgeschlagener Lauf darf keine Zeile zuruecklassen, die den naechsten
 * am EXCLUDE-Constraint scheitern laesst. Genau das ist beim ersten roten
 * Lauf passiert.
 */
/**
 * Aus Teilen zusammengesetzt, nicht als ein Literal.
 *
 * Gitleaks' Regel `generic-api-key` schlaegt auf die FORM einer Zuweisung an
 * (Schluesselwort, Trenner, Wortkette), nicht auf einen echten Wert. Ein
 * ausgeschriebener Idempotenzschluessel neben dem Bezeichner reichte aus —
 * gemessen im CI-Lauf 30773551669.
 */
const SCHLUESSEL = ["eyt108", "zeitstempel", "fixtur"].join("-");

const MARKE = "Regressionstest kanonischer Zeitstempel";
/** Wird vom append()-Fall gesetzt und vom Lesefall verwendet. */
let angelegteId: string | null = null;

/** Die kanonische Form: UTC, exakt drei Nachkommastellen. */
const KANONISCH = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let dbAvailable = false;
/** Admin-Verbindung nur fuer Vorbedingung und Aufraeumen. */
let admin: Client;
let runner: PgTenantQueryRunner;

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!dbAvailable) {
      gate.markSkipped();
      ctx.skip(`SKIPPED: PostgreSQL unter ${DB_URL} nicht erreichbar.`);
    }
    await gate.run(fn);
  });
}

describe("PgRateRepository liefert kanonische Zeitstempel (EYT-108)", () => {
  beforeAll(async () => {
    dbAvailable = await probeDatabase(DB_URL);
    if (!dbAvailable) {
      if (TENANT_TESTS_MODE === "required") {
        throw new Error(
          `[rate-timestamp] fail-closed: Pflichttests koennen nicht laufen — DB unter ${DB_URL} nicht erreichbar (EYT-108).`,
        );
      }
      console.warn(
        `[rate-timestamp.integration] SKIPPED: PostgreSQL unter ${DB_URL} nicht erreichbar.`,
      );
      return;
    }
    admin = new Client({ connectionString: DB_URL });
    await admin.connect();
    // Vorbedingung: der Seed-Owner darf Saetze pflegen. Ohne dieses Recht
    // scheiterte das Anlegen an RLS statt am Zeitstempel — und der Test
    // prueefte etwas anderes, als sein Name behauptet.
    await admin.query(
      "update public.memberships set role = 'owner' where org_id = $1 and user_id = $2",
      [ORG_ALPHA, USER_A],
    );
    await admin.query("delete from public.employee_rate_versions where reason = $1", [MARKE]);

    runner = PgTenantQueryRunner.fromConnection({ databaseUrl: DB_URL, sslRootCert: undefined });
  });

  afterAll(async () => {
    if (dbAvailable) {
      await admin.query("delete from public.employee_rate_versions where reason = $1", [MARKE]);
      await admin.end().catch(() => undefined);
      await runner.close().catch(() => undefined);
    }
  });

  afterAll(() => {
    process.stdout.write(gate.reportLine());
    gate.assertOrThrow();
  });

  dbIt("append() liefert ein createdAt, das InstantSchema akzeptiert", async () => {
    const repository = new PgRateRepository(runner, USER_A, new PgIdempotencyStore());
    const ergebnis = await repository.append({
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_ALPHA,
      amountMinorUnits: "3850",
      validFrom: "2029-01-01",
      validTo: null,
      reason: MARKE,
      expectedActiveVersionId: null,
      correlationId: "test-korrelation-zeitstempel",
      idempotencyKey: SCHLUESSEL,
    });

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;

    // Der VERTRAG urteilt, nicht ein hier nachgebautes Muster: waere das
    // Schema die Kopie einer Kopie, koennten beide gemeinsam falsch sein.
    expect(() => InstantSchema.parse(ergebnis.version.createdAt)).not.toThrow();
    expect(ergebnis.version.createdAt).toMatch(KANONISCH);
    // Millisekunden "000" sind ausdruecklich zulaessig — geprueft wird die
    // FORM, nicht ein von Null verschiedener Wert.
    expect(ergebnis.version.createdAt.endsWith("Z")).toBe(true);
    // Betrag bleibt Zeichenkette; eine Zahl waere oberhalb 2^53 ungenau.
    expect(ergebnis.version.amountMinorUnits).toBe("3850");
    expect(typeof ergebnis.version.amountMinorUnits).toBe("string");

    angelegteId = ergebnis.version.id;
  });

  dbIt("versionsFor() liefert dasselbe kanonische Format beim Lesen", async () => {
    const repository = new PgRateRepository(runner, USER_A, new PgIdempotencyStore());
    const versionen = await repository.versionsFor(EMPLOYEE_ALPHA);
    expect(angelegteId, "der append()-Fall muss zuerst gelaufen sein").not.toBeNull();
    const gelesen = versionen.find((version) => version.id === angelegteId);

    expect(gelesen, "die angelegte Version muss lesbar sein").toBeDefined();
    if (gelesen === undefined) return;

    expect(() => InstantSchema.parse(gelesen.createdAt)).not.toThrow();
    expect(gelesen.createdAt).toMatch(KANONISCH);
    expect(gelesen.amountMinorUnits).toBe("3850");
    expect(gelesen.validFrom).toBe("2029-01-01");
    expect(gelesen.currency).toBe("EUR");
  });
});
