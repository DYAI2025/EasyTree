import { STATUS_CODES } from "node:http";

import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";

import type { RequestWithCorrelationId } from "./correlation-id.middleware";

/** RFC-7807-like problem document returned for every error response. */
export interface ProblemDocument {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly correlationId: string;
}

const GENERIC_DETAIL = "An unexpected error occurred.";

/**
 * Extracts a safe human-readable detail from a deliberately thrown
 * HttpException. Unexpected errors are NEVER surfaced: their message may
 * embed internals or secret values (connection strings, keys), so they map
 * to a generic detail. Stack traces are never part of the response body.
 */
function detailOf(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === "string") return response;
  if (typeof response === "object" && response !== null && "message" in response) {
    const message = (response as { message: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.map(String).join("; ");
  }
  return exception.message;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body: ProblemDocument = {
      type: "about:blank",
      title: STATUS_CODES[status] ?? "Error",
      status,
      detail: isHttp ? detailOf(exception) : GENERIC_DETAIL,
      correlationId: (req as Partial<RequestWithCorrelationId>).correlationId ?? "unknown",
    };

    res.status(status).json(body);
  }
}
