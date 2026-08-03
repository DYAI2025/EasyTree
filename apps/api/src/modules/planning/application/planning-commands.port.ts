import type { AssignmentDraft, PlanningConflict } from "../domain/assignment-draft";

/**
 * Öffentlicher Anwendungs-Port des Planungsmoduls (EYT-46, ADR-001 Z. 76).
 *
 * Modulübergreifende Aufrufe gehen ausschliesslich hierüber — nie über
 * `domain/` oder `infrastructure/`.
 *
 * ## Warum `publishPlan` hier NICHT mehr steht (EYT-107)
 *
 * Diese Datei trug bis EYT-107 eine zweite `publishPlan`-Deklaration:
 * `(input: { assignmentIds }) => Promise<PlanVersionId>`. Sie hatte null
 * Implementierungen und widersprach dem Transportvertrag, der die Woche und
 * die erwartete Versions-Id fuehrt (`PublishPlanCommandSchema`), nicht eine
 * Liste von Zuweisungen.
 *
 * Zwei Deklarationen desselben Vorgangs sind schlimmer als keine: die naechste
 * Person haette die falsche implementiert und waere erst am
 * Konformitaetstest aufgelaufen. Der echte Schreibpfad liegt auf
 * `PlanningWrites` — dort, wo `createAssignment` schon liegt und wo die
 * Factory bereits verdrahtet ist.
 *
 * `createAssignmentDraft` bleibt vorerst stehen, hat aber ebenfalls keine
 * Implementierung; der Entwurfspfad laeuft ueber
 * `PlanningWrites.createAssignment` (EYT-92).
 */
export interface PlanningCommands {
  /** Legt einen Entwurf an und gibt die gefundenen Konflikte zurück. */
  createAssignmentDraft(draft: AssignmentDraft): Promise<readonly PlanningConflict[]>;
}
