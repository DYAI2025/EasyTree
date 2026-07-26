import type { AssignmentId, PlanVersionId } from "@easytree/domain";

import type { AssignmentDraft, PlanningConflict } from "../domain/assignment-draft";

/**
 * Öffentlicher Anwendungs-Port des Planungsmoduls (EYT-46, ADR-001 Z. 76).
 *
 * Modulübergreifende Aufrufe gehen ausschliesslich hierüber — nie über
 * `domain/` oder `infrastructure/`. Die Implementierung (Kysely-Repository,
 * Transaktionsgrenze) kommt mit EYT-45/EYT-50.
 */
export interface PlanningCommands {
  /** Legt einen Entwurf an und gibt die gefundenen Konflikte zurück. */
  createAssignmentDraft(draft: AssignmentDraft): Promise<readonly PlanningConflict[]>;

  /**
   * Veröffentlicht atomar eine neue Planversion. Schlägt fehl, solange ein
   * blockierender Konflikt offen ist — fail-closed (EYT-73).
   */
  publishPlan(input: { readonly assignmentIds: readonly AssignmentId[] }): Promise<PlanVersionId>;
}
