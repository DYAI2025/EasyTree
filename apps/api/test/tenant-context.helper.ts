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

export const ORG_ALPHA = "00000000-0000-4000-8000-0000000000a1";
export const ORG_BETA = "00000000-0000-4000-8000-0000000000b2";
export const USER_A = "00000000-0000-4000-8000-00000000aaa1"; // aktiv in Org Alpha
export const USER_C = "00000000-0000-4000-8000-00000000ccc3"; // INAKTIV in Org Alpha
export const BETA_ITEM_ID = "00000000-0000-4000-8000-0000000220b2";
export const BETA_NOTE_ID = "00000000-0000-4000-8000-0000000320b2";

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
 * Zaehlwerk der fail-closed-Suiten (EYT-66/EYT-71).
 *
 * Bewusst OHNE vitest-Import: reine Logik, damit der Rot-Fall direkt getrieben
 * werden kann, statt ihn behaupten zu muessen (siehe
 * test/fail-closed-gate.red-case.test.ts). Die Suiten behalten `it`/`ctx.skip`.
 *
 * Warum getrennte Zaehler: `executed` stieg frueher VOR der Assertion, ein
 * fehlgeschlagener Test zaehlte also mit. `executed=7 skipped=0` las sich damit
 * wie sieben bestandene Sicherheitstests — die Zahl trug diese Aussage nie.
 */
export class FailClosedGate {
  private executed = 0;
  private passed = 0;
  private skipped = 0;

  constructor(
    private readonly prefix: string,
    private readonly mode: string,
    private readonly ticket: string,
  ) {}

  /** Ein Pflichttest wurde uebersprungen (nur im Local-Modus zulaessig). */
  markSkipped(): void {
    this.skipped++;
  }

  /**
   * Fuehrt einen Pflichttest aus. `passed` steigt ERST nach fehlerfreiem
   * Durchlauf — wirft `fn`, bleibt die Differenz im Report sichtbar.
   */
  async run(fn: () => Promise<void>): Promise<void> {
    this.executed++;
    await fn();
    this.passed++;
  }

  counts(): { executed: number; passed: number; skipped: number } {
    return { executed: this.executed, passed: this.passed, skipped: this.skipped };
  }

  /** Greppbare Report-Zeile; scripts/assert-tenant-report.sh wertet sie aus. */
  reportLine(): string {
    return (
      `[${this.prefix}] mode=${this.mode} executed=${this.executed} ` +
      `passed=${this.passed} skipped=${this.skipped}\n`
    );
  }

  /**
   * Im Required-Modus: jeder Skip und jeder nicht bestandene Pflichttest ist
   * ein Fehler. Vitest laesst den Lauf bei einem fehlgeschlagenen Test ohnehin
   * rot werden; dieser Wurf sorgt dafuer, dass die Diskrepanz auch dort
   * auffaellt, wo nur der Report gelesen wird.
   */
  assertOrThrow(): void {
    if (this.mode !== "required") return;
    if (this.skipped > 0) {
      throw new Error(
        `[${this.prefix}] fail-closed: ${this.skipped} Pflichttests uebersprungen (EYT-66).`,
      );
    }
    if (this.passed !== this.executed) {
      throw new Error(
        `[${this.prefix}] fail-closed: ${this.executed - this.passed} von ${this.executed} ` +
          `Pflichttests sind nicht bestanden (${this.ticket}).`,
      );
    }
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
