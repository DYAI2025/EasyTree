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
export type { PlanningQueriesFactory } from "./application/planning-queries.factory";
export { PLANNING_QUERIES_FACTORY } from "./application/planning-queries.factory";
export { PlanningWindowRepository } from "./infrastructure/planning-window.repository";
export { PlanningController } from "./interface/http/planning.controller";
export type { PlanningAccessPolicy } from "./application/planning-access.port";
export { DenyAllPlanningAccess, PLANNING_ACCESS_POLICY } from "./application/planning-access.port";
