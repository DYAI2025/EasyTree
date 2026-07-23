import { randomUUID } from "node:crypto";

import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

/** Canonical correlation id header (lowercase, as normalized by Node). */
export const CORRELATION_ID_HEADER = "x-correlation-id";

/** Request augmented with the correlation id for downstream consumers. */
export interface RequestWithCorrelationId extends Request {
  correlationId: string;
}

const MAX_HEADER_LENGTH = 128;

/**
 * Adopts an incoming `x-correlation-id` or generates a UUID, mirrors it
 * into the response header and exposes it on the request object so
 * filters/loggers can bind it (EYT-42).
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(CORRELATION_ID_HEADER)?.trim();
    const correlationId =
      incoming !== undefined && incoming.length > 0 && incoming.length <= MAX_HEADER_LENGTH
        ? incoming
        : randomUUID();
    (req as RequestWithCorrelationId).correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}
