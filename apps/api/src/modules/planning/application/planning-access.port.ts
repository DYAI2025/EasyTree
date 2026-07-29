/**
 * Fachliche Leseberechtigung fuer die Planung (EYT-50).
 *
 * `TenantSubjectResolver` beantwortet "WER ist das". Diese Frage ist eine
 * andere: "darf DIESE Person Planung lesen". Ohne die Trennung waere ein
 * verifiziertes Subjekt automatisch ein berechtigtes — und jede beschaeftigte
 * Person saehe die Wochenplanung ihrer Organisation.
 *
 * Produktionsstand ist DENY. Kein Rollenmodell, keine Claims, keine
 * Supabase-Strategie: die gehoeren zu EYT-14 und werden hier nicht
 * vorweggenommen. Tests ersetzen den Port per DI, wie `DATABASE_PING`.
 */
export interface PlanningAccessPolicy {
  mayReadPlanning(subjectUserId: string): Promise<boolean>;
  /**
   * Getrennt vom Lesen, weil beides verschieden schwer wiegt: eine Planerin
   * darf eine Woche lesen, ohne sie aendern zu duerfen. Ein gemeinsames Recht
   * haette die Schreibberechtigung stillschweigend an jede Lesefreigabe
   * gekoppelt (EYT-92).
   */
  mayWritePlanning(subjectUserId: string): Promise<boolean>;
}

export const PLANNING_ACCESS_POLICY = "PLANNING_ACCESS_POLICY";

/** Der Produktionsstand: niemand ist berechtigt, bis EYT-14 entscheidet. */
export class DenyAllPlanningAccess implements PlanningAccessPolicy {
  mayReadPlanning(subjectUserId: string): Promise<boolean> {
    // Das Subjekt wird bewusst NICHT ausgewertet. Eine Bedingung hier waere
    // ein vorweggenommenes Rollenmodell.
    void subjectUserId;
    return Promise.resolve(false);
  }

  mayWritePlanning(subjectUserId: string): Promise<boolean> {
    void subjectUserId;
    return Promise.resolve(false);
  }
}
