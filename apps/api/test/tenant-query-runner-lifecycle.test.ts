/**
 * Der Verbindungspool wird beim Shutdown beendet — genau einmal (EYT-50).
 *
 * ## Warum das ein eigener Test ist
 *
 * Zuvor entstand der Pool in einer `useFactory` und war Nest unbekannt:
 * `app.close()` konnte ihn nicht schliessen. Der Provider hat jetzt einen
 * Lebenszyklus — aber "hat einen Pfad" ist keine Aussage darueber, dass er
 * gegangen wird. Ein Test, der nur `app.close()` aufruft und gruen bleibt,
 * belegt gar nichts.
 *
 * Gemessen wird deshalb am POOL: wie oft `end()` gerufen wurde, und ob eine
 * echte Nutzung davor stattfand. Der `pg.Pool` selbst ist ersetzt — eine
 * Datenbank braucht es fuer diese Aussage nicht, wohl aber eine echte
 * Poolnutzung ueber `run()`.
 */
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { APP_CONFIG } from "../src/config/config.module";
import { PgTenantQueryRunner } from "../src/platform/database/tenant-query-runner";
import { TenantQueryRunnerProvider } from "../src/platform/database/tenant-query-runner.provider";

/** Zaehlt Verbindungen, Queries und `end()`-Aufrufe. */
function fakePool(): {
  pool: ConstructorParameters<typeof PgTenantQueryRunner>[0];
  ends: number;
  statements: string[];
} {
  const zaehler = { ends: 0, statements: [] as string[] };
  const client = {
    query: (sql: string): Promise<{ rows: unknown[]; rowCount: number }> => {
      zaehler.statements.push(sql);
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
    release: (): void => undefined,
  };
  const pool = {
    connect: () => Promise.resolve(client),
    end: () => {
      zaehler.ends++;
      return Promise.resolve();
    },
  };
  return {
    pool: pool as unknown as ConstructorParameters<typeof PgTenantQueryRunner>[0],
    get ends() {
      return zaehler.ends;
    },
    get statements() {
      return zaehler.statements;
    },
  };
}

async function bootWith(runner: PgTenantQueryRunner): Promise<{
  provider: TenantQueryRunnerProvider;
  close: () => Promise<void>;
}> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: APP_CONFIG, useValue: { databaseUrl: "postgres://ungenutzt" } },
      {
        provide: TenantQueryRunnerProvider,
        useValue: new TenantQueryRunnerProvider(
          { databaseUrl: "postgres://ungenutzt" } as never,
          runner,
        ),
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();
  return {
    provider: app.get(TenantQueryRunnerProvider),
    close: () => app.close(),
  };
}

describe("TenantQueryRunnerProvider — Lebenszyklus", () => {
  it("beendet den Pool nach echter Nutzung genau einmal", async () => {
    const zaehler = fakePool();
    const runner = new PgTenantQueryRunner(zaehler.pool);
    const { provider, close } = await bootWith(runner);

    // Echte Poolnutzung: Verbindung, Transaktion, Kontext, Query.
    await provider.run({ userId: "00000000-0000-4000-8000-00000000aaa1" }, async (tx) => {
      await tx.query("select 1");
    });
    // Ohne diese Zeile koennte der Test auch mit einem nie benutzten Pool
    // gruen sein — und genau darum geht es nicht.
    expect(zaehler.statements).toContain("set local role authenticated");
    expect(zaehler.ends).toBe(0);

    await close();
    expect(zaehler.ends).toBe(1);
  });

  it("loest bei einem zweiten Shutdown keinen zweiten end() aus", async () => {
    // `pool.end()` zweimal auf demselben Pool wirft. Ein Shutdown, der schon
    // gelaufen ist, darf den naechsten nicht mit einem Fehler quittieren.
    const zaehler = fakePool();
    const runner = new PgTenantQueryRunner(zaehler.pool);
    const provider = new TenantQueryRunnerProvider(
      { databaseUrl: "postgres://ungenutzt" } as never,
      runner,
    );

    await provider.run({ userId: "00000000-0000-4000-8000-00000000aaa1" }, async (tx) => {
      await tx.query("select 1");
    });

    await provider.onApplicationShutdown();
    await provider.onApplicationShutdown();
    expect(zaehler.ends).toBe(1);
    expect(provider.closed).toBe(true);
  });
});
