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
import {
  AuthController,
  GotruePasswordLogin,
  MembershipRepository,
  PASSWORD_LOGIN,
  SESSION_ORGANISATIONS,
} from "./modules/tenancy";
import {
  COST_ACCESS_AUDIT,
  COST_ACCESS_POLICY,
  CostsController,
  MembershipCostAccessPolicy,
  NestCostAccessAuditLog,
  PgRateRepository,
  RATE_REPOSITORY_FACTORY,
  type RateRepositoryFactory,
} from "./modules/costs";
import {
  EMPLOYEE_DIRECTORY_FACTORY,
  PgEmployeeDirectory,
  type EmployeeDirectoryFactory,
} from "./modules/workforce";
import { REQUEST_IDENTITY, RequestIdentityService } from "./platform/auth/request-identity";
import { SESSION_LIVENESS, type SessionLiveness } from "./platform/auth/session-liveness";
import { TOKEN_VERIFIER, type TokenVerifier } from "./platform/auth/token-verifier";
import {
  createSupabaseSessionLiveness,
  createSupabaseTokenVerifier,
} from "./platform/auth/supabase-token-verifier.factory";
import { PgDatabasePing } from "./platform/database/pg-database-ping";
import {
  DATABASE_PING,
  READINESS_INDICATORS,
  type DatabasePing,
  type ReadinessIndicator,
} from "./health/readiness";

@Module({
  imports: [ConfigModule],
  controllers: [HealthController, PlanningController, AuthController, CostsController],
  providers: [
    {
      // EYT-106: reale Pruefkette aus der validierten Konfiguration. Tests
      // ersetzen die Tokens einzeln (lokales JWKS, gestellte Liveness) — die
      // Pruefregeln selbst sind nicht injizierbar.
      provide: TOKEN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): TokenVerifier => createSupabaseTokenVerifier(config),
    },
    {
      provide: SESSION_LIVENESS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SessionLiveness => createSupabaseSessionLiveness(config),
    },
    {
      provide: REQUEST_IDENTITY,
      inject: [TOKEN_VERIFIER, SESSION_LIVENESS],
      useFactory: (verifier: TokenVerifier, liveness: SessionLiveness): RequestIdentityService =>
        new RequestIdentityService(verifier, liveness),
    },
    {
      provide: PASSWORD_LOGIN,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): GotruePasswordLogin =>
        new GotruePasswordLogin({
          supabaseUrl: config.supabaseUrl,
          anonKey: config.supabaseAnonKey,
          fetchImpl: (eingabe, init) => fetch(eingabe, init),
        }),
    },
    {
      provide: SESSION_ORGANISATIONS,
      inject: [TenantQueryRunnerProvider],
      useFactory: (runner: TenantQueryRunnerProvider): MembershipRepository =>
        new MembershipRepository(runner),
    },
    {
      // EYT-106: die anwendungsseitige Haelfte der Kostenautorisierung. Die
      // Datenbank entscheidet unabhaengig noch einmal (Migration 0013).
      provide: COST_ACCESS_POLICY,
      useClass: MembershipCostAccessPolicy,
    },
    {
      // EYT-106 AK9: jede Kosten-Zugriffsentscheidung wird mit Korrelations-Id
      // fortgeschrieben. Der Logger beobachtet nur — er entscheidet nichts,
      // und ein Fehler in ihm veraendert keine Entscheidung (Controller
      // faengt ab).
      provide: COST_ACCESS_AUDIT,
      useClass: NestCostAccessAuditLog,
    },
    {
      // Repository je Subjekt, Pool je Prozess — dieselbe Begruendung wie beim
      // Planungsrepository: ein Singleton truege die Identitaet der ERSTEN
      // Anfrage in alle folgenden.
      provide: RATE_REPOSITORY_FACTORY,
      inject: [TENANT_QUERY_RUNNER],
      useFactory: (runner: TenantQueryRunnerProvider): RateRepositoryFactory => {
        return (subjectUserId: string) => new PgRateRepository(runner, subjectUserId);
      },
    },
    {
      // `public.employees` gehoert dem Workforce-Modul; die Kostenroute
      // bekommt die Liste ueber dessen oeffentlichen Port.
      provide: EMPLOYEE_DIRECTORY_FACTORY,
      inject: [TENANT_QUERY_RUNNER],
      useFactory: (runner: TenantQueryRunnerProvider): EmployeeDirectoryFactory => {
        return (subjectUserId: string) => new PgEmployeeDirectory(runner, subjectUserId);
      },
    },
    {
      // Real database ping (EYT-58): SELECT 1 against the configured
      // DATABASE_URL. Tests substitute this token via DI override
      // (`StubDatabasePing` or inline fakes) — never the controller.
      provide: DATABASE_PING,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DatabasePing =>
        new PgDatabasePing({
          databaseUrl: config.databaseUrl,
          sslRootCert: config.databaseSslRootCert,
        }),
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
            // KEIN vierter Parameter. Der Fehlerpunkt fuer den
            // Teilwirkungsnachweis bleibt `null`, weil die Produktionswurzel
            // keine Umgebungsvariable dafuer liest — ein Testhaken in
            // `AppModule` waere ein Produktionsschalter, egal wie er heisst.
            // Der Integrationstest konstruiert das Repository direkt und
            // injiziert den Punkt dort.
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
