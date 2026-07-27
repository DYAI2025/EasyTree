import { Client } from "pg";

import type { DatabasePing } from "../../health/readiness";

/** Echter DB-Ping (EYT-58): SELECT 1 mit hartem Timeout, niemals throw. */
export class PgDatabasePing implements DatabasePing {
  constructor(private readonly databaseUrl: string) {}

  async ping(): Promise<boolean> {
    const client = new Client({
      connectionString: this.databaseUrl,
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
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
}
