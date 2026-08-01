/**
 * Auth-Fehler -> RFC-7807 mit stabilen URN-Codes (EYT-106).
 *
 * Dieselbe Bauart wie `PlanningProblemFilter`: die Fachfehler der
 * Identitaetskette werden HIER in Transportform gebracht, damit weder
 * Tokenmaterial noch jose-Interna in eine Antwort geraten. UI-Texte haengen
 * an diesen URNs, nie an Bibliotheksmeldungen.
 */
import { STATUS_CODES } from "node:http";

import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";

import type { RequestWithCorrelationId } from "../../../../common/correlation-id.middleware";
import { IdentityRejectedError } from "../../../../platform/auth/request-identity";
import { SessionRejectedError } from "../../../../platform/auth/session-liveness";
import { TokenRejectedError } from "../../../../platform/auth/token-verifier";

export const AUTH_ERROR_TYPE = {
  UNAUTHENTICATED: "urn:easytree:auth:unauthenticated",
  CREDENTIAL_CONFLICT: "urn:easytree:auth:credential-conflict",
  AUTH_SERVER_UNAVAILABLE: "urn:easytree:auth:auth-server-unavailable",
} as const;

interface AuthProblem {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
}

function problemOf(exception: unknown): AuthProblem | null {
  if (exception instanceof IdentityRejectedError) {
    if (exception.code === "CREDENTIAL_CONFLICT") {
      return {
        status: HttpStatus.UNAUTHORIZED,
        type: AUTH_ERROR_TYPE.CREDENTIAL_CONFLICT,
        title: "Widersprüchliche Anmeldedaten",
        detail:
          "Cookie und Authorization-Header ergeben nicht dieselbe Identität. Bitte neu anmelden.",
      };
    }
    return {
      status: HttpStatus.UNAUTHORIZED,
      type: AUTH_ERROR_TYPE.UNAUTHENTICATED,
      title: "Nicht angemeldet",
      detail: "Für diese Aktion ist eine Anmeldung erforderlich.",
    };
  }
  if (exception instanceof TokenRejectedError) {
    // Der praezise Ablehnungsgrund steht im Log (Korrelation), nicht in der
    // Antwort — ein Angreifer bekommt keine Diagnose seiner Manipulationen.
    return {
      status: HttpStatus.UNAUTHORIZED,
      type: AUTH_ERROR_TYPE.UNAUTHENTICATED,
      title: "Nicht angemeldet",
      detail: "Die Sitzung ist ungültig oder abgelaufen. Bitte neu anmelden.",
    };
  }
  if (exception instanceof SessionRejectedError) {
    if (exception.code === "AUTH_SERVER_UNAVAILABLE") {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        type: AUTH_ERROR_TYPE.AUTH_SERVER_UNAVAILABLE,
        title: "Anmeldedienst nicht erreichbar",
        detail: "Die Sitzung konnte nicht geprüft werden. Bitte später erneut versuchen.",
      };
    }
    return {
      status: HttpStatus.UNAUTHORIZED,
      type: AUTH_ERROR_TYPE.UNAUTHENTICATED,
      title: "Nicht angemeldet",
      detail: "Die Sitzung wurde beendet. Bitte neu anmelden.",
    };
  }
  return null;
}

/**
 * Faengt AUSSCHLIESSLICH die drei Fehlerklassen der Identitaetskette.
 *
 * Alles andere — auch `HttpException` aus den Controllern — laeuft weiter zum
 * globalen `HttpExceptionFilter`. Ein `@Catch()` ohne Argumente haette hier
 * die fachlichen 400/403/409 mitgeschluckt und ihnen den falschen URN gegeben.
 */
@Catch(IdentityRejectedError, TokenRejectedError, SessionRejectedError)
export class AuthProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const problem = problemOf(exception) ?? {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      type: "about:blank",
      title: STATUS_CODES[HttpStatus.INTERNAL_SERVER_ERROR] ?? "Error",
      detail: "Unerwarteter Fehler.",
    };

    res.status(problem.status).json({
      type: problem.type,
      title: problem.title,
      status: problem.status,
      detail: problem.detail,
      correlationId: (req as Partial<RequestWithCorrelationId>).correlationId ?? "unknown",
    });
  }
}
