import "reflect-metadata";

import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";

/**
 * Worker entrypoint (EYT-42, ADR-001 §2): boots the SAME {@link AppModule}
 * via `createApplicationContext` — full DI and configuration, but NO HTTP
 * listener and no port. Async work (transactional outbox processing) will
 * live here in later sprints.
 */
export async function bootstrapWorker(): Promise<INestApplicationContext> {
  const ctx = await NestFactory.createApplicationContext(AppModule);
  ctx.enableShutdownHooks();
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
