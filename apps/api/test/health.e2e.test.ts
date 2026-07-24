import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import {
  DATABASE_PING,
  READINESS_INDICATORS,
  StubDatabasePing,
  type DatabasePing,
  type ReadinessIndicator,
} from "../src/health/readiness";

let app: INestApplication | undefined;

async function createApp(overrides?: {
  indicators?: readonly ReadinessIndicator[];
  databasePing?: DatabasePing;
}): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (overrides?.indicators) {
    builder.overrideProvider(READINESS_INDICATORS).useValue(overrides.indicators);
  }
  if (overrides?.databasePing) {
    builder.overrideProvider(DATABASE_PING).useValue(overrides.databasePing);
  }
  const moduleRef = await builder.compile();
  app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request((await createApp()).getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });
});

describe("GET /ready", () => {
  it("returns 200 when all dependencies are ready", async () => {
    // The production DATABASE_PING provider performs a REAL TCP ping
    // (EYT-58), so the "everything healthy" e2e case substitutes the
    // always-reachable stub. The real ping is covered by
    // pg-database-ping.test.ts and the CI runtime smoke (EXPECT_READY=200).
    const res = await request(
      (await createApp({ databasePing: new StubDatabasePing() })).getHttpServer(),
    ).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready" });
  });

  it("returns 503 when the DATABASE_PING override reports the DB as unreachable", async () => {
    const res = await request(
      (await createApp({ databasePing: { ping: () => Promise.resolve(false) } })).getHttpServer(),
    ).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "not-ready" });
    expect(res.body).toMatchObject({
      checks: expect.arrayContaining([{ name: "database", ready: false }]) as unknown,
    });
  });

  it("returns 200 when the DATABASE_PING override reports the DB as reachable", async () => {
    const res = await request(
      (await createApp({ databasePing: { ping: () => Promise.resolve(true) } })).getHttpServer(),
    ).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready" });
    expect(res.body).toMatchObject({
      checks: expect.arrayContaining([{ name: "database", ready: true }]) as unknown,
    });
  });

  it("returns 503 when a dependency is not ready", async () => {
    const notReady: ReadinessIndicator = {
      name: "database",
      isReady: () => Promise.resolve(false),
    };
    const res = await request((await createApp({ indicators: [notReady] })).getHttpServer()).get(
      "/ready",
    );
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "not-ready" });
  });
});
