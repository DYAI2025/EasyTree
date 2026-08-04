/**
 * Die reale Planungsautorisierung (EYT-107).
 *
 * Rein und synchron: die Ja/Nein-Frage ist der sicherheitsrelevante Teil und
 * muss ohne Datenbank pruefbar sein. Dieselbe Bauart wie
 * `MembershipCostAccessPolicy` — bewusst, denn zwei verschiedene Formen fuer
 * dieselbe Entscheidung waeren zwei Stellen, an denen man sie falsch treffen
 * kann.
 *
 * Diese Klasse ist die ANWENDUNGSSEITIGE Haelfte. Die Datenbank entscheidet
 * unabhaengig noch einmal (`app.has_permission` in der Update-Policy von
 * Migration 0015). Schaltet man diese Klasse auf „immer erlaubt", muss RLS
 * weiterhin ablehnen — sonst waere „unabhaengig" nur behauptet.
 */
import type {
  PlanningAccessPolicy,
  PlanningAccessResult,
  PlanningMembership,
  PlanningPermission,
} from "./planning-access.port";

export { PLANNING_PERMISSIONS } from "./planning-access.port";

export class MembershipPlanningAccessPolicy implements PlanningAccessPolicy {
  authorize(
    memberships: readonly PlanningMembership[],
    requestedOrganisationId: string | null,
    permission: PlanningPermission,
  ): PlanningAccessResult {
    if (requestedOrganisationId === null) {
      // Genau eine aktive Organisation ist eindeutig; alles andere waere
      // Raten. Bei mehreren muss die Auswahl sichtbar getroffen werden, bei
      // keiner gibt es nichts zu waehlen. Die stille Auswahl ist ausdruecklich
      // verboten (PO 03.08.2026) — sie waere aus Sicht der Planerin ein
      // veroeffentlichter Plan in der falschen Organisation.
      if (memberships.length !== 1) {
        return { ok: false, problem: "ORG_CONTEXT_REQUIRED" };
      }
      return this.pruefeRecht(memberships[0] as PlanningMembership, permission);
    }

    const gewaehlt = memberships.find(
      (mitgliedschaft) => mitgliedschaft.organisationId === requestedOrganisationId,
    );
    if (gewaehlt === undefined) {
      // Kein Existenzleck: die Antwort unterscheidet nicht zwischen „gibt es
      // nicht" und „du gehoerst nicht dazu". Sie faellt ausserdem VOR der
      // Rechtepruefung, damit ein Fremder nicht erfaehrt, welche Rechte es
      // ueberhaupt gibt.
      return { ok: false, problem: "ORG_NOT_A_MEMBER" };
    }
    return this.pruefeRecht(gewaehlt, permission);
  }

  private pruefeRecht(
    mitgliedschaft: PlanningMembership,
    permission: PlanningPermission,
  ): PlanningAccessResult {
    // Exakter Vergleich, kein Praefix. `costs.read` und `planning.read` liegen
    // in derselben Spalte `role_permissions.permission`; ein Praefixvergleich
    // liesse ein Kostenrecht als Planungsrecht gelten.
    if (!mitgliedschaft.permissions.includes(permission)) {
      return { ok: false, problem: "PERMISSION_MISSING" };
    }
    return { ok: true, organisationId: mitgliedschaft.organisationId };
  }
}
