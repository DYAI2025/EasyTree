import type { AppConfig } from "@easytree/config";
import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { CorrelationIdMiddleware } from "./common/correlation-id.middleware";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { APP_CONFIG, ConfigModule } from "./config/config.module";
import { TENANT_SUBJECT_RESOLVER, UnauthenticatedSubjectResolver } from "./common/tenant-subject";
import { HealthController } from "./health/health.controller";
import {
  DenyAllPlanningAccess,
  PLANNING_ACCESS_POLICY,
  PLANNING_QUERIES_FACTORY,
  PLANNING_WRITES_FACTORY,
  PlanningController,
  PlanningWindowRepository,
  PlanningWriteRepository,
  type PlanningQueriesFactory,
  type PlanningWritesFactory,
} from "./modules/planning";
import {
  createTimeZone,
  isoWeekOfLocalDate,
  localBusinessDate,
  planningWeekKey,
} from "@easytree/domain";
import {
  TENANT_QUERY_RUNNER,
  TenantQueryRunnerProvider,
} from "./platform/database/tenant-query-runner.provider";

/**
 * Fehlerinjektionspunkt fuer den Teilwirkungsnachweis (EYT-92).
 *
 * `EASYTREE_FAULT_AFTER=assignment|audit|outbox` bricht den Schreibvorgang
 * genau nach diesem Schritt ab. Ein unbekannter Wert wird ausdruecklich
 * ABGELEHNT statt ignoriert: ein Tippfehler wuerde sonst einen Test still in
 * den Normalfall laufen lassen, und der Test faerbte sich gruen, ohne den
 * Abbruch je ausgeloest zu haben.
 */
function fehlerpunktAusUmgebung(): "assignment" | "audit" | "outbox" | null {
  const wert = process.env["EASYTREE_FAULT_AFTER"];
  if (wert === undefined || wert === "") return null;
  if (wert === "assignment" || wert === "audit" || wert === "outbox") return wert;
  throw new Error(
    `EASYTREE_FAULT_AFTER hat den unbekannten Wert "${wert}". Erlaubt: assignment, audit, outbox.`,
  );
}
import { PgDatabasePing } from "./platform/database/pg-database-ping";
import {
  DATABASE_PING,
  READINESS_INDICATORS,
  type DatabasePing,
  type ReadinessIndicator,
} from "./health/readiness";

/**
 * Shared module core for BOTH entrypoints (EYT-42, ADR-001 §2):
 * `main.ts` boots it as an HTTP application, `worker.ts` boots it as a
 * plain application context. Modules, DI and configuration are identical;
 * only the bootstrap differs.
 */
@Module({
  imports: [ConfigModule],
  controllers: [HealthController, PlanningController],
  providers: [
    {
      // Real database ping (EYT-58): SELECT 1 against the configured
      // DATABASE_URL. Tests substitute this token via DI override
      // (`StubDatabasePing` or inline fakes) — never the controller.
      provide: DATABASE_PING,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DatabasePing => new PgDatabasePing(config.databaseUrl),
    },
    {
      provide: READINESS_INDICATORS,
      inject: [APP_CONFIG, DATABASE_PING],
      useFactory: (config: AppConfig, databasePing: DatabasePing): ReadinessIndicator[] => [
        // Config is validated at bootstrap; reaching this factory means it loaded.
        { name: "config", isReady: (): boolean => config.nodeEnv !== undefined },
        { name: "database", isReady: (): Promise<boolean> => databasePing.ping() },
      ],
    },
    {
      // Mandantensubjekt (EYT-50). Absichtlich registriert, BEVOR die erste
      // Fachroute existiert: sonst brauchte die erste Route eine Quelle und
      // wuerde sich eine schwaechere ausdenken — einen Header, den niemand
      // prueft, oder eine Organisations-Id aus dem Anfragekoerper.
      //
      // Der Default liefert immer null. Fachrouten antworten damit 401, bis
      // EYT-14 die Tokenpruefung liefert. Tests ersetzen den Token per DI,
      // genau wie DATABASE_PING — deshalb braucht es keinen
      // "nur-in-test"-Umgehungsschalter im Produktionscode.
      provide: TENANT_SUBJECT_RESOLVER,
      useClass: UnauthenticatedSubjectResolver,
    },
    {
      // Verbindungspool je Prozess, Repository je Subjekt. Ein Repository mit
      // fest eingebautem Subjekt waere ein Singleton, das die Identitaet der
      // ERSTEN Anfrage an alle folgenden weiterreicht.
      provide: PLANNING_QUERIES_FACTORY,
      inject: [TENANT_QUERY_RUNNER],
      useFactory: (runner: TenantQueryRunnerProvider): PlanningQueriesFactory => {
        return (subjectUserId: string) => new PlanningWindowRepository(runner, subjectUserId);
      },
    },
    {
      // Schreibport, gleiche Begruendung wie oben: Subjekt je Anfrage.
      // Die Wochenregel kommt aus @easytree/domain und wird HINEINGEREICHT,
      // damit das Repository sie nicht selbst nachbaut — eine zweite
      // Wochenrechnung waere genau der Fehler aus EYT-74.
      provide: PLANNING_WRITES_FACTORY,
      inject: [TENANT_QUERY_RUNNER],
      useFactory: (runner: TenantQueryRunnerProvider): PlanningWritesFactory => {
        return (subjectUserId: string) =>
          new PlanningWriteRepository(
            runner,
            subjectUserId,
            (instant, zone) => {
              const geprueft = createTimeZone(zone);
              if (!geprueft.ok) {
                throw new Error(
                  `EYT-92: unbekannte Zeitzone "${zone}" in organizations.time_zone.`,
                );
              }
              return planningWeekKey(
                isoWeekOfLocalDate(localBusinessDate(instant, geprueft.timeZone)),
              );
            },
            // Testhaken fuer den Teilwirkungsnachweis. Kann nur SCHEITERN
            // lassen, nie etwas gruen faerben — das Gegenteil eines
            // Skip-Schalters. `EASYTREE_*` steuert Tests und nie die Anwendung
            // (CLAUDE.md), deshalb steht die Variable NICHT in ENV_VAR_META und
            // wird hier direkt gelesen.
            fehlerpunktAusUmgebung(),
          );
      },
    },
    {
      // Produktionsstand: niemand darf lesen. EYT-14 ersetzt das.
      provide: PLANNING_ACCESS_POLICY,
      useClass: DenyAllPlanningAccess,
    },
    TenantQueryRunnerProvider,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // "{*splat}" is the Express-5/path-to-regexp-v8 catch-all (Nest 11).
    consumer.apply(CorrelationIdMiddleware).forRoutes("{*splat}");
  }
}
