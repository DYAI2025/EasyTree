import "reflect-metadata";

import type { AppConfig } from "@easytree/config";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { APP_CONFIG } from "./config/config.module";
import {
  createRolePrivilegeReader,
  verifyDatabaseRole,
  type RolePrivilegeReader,
} from "./platform/database/role-privileges";

/**
 * HTTP API entrypoint (EYT-42). Boots the shared {@link AppModule} as an
 * HTTP application on the validated `API_PORT` and enables shutdown hooks
 * so SIGTERM/SIGINT close the server gracefully.
 */
export async function bootstrapApi(
  /** Einspritzpunkt fuer die Rollenpruefung (EYT-45). Siehe worker.ts. */
  readRolePrivileges: (databaseUrl: string) => RolePrivilegeReader = createRolePrivilegeReader,
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(APP_CONFIG);
  // Vor dem ersten Request: die verbundene Rolle darf RLS nicht umgehen
  // koennen (EYT-45, ADR-001 Z. 85). Wirft und verhindert damit den Start.
  try {
    await verifyDatabaseRole(readRolePrivileges(config.databaseUrl));
  } catch (error) {
    await app.close();
    throw error;
  }
  await app.listen(config.apiPort);
  return app;
}

/* c8 ignore start -- process-level wiring, exercised by the build smoke test */
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  bootstrapApi().catch((error: unknown) => {
    // ConfigValidationError messages are redacted by @easytree/config;
    // this log goes to stderr only, never into an HTTP response.
    console.error("API bootstrap failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
