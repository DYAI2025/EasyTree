import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module";

describe("graceful shutdown", () => {
  it("invokes shutdown hooks when the application closes", async () => {
    const onShutdown = vi.fn();

    @Injectable()
    class ShutdownSpy implements OnApplicationShutdown {
      onApplicationShutdown(signal?: string): void {
        onShutdown(signal);
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [ShutdownSpy],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.enableShutdownHooks();
    await app.init();

    await app.close();
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });
});
