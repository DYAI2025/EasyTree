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
 * ## Organisations-Id: Verengung, keine Grenze
 *
 * Die Mandantengrenze kommt aus RLS, also aus `app.user_org_ids()` und damit
 * aus dem verifizierten Subjekt, das `PgTenantQueryRunner` transaktionslokal
 * gesetzt hat. Sie ist eine VEREINIGUNG ueber alle aktiven Mitgliedschaften —
 * bei mehreren Mitgliedschaften also mehr als eine Organisation.
 *
 * Seit EYT-109 tragen die Nutzdatenabfragen deshalb zusaetzlich
 * `and org_id = $n` mit der zuvor AUFGELOESTEN Organisation. Das ist keine
 * zweite, schwaechere Grenze neben der erzwungenen: die Bedingung steht UND-
 * verknuepft neben RLS und kann die sichtbare Menge nur verkleinern, nie
 * vergroessern. Der Wert stammt aus `organisationOf` und damit aus der
 * Datenbank — nie aus URL, Rumpf oder Header.
 *
 * Ohne diese Verengung wirkte eine Bindung nur auf die Zeitzone, waehrend
 * Versionen und Stammdaten weiter aus allen Mitgliedschaften kaemen: ein
 * gebundener Multi-Org-Lauf lieferte eine Collage aus zwei Mandanten, die
 * plausibel aussieht. Genau davor warnt `planning-queries.port.ts`.
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
  QueryResult,
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
    /**
     * Bereits serverseitig aufgeloeste Organisation, oder `null`.
     *
     * KEINE Autorisierung. Der Wert verengt nur innerhalb der RLS-sichtbaren
     * Menge; ist die Organisation dort nicht enthalten, liefert die Abfrage
     * null Zeilen und die Antwort ist `NO_ORGANISATION`.
     */
    private readonly organisationId: string | null = null,
  ) {}

  async planningWindow(weekKey: string): Promise<PlanningWindowResult> {
    return this.runner.run({ userId: this.subjectUserId }, async (tx) => {
      const organisation = await this.organisationOf(tx);
      if (!organisation.ok) return { ok: false as const, problem: organisation.problem };
      const org = organisation.org;

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
            and org_id = $2
          order by published_at asc nulls last, created_at asc, id asc`,
        [weekKey, org.id],
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
      // Verengt auf die aufgeloeste Organisation (siehe Kopf) — sonst listete
      // eine Bindung die Personen aller Mitgliedschaften auf. KEIN
      // `where active`: geliefert wird alles Sichtbare des Mandanten, damit
      // bestehende Zuweisungen auf inaktive Eintraege einen Namen behalten.
      // Die Auswaehlbarkeit steuert das Feld `active`, nicht die Zeilenmenge.
      const resources = await this.resourcesOf(tx, org.id);

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

      // Die letzte Bedingung der WHERE-Kette verengt auf die aufgeloeste
      // Organisation (siehe Kopf). Sie wird hier bewusst NICHT zitiert: die
      // Gegenmutation GM-MO-3 streicht sie und belegt das per `grep` — ein
      // Kommentar mit demselben Text machte diesen Beleg unbrauchbar.
      const rows = await tx.query<RawPublishedVersionRow>(
        `select id, week_key, published_at
           from public.plan_versions
          where published_at is not null
            and week_key collate "C" >= $1
            and week_key collate "C" <= $2
            and org_id = $3
          order by week_key collate "C" asc, published_at asc, created_at asc, id asc`,
        [fromWeekKey, toWeekKey, organisation.org.id],
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

      // 1. Sichtbarkeit. RLS und die Verengung auf die aufgeloeste
      //    Organisation entscheiden gemeinsam — eine fremde Version liefert
      //    null Zeilen, genau wie eine erfundene Id. Diese Ununterscheidbarkeit
      //    ist der Zweck, nicht ein Nebeneffekt.
      const vorhanden = await tx.query<RawVersionExistenceRow>(
        `select id
           from public.plan_versions
          where id = $1
            and org_id = $2`,
        [planVersionId, organisation.org.id],
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
            and org_id = $2
            and published_at is not null`,
        [planVersionId, organisation.org.id],
      );
      const version = veroeffentlicht.rows[0];
      if (version === undefined) {
        return { ok: false as const, problem: "PLAN_NOT_PUBLISHED" as const };
      }

      const assignments = await this.assignmentsOf(tx, version.id);
      const resources = await this.resourcesOf(tx, organisation.org.id);

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
   * ## Warum eine unbekannte Organisation `NO_ORGANISATION` ergibt
   *
   * Weil es in dem angefragten Kontext keine nutzbare Mitgliedschaft gibt —
   * derselbe Sachverhalt wie bei einem Subjekt ganz ohne Mitgliedschaft. Ein
   * eigener Code muesste „gibt es nicht" von „du gehoerst nicht dazu"
   * unterscheiden; genau das ist das Existenzleck, das `PLAN_VERSION_NOT_FOUND`
   * an anderer Stelle bereits vermeidet.
   *
   * Im gebundenen Zweig ist `AMBIGUOUS_ORGANISATION` unerreichbar: ein
   * Gleichheitsvergleich auf den Primaerschluessel liefert hoechstens eine
   * Zeile. Die Pruefung bleibt trotzdem stehen — sie gilt dem ungebundenen
   * Zweig, und ihre Bedingung an den Zweig zu knuepfen hiesse, zwei Wege durch
   * dieselbe Auswertung zu bauen.
   */
  private async organisationOf(tx: TenantQuery): Promise<OrganisationResult> {
    const orgs = await this.sichtbareOrganisationen(tx);
    if (orgs.rows.length === 0) return { ok: false, problem: "NO_ORGANISATION" };
    if (orgs.rows.length > 1) return { ok: false, problem: "AMBIGUOUS_ORGANISATION" };
    const org = orgs.rows[0];
    if (org === undefined) return { ok: false, problem: "NO_ORGANISATION" };
    return { ok: true, org };
  }

  /**
   * Die RLS-sichtbaren Organisationen, ggf. auf die gebundene verengt.
   *
   * ## Zwei Zweige, und warum der ungebundene woertlich bleibt
   *
   * Ohne Bindung laeuft exakt das Statement von frueher — Buchstabe fuer
   * Buchstabe. Das ist Absicht: der `read-through`-Lauf und die bestehenden
   * Integrationsfaelle messen genau diesen Text, und ihn beilaeufig
   * umzuschreiben tauschte eine geprueft Zusage gegen eine ungeprueft neue.
   *
   * ## Warum `id::text = $1` und nicht `id = $1::uuid`
   *
   * Ein `::uuid`-Cast wirft bei einer nicht wohlgeformten Eingabe SQLSTATE
   * 22P02. Der Ausfallweg waere dann eine Ausnahme statt einer Antwort. Ueber
   * Text vergleicht die Abfrage mit nichts und liefert null Zeilen —
   * fail-closed als normales Ergebnis, das ein Aufrufer behandeln kann. Das
   * gilt NUR hier: der Wert kommt von aussen. Die `org_id`-Bedingungen der
   * Nutzdatenabfragen vergleichen schlicht, weil ihr Wert aus dieser Abfrage
   * stammt und damit bereits eine wohlgeformte UUID ist.
   */
  private async sichtbareOrganisationen(tx: TenantQuery): Promise<QueryResult<OrgRow>> {
    // RLS liefert genau die Organisationen der aktiven Mitgliedschaften.
    if (this.organisationId === null) {
      return tx.query<OrgRow>("select id, time_zone from public.organizations");
    }
    return tx.query<OrgRow>(
      `select id, time_zone
         from public.organizations
        where id::text = $1`,
      [this.organisationId],
    );
  }

  /**
   * Auswaehlbare Beschaeftigte und Baustellen des Mandanten.
   *
   * `where org_id = $1` traegt die zuvor aufgeloeste Organisation (siehe Kopf).
   * Ohne sie lieferte ein gebundener Multi-Org-Lauf die Personen und Baustellen
   * ALLER Mitgliedschaften — RLS ist eine Vereinigung, keine Auswahl.
   *
   * Sortiert nach Name UND Id. Der Name allein genuegt nicht: zwei Baustellen
   * duerfen gleich heissen, und PostgreSQL gibt ohne vollstaendige Sortierung
   * keine stabile Reihenfolge zu — die Auswahlliste saehe dann von Aufruf zu
   * Aufruf anders aus, und der E2E-Nachweis waere nicht reproduzierbar.
   * `collate "C"` erzwingt dieselbe Byte-Ordnung unabhaengig von der Locale
   * der Datenbank; ohne sie sortiert eine deutsche Locale "Ärger" anders als
   * eine C-Locale, und CI und lokale Maschine kaemen zu verschiedenen Listen.
   */
  private async resourcesOf(tx: TenantQuery, orgId: string): Promise<ResourcesRow> {
    const [employees, worksites] = await Promise.all([
      tx.query<ResourceRow>(
        `select id, display_name as label, active
           from public.employees
          where org_id = $1
          order by display_name collate "C" asc, id asc`,
        [orgId],
      ),
      tx.query<ResourceRow>(
        `select id, name as label, active
           from public.worksites
          where org_id = $1
          order by name collate "C" asc, id asc`,
        [orgId],
      ),
    ]);
    const abbilden = (rows: readonly ResourceRow[]): ResourceRow[] =>
      rows.map((row) => ({ id: row.id, label: row.label, active: row.active }));
    return { employees: abbilden(employees.rows), worksites: abbilden(worksites.rows) };
  }

  /**
   * Die Zuweisungen EINER Planversion — als einzige Abfrage ohne `org_id`.
   *
   * Das ist kein Vergessen. `assignments` traegt den tenantgebundenen
   * Fremdschluessel `(plan_version_id, org_id) references plan_versions (id,
   * org_id)` (Migration 0007): die Version bestimmt die Organisation bereits,
   * und sie ist hier immer eine, die die vorangehende Abfrage im Mandanten
   * gefunden hat. Ein zusaetzliches `and org_id = $2` waere damit eine
   * Bedingung, die keine Datenlage je verletzt — also keine Pruefung, sondern
   * Dekoration. Dieselbe Begruendung wie beim weggelassenen
   * `published_at`-Filter oben.
   */
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
