import type { AssignmentId, EmployeeId, OrgId, WorksiteId } from "@easytree/domain";

/**
 * Entwurf einer Einsatzzuweisung (EYT-46).
 *
 * Bewusst NICHT die veröffentlichte Zuweisung: Entwurf und veröffentlichte
 * Version sind getrennt (EYT-18). Zeitintervall und Kapazitätsregel folgen mit
 * EYT-73/EYT-74 in `@easytree/domain` — dieser Typ nimmt sie dann auf, statt
 * eigene Zeitlogik zu erfinden.
 */
export interface AssignmentDraft {
  readonly id: AssignmentId;
  readonly orgId: OrgId;
  readonly employeeId: EmployeeId;
  readonly worksiteId: WorksiteId;
}

/**
 * Stabile Konfliktcodes. Der Code ist Teil des API-Vertrags (EYT-47) und darf
 * sich nicht mit der Formulierung der Meldung ändern.
 */
export const CONFLICT_CODES = [
  "EMPLOYEE_INTERVAL_OVERLAP",
  "RESOURCE_DOUBLE_BOOKED",
  "EMPLOYEE_INACTIVE",
  "WORKSITE_NOT_PUBLISHABLE",
] as const;

export type ConflictCode = (typeof CONFLICT_CODES)[number];

/** Ein Konflikt blockiert die Veröffentlichung; eine Warnung tut es nicht (EYT-74). */
export interface PlanningConflict {
  readonly code: ConflictCode;
  readonly blocking: boolean;
}
