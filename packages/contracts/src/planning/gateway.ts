/**
 * Planer-Port (EYT-79).
 *
 * Ausschliesslich Transporttypen — siehe Kopf von `schemas.ts` und `gateway.ts`.
 */
import type { GatewayResult } from "../gateway.js";
import type { IdempotencyKey } from "../primitives.js";
import type {
  AssignmentDto,
  CreateAssignmentCommand,
  PlanValidationResult,
  PlanningWindow,
  PlanningWindowQuery,
  PublishPlanCommand,
  PublishedPlanVersion,
  ValidatePlanCommand,
} from "./schemas.js";

/**
 * Der Idempotenzschluessel eines schreibenden Aufrufs.
 *
 * PFLICHTFELD, und das ist der ganze Punkt. Ein optionaler Schluessel haette
 * einen Standardweg gehabt — "wenn keiner da ist, erzeuge einen" — und genau
 * dieser Standardweg ist der Fehler: er erzeugt bei JEDEM Aufruf einen neuen,
 * also auch bei der Wiederholung nach einer verlorenen Antwort. Der Server
 * saehe zwei Vorgaenge, und der Doppeleffekt traete genau dann ein, wenn der
 * Schluessel ihn verhindern sollte.
 *
 * Weil der Aufrufer ihn liefern MUSS, hat er die Lebensdauer des fachlichen
 * Vorgangs: `newIdempotencyKey()` einmal beim Start des Vorgangs, danach
 * unveraendert ueber jeden Wiederholungsversuch.
 */
export interface WriteOptions {
  readonly idempotencyKey: IdempotencyKey;
}

export interface PlanningGateway {
  getPlanningWindow(input: PlanningWindowQuery): Promise<GatewayResult<PlanningWindow>>;
  /** Prueft ohne Schreibwirkung — deshalb ohne Schluessel: es entsteht nichts. */
  validateDraft(input: ValidatePlanCommand): Promise<GatewayResult<PlanValidationResult>>;
  createAssignment(
    input: CreateAssignmentCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<AssignmentDto>>;
  publishPlan(
    input: PublishPlanCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<PublishedPlanVersion>>;
}
