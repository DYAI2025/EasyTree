import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { CORRELATION_ID_HEADER } from "../src/common/correlation-id.middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let app: INestApplication;

beforeEach(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterEach(async () => {
  await app.close();
});

describe("correlation id middleware", () => {
  it("mirrors an incoming x-correlation-id header into the response", async () => {
    const incoming = "11111111-2222-4333-8444-555555555555";
    const res = await request(app.getHttpServer())
      .get("/health")
      .set(CORRELATION_ID_HEADER, incoming);
    expect(res.headers[CORRELATION_ID_HEADER]).toBe(incoming);
  });

  it("generates a UUID when no header is sent", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.headers[CORRELATION_ID_HEADER]).toMatch(UUID_RE);
  });
});
