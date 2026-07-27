/**
 * Mandantengebundener Transaktionslauf (EYT-50).
 *
 * ## Warum das hier liegt und nicht im Modul
 *
 * `apps/api/test/architecture/rules.ts` erlaubt `pg` ausschliesslich unter
 * `apps/api/src/platform/` (Regel `api-dependency-allowlist`, EYT-45). Das ist
 * keine Formalie: ein Treiber im Fachmodul heisst, dass irgendwann jemand eine
 * Query an Transaktionsgrenze, Rollenwechsel und RLS vorbei absetzt. Deshalb
 * besitzt genau diese Datei die Verbindung, und die Repositories der Module
 * bekommen nur noch {@link TenantQuery} — eine Schnittstelle ohne Treiberbezug.
 *
 * ## Was ein Aufruf tut, und warum in dieser Reihenfolge
 *
 * Jeder Lauf ist EINE Transaktion und setzt darin drei Dinge:
 *
 *   1. `set_config('request.jwt.claims', …, true)` — transaktionslokal.
 *      `app.current_user_id()` und `app.user_org_ids()` aus Migration 0002
 *      lesen genau diesen Wert.
 *   2. `set local role authenticated` — erst danach gelten Tabellenrechte.
 *      `easytree_app` ist NOINHERIT (Migration 0003): ohne diesen Wechsel
 *      scheitert jede Query mit "permission denied", nicht mit stillen
 *      Volldaten. Fail-closed auf Datenbankebene.
 *   3. den Rumpf.
 *
 * Beides transaktionslokal, weil der Transaction-Mode-Pooler nichts anderes
 * ueberlebt — dieselbe Begruendung wie in `test/tenant-context.helper.ts`, und
 * dort in CI gegen einen echten Supavisor bewiesen (`[tenant-pooling] …`).
 *
 * ## Was hier NICHT passiert
 *
 * Keine Berechtigungspruefung. Diese Schicht setzt den Kontext, sie entscheidet
 * nicht. Serverseitige Autorisierung ist primaer und gehoert in die
 * Anwendungsschicht des Moduls; RLS ist Tiefenverteidigung (ADR-001, CLAUDE.md).
 * Wer hier eine Rollenpruefung einbaut, verlegt eine fachliche Entscheidung in
 * die Infrastruktur.
 */
import { Pool } from "pg";
import type { PoolClient } from "pg";

/** Ergebniszeilen einer Query. Bewusst schmal — kein Treibertyp nach aussen. */
export interface QueryResult<TRow> {
  readonly rows: readonly TRow[];
  readonly rowCount: number;
}

/**
 * Was ein Repository sieht: Queries innerhalb einer bereits gesetzten
 * Mandantentransaktion. Kein `begin`, kein `commit`, kein Rollenwechsel —
 * darueber entscheidet der Aufrufer von {@link TenantQueryRunner.run}.
 */
export interface TenantQuery {
  query<TRow>(sql: string, params?: readonly unknown[]): Promise<QueryResult<TRow>>;
}

/** Der Mandantenkontext einer Anfrage, so wie ihn die Datenbank erwartet. */
export interface TenantContext {
  /** `auth.uid()`-Subjekt aus dem verifizierten JWT. */
  readonly userId: string;
}

export interface TenantQueryRunner {
  /**
   * Fuehrt `work` in EINER Transaktion mit gesetztem Mandantenkontext aus.
   * Wirft `work`, wird zurueckgerollt und der Fehler weitergereicht.
   */
  run<T>(context: TenantContext, work: (tx: TenantQuery) => Promise<T>): Promise<T>;
}

export class PgTenantQueryRunner implements TenantQueryRunner {
  constructor(private readonly pool: Pool) {}

  static fromUrl(databaseUrl: string): PgTenantQueryRunner {
    return new PgTenantQueryRunner(new Pool({ connectionString: databaseUrl }));
  }

  async run<T>(context: TenantContext, work: (tx: TenantQuery) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    // Scheitert das ROLLBACK selbst, ist der Zustand der Sitzung unbekannt.
    // Sie darf dann NICHT in den Pool zurueck: bliebe sie in der Transaktion,
    // erbte der naechste Entleiher ihr `set local role authenticated` und ihre
    // request.jwt.claims — also den Mandanten einer fremden Person. Genau die
    // Isolation, fuer die es diese Klasse gibt, waere damit aufgehoben.
    let poisoned: unknown = null;
    try {
      await client.query("begin");
      // `true` = transaktionslokal. Ohne das bliebe der Anspruch an der
      // Verbindung haengen und die naechste Anfrage erbte ihn — im Pooler
      // sogar die einer anderen Person.
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: context.userId, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");

      const result = await work({
        query: async <TRow>(sql: string, params: readonly unknown[] = []) => {
          const raw = await client.query(sql, params as unknown[]);
          return { rows: raw.rows as TRow[], rowCount: raw.rowCount ?? 0 };
        },
      });

      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch (rollbackError) {
        poisoned = rollbackError;
      }
      throw error;
    } finally {
      // `release(err)` zerstoert die Verbindung, statt sie zurueckzulegen.
      // Ein neuer Verbindungsaufbau ist der guenstigere Fehler.
      client.release(poisoned === null ? undefined : (poisoned as Error));
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
