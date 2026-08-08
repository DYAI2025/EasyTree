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
  newIdempotencyKey,
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
  IsoWeekKeySchema,
  PlanningResourceSchema,
  PlanningResourcesSchema,
  PlanningWindowQuerySchema,
  PlanningWindowSchema,
  SourceVersionSchema,
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
  PlanningResource,
  PlanningResources,
  PlanningWindow,
  PlanningWindowQuery,
  SourceVersion,
  PublishPlanCommand,
  PublishedPlanVersion,
  TimeIntervalDto,
  ValidatePlanCommand,
} from "./planning/schemas.js";
export type { PlanningGateway } from "./planning/gateway.js";

// ISO-Wochenschluessel mit Kalenderrechnung (EYT-88). Exportiert, weil sowohl
// spaetere Command-Grenzen als auch der Paritaetstest gegen `@easytree/domain`
// dieselbe Funktion verwenden muessen — eine zweite Wochenregel waere genau der
// Fehler, den EYT-88 behebt.
export {
  ISO_WEEK_KEY_PROBLEMS,
  formatIsoWeekKey,
  isValidIsoWeekKey,
  isoWochenImJahr,
  parseIsoWeekKey,
} from "./planning/iso-week.js";
export type { IsoWeek, IsoWeekKeyProblem, IsoWeekKeyResult } from "./planning/iso-week.js";

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

/**
 * Basispfad der Fach-API — die EINE Quelle.
 *
 * Er steht in `servers[0].url` des erzeugten Dokuments und muss deshalb
 * dieselbe Zeichenkette sein, die Server und Client verwenden. Eine zweite,
 * frei gepflegte Kopie war genau die Falle, aus der `/api/v1` serverseitig
 * ueberhaupt nicht existierte, ohne dass etwas rot wurde.
 */
export { API_BASE_PATH, API_PATH_VERSION } from "./api-metadata.js";

export { HttpPlanningGateway } from "./http/planning-gateway.js";
export type { FetchLike, HttpPlanningGatewayOptions } from "./http/planning-gateway.js";

// EYT-106: Anmeldung. Tokens reisen in keinem dieser Typen — nur in
// HttpOnly-Cookies, die der Browser traegt und der Server setzt.
export {
  LoginCommandSchema,
  MEMBERSHIP_ROLES,
  MembershipRoleSchema,
  SessionDtoSchema,
  SessionOrganisationSchema,
} from "./auth/schemas.js";
export type {
  LoginCommand,
  MembershipRole,
  SessionDto,
  SessionOrganisation,
} from "./auth/schemas.js";
export type { AuthGateway } from "./auth/gateway.js";
export { HttpAuthGateway } from "./http/auth-gateway.js";
export type { HttpAuthGatewayOptions } from "./http/auth-gateway.js";

// EYT-108 ff.: Kostenbereich. Betraege reisen als Minor-Unit-String, nie Float;
// Versionen sind unveraenderlich, es gibt kein Update-Kommando.
//
// Achtung auf zwei aehnliche Namen: `PublishedPlanVersionSchema` (Planung, oben)
// ist die ANTWORT auf ein Veroeffentlichungskommando mit ihren Einsatz-Ids;
// `PublishedPlanVersionDtoSchema` hier ist der duenne Eintrag der Auswahlliste
// von `/kosten` (EYT-109).
export {
  BusinessDateSchema,
  CostDayTotalSchema,
  CostPositionDtoSchema,
  CostSnapshotSchema,
  CreateCostSnapshotCommandSchema,
  CreateRateVersionCommandSchema,
  EmployeeForRatesDtoSchema,
  EmployeesForRatesSchema,
  MinorUnitsSchema,
  PublishedPlanVersionDtoSchema,
  PublishedPlanVersionsSchema,
  RATE_VERSION_STATUS,
  RateHistorySchema,
  RateVersionDtoSchema,
  RateVersionStatusSchema,
} from "./costs/schemas.js";
export type {
  CostDayTotal,
  CostPositionDto,
  CostSnapshot,
  CreateCostSnapshotCommand,
  CreateRateVersionCommand,
  EmployeeForRatesDto,
  EmployeesForRates,
  PublishedPlanVersionDto,
  PublishedPlanVersions,
  RateHistory,
  RateVersionDto,
  RateVersionStatus,
} from "./costs/schemas.js";
export type { CostsGateway } from "./costs/gateway.js";
export { HttpCostsGateway, ORGANISATION_HEADER } from "./http/costs-gateway.js";
export type { HttpCostsGatewayOptions } from "./http/costs-gateway.js";

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
