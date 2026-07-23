import { Controller, Get, NotFoundException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";

const INTERNAL_SECRET = "sk-INTERNAL-SECRET-VALUE";

@Controller("boom")
class BoomController {
  @Get("unexpected")
  unexpected(): never {
    throw new Error(`database password is ${INTERNAL_SECRET}`);
  }

  @Get("not-found")
  notFound(): never {
    throw new NotFoundException("tree does not exist");
  }
}

let app: INestApplication;

beforeEach(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [BoomController],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterEach(async () => {
  await app.close();
});

describe("http exception filter", () => {
  it("maps unexpected errors to structured RFC-7807-like JSON without stack or internals", async () => {
    const res = await request(app.getHttpServer()).get("/boom/unexpected");
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toMatchObject({
      type: expect.any(String),
      title: expect.any(String),
      status: 500,
      detail: expect.any(String),
      correlationId: expect.any(String),
    });
    const serialized = JSON.stringify(res.body);
    expect(res.body).not.toHaveProperty("stack");
    expect(serialized).not.toContain(INTERNAL_SECRET);
    expect(serialized).not.toContain("at "); // no stack frames anywhere
  });

  it("maps HttpExceptions to structured JSON with their status and message", async () => {
    const res = await request(app.getHttpServer()).get("/boom/not-found");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      status: 404,
      detail: "tree does not exist",
      correlationId: expect.any(String),
    });
    expect(res.body).not.toHaveProperty("stack");
  });
});
