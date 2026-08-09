/**
 * Öffentliche API des Planungsmoduls (EYT-46, ADR-001 Z. 76).
 *
 * Nur benannte Re-Exporte. `export *` ist hier verboten und wird vom
 * Architekturtest abgelehnt: ein Stern-Re-Export würde das gesamte Domainmodell
 * über die Modulgrenze tragen und aus zehn Modulen ein globales Modell machen
 * (EYT-46 AK 5). Was hier steht, ist bewusst der Vertrag — nichts sonst.
 */
export type { PlanningCommands } from "./application/planning-commands.port";
export type { AssignmentDraft, ConflictCode, PlanningConflict } from "./domain/assignment-draft";
export { CONFLICT_CODES } from "./domain/assignment-draft";
export { conflictsWithExisting } from "./domain/assignment-draft";
export { validateDraft } from "./domain/draft-validation";

// EYT-50: Leseport, seine Fabrik und die HTTP-Naht. Nur ueber diese Datei —
// `module-public-api-only` (ADR-001 Z. 76) laesst modulfremde Importe
// ausschliesslich hier durch.
export type {
  AssignmentRow,
  PlanningQueries,
  PlanningQueryProblem,
  PlanningWindowResult,
  PlanningWindowRow,
  SourceVersionRow,
} from "./application/planning-queries.port";
export { PLANNING_QUERIES } from "./application/planning-queries.port";
// EYT-109: die beiden Leseoperationen fuer VEROEFFENTLICHTE Staende. Getrennt
// vom Block darueber, weil sie eine andere Frage beantworten als das Fenster:
// nicht „was ist bearbeitbar", sondern „was ist verbindlich".
//
// `PublishedVersionRow` heisst NICHT `PublishedPlanVersionRow`, obwohl der Plan
// diesen Namen vorschlug: der ist seit EYT-107 vom Schreibport belegt (siehe
// weiter unten in dieser Datei) und traegt dort eine andere Form. Zwei
// gleichnamige Typen aus derselben Moduldatei waere ein doppelter Export und
// kompilierte nicht.
export type {
  PublishedAssignmentsResult,
  PublishedAssignmentsRow,
  PublishedReadProblem,
  PublishedVersionRow,
  PublishedVersionsResult,
} from "./application/planning-queries.port";
export type { PlanningQueriesFactory } from "./application/planning-queries.factory";
export { PLANNING_QUERIES_FACTORY } from "./application/planning-queries.factory";
export { PlanningWindowRepository } from "./infrastructure/planning-window.repository";
export { PlanningController } from "./interface/http/planning.controller";
// EYT-107: die reale Autorisierung. `DenyAllPlanningAccess` ist ersatzlos
// entfallen — es war der Produktionsstand, solange es kein Rollenmodell gab.
// Seit Migration 0015 gibt es eines.
export type {
  PlanningAccessPolicy,
  PlanningAccessProblem,
  PlanningAccessResult,
  PlanningMembership,
  PlanningPermission,
} from "./application/planning-access.port";
export {
  PLANNING_ACCESS_POLICY,
  PLANNING_ACCESS_PROBLEMS,
  PLANNING_PERMISSIONS,
} from "./application/planning-access.port";
export { MembershipPlanningAccessPolicy } from "./application/membership-planning-access.policy";
export type {
  CreateAssignmentInput,
  CreateAssignmentResult,
  CreatedAssignmentRow,
  PlanningWriteProblem,
  PlanningWrites,
  PlanningWritesFactory,
  PublishPlanInput,
  PublishPlanResult,
  PublishedPlanVersionRow,
} from "./application/planning-writes.port";
export { PLANNING_WRITES_FACTORY } from "./application/planning-writes.port";
export { PlanningWriteRepository } from "./infrastructure/planning-write.repository";
export type {
  ValidateDraftInput,
  ValidateDraftResult,
  ValidatedConflict,
} from "./application/planning-writes.port";
export {
  PLANNING_ERROR_TYPE,
  PlanningProblemFilter,
} from "./interface/http/planning-problem.filter";
export type { PlanningErrorType } from "./interface/http/planning-problem.filter";
