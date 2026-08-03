/**
 * Abloesung und Wiederholung gegen ECHTES PostgreSQL (EYT-108 Option A+).
 *
 * ## Was hier bewiesen wird, und warum es ohne Datenbank nicht geht
 *
 * `rate-succession.test.ts` prueft die reine Regel. Sie bliebe vollstaendig
 * gruen, wenn die Datenbank jede Ueberlappung durchliesse, jeden Retry doppelt
 * schriebe und zwei gleichzeitige Bearbeiter beide gewinnen liesse — sie sieht
 * PostgreSQL ja nie.
 *
 * Drei Aussagen sind nur mit zwei ECHTEN Verbindungen pruefbar:
 *
 *   1. `for update` serialisiert den kritischen Abschnitt. Eine Verbindung
 *      kann das nicht zeigen: sie sieht ihre eigene Sperre nie als Wartezeit.
 *   2. Ein Retry mit demselben Schluessel liefert dasselbe Ergebnis, statt
 *      eine zweite Version anzulegen.
 *   3. Derselbe Schluessel in zwei Organisationen kollidiert nicht — und
 *      Organisation A sieht das Ergebnis von B nicht.
 *
 * ## Warum diese Suite committet
 *
 * Anders als `cost-access.integration.test.ts` laeuft sie NICHT in einer
 * zurueckgerollten Transaktion: Nebenlaeufigkeit zwischen zwei Verbindungen
 * setzt voraus, dass die erste wirklich committet. Aufgeraeumt wird deshalb
 * ueber die Marke im Feld `reason` — dieselbe Technik wie in
 * `rate-timestamp.integration.test.ts`, die dort aus demselben Grund gewaehlt
 * wurde.
 *
 * ## Fail-closed
 *
 * Modus aus `EASYTREE_TENANT_TESTS`. In CI (`required`) ist eine unerreichbare
 * Datenbank ein Fehler, kein Skip. Jeder Lauf schreibt eine greppbare Zeile,
 * die `scripts/assert-tenant-report.sh` auswertet.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PgRateRepository } from "../../src/modules/costs";
import type { RateWriteResult } from "../../src/modules/costs";
import { PgTenantQueryRunner } from "../../src/platform/database/tenant-query-runner";
import { PgIdempotencyStore } from "../../src/platform/idempotency/pg-idempotency-store";
import {
  FailClosedGate,
  ORG_ALPHA,
  ORG_BETA,
  probeDatabase,
  USER_A,
} from "../tenant-context.helper";

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
const gate = new FailClosedGate("rate-succession", TENANT_TESTS_MODE, "EYT-108");

/** Seed-Fixtures (supabase/seed.sql). */
const EMPLOYEE_ALPHA = "00000000-0000-4000-8000-0000004010a1";
const EMPLOYEE_ALPHA_2 = "00000000-0000-4000-8000-0000004011a1";
const USER_B = "00000000-0000-4000-8000-00000000bbb2";
const EMPLOYEE_BETA = "00000000-0000-4000-8000-0000004020b2";

/**
 * Aufraeummarke.
 *
 * Alles, was diese Suite committet, traegt sie im Feld `reason`. Ein
 * abgebrochener Lauf hinterlaesst sonst eine offene Version, und der naechste
 * Lauf scheitert am EXCLUDE statt an dem, was er messen will.
 */
const MARKE = "EYT-108-abloesung-integration";

let dbAvailable = false;
let admin: Client;
let runnerA: PgTenantQueryRunner;
let runnerB: PgTenantQueryRunner;

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!dbAvailable) {
      gate.markSkipped();
      ctx.skip(`SKIPPED: PostgreSQL unter ${DB_URL} nicht erreichbar.`);
      return;
    }
    await gate.run(fn);
  });
}

async function aufraeumen(): Promise<void> {
  await admin.query("delete from public.employee_rate_versions where reason like $1", [
    `${MARKE}%`,
  ]);
  await admin.query("delete from public.idempotency_records where idempotency_key like $1", [
    `${MARKE}%`,
  ]);
}

/** Legt einen OFFENEN Vorgaenger an und committet ihn. */
async function offenerVorgaenger(
  organisationId: string,
  employeeId: string,
  createdBy: string,
  validFrom: string,
): Promise<string> {
  const ergebnis = await admin.query<{ id: string }>(
    `insert into public.employee_rate_versions
       (org_id, employee_id, amount_minor_units, currency, valid_from, valid_to,
        reason, created_by, correlation_id)
     values ($1::uuid, $2::uuid, 3850, 'EUR', $3::date, null, $4, $5::uuid, 'korr-fixtur')
     returning id`,
    [organisationId, employeeId, validFrom, `${MARKE}-vorgaenger`, createdBy],
  );
  return ergebnis.rows[0]?.id ?? "";
}

function repositoryFuer(runner: PgTenantQueryRunner, userId: string): PgRateRepository {
  return new PgRateRepository(runner, userId, new PgIdempotencyStore());
}

beforeAll(async () => {
  dbAvailable = await probeDatabase(DB_URL);
  if (!dbAvailable) {
    if (TENANT_TESTS_MODE === "required") {
      throw new Error(
        `[rate-succession] fail-closed: Pflichttests koennen nicht laufen — DB unter ${DB_URL} nicht erreichbar (EYT-108).`,
      );
    }
    console.warn(
      `[rate-succession.integration] SKIPPED: PostgreSQL unter ${DB_URL} nicht erreichbar.`,
    );
    return;
  }
  admin = new Client({ connectionString: DB_URL });
  await admin.connect();
  // Vorbedingung, nicht Annahme: beide Seed-Owner muessen Saetze pflegen
  // duerfen. Fehlte das Recht, scheiterten die Faelle an RLS statt an dem,
  // was sie messen — und waeren rot aus dem falschen Grund.
  await admin.query("update public.memberships set role = 'owner' where user_id in ($1, $2)", [
    USER_A,
    USER_B,
  ]);
  await aufraeumen();

  runnerA = PgTenantQueryRunner.fromConnection({ databaseUrl: DB_URL, sslRootCert: undefined });
  runnerB = PgTenantQueryRunner.fromConnection({ databaseUrl: DB_URL, sslRootCert: undefined });
});

afterAll(async () => {
  if (dbAvailable) {
    await aufraeumen();
    await admin.end().catch(() => undefined);
    await runnerA.close().catch(() => undefined);
    await runnerB.close().catch(() => undefined);
  }
});

afterAll(() => {
  process.stdout.write(gate.reportLine());
  gate.assertOrThrow();
});

describe("Abloesung unter echter Nebenlaeufigkeit (EYT-108)", () => {
  dbIt("zwei Verbindungen loesen denselben offenen Satz ab — genau eine gewinnt", async () => {
    const vorgaengerId = await offenerVorgaenger(ORG_ALPHA, EMPLOYEE_ALPHA, USER_A, "2030-01-01");

    // Beide Anfragen sehen denselben offenen Vorgaenger und wollen ihn
    // abloesen. VERSCHIEDENE Idempotenzschluessel — mit demselben Schluessel
    // wuerde die Idempotenzsperre serialisieren und der Zeilenlock waere gar
    // nicht das, was hier geprueft wird.
    const befehl = (schluessel: string) => ({
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_ALPHA,
      amountMinorUnits: "4200",
      validFrom: "2030-07-01",
      validTo: null,
      reason: `${MARKE}-nachfolger`,
      expectedActiveVersionId: vorgaengerId,
      correlationId: "korr-parallel",
      idempotencyKey: schluessel,
    });

    const [a, b] = await Promise.allSettled([
      repositoryFuer(runnerA, USER_A).append(befehl(`${MARKE}-parallel-a`)),
      repositoryFuer(runnerB, USER_A).append(befehl(`${MARKE}-parallel-b`)),
    ]);

    // Beide Aufrufe muessen ein ERGEBNIS liefern, keinen Ausnahmefehler. Ein
    // Wurf waere genau der Zustand, den `for update` verhindern soll: der
    // Verlierer haette den Vorgaenger als offen gelesen und danach null
    // Zeilen geschlossen.
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    const ergebnisse = [a, b]
      .filter((e): e is PromiseFulfilledResult<RateWriteResult> => e.status === "fulfilled")
      .map((e) => e.value);

    const gewinner = ergebnisse.filter((e) => e.ok);
    const verlierer = ergebnisse.filter((e) => !e.ok);
    expect(gewinner).toHaveLength(1);
    expect(verlierer).toHaveLength(1);
    // Stabiler fachlicher Grund, kein Constraint-Rauschen: der Verlierer sieht
    // nach der Sperre den bereits geschlossenen Vorgaenger.
    const grund = verlierer[0];
    if (grund !== undefined && !grund.ok) {
      expect(["VORGAENGER_BEREITS_GESCHLOSSEN", "STALE_ACTIVE_VERSION"]).toContain(grund.problem);
    }

    const zustand = await admin.query<{
      id: string;
      valid_to: string | null;
      predecessor_id: string | null;
    }>(
      `select id, to_char(valid_to,'YYYY-MM-DD') as valid_to, predecessor_id
         from public.employee_rate_versions
        where employee_id = $1 and reason like $2
        order by valid_from`,
      [EMPLOYEE_ALPHA, `${MARKE}%`],
    );

    // Genau zwei Zeilen: der geschlossene Vorgaenger und EIN Nachfolger.
    expect(zustand.rows).toHaveLength(2);
    expect(zustand.rows[0]?.valid_to).toBe("2030-07-01");
    expect(zustand.rows[1]?.valid_to).toBeNull();
    expect(zustand.rows[1]?.predecessor_id).toBe(vorgaengerId);
  });
});

describe("Wiederholung liefert dasselbe Ergebnis (EYT-108)", () => {
  dbIt("gleicher Schluessel und gleiche Nutzlast legen keine zweite Version an", async () => {
    const vorgaengerId = await offenerVorgaenger(ORG_ALPHA, EMPLOYEE_ALPHA_2, USER_A, "2031-01-01");
    const repository = repositoryFuer(runnerA, USER_A);
    const befehl = {
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_ALPHA_2,
      amountMinorUnits: "4400",
      validFrom: "2031-07-01",
      validTo: null,
      reason: `${MARKE}-retry`,
      expectedActiveVersionId: vorgaengerId,
      correlationId: "korr-erster-versuch",
      idempotencyKey: `${MARKE}-retry-key`,
    };

    const erst = await repository.append(befehl);
    expect(erst.ok).toBe(true);

    // Der Retry traegt eine ANDERE Korrelations-Id — so sieht ein echter
    // Wiederholungsversuch aus. Waere sie Teil des Fingerabdrucks, gaelte er
    // als andere Nutzlast und der Schutz waere wirkungslos.
    const wieder = await repository.append({ ...befehl, correlationId: "korr-zweiter-versuch" });
    expect(wieder.ok).toBe(true);
    if (erst.ok && wieder.ok) expect(wieder.version.id).toBe(erst.version.id);

    const anzahl = await admin.query<{ n: string }>(
      `select count(*)::text as n from public.employee_rate_versions
        where employee_id = $1 and reason = $2`,
      [EMPLOYEE_ALPHA_2, `${MARKE}-retry`],
    );
    expect(anzahl.rows[0]?.n).toBe("1");
  });

  dbIt("gleicher Schluessel mit anderer Nutzlast ist ein stabiler Konflikt", async () => {
    const repository = repositoryFuer(runnerA, USER_A);
    const basis = {
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_ALPHA_2,
      amountMinorUnits: "5000",
      validFrom: "2032-01-01",
      validTo: null,
      reason: `${MARKE}-konflikt`,
      expectedActiveVersionId: null,
      correlationId: "korr-a",
      idempotencyKey: `${MARKE}-konflikt-key`,
    };
    expect((await repository.append(basis)).ok).toBe(true);

    const anders = await repository.append({ ...basis, amountMinorUnits: "9999" });
    expect(anders.ok).toBe(false);
    if (!anders.ok) expect(anders.problem).toBe("IDEMPOTENCY_KEY_REUSED");

    // Wirkungslosigkeitsnachweis: der abweichende Versuch hat NICHTS
    // geschrieben. Ohne diese Zeile waere der Fall auch dann gruen, wenn er
    // zusaetzlich eine Zeile angelegt haette.
    const anzahl = await admin.query<{ n: string }>(
      `select count(*)::text as n from public.employee_rate_versions where reason = $1`,
      [`${MARKE}-konflikt`],
    );
    expect(anzahl.rows[0]?.n).toBe("1");
  });

  dbIt("derselbe Schluessel kollidiert nicht ueber Organisationen hinweg", async () => {
    const gemeinsamerSchluessel = `${MARKE}-mandant-key`;
    const alpha = await repositoryFuer(runnerA, USER_A).append({
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_ALPHA_2,
      amountMinorUnits: "6000",
      validFrom: "2033-01-01",
      validTo: null,
      reason: `${MARKE}-mandant-alpha`,
      expectedActiveVersionId: null,
      correlationId: "korr-alpha",
      idempotencyKey: gemeinsamerSchluessel,
    });
    const beta = await repositoryFuer(runnerB, USER_B).append({
      organisationId: ORG_BETA,
      employeeId: EMPLOYEE_BETA,
      amountMinorUnits: "6100",
      validFrom: "2033-01-01",
      validTo: null,
      reason: `${MARKE}-mandant-beta`,
      expectedActiveVersionId: null,
      correlationId: "korr-beta",
      idempotencyKey: gemeinsamerSchluessel,
    });

    // Beide muessen durchgehen: der unique-Index ist auf (org_id, operation,
    // key) und nicht auf den Schluessel allein. Ginge nur einer durch, waere
    // die Mandantentrennung des Schluesselraums verletzt.
    expect(alpha.ok).toBe(true);
    expect(beta.ok).toBe(true);
    if (alpha.ok && beta.ok) expect(alpha.version.id).not.toBe(beta.version.id);

    // Und Alpha darf Betas Auskunft nicht einmal SEHEN. Gegenprobe im selben
    // Aufruf: die eigene Zeile ist sichtbar, sonst pruefte die Zeile darunter
    // nur, dass ueberhaupt nichts sichtbar ist.
    const sicht = await runnerA.run({ userId: USER_A }, async (tx) => {
      const eigene = await tx.query(
        `select 1 from public.idempotency_records where idempotency_key = $1 and org_id = $2`,
        [gemeinsamerSchluessel, ORG_ALPHA],
      );
      const fremde = await tx.query(
        `select 1 from public.idempotency_records where idempotency_key = $1 and org_id = $2`,
        [gemeinsamerSchluessel, ORG_BETA],
      );
      return { eigene: eigene.rowCount, fremde: fremde.rowCount };
    });
    expect(sicht.eigene).toBe(1);
    expect(sicht.fremde).toBe(0);
  });
});
