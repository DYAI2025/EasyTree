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

export { MockPlanningGateway } from "./mock/planning.js";
export type { MockPlanningState } from "./mock/planning.js";
