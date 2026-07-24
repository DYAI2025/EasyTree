import type { AppConfig } from "@easytree/config";
import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { CorrelationIdMiddleware } from "./common/correlation-id.middleware";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { APP_CONFIG, ConfigModule } from "./config/config.module";
import { HealthController } from "./health/health.controller";
import { PgDatabasePing } from "./health/pg-database-ping";
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
  controllers: [HealthController],
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
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // "{*splat}" is the Express-5/path-to-regexp-v8 catch-all (Nest 11).
    consumer.apply(CorrelationIdMiddleware).forRoutes("{*splat}");
  }
}
