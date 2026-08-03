/**
 * Fehlerantworten der Planung mit stabilem, maschinenlesbarem Code (EYT-92).
 *
 * ## Warum ein eigener Filter
 *
 * `HttpExceptionFilter` setzt `type` fest auf `about:blank` und leitet `title`
 * aus dem Statuscode ab. Das ist fuer generische Fehler richtig — aber vier
 * Ablehnungen des Schreibpfads sind FACHLICH verschieden und teilen sich
 * teilweise denselben Status: „Ressource nicht auswaehlbar" und „Einsatz
 * ausserhalb der Woche" sind beide 400. Ein Client, der sie unterscheiden
 * will, muesste sonst den deutschen Meldungstext parsen — und der ist
 * Darstellung, keine Schnittstelle.
 *
 * Der Filter haengt per `@UseFilters` am Planungscontroller und hat damit
 * Vorrang vor dem globalen. Er ersetzt ihn NICHT: alles, was hier keinen
 * Planungscode traegt, wird exakt wie zuvor behandelt.
 *
 * ## Was er nicht tut
 *
 * Er gibt weder Stacktraces noch unerwartete Fehlermeldungen heraus. Ein
 * Fehler ohne `type` aus {@link PLANNING_ERROR_TYPE} bekommt dieselbe generische
 * Behandlung wie im globalen Filter — die Ursache koennte Verbindungsdaten
 * oder Schluessel enthalten.
 */
import { Catch, HttpException, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { STATUS_CODES } from "node:http";

/**
 * Die stabilen Fehlercodes des Planungs-Schreibpfads.
 *
 * URN statt HTTP-URL: ein Link muesste aufloesbar sein, und eine Dokumentseite,
 * die es nicht gibt, ist ein gebrochenes Versprechen im Fehlerobjekt.
 *
 * Diese Werte sind Teil des Vertrags. Sie umzubenennen ist eine
 * Vertragsaenderung, kein Refactoring.
 */
export const PLANNING_ERROR_TYPE = {
  OVERLAPPING_ASSIGNMENT: "urn:easytree:planning:overlapping-assignment",
  RESOURCE_NOT_SELECTABLE: "urn:easytree:planning:resource-not-selectable",
  OUTSIDE_WEEK: "urn:easytree:planning:outside-week",
  INVALID_INTERVAL: "urn:easytree:planning:invalid-interval",
  NO_ORGANISATION: "urn:easytree:planning:no-organisation",
  AMBIGUOUS_ORGANISATION: "urn:easytree:planning:ambiguous-organisation",
  MISSING_IDEMPOTENCY_KEY: "urn:easytree:planning:missing-idempotency-key",
  IDEMPOTENCY_KEY_REUSED: "urn:easytree:planning:idempotency-key-reused",
  // ---------------------------------------------------------------------
  // Veroeffentlichen (EYT-107)
  // ---------------------------------------------------------------------
  // Alle vier sind HTTP 409 — und genau deshalb brauchen sie eigene Codes.
  // `HttpPlanningGateway` bildet 409 fuer `publishPlan` pauschal auf
  // `STALE_VERSION` ab (conflictAs). Ohne diese Typen koennte die Oberflaeche
  // „veraltet", „schon veroeffentlicht", „blockierender Konflikt" und
  // „Zuweisung in der falschen Woche" nicht auseinanderhalten und muesste
  // dem deutschen Meldungstext glauben — der ist Darstellung, keine
  // Schnittstelle.
  STALE_VERSION: "urn:easytree:planning:stale-version",
  ALREADY_PUBLISHED: "urn:easytree:planning:already-published",
  BLOCKING_CONFLICT: "urn:easytree:planning:blocking-conflict",
  ASSIGNMENT_OUTSIDE_WEEK: "urn:easytree:planning:assignment-outside-week",
} as const;

export type PlanningErrorType = (typeof PLANNING_ERROR_TYPE)[keyof typeof PLANNING_ERROR_TYPE];

const BEKANNTE_TYPEN = new Set<string>(Object.values(PLANNING_ERROR_TYPE));

const GENERIC_DETAIL = "An unexpected error occurred.";

interface RequestMitKorrelation extends Request {
  readonly correlationId?: string;
}

interface Planungsfehler {
  readonly type: string;
  readonly title: string;
  readonly detail: string;
}

/** Traegt die Ausnahme einen der bekannten Planungscodes? Sonst: generisch. */
function planungsfehler(exception: HttpException): Planungsfehler | null {
  const response = exception.getResponse();
  if (typeof response !== "object" || response === null) return null;
  const kandidat = response as Partial<Planungsfehler>;
  if (typeof kandidat.type !== "string" || !BEKANNTE_TYPEN.has(kandidat.type)) return null;
  if (typeof kandidat.title !== "string" || typeof kandidat.detail !== "string") return null;
  return { type: kandidat.type, title: kandidat.title, detail: kandidat.detail };
}

/** Sichere Meldung fuer alles ohne Planungscode — identisch zum globalen Filter. */
function generischesDetail(exception: HttpException): string {
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
export class PlanningProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestMitKorrelation>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const fachlich = isHttp ? planungsfehler(exception) : null;

    res.status(status).json({
      type: fachlich?.type ?? "about:blank",
      title: fachlich?.title ?? STATUS_CODES[status] ?? "Error",
      status,
      detail: fachlich?.detail ?? (isHttp ? generischesDetail(exception) : GENERIC_DETAIL),
      correlationId: req.correlationId ?? "unknown",
    });
  }
}
