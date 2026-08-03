/**
 * Fachliche Planungsberechtigung (EYT-50, umgebaut in EYT-107).
 *
 * ## Was sich mit EYT-107 geaendert hat, und warum
 *
 * Die erste Fassung fragte `mayReadPlanning(subjectUserId)` und
 * `mayWritePlanning(subjectUserId)` — zwei boolesche Fragen an eine Nutzer-Id.
 * Produktionsstand war `DenyAllPlanningAccess`, weil es kein Rollenmodell gab.
 *
 * Inzwischen gibt es eines: `role_permissions` (Migration 0013, erweitert um
 * `planning.*` in 0015) bildet Rollen auf atomare Rechte ab, und die
 * Kostenroute nutzt es seit EYT-106 produktiv. Eine zweite, parallele
 * Berechtigungsform daneben stehen zu lassen waere genau die „doppelte
 * Auth-Wahrheit", die EYT-107 aufloest.
 *
 * Der Port hat deshalb dieselbe Form wie `CostAccessPolicy`:
 * Organisation aufloesen UND Recht pruefen, in dieser Reihenfolge.
 *
 * ## Warum die Mitgliedschaften HEREINGEREICHT werden
 *
 * Der Port bekommt sie als Parameter, statt sie selbst zu laden. Damit bleibt
 * die sicherheitsrelevante Ja/Nein-Entscheidung rein und synchron und ist ohne
 * Datenbank pruefbar — dieselbe Bauart wie `assertRoleCannotBypassRls` beim
 * Startgate. Geladen werden sie vom Controller ueber
 * `SESSION_ORGANISATIONS`, also serverseitig unter RLS.
 *
 * ## Warum `PlanningMembership` hier eigenstaendig steht
 *
 * `MembershipWithPermissions` im Kostenmodul hat dieselbe Form. Sie von dort
 * zu importieren waere ein modulaeberquerender Import fuer eine Struktur aus
 * zwei Feldern — die Kopplung waere teurer als die Wiederholung, und
 * ADR-001 Z. 76 laesst Modulzugriffe nur ueber `index.ts` zu. Beide Typen
 * beschreiben dieselbe Zeile aus `memberships` x `role_permissions`; wandert
 * sie eines Tages in einen Plattformport, verschwinden beide zugleich.
 */

/**
 * Die drei atomaren Rechte der Planung. Keine Sammelrolle, kein „admin".
 *
 * `planning.publish` ist ausdruecklich NICHT durch `planning.write` impliziert
 * (Product-Owner-Entscheidung 03.08.2026): wer einen Entwurf bearbeiten darf,
 * darf ihn deshalb nicht automatisch verbindlich machen. Genau diese Trennung
 * ist der Zweck des dritten Eintrags — und sie hat einen eigenen Testfall,
 * weil sie sonst eine Behauptung waere.
 */
export const PLANNING_PERMISSIONS = [
  "planning.read",
  "planning.write",
  "planning.publish",
] as const;

export type PlanningPermission = (typeof PLANNING_PERMISSIONS)[number];

export const PLANNING_ACCESS_PROBLEMS = [
  /** Keine oder mehrere aktive Organisationen und keine sichtbare Auswahl. */
  "ORG_CONTEXT_REQUIRED",
  /** Die gewaehlte Organisation existiert nicht ODER das Subjekt gehoert nicht dazu. */
  "ORG_NOT_A_MEMBER",
  /** Mitglied, aber die Rolle traegt das verlangte Recht nicht. */
  "PERMISSION_MISSING",
] as const;

export type PlanningAccessProblem = (typeof PLANNING_ACCESS_PROBLEMS)[number];

export type PlanningAccessResult =
  | { readonly ok: true; readonly organisationId: string }
  | { readonly ok: false; readonly problem: PlanningAccessProblem };

/** Eine Organisation, in der das Subjekt aktiv Mitglied ist, samt Rechten. */
export interface PlanningMembership {
  readonly organisationId: string;
  readonly permissions: readonly string[];
}

export interface PlanningAccessPolicy {
  /**
   * Loest die Organisation auf UND prueft das Recht — in dieser Reihenfolge,
   * weil ein Recht ohne Organisationsbezug bedeutungslos ist und weil die
   * umgekehrte Reihenfolge einem Fremden verriete, welche Rechte es gibt.
   *
   * `requestedOrganisationId` ist der Wunsch des Aufrufers, oder `null`. Er
   * WAEHLT aus; er autorisiert nichts.
   */
  authorize(
    memberships: readonly PlanningMembership[],
    requestedOrganisationId: string | null,
    permission: PlanningPermission,
  ): PlanningAccessResult;
}

export const PLANNING_ACCESS_POLICY = "PLANNING_ACCESS_POLICY";
