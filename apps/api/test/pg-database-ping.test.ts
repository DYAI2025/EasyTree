import { describe, expect, it } from "vitest";

import { PgDatabasePing } from "../src/platform/database/pg-database-ping";

/**
 * Integration-level check WITHOUT Docker (EYT-58): the real pg-based ping
 * must classify an unreachable database as "not ready" — quickly (bounded
 * by connectionTimeoutMillis=2000) and without ever throwing. Port 59999
 * is deliberately unassigned in every environment this suite runs in.
 */
describe("PgDatabasePing", () => {
  it("returns false within 5s and never throws for an unreachable database", async () => {
    const ping = new PgDatabasePing({
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:59999/postgres",
      sslRootCert: undefined,
    });
    const startedAt = Date.now();
    await expect(ping.ping()).resolves.toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});
