/**
 * AK4 — API und RLS lehnen UNABHAENGIG voneinander ab (EYT-106).
 *
 * ## Was diese Datei beweist, und was die Policy-Unit-Tests nicht koennen
 *
 * `cost-access.policy.test.ts` prueft die anwendungsseitige Haelfte. Sie
 * bliebe vollstaendig gruen, wenn die Datenbank jedem alles zeigte — sie sieht
 * PostgreSQL ja nie. Diese Suite prueft die ANDERE Haelfte gegen eine echte
 * Datenbank: selbst OHNE jede Anwendungsschicht darf ein `member` keine
 * Satzversion sehen und kein `manager` eine anlegen.
 *
 * Das ist die eigentliche Unabhaengigkeitszusage: schaltet man die
 * `CostAccessPolicy` auf "immer true", muessen diese Faelle WEITERHIN rot
 * werden — sie kennen die Policy nicht.
 *
 * ## Fail-closed
 *
 * Modus aus `EASYTREE_TENANT_TESTS`. In CI (`required`) ist eine unerreichbare
 * Datenbank ein Fehler, kein Skip; lokal wird mit Hinweis uebersprungen. Jeder
 * Lauf schreibt eine greppbare Zeile, die CI auswertet.
 */
import { Client, DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FailClosedGate,
  inTenantTx,
  ORG_ALPHA,
  probeDatabase,
  USER_A,
} from "../tenant-context.helper";

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
const gate = new FailClosedGate("cost-access", TENANT_TESTS_MODE, "EYT-106");

/** Seed-Fixtures (supabase/seed.sql). */
const EMPLOYEE_ALPHA = "00000000-0000-4000-8000-0000004010a1";
/** Frei gewaehlte, kollisionsfreie IDs dieser Suite. */
const VERSION_1 = "00000000-0000-4000-8000-0000006ca001";
const VERSION_2 = "00000000-0000-4000-8000-0000006ca002";

let dbAvailable = false;
let client: Client;

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!dbAvailable) {
      gate.markSkipped();
      ctx.skip(
        `SKIPPED: Supabase-Postgres unter ${DB_URL} nicht erreichbar — ` +
          "lokal starten mit `pnpm exec supabase start && pnpm exec supabase db reset`.",
      );
    }
    await gate.run(fn);
  });
}

/** Setzt die Rolle des Seed-Users in Org Alpha — ausserhalb jeder RLS. */
async function setRole(rolle: "owner" | "manager" | "member"): Promise<void> {
  await client.query("update public.memberships set role = $1 where org_id = $2 and user_id = $3", [
    rolle,
    ORG_ALPHA,
    USER_A,
  ]);
}

async function fehlercode(arbeit: () => Promise<unknown>): Promise<string | null> {
  try {
    await arbeit();
    return null;
  } catch (fehler) {
    return fehler instanceof DatabaseError ? (fehler.code ?? null) : null;
  }
}

describe("Kostenrechte in PostgreSQL — unabhaengig von der Anwendungsschicht (EYT-106 AK4)", () => {
  beforeAll(async () => {
    dbAvailable = await probeDatabase(DB_URL);
    if (!dbAvailable) {
      if (TENANT_TESTS_MODE === "required") {
        throw new Error(
          `[cost-access] fail-closed: Pflichttests koennen nicht laufen — DB unter ${DB_URL} nicht erreichbar (EYT-106).`,
        );
      }
      console.warn(
        `[cost-access.integration] SKIPPED: Supabase-Postgres unter ${DB_URL} nicht erreichbar.`,
      );
      return;
    }
    client = new Client({ connectionString: DB_URL });
    await client.connect();
  });

  afterAll(async () => {
    if (dbAvailable) {
      // Aufraeumen als Superuser: die Zeilen sind fuer `authenticated`
      // unloeschbar (Grants), und genau das ist gewollt.
      await client.query("delete from public.employee_rate_versions where id = any($1::uuid[])", [
        [VERSION_1, VERSION_2],
      ]);
      await setRole("owner");
      await client.end();
    }
  });

  afterAll(() => {
    process.stdout.write(gate.reportLine());
    gate.assertOrThrow();
  });

  dbIt("owner darf eine Satzversion anlegen und sie danach lesen", async () => {
    await setRole("owner");
    await inTenantTx(client, USER_A, async (tx) => {
      await tx.query(
        `insert into public.employee_rate_versions
           (id, org_id, employee_id, amount_minor_units, currency,
            valid_from, valid_to, reason, created_by, correlation_id)
         values ($1, $2, $3, 3850, 'EUR', date '2026-01-01', date '2026-06-01',
                 'Integrationstest', $4, 'test-korrelation')`,
        [VERSION_1, ORG_ALPHA, EMPLOYEE_ALPHA, USER_A],
      );
      const gelesen = await tx.query("select id from public.employee_rate_versions where id = $1", [
        VERSION_1,
      ]);
      expect(gelesen.rowCount).toBe(1);
    });
  });

  dbIt("member sieht KEINE Satzversion — ohne dass die Anwendung beteiligt waere", async () => {
    // Der Kern von AK4. Kein Controller, keine Policy, nur PostgreSQL.
    // Gegenmutation: `app.has_cost_permission(org_id,'costs.read')` aus der
    // select-Policy von Migration 0013 entfernen -> dieser Fall wird gruen
    // und damit wertlos, also rot fuer die Zusicherung.
    await setRole("member");
    await inTenantTx(client, USER_A, async (tx) => {
      const gelesen = await tx.query("select id from public.employee_rate_versions");
      expect(gelesen.rowCount).toBe(0);
    });
  });

  dbIt("manager sieht Satzversionen, darf aber KEINE anlegen", async () => {
    // Die atomare Trennung: costs.read ja, costs.manage_rates nein.
    await setRole("manager");
    await inTenantTx(client, USER_A, async (tx) => {
      const gelesen = await tx.query("select id from public.employee_rate_versions");
      expect(gelesen.rowCount).toBe(1);
    });

    const code = await fehlercode(() =>
      inTenantTx(client, USER_A, async (tx) => {
        await tx.query(
          `insert into public.employee_rate_versions
             (id, org_id, employee_id, amount_minor_units, currency,
              valid_from, reason, created_by, correlation_id)
           values ($1, $2, $3, 9999, 'EUR', date '2027-01-01',
                   'manager darf das nicht', $4, 'test-korrelation')`,
          [VERSION_2, ORG_ALPHA, EMPLOYEE_ALPHA, USER_A],
        );
      }),
    );
    // 42501 = insufficient_privilege: die with-check-Policy greift.
    expect(code).toBe("42501");
  });

  dbIt("die abgelehnte Anlage blieb wirkungslos", async () => {
    // Ohne diesen Nachweis koennte die Ablehnung oben auch NACH einem
    // erfolgreichen Insert kommen.
    const alle = await client.query("select id from public.employee_rate_versions where id = $1", [
      VERSION_2,
    ]);
    expect(alle.rowCount).toBe(0);
  });

  dbIt("niemand darf role_permissions beschreiben, auch owner nicht", async () => {
    await setRole("owner");
    const code = await fehlercode(() =>
      inTenantTx(client, USER_A, async (tx) => {
        await tx.query(
          "insert into public.role_permissions (role, permission) values ('member','costs.read')",
        );
      }),
    );
    expect(code).toBe("42501");
  });

  dbIt("eine Satzversion ist unveraenderlich und unloeschbar", async () => {
    await setRole("owner");
    const updateCode = await fehlercode(() =>
      inTenantTx(client, USER_A, async (tx) => {
        await tx.query(
          "update public.employee_rate_versions set amount_minor_units = 1 where id = $1",
          [VERSION_1],
        );
      }),
    );
    expect(updateCode).toBe("42501");

    const deleteCode = await fehlercode(() =>
      inTenantTx(client, USER_A, async (tx) => {
        await tx.query("delete from public.employee_rate_versions where id = $1", [VERSION_1]);
      }),
    );
    expect(deleteCode).toBe("42501");
  });
});
