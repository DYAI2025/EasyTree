import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { READINESS_INDICATORS, type ReadinessIndicator } from "../src/health/readiness";

let app: INestApplication | undefined;

async function createApp(overrides?: {
  indicators?: readonly ReadinessIndicator[];
}): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (overrides?.indicators) {
    builder.overrideProvider(READINESS_INDICATORS).useValue(overrides.indicators);
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
    const res = await request((await createApp()).getHttpServer()).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready" });
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
