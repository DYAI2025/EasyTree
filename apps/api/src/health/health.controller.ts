import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";

import { READINESS_INDICATORS, type ReadinessIndicator } from "./readiness";

interface ReadinessCheck {
  readonly name: string;
  readonly ready: boolean;
}

@Controller()
export class HealthController {
  constructor(
    @Inject(READINESS_INDICATORS)
    private readonly indicators: readonly ReadinessIndicator[],
  ) {}

  /** Liveness: the process is up and serving HTTP. */
  @Get("health")
  health(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Readiness: 200 when every dependency indicator reports ready, else 503. */
  @Get("ready")
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: "ready" | "not-ready"; checks: ReadinessCheck[] }> {
    const checks = await Promise.all(
      this.indicators.map(async (indicator): Promise<ReadinessCheck> => {
        let ready: boolean;
        try {
          ready = await indicator.isReady();
        } catch {
          // A crashing indicator is a not-ready indicator, never a 500.
          ready = false;
        }
        return { name: indicator.name, ready };
      }),
    );
    const allReady = checks.every((check) => check.ready);
    res.status(allReady ? 200 : 503);
    return { status: allReady ? "ready" : "not-ready", checks };
  }
}
