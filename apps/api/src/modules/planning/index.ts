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
