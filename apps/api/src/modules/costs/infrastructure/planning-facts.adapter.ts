/**
 * Adapter: veroeffentlichte Planfakten aus der oeffentlichen
 * Planning-Application-API (EYT-105, REQ-001, ADR-003).
 *
 * ## Warum der Adapter in `infrastructure/` liegt und nicht in `application/`
 *
 * Die Anwendungsschicht des Kostenmoduls kennt ausschliesslich ihren eigenen
 * Port {@link PlanCostFactsPort}. Die Kenntnis, dass die Fakten heute aus dem
 * Planungsmodul kommen, ist eine Fremdsystemkenntnis und gehoert deshalb nach
 * aussen. Laege sie in `application/`, waere die Reihenfolge umgekehrt: eine
 * Aenderung an der Planung reichte bis in den Use Case.
 *
 * ## Warum hier kein SQL steht
 *
 * `select … from public.assignments` waere kuerzer und ist genau der Fehler,
 * den EYT-105 verhindert: das Kostenmodul liest UND schreibt nur eigene
 * Tabellen (Regel `costs-touches-only-own-tables`), modulfremde Planfakten
 * kommen ueber die oeffentliche Application-API. Diese Datei enthaelt deshalb
 * bewusst keine einzige SQL-Zeile — die Transaktions-, Rollen- und
 * RLS-Verantwortung bleibt vollstaendig beim Planungsrepository und dem
 * `TenantQueryRunner` dahinter (EYT-45).
 *
 * ## Verdrahtung
 *
 * Bewusst NICHT in `AppModule` registriert. Das Kostenmodul ist heute eine
 * Grenze, kein laufendes Feature: es gibt keine Route (EYT-109) und keine
 * Autorisierung (EYT-106). Eine Verdrahtung ohne beides waere eine Zusage, die
 * kein Test einloest. Wenn sie kommt, folgt sie dem Factory-Muster der Planung
 * — ein Adapter je Subjekt, nie ein Singleton, das die Identitaet der ersten
 * Anfrage weiterreicht.
 */
import type { AssignmentId, EmployeeId, PlanVersionId, WorksiteId } from "@easytree/domain";
import { unsafeIdentifier } from "@easytree/domain";

import type { AssignmentRow, PlanningQueries } from "../../planning";
import type { PlanCostFactsPort, PlanCostFactsResult } from "../application/plan-cost-facts.port";
import type { PlannedWorkFact } from "../domain/planned-work-fact";

/**
 * Abbildung einer Planungszeile auf einen Kostenfakt.
 *
 * `unsafeIdentifier` ist hier die dokumentierte Stelle im Sinne seines eigenen
 * Kommentars: die Werte stammen aus Datenbankspalten, die Herkunft ist belegt.
 */
function planfakt(row: AssignmentRow): PlannedWorkFact {
  return {
    assignmentId: unsafeIdentifier<AssignmentId>(row.id),
    employeeId: unsafeIdentifier<EmployeeId>(row.employeeId),
    worksiteId: unsafeIdentifier<WorksiteId>(row.worksiteId),
    startsAtUtc: row.startsAtUtc,
    endsAtUtc: row.endsAtUtc,
  };
}

export class PlanningFactsAdapter implements PlanCostFactsPort {
  constructor(private readonly planning: PlanningQueries) {}

  async publishedFacts(weekKey: string): Promise<PlanCostFactsResult> {
    const gelesen = await this.planning.planningWindow(weekKey);
    // Die Ablehnungsgruende der Planung sind eine echte Teilmenge der eigenen.
    // Kommt dort einer hinzu, scheitert genau diese Zeile im typecheck — das
    // ist gewollt: ein neuer Grund braucht eine Entscheidung im Kostenmodul
    // und einen Fehlercode an der HTTP-Naht, kein stilles Durchreichen.
    if (!gelesen.ok) return { ok: false, problem: gelesen.problem };

    const quelle = gelesen.window.sourceVersion;
    // Kosten entstehen ausschliesslich aus einer veroeffentlichten Planversion
    // (FMC-001). Der Leseport liefert bewusst auch den Entwurf, weil die
    // Planungsoberflaeche ihn braucht — hier ist er kein gueltiger Ursprung.
    if (quelle === null || quelle.state !== "published") {
      return { ok: false, problem: "PLAN_NOT_PUBLISHED" };
    }

    return {
      ok: true,
      facts: {
        planVersionId: unsafeIdentifier<PlanVersionId>(quelle.id),
        weekKey: gelesen.window.weekKey,
        timeZone: gelesen.window.timeZone,
        work: gelesen.window.assignments.map(planfakt),
      },
    };
  }
}
