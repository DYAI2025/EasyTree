import "reflect-metadata";

import type { AppConfig } from "@easytree/config";
import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { APP_CONFIG } from "./config/config.module";
import {
  createRolePrivilegeReader,
  verifyDatabaseRole,
  type RolePrivilegeReader,
} from "./platform/database/role-privileges";

/**
 * Worker entrypoint (EYT-42, ADR-001 §2): boots the SAME {@link AppModule}
 * via `createApplicationContext` — full DI and configuration, but NO HTTP
 * listener and no port. Async work (transactional outbox processing) will
 * live here in later sprints.
 */
export async function bootstrapWorker(
  /**
   * Einspritzpunkt fuer die Rollenpruefung (EYT-45).
   *
   * Standard ist die echte Abfrage gegen die konfigurierte Datenbank. Tests,
   * die nur das Bootstrap-Verhalten pruefen, ersetzen sie — dasselbe Muster wie
   * beim `DATABASE_PING`-Token. Der Produktivpfad laeuft ueber den Standardwert
   * und wird von `scripts/smoke-worker.sh` und `smoke-api-role-gate.sh`
   * ausgefuehrt, nicht von dieser Signatur umgangen.
   */
  readRolePrivileges: (databaseUrl: string) => RolePrivilegeReader = createRolePrivilegeReader,
): Promise<INestApplicationContext> {
  const ctx = await NestFactory.createApplicationContext(AppModule);
  ctx.enableShutdownHooks();
  // Der Worker schreibt spaeter ueber dieselbe Verbindung wie die API und
  // unterliegt derselben Auflage (EYT-45, ADR-001 Z. 85).
  const config = ctx.get<AppConfig>(APP_CONFIG);
  try {
    await verifyDatabaseRole(readRolePrivileges(config.databaseUrl));
  } catch (error) {
    // Kein halb gestarteter Kontext: sonst haelt der Worker Verbindungen offen,
    // obwohl er nicht arbeiten darf.
    await ctx.close();
    throw error;
  }
  return ctx;
}

/* c8 ignore start -- process-level wiring, exercised by the build smoke test */
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  bootstrapWorker()
    .then(() => {
      // A context without an HTTP listener holds no event-loop handles, so
      // the process would exit immediately. Keep it alive until SIGTERM /
      // SIGINT, which Nest's shutdown hooks translate into a graceful
      // ctx.close() before the process terminates.
      setInterval(() => {
        /* keep event loop alive */
      }, 60_000);
    })
    .catch((error: unknown) => {
      console.error("Worker bootstrap failed:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
