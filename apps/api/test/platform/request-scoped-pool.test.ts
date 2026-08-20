import { describe, expect, it } from "vitest";

import { createRequestScopedPool } from "../../src/platform/database/request-scoped-pool";
import { PgTenantQueryRunner } from "../../src/platform/database/tenant-query-runner";

/**
 * EYT-142 — verbindungsfrische Poolattrappe (Kandidatennaht K1).
 *
 * ## Warum diese Naht und keine andere
 *
 * Spike A4 hat den entscheidenden Satz GEMESSEN, nicht angenommen: ein Socket,
 * der in Request 1 erzeugt wurde, ist in Request 2 unbenutzbar —
 * "Cannot perform I/O on behalf of a different request. (I/O type: Writable)".
 * Der Kontrollfall (jeder Request erzeugt seinen EIGENEN Socket) war dagegen
 * gruen. Ein isolate-weiter `pg.Pool`, der Verbindungen ueber Requests hinweg
 * wiederverwendet, ist damit ausgeschlossen (N2) — und genau das tut ein
 * normaler Pool.
 *
 * Diese Attrappe erfuellt strukturell dieselbe Form wie `pg.Pool`
 * (`connect()` / `end()`), oeffnet aber je `connect()` eine FRISCHE Verbindung
 * und schliesst sie bei `release()`. Dadurch bleibt `PgTenantQueryRunner`
 * UNVERAENDERT (N5, N7): die Transaktionsklammer, die Repositories und die
 * Domain fassen wir nicht an.
 *
 * GEGENMUTATION — eingespielt, gemessen, zurueckgenommen (siehe Commit):
 * `connect()` so aendern, dass es dieselbe Verbindung zwischenspeichert und
 * wiederverwendet -> "je Aufruf eine neue Verbindung" und "release schliesst"
 * werden rot.
 */
interface UnechteVerbindung {
  readonly id: number;
  geschlossen: boolean;
  readonly statements: string[];
}

function attrappenFabrik(): {
  verbindungen: UnechteVerbindung[];
  oeffne: () => Promise<{
    query: (sql: string) => Promise<{ rows: unknown[]; rowCount: number }>;
    end: () => Promise<void>;
  }>;
} {
  const verbindungen: UnechteVerbindung[] = [];
  return {
    verbindungen,
    oeffne: () => {
      const eintrag: UnechteVerbindung = {
        id: verbindungen.length + 1,
        geschlossen: false,
        statements: [],
      };
      verbindungen.push(eintrag);
      return Promise.resolve({
        query: (sql: string) => {
          eintrag.statements.push(sql);
          return Promise.resolve({ rows: [], rowCount: 0 });
        },
        end: () => {
          eintrag.geschlossen = true;
          return Promise.resolve();
        },
      });
    },
  };
}

describe("verbindungsfrische Poolattrappe (EYT-142, Naht K1)", () => {
  it("oeffnet je connect() eine NEUE Verbindung — nichts wird wiederverwendet", async () => {
    const { verbindungen, oeffne } = attrappenFabrik();
    const pool = createRequestScopedPool(oeffne);

    const a = await pool.connect();
    a.release();
    const b = await pool.connect();
    b.release();

    expect(verbindungen).toHaveLength(2);
    expect(verbindungen[0]?.id).not.toBe(verbindungen[1]?.id);
  });

  it("schliesst die Verbindung bei release() — kein Socket ueberlebt den Request", async () => {
    const { verbindungen, oeffne } = attrappenFabrik();
    const pool = createRequestScopedPool(oeffne);

    const client = await pool.connect();
    expect(verbindungen[0]?.geschlossen).toBe(false);
    client.release();
    await Promise.resolve();
    await Promise.resolve();

    expect(verbindungen[0]?.geschlossen).toBe(true);
  });

  it("traegt PgTenantQueryRunner unveraendert — Transaktionsklammer bleibt wortgleich", async () => {
    const { verbindungen, oeffne } = attrappenFabrik();
    const pool = createRequestScopedPool(oeffne);
    const runner = new PgTenantQueryRunner(
      pool as unknown as ConstructorParameters<typeof PgTenantQueryRunner>[0],
    );

    await runner.run({ userId: "11111111-1111-4111-8111-111111111111" }, async (tx) => {
      await tx.query("select 1");
      return null;
    });

    const statements = verbindungen[0]?.statements ?? [];
    expect(statements[0]).toBe("begin");
    expect(statements[1]).toBe("select set_config('request.jwt.claims', $1, true)");
    expect(statements[2]).toBe("set local role authenticated");
    expect(statements).toContain("commit");
  });

  it("gibt jedem run() eine eigene Verbindung", async () => {
    const { verbindungen, oeffne } = attrappenFabrik();
    const pool = createRequestScopedPool(oeffne);
    const runner = new PgTenantQueryRunner(
      pool as unknown as ConstructorParameters<typeof PgTenantQueryRunner>[0],
    );
    const kontext = { userId: "11111111-1111-4111-8111-111111111111" };

    await runner.run(kontext, () => Promise.resolve(null));
    await runner.run(kontext, () => Promise.resolve(null));

    expect(verbindungen).toHaveLength(2);
    expect(verbindungen.every((v) => v.geschlossen)).toBe(true);
  });
});
