/**
 * Oeffentliche API von `@easytree/contracts` (EYT-47, EYT-79, ADR-002 §5).
 *
 * Dieses Paket ist **transport-only**. Es fuehrt `@easytree/domain` bewusst
 * weder als Abhaengigkeit noch als Import: `TimeInterval` ist eine Klasse mit
 * privaten Feldern und die Bezeichner sind nominal gebrandet, also kann keiner
 * von beiden ueber die Leitung. Die Umwandlung DTO <-> Domain gehoert an die
 * HTTP-Naht in `apps/api` und kommt mit EYT-50. Der Architekturtest erzwingt die
 * Trennung.
 */
export {
  IDEMPOTENCY_HEADER,
  IdSchema,
  IdempotencyKeySchema,
  INSTANT_PATTERN,
  InstantSchema,
  ProblemDocumentSchema,
  cursorPage,
} from "./primitives.js";
export type { IdempotencyKey, Instant, ProblemDocument } from "./primitives.js";

export { GATEWAY_FAILURES, gatewayFailed, gatewayOk } from "./gateway.js";
export type { GatewayFailure, GatewayResult } from "./gateway.js";

export {
  AssignmentDtoSchema,
  CONFLICT_CODE_VALUES,
  ConflictCodeSchema,
  CreateAssignmentCommandSchema,
  PlanValidationResultSchema,
  PlanningConflictDtoSchema,
  PlanningWindowQuerySchema,
  PlanningWindowSchema,
  PublishPlanCommandSchema,
  PublishedPlanVersionSchema,
  TimeIntervalDtoSchema,
  ValidatePlanCommandSchema,
} from "./planning/schemas.js";
export type {
  AssignmentDto,
  CreateAssignmentCommand,
  PlanValidationResult,
  PlanningConflictDto,
  PlanningWindow,
  PlanningWindowQuery,
  PublishPlanCommand,
  PublishedPlanVersion,
  TimeIntervalDto,
  ValidatePlanCommand,
} from "./planning/schemas.js";
export type { PlanningGateway } from "./planning/gateway.js";

export {
  ActiveTimeEntrySchema,
  ConfirmPlanCommandSchema,
  ConfirmationSchema,
  EmployeeScheduleSchema,
  MyScheduleQuerySchema,
  RejectAssignmentCommandSchema,
  RejectionSchema,
  StartTimeCommandSchema,
  StopTimeCommandSchema,
  SubmittedTimeEntrySchema,
} from "./employee/schemas.js";
export type {
  ActiveTimeEntry,
  ConfirmPlanCommand,
  Confirmation,
  EmployeeSchedule,
  MyScheduleQuery,
  RejectAssignmentCommand,
  Rejection,
  StartTimeCommand,
  StopTimeCommand,
  SubmittedTimeEntry,
} from "./employee/schemas.js";
export type { EmployeeGateway } from "./employee/gateway.js";

export { HttpPlanningGateway } from "./http/planning-gateway.js";
export type { FetchLike, HttpPlanningGatewayOptions } from "./http/planning-gateway.js";

/**
 * Der Mock ist ABSICHTLICH nicht Teil der oeffentlichen Oberflaeche (EYT-50).
 *
 * Bis hierher stand `MockPlanningGateway` hier — folgenlos, weil niemand
 * `@easytree/contracts` benutzte. Mit dem Anschluss von `apps/web` an den
 * Vertrag waere daraus ein Mock im Produktionsbuendel geworden: importierbar
 * aus der Hauptdatei, in der Browserauslieferung, einen Tippfehler von der
 * echten Implementierung entfernt. Genau die Verwechslung, die EYT-50 AK10
 * ausschliessen soll ("kein Mock- oder LocalStorage-State ist operative
 * Wahrheit").
 *
 * Tests importieren ihn weiter direkt ueber `src/mock/planning.js` — der
 * einzige bestehende Nutzer tat das ohnehin schon
 * (`test/planning-gateway.contract.test.ts`).
 *
 * `test/public-surface.test.ts` haelt das fest, statt es der Sorgfalt zu
 * ueberlassen.
 */
