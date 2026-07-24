/**
 * Tenant-Isolation durch den REALEN Transaction-Pooler (EYT-15).
 *
 * Verbindet gegen den lokalen Supavisor im TRANSACTION MODE (Port 54329,
 * supabase/config.toml [db.pooler]) statt gegen die Direct Connection
 * (54322). Damit wird der bisher nur simulierte Pooling-Kontrakt real
 * bewiesen:
 *
 *   1. Der transaktionslokale Tenantkontext (set_config is_local +
 *      `set local role authenticated`) funktioniert DURCH den Pooler.
 *   2. Parallelitaet: 8 gleichzeitige Client-Verbindungen (4x User A,
 *      2x User C inaktiv, 2x ohne Claims) teilen sich die gepoolten
 *      Server-Connections — jeder Client sieht ausschliesslich seine
 *      eigenen Tenantdaten, nie die eines parallelen Clients.
 *   3. Leak-Probe: nach allen Parallel-Transaktionen liefert eine frische
 *      Transaktion ohne Claims auth.uid() IS NULL und 0 Items — eine vom
 *      Pooler wiederverwendete Server-Connection erbt keinen Kontext.
 *
 * Fail-closed-Semantik identisch zur Direct-Suite (EYT-66), aber mit
 * EIGENEM Report-Prefix [tenant-pooling]: Modus aus EASYTREE_TENANT_TESTS
 * ("required" laesst unerreichbaren Pooler und jeden Skip fehlschlagen;
 * "local" = Default skippt mit Warnung, NUR fuer Entwicklermaschinen ohne
 * laufenden Supabase-Stack). CI (Job db-gates) setzt "required" und greppt
 * die Report-Zeile.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inTenantTx, ORG_ALPHA, probeDatabase, USER_A, USER_C } from "./tenant-context.helper";

/**
 * Supavisor identifiziert den Tenant ueber das Username-Suffix:
 * `postgres.<project_id>` (project_id aus supabase/config.toml = "easytree").
 * Plain `postgres` wird vom Pooler mit "Tenant or user not found" abgelehnt —
 * belegt durch den roten CI-Lauf #1 auf PR #5 (fail-closed wie designed).
 * CI ermittelt die URL zur Laufzeit aus `supabase status` (Workflow-Step
 * "Resolve pooler URL"); dieser Default gilt fuer lokale Entwicklung.
 */
const POOLER_URL =
  process.env["EASYTREE_TEST_POOLER_URL"] ??
  "postgresql://postgres.easytree:postgres@127.0.0.1:54329/postgres";

/** Fail-closed-Modus (EYT-66-Semantik): "required" (CI) | "local" (Default). */
const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
let executedCount = 0;
let skippedCount = 0;

let poolerAvailable = false;
let client: Client;

/**
 * Runtime-Skip wie in der Direct-Suite: Erreichbarkeit wird in beforeAll
 * geprueft; nicht erreichbar => Skip NUR im Local-Modus, im Required-Modus
 * macht afterAll jeden Skip zum Fehler (fail-closed).
 */
function poolerIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!poolerAvailable) {
      skippedCount++;
      ctx.skip(
        `SKIPPED: Transaction-Pooler unter ${POOLER_URL} nicht erreichbar — ` +
          "lokal starten mit `pnpm exec supabase start && pnpm exec supabase db reset`.",
      );
    }
    executedCount++;
    await fn();
  });
}

describe("tenant isolation through real transaction pooler (Supavisor)", () => {
  beforeAll(async () => {
    poolerAvailable = await probeDatabase(POOLER_URL);
    if (!poolerAvailable) {
      if (TENANT_TESTS_MODE === "required") {
        throw new Error(
          "[tenant-pooling] fail-closed: Pflicht-Pooler-Tests koennen nicht laufen — Pooler unter " +
            POOLER_URL +
            " nicht erreichbar (EYT-15).",
        );
      }
      console.warn(
        `[tenant-pooling.integration] SKIPPED: Transaction-Pooler unter ${POOLER_URL} nicht erreichbar. ` +
          "Lokal starten mit `pnpm exec supabase start && pnpm exec supabase db reset`. " +
          "Fuer das EYT-15-Pooling-Gate ist ein realer Lauf PFLICHT.",
      );
      return;
    }
    client = new Client({ connectionString: POOLER_URL });
    await client.connect();
  });

  afterAll(async () => {
    if (poolerAvailable) {
      await client.end();
    }
  });

  afterAll(() => {
    // Report fuer CI-Step-Summary (gleiches Muster wie [tenant-isolation],
    // eigenes Prefix — CI greppt beide Zeilen getrennt, Task 5/EYT-15).
    process.stdout.write(
      `[tenant-pooling] mode=${TENANT_TESTS_MODE} executed=${executedCount} skipped=${skippedCount}\n`,
    );
    if (TENANT_TESTS_MODE === "required" && skippedCount > 0) {
      throw new Error(
        `[tenant-pooling] fail-closed: ${skippedCount} Pflicht-Pooler-Tests uebersprungen (EYT-15).`,
      );
    }
  });

  poolerIt(
    "tenant context works through the pooler: user A sees only Org-Alpha items",
    async () => {
      await inTenantTx(client, USER_A, async (tx) => {
        const who = await tx.query("select current_user");
        expect(who.rows[0]).toEqual({ current_user: "authenticated" });

        const all = await tx.query("select distinct org_id from public.items");
        expect(all.rows).toEqual([{ org_id: ORG_ALPHA }]);
      });
    },
  );

  poolerIt(
    "8 parallel pooled clients: A sees only Org-Alpha, C/no-claims see nothing",
    async () => {
      // 4x User A (aktiv in Alpha), 2x User C (inaktiv), 2x ohne Claims —
      // alle GLEICHZEITIG durch den Pooler (Promise.all), sodass sich die
      // Transaktionen die gepoolten Server-Connections real teilen.
      const userIds: (string | null)[] = [
        USER_A,
        USER_A,
        USER_A,
        USER_A,
        USER_C,
        USER_C,
        null,
        null,
      ];
      const clients = userIds.map(() => new Client({ connectionString: POOLER_URL }));
      await Promise.all(clients.map((c) => c.connect()));
      try {
        await Promise.all(
          userIds.map((userId, i) =>
            inTenantTx(clients[i]!, userId, async (tx) => {
              const items = await tx.query("select org_id from public.items");
              if (userId === USER_A) {
                // A-Clients: ausschliesslich Org-Alpha-Zeilen, nie leer.
                expect(items.rowCount).toBeGreaterThan(0);
                for (const row of items.rows) {
                  expect(row).toEqual({ org_id: ORG_ALPHA });
                }
              } else {
                // C (inaktive Membership) und ohne Claims: 0 Zeilen.
                expect(items.rowCount).toBe(0);
              }
            }),
          ),
        );
      } finally {
        await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
      }
    },
  );

  poolerIt(
    "leak probe after parallel load: fresh claimless transaction has no identity, no rows",
    async () => {
      // Laeuft NACH dem Parallel-Test: die gepoolten Server-Connections
      // wurden gerade von A-/C-Transaktionen benutzt. Eine frische
      // Transaktion ohne Claims darf davon nichts erben.
      await inTenantTx(client, null, async (tx) => {
        const uid = await tx.query("select auth.uid() as uid");
        expect(uid.rows[0]).toEqual({ uid: null });

        const items = await tx.query("select id from public.items");
        expect(items.rowCount).toBe(0);
      });
    },
  );
});
