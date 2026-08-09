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
 * ## Warum die versionsgenaue Methode nicht das Wochenfenster benutzt
 *
 * `planningWindow(weekKey)` liefert den BEARBEITBAREN Stand und bevorzugt dafuer
 * den Entwurf. Ein Snapshot darauf uebernaehme unveroeffentlichte Zuweisungen,
 * fror sie unveraenderlich ein, und der spaetere Export (EYT-110) saehe
 * revisionssicher aus, ohne es zu sein. Deshalb adressiert
 * `publishedFactsForVersion` die Version — der Test
 * `test/costs/planning-facts.adapter.test.ts` laesst das Wochenfenster im
 * gestellten Port WERFEN, damit ein Rueckfall auffliegt statt gruen zu bleiben.
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

import type { AssignmentRow, PlanningQueries, PublishedAssignmentsRow } from "../../planning";
import type {
  PlanCostFactsPort,
  PlanCostFactsResult,
  PublishedVersionsListResult,
} from "../application/plan-cost-facts.port";
import type { PlannedWorkFact, PublishedPlanFacts } from "../domain/planned-work-fact";

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

/**
 * Bezeichnungen einer Ressourcenliste, nach Id.
 *
 * Der Parameter ist STRUKTURELL getippt und nicht als `ResourceRow`: diesen
 * Namen exportiert `planning/index.ts` nicht, und ein Tiefimport nach
 * `planning/application/` faellt am Waechter
 * `costs-cross-module-public-api-only`. Das ist keine Umgehung, sondern die
 * Grenze: die Planung garantiert die Zeilenform nur dort, wo sie sie auch
 * benennt.
 */
function bezeichnungen(
  zeilen: readonly { readonly id: string; readonly label: string }[],
): ReadonlyMap<string, string> {
  return new Map(zeilen.map((zeile) => [zeile.id, zeile.label]));
}

/** Der veroeffentlichte Stand der Planung als Faktenlage des Kostenmoduls. */
function planfakten(row: PublishedAssignmentsRow): PublishedPlanFacts {
  return {
    planVersionId: unsafeIdentifier<PlanVersionId>(row.planVersionId),
    weekKey: row.weekKey,
    timeZone: row.timeZone,
    publishedAt: row.publishedAt,
    work: row.assignments.map(planfakt),
    employeeLabels: bezeichnungen(row.resources.employees),
    worksiteLabels: bezeichnungen(row.resources.worksites),
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

    // Der zweite, versionsgenaue Lesevorgang ist kein Umweg (EYT-109, Task 8):
    // `planningWindow` fuehrt weder `publishedAt` noch die Bezeichnungen in
    // einer Form, die dieser Vertrag verlangt. Einen Zeitpunkt hier zu setzen
    // waere eine erfundene Tatsache. Die Wochenlogik darueber entscheidet
    // unveraendert, OB und WELCHE Version — die Semantik dieser Methode aendert
    // sich dadurch nicht.
    return this.publishedFactsForVersion(quelle.id);
  }

  async publishedFactsForVersion(planVersionId: string): Promise<PlanCostFactsResult> {
    const gelesen = await this.planning.publishedAssignments(planVersionId);
    // Vier Gruende, unveraendert durchgereicht: `PublishedReadProblem` ist eine
    // echte Teilmenge von `PlanCostFactsProblem`. Kein Cast — ein `as` haette
    // hier genau die Pruefung entfernt, die diese Zeile wertvoll macht.
    if (!gelesen.ok) return { ok: false, problem: gelesen.problem };

    return { ok: true, facts: planfakten(gelesen.published) };
  }

  async publishedVersions(
    fromWeekKey: string,
    toWeekKey: string,
  ): Promise<PublishedVersionsListResult> {
    const gelesen = await this.planning.publishedVersions(fromWeekKey, toWeekKey);
    if (!gelesen.ok) return { ok: false, problem: gelesen.problem };

    // Reihenfolge unveraendert. Ein `sort()` hier waere eine zweite, stille
    // Ordnung neben der der Planung — und der Test aus Task 7 bewiese die
    // tatsaechlich wirksame nicht mehr.
    return {
      ok: true,
      versions: gelesen.versions.map((zeile) => ({
        planVersionId: unsafeIdentifier<PlanVersionId>(zeile.id),
        weekKey: zeile.weekKey,
        publishedAt: zeile.publishedAt,
      })),
    };
  }
}
