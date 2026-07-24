/**
 * Geteilte Bausteine der Tenant-Isolations-Suiten (EYT-15/EYT-66):
 *
 * - Seed-Konstanten (muessen mit supabase/seed.sql uebereinstimmen),
 * - probeDatabase: Erreichbarkeits-Probe fuer die Fail-closed-Entscheidung,
 * - inTenantTx: das Transaction-Mode-Kontextmuster (set_config is_local +
 *   set local role authenticated), das ein Pooler im TRANSACTION MODE
 *   erzwingt.
 *
 * Verwendet von test/tenant-isolation.integration.test.ts (Direct Connection)
 * und test/tenant-pooling.integration.test.ts (realer Transaction-Pooler).
 * Kein *.test.ts-Suffix — die Datei ist bewusst KEINE eigene Suite.
 */
import { Client } from "pg";

export const ORG_ALPHA = "00000000-0000-0000-0000-0000000000a1";
export const ORG_BETA = "00000000-0000-0000-0000-0000000000b2";
export const USER_A = "00000000-0000-0000-0000-00000000aaa1"; // aktiv in Org Alpha
export const USER_C = "00000000-0000-0000-0000-00000000ccc3"; // INAKTIV in Org Alpha
export const BETA_ITEM_ID = "00000000-0000-0000-0000-0000000220b2";
export const BETA_NOTE_ID = "00000000-0000-0000-0000-0000000320b2";

/** Erreichbarkeits-Probe (select 1) — false statt throw bei jedem Fehler. */
export async function probeDatabase(url: string): Promise<boolean> {
  const client = new Client({
    connectionString: url,
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

/**
 * Fuehrt `fn` in einer Transaktion mit transaktionslokalem Tenantkontext
 * aus — exakt das Muster, das Transaction-Mode-Pooling erzwingt.
 * userId === null: authenticated ohne JWT-Claims (kaputter/fehlender Kontext).
 */
export async function inTenantTx<T>(
  client: Client,
  userId: string | null,
  fn: (tx: Client) => Promise<T>,
): Promise<T> {
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
