/**
 * Konflikte der Satzverwaltung als RFC-7807 mit stabilem URN (EYT-108).
 *
 * Eigener Filter statt `HttpException` mit Statuscode 409, weil die UI am
 * `type` unterscheidet, ob sie "Ueberlappung" oder "konkurrierende Aenderung"
 * anzeigt — und ein deutscher Meldungstext ist Darstellung, keine
 * Schnittstelle (dieselbe Begruendung wie bei `PLANNING_ERROR_TYPE`).
 */
import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";

import type { RequestWithCorrelationId } from "../../../../common/correlation-id.middleware";
import { ConflictProblem } from "./conflict-problem";

@Catch(ConflictProblem)
export class CostsProblemFilter implements ExceptionFilter {
  catch(exception: ConflictProblem, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    res.status(HttpStatus.CONFLICT).json({
      type: exception.type,
      title: "Konflikt",
      status: HttpStatus.CONFLICT,
      detail: exception.message,
      correlationId: (req as Partial<RequestWithCorrelationId>).correlationId ?? "unknown",
    });
  }
}
