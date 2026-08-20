import "reflect-metadata";

import type { AppConfig } from "@easytree/config";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { API_BASE_PATH } from "./common/api-base-path";
import { APP_CONFIG } from "./config/config.module";
import type { PgConnectionInput } from "./platform/database/pg-connection";
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
/**
 * Die fertig konfigurierte Anwendung — alles ausser `listen`.
 *
 * Getrennt von {@link bootstrapApi}, damit Tests GENAU DIESE Verdrahtung
 * pruefen koennen, ohne einen Port zu belegen. Der Grund ist konkret: solange
 * `test/openapi-route-conformance.test.ts` das Praefix selbst setzte, waere
 * jede Zusicherung dort gruen geblieben, wenn jemand `setGlobalPrefix` hier
 * entfernt — der Test haette den Vertrag geschuetzt und die Verdrahtung nicht.
 */
export async function wireApiApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  // Der Vertrag nennt "/api/v1" als Basispfad (packages/contracts/openapi/v1.json,
  // servers[0].url). Bis EYT-50 gab es diesen Pfad serverseitig ueberhaupt nicht —
  // jeder daraus abgeleitete Client haette ins Leere gezeigt.
  //
  // health und ready bleiben unversioniert: sie sind Betriebsschnittstellen,
  // keine Fachrouten. scripts/smoke-api.sh und die Playwright-Suite fragen sie
  // unter genau diesen Pfaden ab, und ein Liveness-Endpunkt, der sich mit der
  // Fachversion verschiebt, ist kein Liveness-Endpunkt.
  app.setGlobalPrefix(API_BASE_PATH, { exclude: ["health", "ready"] });
  app.enableShutdownHooks();
  return app;
}

/**
 * Die Verdrahtung PLUS das Rollengate.
 *
 * Signatur, Reihenfolge und das `app.close()` im Fehlerfall sind unveraendert —
 * `bootstrapApi` und jeder bestehende Aufrufer sehen keinen Unterschied. Neu ist
 * nur, dass die reine Verdrahtung ueber {@link wireApiApp} auch ohne dieses Gate
 * erreichbar ist (EYT-142): der Cloudflare-Entry braucht sie im Modulscope, das
 * Gate aber im Requestscope.
 */
export async function createApiApp(
  /** Einspritzpunkt fuer die Rollenpruefung (EYT-45). Siehe worker.ts. */
  readRolePrivileges: (
    connection: PgConnectionInput,
  ) => RolePrivilegeReader = createRolePrivilegeReader,
): Promise<INestApplication> {
  const app = await wireApiApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  // Vor dem ersten Request: die verbundene Rolle darf RLS nicht umgehen
  // koennen (EYT-45, ADR-001 Z. 85). Wirft und verhindert damit den Start.
  try {
    await verifyDatabaseRole(
      readRolePrivileges({
        databaseUrl: config.databaseUrl,
        sslRootCert: config.databaseSslRootCert,
      }),
    );
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}

export async function bootstrapApi(
  readRolePrivileges: (
    connection: PgConnectionInput,
  ) => RolePrivilegeReader = createRolePrivilegeReader,
): Promise<INestApplication> {
  const app = await createApiApp(readRolePrivileges);
  const config = app.get<AppConfig>(APP_CONFIG);
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
