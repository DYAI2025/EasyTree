import { overlaps } from "@easytree/domain";
import type { AssignmentId, EmployeeId, OrgId, TimeInterval, WorksiteId } from "@easytree/domain";

/**
 * Entwurf einer Einsatzzuweisung (EYT-46, EYT-73).
 *
 * Bewusst NICHT die veröffentlichte Zuweisung: Entwurf und veröffentlichte
 * Version sind getrennt (EYT-18).
 *
 * `interval` ist ein {@link TimeInterval} und kein Paar roher Zeitwerte. Diesen
 * Typ erzeugt ausschliesslich `createTimeInterval`, also existiert kein Entwurf
 * ohne geprüftes Intervall — Pflichtfelder und Fail-closed-Publish (EYT-73)
 * sind damit eine Eigenschaft des Typs, keine Zusicherung im Reviewtext.
 */
export interface AssignmentDraft {
  readonly id: AssignmentId;
  readonly orgId: OrgId;
  readonly employeeId: EmployeeId;
  readonly worksiteId: WorksiteId;
  readonly interval: TimeInterval;
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

/**
 * Ueberschneidet sich der Entwurf mit einem bereits geplanten Einsatz derselben
 * Person? (EYT-73 AK 4: Dauer- und Ueberlappungspruefung nutzen dasselbe Modell.)
 *
 * Nutzt bewusst `overlaps` aus `@easytree/domain` statt einer eigenen
 * Vergleichslogik — die zweite Implementierung war im Prototyp die Ursache
 * dafuer, dass Dauer und Ueberlappung unterschiedliche Antworten gaben.
 * Halb-offen: ein Baustellenwechsel um 12:00 ist kein Konflikt.
 *
 * Die Datenbank sichert dieselbe Invariante nochmals unter Nebenlaeufigkeit ab
 * (EYT-49, Exclusion-Constraint) — diese Pruefung liefert die verstaendliche
 * Meldung, nicht die Garantie.
 */
export function conflictsWithExisting(
  draft: AssignmentDraft,
  existing: readonly AssignmentDraft[],
): boolean {
  return existing.some(
    (other) =>
      other.id !== draft.id &&
      other.employeeId === draft.employeeId &&
      overlaps(draft.interval, other.interval),
  );
}
