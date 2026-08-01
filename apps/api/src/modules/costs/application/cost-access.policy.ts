/**
 * Serverseitige Kostenautorisierung (EYT-106 AK3/AK4).
 *
 * ## Warum eine eigene Schicht und nicht "der Controller fragt die Rolle"
 *
 * PO-Entscheidung 31.07.2026 woertlich: "Keine Rollenabfrage direkt in
 * Controllern." Ein Controller, der `if (rolle === "owner")` schreibt, verteilt
 * die Rechteregel auf so viele Stellen, wie es Routen gibt — und die elfte
 * vergisst sie. Hier steht sie EINMAL.
 *
 * ## Die zwei Haelften, die nichts voneinander wissen
 *
 * Diese Klasse ist die ANWENDUNGSSEITIGE Haelfte. Die Datenbank entscheidet
 * unabhaengig noch einmal (`app.has_cost_permission` in den RLS-Policies von
 * Migration 0013). Beide lesen dieselbe Zuordnung `role_permissions`, aber
 * keine verlaesst sich auf die andere: schaltet man diese Policy auf
 * "immer true", muss RLS weiterhin ablehnen — sonst waere "unabhaengig" nur
 * behauptet (AK4).
 *
 * ## Der Organisationsheader waehlt aus, er autorisiert nicht
 *
 * `X-EasyTree-Organization-Id` sagt nur, WELCHE Organisation gemeint ist.
 * Ob das Subjekt dort etwas darf, beantwortet ausschliesslich die
 * Mitgliedschaft — hier gelesen, nicht geglaubt.
 */

/** Die vier atomaren Rechte dieses Moduls. Keine Sammelrolle, kein "admin". */
export const COST_PERMISSIONS = [
  "costs.read",
  "costs.calculate",
  "costs.export",
  "costs.manage_rates",
] as const;
export type CostPermission = (typeof COST_PERMISSIONS)[number];

export const COST_ACCESS_PROBLEMS = [
  "ORG_CONTEXT_REQUIRED",
  "ORG_NOT_A_MEMBER",
  "PERMISSION_MISSING",
] as const;
export type CostAccessProblem = (typeof COST_ACCESS_PROBLEMS)[number];

export type CostAccessResult =
  | { readonly ok: true; readonly organisationId: string }
  | { readonly ok: false; readonly problem: CostAccessProblem };

/** Eine Organisation, in der das Subjekt aktiv Mitglied ist, samt Rechten. */
export interface MembershipWithPermissions {
  readonly organisationId: string;
  readonly permissions: readonly string[];
}

export interface CostAccessPolicy {
  /**
   * Loest die Organisation auf UND prueft das Recht — in dieser Reihenfolge,
   * weil ein Recht ohne Organisationsbezug bedeutungslos ist.
   *
   * `requestedOrganisationId` ist der Wunsch aus dem Header (oder null).
   */
  authorize(
    memberships: readonly MembershipWithPermissions[],
    requestedOrganisationId: string | null,
    permission: CostPermission,
  ): CostAccessResult;
}

/**
 * Die reale Umsetzung. Rein und synchron: die Ja/Nein-Frage ist der
 * sicherheitsrelevante Teil und muss ohne Datenbank pruefbar sein — dieselbe
 * Bauart wie `assertRoleCannotBypassRls` beim Startgate.
 */
export class MembershipCostAccessPolicy implements CostAccessPolicy {
  authorize(
    memberships: readonly MembershipWithPermissions[],
    requestedOrganisationId: string | null,
    permission: CostPermission,
  ): CostAccessResult {
    if (requestedOrganisationId === null) {
      // Genau eine aktive Organisation ist eindeutig; alles andere waere
      // Raten. Bei mehreren muss die Auswahl sichtbar getroffen werden
      // (PO: 400 ORG_CONTEXT_REQUIRED), bei keiner gibt es nichts zu waehlen.
      if (memberships.length !== 1) {
        return { ok: false, problem: "ORG_CONTEXT_REQUIRED" };
      }
      return this.pruefeRecht(memberships[0] as MembershipWithPermissions, permission);
    }

    const gewaehlt = memberships.find(
      (mitgliedschaft) => mitgliedschaft.organisationId === requestedOrganisationId,
    );
    if (gewaehlt === undefined) {
      // Der Header nennt eine Organisation, in der das Subjekt nicht aktiv
      // Mitglied ist. Kein Existenzleck: die Antwort unterscheidet nicht
      // zwischen "gibt es nicht" und "du gehoerst nicht dazu".
      return { ok: false, problem: "ORG_NOT_A_MEMBER" };
    }
    return this.pruefeRecht(gewaehlt, permission);
  }

  private pruefeRecht(
    mitgliedschaft: MembershipWithPermissions,
    permission: CostPermission,
  ): CostAccessResult {
    if (!mitgliedschaft.permissions.includes(permission)) {
      return { ok: false, problem: "PERMISSION_MISSING" };
    }
    return { ok: true, organisationId: mitgliedschaft.organisationId };
  }
}

export const COST_ACCESS_POLICY = "COSTS_ACCESS_POLICY";
