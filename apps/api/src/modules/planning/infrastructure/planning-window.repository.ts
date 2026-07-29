/**
 * Leserepository des Planungsfensters (EYT-50).
 *
 * ## Kein Treiber, nur `TenantQuery`
 *
 * Diese Datei importiert `pg` NICHT. `api-dependency-allowlist` (EYT-45)
 * erlaubt den Treiber ausschliesslich unter `apps/api/src/platform/` — und das
 * ist keine Formalie: ein Treiber im Fachmodul heisst, dass irgendwann jemand
 * eine Query an Transaktionsgrenze, Rollenwechsel und RLS vorbei absetzt.
 *
 * ## Keine Organisations-Id in einer Query
 *
 * Kein SQL hier nennt `org_id` in einer WHERE-Klausel. Die Mandantengrenze
 * kommt aus RLS, also aus `app.user_org_ids()` und damit aus dem verifizierten
 * Subjekt, das `PgTenantQueryRunner` transaktionslokal gesetzt hat. Eine
 * selbst gefilterte `org_id` waere eine zweite, schwaechere Grenze neben der
 * erzwungenen — und die schwaechere gewinnt immer dann, wenn jemand sie
 * vergisst.
 *
 * ## Keine Wochenberechnung
 *
 * `week_key` wird verglichen, nicht gerechnet. Die Umrechnung Woche -> UTC gibt
 * es im Repository nicht und soll es nicht geben (Entscheidungsnotiz
 * docs/decisions/2026-07-27-eyt-50-lesesemantik-planungsfenster.md, Punkt 1):
 * sie waere ein zweiter Ableitungspfad neben `packages/domain` und braeuchte
 * die Wanduhr->UTC-Richtung, die `no-local-time-construction` verbietet.
 */
import type {
  AssignmentRow,
  PlanningQueries,
  PlanningWindowResult,
  ResourceRow,
  ResourcesRow,
} from "../application/planning-queries.port";
import type {
  TenantQuery,
  TenantQueryRunner,
} from "../../../platform/database/tenant-query-runner";

interface OrgRow {
  readonly id: string;
  readonly time_zone: string;
}

interface VersionRow {
  readonly id: string;
  readonly published_at: Date | null;
  readonly created_at: Date;
}

interface RawAssignmentRow {
  readonly id: string;
  readonly employee_id: string;
  readonly worksite_id: string;
  readonly starts_at_utc: Date;
  readonly ends_at_utc: Date;
}

export class PlanningWindowRepository implements PlanningQueries {
  constructor(
    private readonly runner: TenantQueryRunner,
    private readonly subjectUserId: string,
  ) {}

  async planningWindow(weekKey: string): Promise<PlanningWindowResult> {
    return this.runner.run({ userId: this.subjectUserId }, async (tx) => {
      // RLS liefert genau die Organisationen der aktiven Mitgliedschaften.
      // Kein Filter noetig — und keiner erlaubt.
      const orgs = await tx.query<OrgRow>("select id, time_zone from public.organizations");
      if (orgs.rows.length === 0) return { ok: false, problem: "NO_ORGANISATION" as const };
      if (orgs.rows.length > 1) {
        return { ok: false, problem: "AMBIGUOUS_ORGANISATION" as const };
      }
      const org = orgs.rows[0];
      if (org === undefined) return { ok: false, problem: "NO_ORGANISATION" as const };

      // Alle Versionen dieser Woche. Mehrere veroeffentlichte sind erlaubt
      // (der Unique-Index aus 0007 ist partiell und begrenzt nur Entwuerfe),
      // hoechstens ein Entwurf.
      // Deterministische Reihenfolge. `published_at` allein genuegt nicht:
      // zwei Veroeffentlichungen derselben Transaktion tragen denselben
      // now()-Wert, und PostgreSQL gibt ohne vollstaendige Sortierung keine
      // stabile Reihenfolge zu. Die Auswahl waere dann von Lauf zu Lauf
      // verschieden — und die Mitarbeitersicht saehe eine andere Version als
      // die Planersicht.
      const versions = await tx.query<VersionRow>(
        `select id, published_at, created_at
           from public.plan_versions
          where week_key = $1
          order by published_at asc nulls last, created_at asc, id asc`,
        [weekKey],
      );

      const draft = versions.rows.find((row) => row.published_at === null) ?? null;
      const published = versions.rows.filter((row) => row.published_at !== null);
      const latestPublished = published.length === 0 ? null : published[published.length - 1];

      // Der bearbeitbare Stand: Entwurf, sonst zuletzt Veroeffentlichtes,
      // sonst nichts (Entscheidungsnotiz, Punkt 2).
      const source = draft ?? latestPublished;

      const assignments =
        source === null || source === undefined ? [] : await this.assignmentsOf(tx, source.id);

      // Stammdaten im SELBEN Transaktionsblock wie Woche, Versionen und
      // Zuweisungen. Nicht aus Bequemlichkeit: eine zweite Route oder ein
      // zweiter Runner-Aufruf saehe einen anderen Zeitpunkt, und dann koennte
      // `assignments` auf eine Person zeigen, die `resources` nicht mehr
      // kennt. Der Vertrag verwirft genau diesen Zustand — hier wird er
      // strukturell verhindert.
      //
      // Kein `where org_id = …`. Die Mandantengrenze ist RLS; ein Filter aus
      // Anwendungscode waere eine zweite, stillschweigend abweichende Wahrheit.
      // Auch KEIN `where active`: geliefert wird alles Sichtbare, damit
      // bestehende Zuweisungen auf inaktive Eintraege einen Namen behalten.
      // Die Auswaehlbarkeit steuert das Feld `active`, nicht die Zeilenmenge.
      const resources = await this.resourcesOf(tx);

      return {
        ok: true as const,
        window: {
          weekKey,
          timeZone: org.time_zone,
          assignments,
          resources,
          sourceVersion:
            source === null || source === undefined
              ? null
              : { id: source.id, state: source.published_at === null ? "draft" : "published" },
          publishedVersionId: latestPublished?.id ?? null,
        },
      };
    });
  }

  /**
   * Auswaehlbare Beschaeftigte und Baustellen des Mandanten.
   *
   * Sortiert nach Name UND Id. Der Name allein genuegt nicht: zwei Baustellen
   * duerfen gleich heissen, und PostgreSQL gibt ohne vollstaendige Sortierung
   * keine stabile Reihenfolge zu — die Auswahlliste saehe dann von Aufruf zu
   * Aufruf anders aus, und der E2E-Nachweis waere nicht reproduzierbar.
   * `collate "C"` erzwingt dieselbe Byte-Ordnung unabhaengig von der Locale
   * der Datenbank; ohne sie sortiert eine deutsche Locale "Ärger" anders als
   * eine C-Locale, und CI und lokale Maschine kaemen zu verschiedenen Listen.
   */
  private async resourcesOf(tx: TenantQuery): Promise<ResourcesRow> {
    const [employees, worksites] = await Promise.all([
      tx.query<ResourceRow>(
        `select id, display_name as label, active
           from public.employees
          order by display_name collate "C" asc, id asc`,
      ),
      tx.query<ResourceRow>(
        `select id, name as label, active
           from public.worksites
          order by name collate "C" asc, id asc`,
      ),
    ]);
    const abbilden = (rows: readonly ResourceRow[]): ResourceRow[] =>
      rows.map((row) => ({ id: row.id, label: row.label, active: row.active }));
    return { employees: abbilden(employees.rows), worksites: abbilden(worksites.rows) };
  }

  private async assignmentsOf(tx: TenantQuery, planVersionId: string): Promise<AssignmentRow[]> {
    const rows = await tx.query<RawAssignmentRow>(
      `select id, employee_id, worksite_id, starts_at_utc, ends_at_utc
         from public.assignments
        where plan_version_id = $1
        order by starts_at_utc asc, id asc`,
      [planVersionId],
    );
    return rows.rows.map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      worksiteId: row.worksite_id,
      startsAtUtc: row.starts_at_utc,
      endsAtUtc: row.ends_at_utc,
    }));
  }
}
