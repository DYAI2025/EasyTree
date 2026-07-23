/**
 * Tenant-Isolations-Integrationstest (EYT-15) — realer DB-Pfad.
 *
 * Verbindet gegen den lokalen Supabase-Postgres (Port 54322) und stellt den
 * authenticated-Kontext pro Transaktion her:
 *
 *   begin;
 *   select set_config('request.jwt.claims', '{"sub":"…"}', true);  -- is_local
 *   set local role authenticated;
 *   … Queries des Angriffsszenarios …
 *   rollback;
 *
 * Genau so erzwingt es ein Pooler im TRANSACTION MODE (Supavisor, Produktions-
 * entscheid, siehe docs/architecture/tenant-isolation-report.md): keine
 * session-level Settings — der gesamte Tenantkontext muss transaktionslokal
 * gesetzt werden. Der Test beweist zusaetzlich, dass der Kontext NICHT in die
 * naechste Transaktion leakt.
 *
 * Kein Service-Role-Einsatz: Alle Assertions laufen unter `set local role
 * authenticated` (rolbypassrls = false, wird mitgeprueft). Die postgres-
 * Login-Rolle dient ausschliesslich als lokaler Transportkanal (authenticated
 * ist NOLOGIN); nach dem Rollenwechsel gelten die Rechte von authenticated.
 *
 * CI-Schutz: Ist die DB nicht erreichbar, ueberspringt sich die Suite mit
 * klarem Hinweis. Fuer den EYT-15-Nachweis MUSS sie real gelaufen sein
 * (Testnamen + Dauer im Report).
 */
import { Client, DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const ORG_ALPHA = "00000000-0000-0000-0000-0000000000a1";
const ORG_BETA = "00000000-0000-0000-0000-0000000000b2";
const USER_A = "00000000-0000-0000-0000-00000000aaa1"; // aktiv in Org Alpha
const USER_C = "00000000-0000-0000-0000-00000000ccc3"; // INAKTIV in Org Alpha
const BETA_ITEM_ID = "00000000-0000-0000-0000-0000000220b2";
const BETA_NOTE_ID = "00000000-0000-0000-0000-0000000320b2";

async function probeDatabase(): Promise<boolean> {
  const client = new Client({
    connectionString: DB_URL,
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

let dbAvailable = false;
let client: Client;

/**
 * Runtime-Skip statt describe.skipIf: Die Erreichbarkeit wird in beforeAll
 * geprueft (kein top-level await unter CommonJS). Nicht erreichbar => jeder
 * Test wird mit klarem Hinweis uebersprungen (CI-Schutz); fuer das
 * EYT-15-Sicherheitsgate MUSS die Suite real gelaufen sein.
 */
function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!dbAvailable) {
      ctx.skip(
        `SKIPPED: Supabase-Postgres unter ${DB_URL} nicht erreichbar — ` +
          "lokal starten mit `pnpm exec supabase start && pnpm exec supabase db reset`.",
      );
    }
    await fn();
  });
}

describe("tenant isolation via RLS (transaction-mode context)", () => {
  beforeAll(async () => {
    dbAvailable = await probeDatabase();
    if (!dbAvailable) {
      // eslint-disable-next-line no-console
      console.warn(
        `[tenant-isolation.integration] SKIPPED: Supabase-Postgres unter ${DB_URL} nicht erreichbar. ` +
          "Lokal starten mit `pnpm exec supabase start && pnpm exec supabase db reset`. " +
          "Fuer das EYT-15-Sicherheitsgate ist ein realer Lauf PFLICHT.",
      );
      return;
    }
    client = new Client({ connectionString: DB_URL });
    await client.connect();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await client.end();
    }
  });

  /**
   * Fuehrt `fn` in einer Transaktion mit transaktionslokalem Tenantkontext
   * aus — exakt das Muster, das Transaction-Mode-Pooling erzwingt.
   * userId === null: authenticated ohne JWT-Claims (kaputter/fehlender Kontext).
   */
  async function inTenantTx<T>(userId: string | null, fn: (tx: Client) => Promise<T>): Promise<T> {
    await client.query("begin");
    try {
      if (userId !== null) {
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: userId, role: "authenticated" }),
        ]);
      }
      await client.query("set local role authenticated");
      return await fn(client);
    } finally {
      await client.query("rollback");
    }
  }

  dbIt("runs as authenticated without BYPASSRLS (no service role involved)", async () => {
    await inTenantTx(USER_A, async (tx) => {
      const who = await tx.query("select current_user");
      expect(who.rows[0]).toEqual({ current_user: "authenticated" });
      const bypass = await tx.query(
        "select rolbypassrls from pg_roles where rolname = current_user",
      );
      expect(bypass.rows[0]).toEqual({ rolbypassrls: false });
    });
  });

  dbIt("cross-tenant read: user A sees only Org-Alpha rows, Org-Beta reads are empty", async () => {
    await inTenantTx(USER_A, async (tx) => {
      const all = await tx.query("select distinct org_id from public.items");
      expect(all.rows).toEqual([{ org_id: ORG_ALPHA }]);

      const beta = await tx.query("select id from public.items where org_id = $1", [ORG_BETA]);
      expect(beta.rowCount).toBe(0);

      const notes = await tx.query("select id from public.item_notes where org_id = $1", [
        ORG_BETA,
      ]);
      expect(notes.rowCount).toBe(0);
    });
  });

  dbIt("IDOR: direct lookup of a foreign UUID leaks nothing", async () => {
    await inTenantTx(USER_A, async (tx) => {
      const item = await tx.query("select * from public.items where id = $1", [BETA_ITEM_ID]);
      expect(item.rowCount).toBe(0);

      const note = await tx.query("select * from public.item_notes where id = $1", [BETA_NOTE_ID]);
      expect(note.rowCount).toBe(0);
    });
  });

  dbIt("cross-tenant write: insert with foreign org_id fails with 42501", async () => {
    await inTenantTx(USER_A, async (tx) => {
      let caught: unknown;
      try {
        await tx.query("insert into public.items (org_id, title) values ($1, $2)", [
          ORG_BETA,
          "smuggled via api path",
        ]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DatabaseError);
      expect((caught as DatabaseError).code).toBe("42501");
    });
  });

  dbIt("cross-tenant write: update/delete on foreign rows affect 0 rows", async () => {
    await inTenantTx(USER_A, async (tx) => {
      const upd = await tx.query("update public.items set title = 'pwned' where org_id = $1", [
        ORG_BETA,
      ]);
      expect(upd.rowCount).toBe(0);

      const del = await tx.query("delete from public.items where org_id = $1", [ORG_BETA]);
      expect(del.rowCount).toBe(0);
    });
  });

  dbIt("inactive membership: user C sees no Org-Alpha data at all", async () => {
    await inTenantTx(USER_C, async (tx) => {
      const items = await tx.query("select id from public.items");
      expect(items.rowCount).toBe(0);
      const notes = await tx.query("select id from public.item_notes");
      expect(notes.rowCount).toBe(0);
    });
  });

  dbIt(
    "transaction-mode guarantee: tenant context does not leak into the next transaction",
    async () => {
      // 1. Transaktion mit Kontext von User A (sieht Alpha-Daten)
      await inTenantTx(USER_A, async (tx) => {
        const items = await tx.query("select id from public.items");
        expect(items.rowCount).toBeGreaterThan(0);
      });
      // 2. Folgetransaktion OHNE Claims (wie eine fremde, wiederverwendete
      //    Pooler-Connection): auth.uid() ist null => alles leer.
      await inTenantTx(null, async (tx) => {
        const uid = await tx.query("select auth.uid() as uid");
        expect(uid.rows[0]).toEqual({ uid: null });
        const items = await tx.query("select id from public.items");
        expect(items.rowCount).toBe(0);
      });
    },
  );
});
