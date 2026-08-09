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
  PlanningQueryProblem,
  PlanningWindowResult,
  PublishedAssignmentsResult,
  PublishedVersionsResult,
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

/**
 * Zeile der Bereichsabfrage (EYT-109).
 *
 * `published_at` ist hier NICHT nullable, obwohl die Spalte es ist: die Abfrage
 * traegt `published_at is not null`. Der Typ haelt genau diese Zusicherung fest
 * — waere er `Date | null`, muesste jeder Aufrufer einen Fall behandeln, den
 * die Abfrage bereits ausgeschlossen hat.
 */
interface RawPublishedVersionRow {
  readonly id: string;
  readonly week_key: string;
  readonly published_at: Date;
}

/** Nur die Existenzfrage — bewusst ohne Nutzdaten. */
interface RawVersionExistenceRow {
  readonly id: string;
}

type OrganisationResult =
  | { readonly ok: true; readonly org: OrgRow }
  | { readonly ok: false; readonly problem: PlanningQueryProblem };

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
   * Veroeffentlichte Planversionen eines Wochenbereichs (EYT-109).
   *
   * `published_at is not null` ist der ganze Unterschied zur Fensterabfrage:
   * dort ist der Entwurf der bevorzugte Stand, hier ist er kein Stand.
   *
   * ## Warum `collate "C"`
   *
   * Sowohl der Bereichsvergleich als auch die Sortierung laufen ueber eine
   * Textspalte, und Textvergleiche haengen an der Kollation der Datenbank. Eine
   * deutsche Locale ordnet Interpunktion anders als eine C-Locale — CI und eine
   * lokale Maschine kaemen dann bei derselben Datenlage zu verschiedenen
   * Ergebnissen, und zwar leise. Dieselbe Begruendung wie bei `resourcesOf`.
   *
   * ## Warum die Sortierung vier Schluessel hat
   *
   * `week_key` allein genuegt nicht: pro Woche sind MEHRERE veroeffentlichte
   * Versionen erlaubt (der Unique-Index aus 0007 ist partiell und begrenzt nur
   * Entwuerfe). Die nachrangige Ordnung ist bewusst dieselbe wie in
   * `planningWindow` — `published_at`, dann `created_at`, dann `id` —, damit
   * nicht zwei Stellen im selben Modul eine andere Reihenfolge fuer dasselbe
   * Ding behaupten. `published_at` allein reicht dort wie hier nicht, weil zwei
   * Veroeffentlichungen derselben Transaktion denselben `now()`-Wert tragen.
   */
  async publishedVersions(
    fromWeekKey: string,
    toWeekKey: string,
  ): Promise<PublishedVersionsResult> {
    return this.runner.run({ userId: this.subjectUserId }, async (tx) => {
      const organisation = await this.organisationOf(tx);
      if (!organisation.ok) return { ok: false as const, problem: organisation.problem };

      // Kein `where org_id = …`. Die Mandantengrenze ist RLS — siehe Kopf.
      const rows = await tx.query<RawPublishedVersionRow>(
        `select id, week_key, published_at
           from public.plan_versions
          where published_at is not null
            and week_key collate "C" >= $1
            and week_key collate "C" <= $2
          order by week_key collate "C" asc, published_at asc, created_at asc, id asc`,
        [fromWeekKey, toWeekKey],
      );

      return {
        ok: true as const,
        versions: rows.rows.map((row) => ({
          id: row.id,
          weekKey: row.week_key,
          publishedAt: row.published_at,
        })),
      };
    });
  }

  /**
   * Der veroeffentlichte Stand GENAU DER benannten Planversion (EYT-109).
   *
   * ## Warum zwei Abfragen auf dieselbe Tabelle
   *
   * Weil zwei verschiedene Fragen beantwortet werden, die verschieden ausgehen
   * duerfen: „ist diese Version fuer mich ueberhaupt sichtbar" und „ist sie
   * veroeffentlicht". Eine einzige Abfrage mit `published_at is not null`
   * lieferte fuer einen Entwurf null Zeilen und waere damit von „gibt es nicht"
   * nicht mehr zu unterscheiden — der Aufrufer bekaeme `PLAN_VERSION_NOT_FOUND`
   * fuer eine Version, die er selbst angelegt hat.
   *
   * Umgekehrt steht die Veroeffentlichungspruefung bewusst im SQL und nicht als
   * `if` hinter einer gelesenen Zeile: die Bedingung ist die Regel, und eine
   * Regel, die in der Abfrage steht, laesst sich durch Streichen genau dieser
   * Bedingung widerlegen (Gegenmutation GM1 des Plans). Ein TypeScript-`if`
   * waere dieselbe Wirkung an einer Stelle, die die benannte Mutation nicht
   * trifft.
   *
   * Beide Abfragen laufen im SELBEN `runner.run`, also in EINER Transaktion,
   * gemeinsam mit Zuweisungen, Stammdaten und Zeitzone. Eine Folge unabhaengiger
   * Aufrufe koennte vier Zeitpunkte sehen — und ein Kostenschnappschuss aus vier
   * Zeitpunkten ist kein Stand, sondern eine Collage.
   *
   * ## Warum die Zuweisungen NICHT zusaetzlich auf `published_at` gefiltert sind
   *
   * Sie koennen gar nicht unveroeffentlicht sein. Migration 0010 stempelt beim
   * Veroeffentlichen jede Zuweisung der Version mit (Punkt 3) und weist danach
   * jede weitere Zuweisung in dieselbe Version ab (Punkt 5, SQLSTATE 23514).
   * Ein Filter waere hier also eine Bedingung, die keine Datenlage je verletzt —
   * also keine Pruefung, sondern Dekoration. Statt ihn zu schreiben, misst der
   * Integrationstest die Invariante gegen die echte Datenbank.
   */
  async publishedAssignments(planVersionId: string): Promise<PublishedAssignmentsResult> {
    return this.runner.run({ userId: this.subjectUserId }, async (tx) => {
      const organisation = await this.organisationOf(tx);
      if (!organisation.ok) return { ok: false as const, problem: organisation.problem };

      // 1. Sichtbarkeit. RLS entscheidet — ein fremder Mandant liefert null
      //    Zeilen, genau wie eine erfundene Id. Diese Ununterscheidbarkeit ist
      //    der Zweck, nicht ein Nebeneffekt.
      const vorhanden = await tx.query<RawVersionExistenceRow>(
        "select id from public.plan_versions where id = $1",
        [planVersionId],
      );
      if (vorhanden.rows.length === 0) {
        return { ok: false as const, problem: "PLAN_VERSION_NOT_FOUND" as const };
      }

      // 2. Verbindlichkeit. Kosten entstehen ausschliesslich aus einem
      //    veroeffentlichten Stand (FMC-001).
      const veroeffentlicht = await tx.query<RawPublishedVersionRow>(
        `select id, week_key, published_at
           from public.plan_versions
          where id = $1
            and published_at is not null`,
        [planVersionId],
      );
      const version = veroeffentlicht.rows[0];
      if (version === undefined) {
        return { ok: false as const, problem: "PLAN_NOT_PUBLISHED" as const };
      }

      const assignments = await this.assignmentsOf(tx, version.id);
      const resources = await this.resourcesOf(tx);

      return {
        ok: true as const,
        published: {
          planVersionId: version.id,
          weekKey: version.week_key,
          timeZone: organisation.org.time_zone,
          publishedAt: version.published_at,
          assignments,
          resources,
        },
      };
    });
  }

  /**
   * Die EINE Organisation des gesetzten Kontexts.
   *
   * Bewusst nur von den beiden neuen Methoden benutzt und NICHT nachtraeglich in
   * `planningWindow` eingezogen: dessen Fassung ist durch den `read-through`-Lauf
   * gedeckt, diese hier noch nicht. Denselben Block zu teilen waere richtig,
   * sobald ein Test beide Wege deckt — das ist ein eigener Schritt und nicht
   * einer, der sich in dieser Aenderung versteckt.
   */
  private async organisationOf(tx: TenantQuery): Promise<OrganisationResult> {
    // RLS liefert genau die Organisationen der aktiven Mitgliedschaften.
    const orgs = await tx.query<OrgRow>("select id, time_zone from public.organizations");
    if (orgs.rows.length === 0) return { ok: false, problem: "NO_ORGANISATION" };
    if (orgs.rows.length > 1) return { ok: false, problem: "AMBIGUOUS_ORGANISATION" };
    const org = orgs.rows[0];
    if (org === undefined) return { ok: false, problem: "NO_ORGANISATION" };
    return { ok: true, org };
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
