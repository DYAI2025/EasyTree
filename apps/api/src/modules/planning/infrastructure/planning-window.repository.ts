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
      const versions = await tx.query<VersionRow>(
        `select id, published_at
           from public.plan_versions
          where week_key = $1
          order by published_at asc nulls last`,
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

      return {
        ok: true as const,
        window: {
          weekKey,
          timeZone: org.time_zone,
          assignments,
          publishedVersionId: latestPublished?.id ?? null,
        },
      };
    });
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
