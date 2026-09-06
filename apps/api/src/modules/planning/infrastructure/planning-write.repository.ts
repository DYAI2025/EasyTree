/**
 * Schreibrepository der Planung (EYT-92).
 *
 * Dieselben Regeln wie im Leserepository, aus denselben Gruenden: kein `pg`,
 * kein `org_id` in einer WHERE-Klausel, keine Wochenberechnung. Was hier
 * hinzukommt, ist die Transaktionsgrenze — und die ist der eigentliche Inhalt
 * dieser Datei.
 *
 * ## Warum alles in EINER Transaktion liegt
 *
 * Ein Entwurf entsteht nur, weil jemand eine Zuweisung anlegen will. Faende das
 * Anlegen des Entwurfs und das der Zuweisung in getrennten Transaktionen statt,
 * bliebe bei einem Konflikt ein leerer Entwurf stehen: die Woche zeigte
 * anschliessend "Unveroeffentlichter Entwurf" ueber null Zuweisungen, obwohl
 * niemand etwas geplant hat. `TenantQueryRunner.run` klammert deshalb Auflösung
 * der Organisation, Anlegen des Entwurfs, Konfliktpruefung und Einfuegen.
 *
 * ## Warum die Ueberlappungspruefung hier steht und nicht in der Datenbank
 *
 * Migration `0010` traegt `assignments_no_published_overlap` — aber ausdruecklich
 * `where (published_at is not null)`. ENTWUERFE duerfen sich dort ueberlappen,
 * und zwar absichtlich: waehrend des Planens ist ein Zwischenstand mit Konflikt
 * ein normaler Zustand. Fuer den Nutzerpfad "Entwurf speichern" ist er es
 * nicht — die Planerin soll den Konflikt beim Speichern sehen, nicht erst beim
 * Veroeffentlichen. Die Pruefung ist deshalb hier, und sie laeuft INNERHALB
 * derselben Transaktion wie das Einfuegen.
 *
 * **Ehrlichkeitshinweis zur Grenze dieser Pruefung.** `read committed` allein
 * schuetzt nicht gegen zwei gleichzeitige Einfuegungen, die einander noch nicht
 * sehen. `createAssignment` serialisiert deshalb Pruefen und Einfuegen mit einem
 * transaktionsgebundenen Advisory-Lock je Organisation und Person. Das ist eine
 * Eigenschaft dieses Kommandopfads, keine allgemeine Datenbank-Constraint:
 * andere Entwurfspfade duerfen weiterhin ueberlappende Zwischenstaende erzeugen,
 * wie Migration 0010 es fachlich vorsieht.
 */
import {
  createTimeZone,
  isoWeekOfLocalDate,
  localBusinessDate,
  NO_CAPACITY_LIMIT,
  planningWeekKey,
  TimeInterval,
  unsafeIdentifier,
  type AssignmentId,
  type EmployeeId,
  type OrgId,
  type WorksiteId,
} from "@easytree/domain";

import type {
  CreateAssignmentInput,
  CreateAssignmentResult,
  CreatedAssignmentRow,
  CreatedWorksiteDayRow,
  PlanWorksiteDayInput,
  PlanWorksiteDayResult,
  PlanningWrites,
  PublishPlanInput,
  PublishPlanResult,
  PublishedPlanVersionRow,
  ValidateDraftInput,
  ValidateDraftResult,
  ValidatedConflict,
} from "../application/planning-writes.port";
import type { AssignmentDraft, ConflictCode } from "../domain/assignment-draft";
import { validateDraft } from "../domain/draft-validation";
import { zuweisungenAusserhalbDerWoche } from "../domain/week-membership";
import type { IdempotencyStore } from "../../../platform/idempotency/idempotency-store";
import type {
  TenantQuery,
  TenantQueryRunner,
} from "../../../platform/database/tenant-query-runner";

interface RawExistingRow {
  readonly id: string;
  readonly employee_id: string;
  readonly worksite_id: string;
  readonly starts_at_utc: Date;
  readonly ends_at_utc: Date;
}

/**
 * Deutscher Text je Konfliktcode.
 *
 * Der CODE ist die Schnittstelle, der Text die Darstellung — deshalb reisen
 * beide, und der Client darf sich nur auf den Code stuetzen. Vollstaendig
 * ausgeschrieben ohne Standardzweig: ein neuer Code faellt beim Typcheck auf,
 * statt als roher Bezeichner in der Oberflaeche zu landen.
 */
const KONFLIKT_TEXT: Record<ConflictCode, string> = {
  EMPLOYEE_INTERVAL_OVERLAP: "Diese Person ist in diesem Zeitraum bereits eingeplant.",
  EMPLOYEE_WEEKLY_CAPACITY: "Die Wochenarbeitszeit dieser Person wird überschritten.",
  EMPLOYEE_INACTIVE: "Diese Person ist nicht aktiv.",
  WORKSITE_NOT_PUBLISHABLE: "Diese Baustelle kann nicht veröffentlicht werden.",
};

interface OrgRow {
  readonly id: string;
  readonly time_zone: string;
}

interface VersionRow {
  readonly id: string;
  readonly published_at: Date | null;
}

/** Eine Planversion mit ihrem Wochenschluessel — die Form der Publish-Antwort. */
interface PublishedVersionRow {
  readonly id: string;
  readonly week_key: string;
  readonly published_at: Date | null;
}

interface IdRow {
  readonly id: string;
}

interface ActiveRow {
  readonly active: boolean;
}

interface AssignmentInsertRow {
  readonly id: string;
  readonly plan_version_id: string;
  readonly employee_id: string;
  readonly worksite_id: string;
  readonly starts_at_utc: Date;
  readonly ends_at_utc: Date;
}

interface WorksiteDayRow {
  readonly id: string;
}

interface WorksiteDayConfigurationRow {
  readonly id: string;
  readonly lock_version: number;
}

interface WorksiteDayAssignmentInsertRow {
  readonly id: string;
  readonly employee_id: string;
  readonly starts_at_utc: Date;
  readonly ends_at_utc: Date;
}

interface OverlapQueryRow {
  readonly id: string;
  readonly starts_at_utc: Date;
  readonly ends_at_utc: Date;
}

/** PostgreSQL-Fehlercodes, die hier eine fachliche Bedeutung tragen. */
const EXCLUSION_VIOLATION = "23P01";
const UNIQUE_VIOLATION = "23505";

function fehlerCode(fehler: unknown): string | null {
  if (typeof fehler !== "object" || fehler === null || !("code" in fehler)) return null;
  const code = (fehler as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Stabiler Fingerabdruck der Anfrage.
 *
 * Kanonisch in fester Feldreihenfolge, Zeitstempel als ISO-8601 — nicht
 * `JSON.stringify(input)`: dessen Reihenfolge haengt an der Konstruktion des
 * Objekts, und ein umsortiertes Literal wuerde dieselbe Anfrage plötzlich als
 * andere lesen. Der Idempotenzschluessel selbst geht NICHT ein, sonst waere der
 * Vergleich tautologisch.
 *
 * Kein Hash: der Wert ist kurz, und ein Klartextvergleich laesst sich im
 * Fehlerfall lesen. Personenbezug entsteht nicht — es sind Uuids und Instants.
 */
function fingerprintOf(input: CreateAssignmentInput): string {
  return [
    input.weekKey,
    input.employeeId,
    input.worksiteId,
    input.startsAtUtc.toISOString(),
    input.endsAtUtc.toISOString(),
  ].join("|");
}

/** Vorgangsname im Idempotenzspeicher. Siehe Migration 0012. */
const OPERATION = "planning.create_assignment";

/**
 * Vorgangsname des Veroeffentlichens (EYT-107).
 *
 * Eigener Schluesselraum, und das ist der Zweck der Spalte `operation`: derselbe
 * Schluessel darf fuer „Einsatz anlegen" und „Woche veroeffentlichen" nicht
 * kollidieren, sonst bekaeme der zweite Vorgang die Antwort des ersten.
 * Namenskonvention wie `planning.create_assignment` und
 * `costs.create_rate_version`.
 */
const PUBLISH_OPERATION = "planning.publish_plan";

/** Eigener Idempotenzraum; das Ergebnis ist nur ueber 0019 lesbar. */
const PLAN_WORKSITE_DAY_OPERATION = "planning.plan_worksite_day";

/**
 * Fingerabdruck der Veroeffentlichungsanfrage.
 *
 * Nur die fachlich wirksamen Felder, in fester Reihenfolge. Der
 * Idempotenzschluessel selbst geht NICHT ein, sonst waere der Vergleich
 * tautologisch. Klartext statt Hash — dieselbe Form wie
 * {@link fingerprintOf}, und der Wert ist im Fehlerfall lesbar. Personenbezug
 * entsteht nicht: eine Woche und eine Uuid.
 */
function publishFingerprintOf(input: PublishPlanInput): string {
  return [input.weekKey, input.expectedVersionId ?? "null"].join("|");
}

function worksiteDayFingerprintOf(input: PlanWorksiteDayInput): string {
  return [
    input.weekKey,
    input.worksiteId,
    input.localDate,
    ...input.team
      .map((member) =>
        [member.employeeId, member.startsAtUtc.toISOString(), member.endsAtUtc.toISOString()].join(
          "|",
        ),
      )
      .sort(),
  ].join("|");
}

function localDateParts(localDate: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (match === null)
    throw new Error("EYT-152: ungueltiges lokales Datum erreichte das Repository.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error("EYT-152: nicht existentes lokales Datum erreichte das Repository.");
  }
  return { year, month, day };
}

function isSameLocalDate(
  a: { year: number; month: number; day: number },
  b: { year: number; month: number; day: number },
): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function serialisiereWorksiteDay(tag: CreatedWorksiteDayRow): Record<string, unknown> {
  return {
    worksiteDayId: tag.worksiteDayId,
    configurationId: tag.configurationId,
    worksiteId: tag.worksiteId,
    localDate: tag.localDate,
    lockVersion: tag.lockVersion,
    team: tag.team.map((member) => ({
      assignmentId: member.assignmentId,
      employeeId: member.employeeId,
      interval: {
        startUtc: member.startsAtUtc.toISOString(),
        endUtc: member.endsAtUtc.toISOString(),
      },
    })),
  };
}

function replayWorksiteDay(payload: unknown): CreatedWorksiteDayRow {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("EYT-152: Idempotenz-Payload eines Baustellentags ist unlesbar.");
  }
  const record = payload as Record<string, unknown>;
  const requiredString = (field: string): string => {
    const value = record[field];
    if (typeof value !== "string") {
      throw new Error(`EYT-152: Idempotenz-Payload ohne ${field}.`);
    }
    return value;
  };
  if (!Number.isInteger(record["lockVersion"]) || (record["lockVersion"] as number) < 0) {
    throw new Error("EYT-152: Idempotenz-Payload ohne gueltige lockVersion.");
  }
  if (!Array.isArray(record["team"])) {
    throw new Error("EYT-152: Idempotenz-Payload ohne Team.");
  }
  return {
    worksiteDayId: requiredString("worksiteDayId"),
    configurationId: requiredString("configurationId"),
    worksiteId: requiredString("worksiteId"),
    localDate: requiredString("localDate"),
    lockVersion: record["lockVersion"] as number,
    team: record["team"].map((raw) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("EYT-152: Idempotenz-Payload mit unlesbarem Teammitglied.");
      }
      const member = raw as Record<string, unknown>;
      const interval = member["interval"];
      if (typeof interval !== "object" || interval === null || Array.isArray(interval)) {
        throw new Error("EYT-152: Idempotenz-Payload mit unlesbarem Intervall.");
      }
      const values = interval as Record<string, unknown>;
      if (
        typeof member["assignmentId"] !== "string" ||
        typeof member["employeeId"] !== "string" ||
        typeof values["startUtc"] !== "string" ||
        typeof values["endUtc"] !== "string"
      ) {
        throw new Error("EYT-152: Idempotenz-Payload mit unvollstaendigem Teammitglied.");
      }
      const startsAtUtc = new Date(values["startUtc"]);
      const endsAtUtc = new Date(values["endUtc"]);
      if (Number.isNaN(startsAtUtc.getTime()) || Number.isNaN(endsAtUtc.getTime())) {
        throw new Error("EYT-152: Idempotenz-Payload mit ungueltigem Zeitstempel.");
      }
      return {
        assignmentId: member["assignmentId"],
        employeeId: member["employeeId"],
        startsAtUtc,
        endsAtUtc,
      };
    }),
  };
}

/** Fachliche Ablehnung NACH einer Mutation: erzwingt den Transaktionsrollback. */
class WorksiteDayRejectedError extends Error {
  constructor(
    readonly problem: import("../application/planning-writes.port").PlanningWriteProblem,
  ) {
    super(`EYT-152: ${problem.kind}`);
  }
}

function zuAssignment(zeile: AssignmentInsertRow): CreatedAssignmentRow {
  return {
    id: zeile.id,
    planVersionId: zeile.plan_version_id,
    employeeId: zeile.employee_id,
    worksiteId: zeile.worksite_id,
    startsAtUtc: zeile.starts_at_utc,
    endsAtUtc: zeile.ends_at_utc,
  };
}

export class PlanningWriteRepository implements PlanningWrites {
  constructor(
    private readonly runner: TenantQueryRunner,
    private readonly subjectUserId: string,
    /** Bildet einen Instant auf seine ISO-Woche in der Zone der Organisation ab. */
    private readonly wochenschluessel: (instant: Date, timeZone: string) => string,
    /**
     * Wiederholungserkennung als Plattformdienst (EYT-107).
     *
     * Bis hierher baute diese Datei dasselbe Protokoll als rohes SQL nach,
     * obwohl `platform/idempotency` es seit EYT-108 kapselt — zwei
     * Implementierungen derselben Zusicherung, und die zweite waere beim
     * Hinzufuegen des Publish-Pfads zur dritten geworden.
     */
    private readonly idempotenz: IdempotencyStore,
    /** Testhaken fuer den Teilwirkungsnachweis. `null` im Normalbetrieb. */
    private readonly fehlerNach: "assignment" | "audit" | "outbox" | "published" | null = null,
  ) {}

  /**
   * Entwurf gegen den Bestand pruefen, ohne zu schreiben (EYT-92, Vertragslücke 8).
   *
   * Verwendet **dieselbe** Domainfunktion `validateDraft`, die bisher nur
   * Unittests hatte und keinen Produktionsaufrufer — genau die Konstellation,
   * die `docs/traceability.md` als REQ-006 „Regel vorhanden, fuer den Nutzer
   * nicht erreichbar" fuehrte.
   *
   * Kein Advisory-Lock: eine Pruefung ohne Schreibwirkung braucht keine
   * Serialisierung, und ihr Ergebnis ist ohnehin nur eine Momentaufnahme. Wer
   * daraus eine Garantie ableitet, irrt — die Garantie gibt nur
   * `createAssignment` mit seinem Lock.
   */
  async validateDraft(input: ValidateDraftInput): Promise<ValidateDraftResult> {
    return this.runner.run({ userId: this.subjectUserId }, async (tx) => {
      const orgs = await tx.query<OrgRow>("select id, time_zone from public.organizations");
      if (orgs.rows.length === 0) {
        return { ok: false as const, problem: { kind: "NO_ORGANISATION" as const } };
      }
      if (orgs.rows.length > 1) {
        return { ok: false as const, problem: { kind: "AMBIGUOUS_ORGANISATION" as const } };
      }
      const org = orgs.rows[0];
      if (org === undefined) {
        return { ok: false as const, problem: { kind: "NO_ORGANISATION" as const } };
      }

      const zone = createTimeZone(org.time_zone);
      if (!zone.ok) {
        throw new Error(`EYT-92: unbekannte Zeitzone "${org.time_zone}" in organizations.`);
      }

      const intervall = TimeInterval.create(input.startsAtUtc, input.endsAtUtc);
      if (!intervall.ok) {
        // Der Vertrag hat das bereits geprueft; kommt es hier trotzdem an, ist
        // die Vertragspruefung umgangen worden.
        throw new Error(`EYT-92: ungueltiges Intervall erreichte die Domain (${intervall.error}).`);
      }

      // Bestand des SICHTBAREN Standes — Entwurf, sonst zuletzt
      // Veroeffentlichtes, sonst leer.
      //
      // Die erste Fassung lud alle Zuweisungen ALLER Versionen derselben
      // Woche. Das widersprach dem eigenen Kommentar und der Leseroute: eine
      // vor Wochen ueberholte Version haette Konflikte gegen einen Stand
      // erzeugt, den niemand mehr sieht. Die Auswahl ist deshalb identisch zu
      // `PlanningWindowRepository` — Entwurf hat Vorrang, sonst gewinnt die
      // zuletzt veroeffentlichte Version, und der Id-Tie-Breaker entscheidet
      // bei Zeitstempelgleichstand.
      const versionen = await tx.query<VersionRow>(
        `select id, published_at from public.plan_versions
          where week_key = $1
          order by published_at asc nulls last, created_at asc, id asc`,
        [input.weekKey],
      );
      const entwurfVersion = versionen.rows.find((r) => r.published_at === null) ?? null;
      const veroeffentlichte = versionen.rows.filter((r) => r.published_at !== null);
      const quelle = entwurfVersion ?? veroeffentlichte[veroeffentlichte.length - 1] ?? null;

      const bestand =
        quelle === null
          ? { rows: [] as RawExistingRow[] }
          : await tx.query<RawExistingRow>(
              `select id, employee_id, worksite_id, starts_at_utc, ends_at_utc
                 from public.assignments
                where plan_version_id = $1
                order by starts_at_utc asc, id asc`,
              [quelle.id],
            );

      const alsDraft = (
        id: string,
        employeeId: string,
        worksiteId: string,
        von: Date,
        bis: Date,
      ): AssignmentDraft | null => {
        const i = TimeInterval.create(von, bis);
        if (!i.ok) return null;
        return {
          id: unsafeIdentifier<AssignmentId>(id),
          orgId: unsafeIdentifier<OrgId>(org.id),
          employeeId: unsafeIdentifier<EmployeeId>(employeeId),
          worksiteId: unsafeIdentifier<WorksiteId>(worksiteId),
          interval: i.interval,
        };
      };

      const existing = bestand.rows
        .map((r) => alsDraft(r.id, r.employee_id, r.worksite_id, r.starts_at_utc, r.ends_at_utc))
        .filter((d): d is AssignmentDraft => d !== null);

      const entwurf = alsDraft(
        // Der zu pruefende Entwurf existiert noch nicht und hat keine Id. Die
        // Nil-Uuid ist hier korrekt und nicht geraten: `excludeId: null` sorgt
        // dafuer, dass sie mit nichts verglichen wird.
        "00000000-0000-0000-0000-000000000000",
        input.employeeId,
        input.worksiteId,
        input.startsAtUtc,
        input.endsAtUtc,
      );
      if (entwurf === null) {
        throw new Error("EYT-92: Entwurf liess sich nicht in die Domainform bringen.");
      }

      const konflikte = validateDraft({
        draft: entwurf,
        existing,
        excludeId: null,
        timeZone: zone.timeZone,
        // Ohne Wochenstundengrenze im Fachschema gibt es keine zu pruefen.
        // Eine geratene Zahl waere eine erfundene Regel — siehe Dateikopf von
        // `weekly-capacity.ts`.
        capacityLimit: NO_CAPACITY_LIMIT,
      });

      const conflicts = konflikte.map((k) => ({
        code: k.code,
        blocking: k.blocking,
        message: KONFLIKT_TEXT[k.code] ?? k.code,
      }));

      return {
        ok: true as const,
        conflicts,
        // Abgeleitet, nicht behauptet: veroeffentlichbar ist, was keinen
        // blockierenden Konflikt hat.
        publishable: conflicts.every((k) => !k.blocking),
      };
    });
  }

  async createAssignment(input: CreateAssignmentInput): Promise<CreateAssignmentResult> {
    return this.runner.run({ userId: this.subjectUserId }, async (tx) => {
      const orgs = await tx.query<OrgRow>("select id, time_zone from public.organizations");
      if (orgs.rows.length === 0)
        return { ok: false as const, problem: { kind: "NO_ORGANISATION" as const } };
      if (orgs.rows.length > 1) {
        return { ok: false as const, problem: { kind: "AMBIGUOUS_ORGANISATION" as const } };
      }
      const org = orgs.rows[0];
      if (org === undefined) {
        return { ok: false as const, problem: { kind: "NO_ORGANISATION" as const } };
      }

      // Die Woche wird aus dem BEGINN abgeleitet, in der Zone der Organisation
      // — dieselbe Regel wie `planningWeekOf` (packages/domain). Stimmt sie
      // nicht mit der angefragten ueberein, wuerde die Zeile in einer anderen
      // Woche auftauchen als in der, in der sie angelegt wurde.
      const tatsaechlicheWoche = this.wochenschluessel(input.startsAtUtc, org.time_zone);
      if (tatsaechlicheWoche !== input.weekKey) {
        return {
          ok: false as const,
          problem: { kind: "OUTSIDE_WEEK" as const, tatsaechlicheWoche },
        };
      }

      // ---------------------------------------------------------------
      // Wiederholungsschutz — serialisiert, und VOR jeder veraenderlichen Pruefung
      // ---------------------------------------------------------------
      // Zwei Aenderungen gegenueber der ersten Fassung, beide notwendig:
      //
      // 1. Die Sperre steht VOR der Abfrage. Ohne sie lesen zwei gleichzeitige
      //    Anfragen mit demselben Schluessel beide "nicht vorhanden", legen
      //    beide einen Einsatz an, und erst der zweite Insert in
      //    `idempotency_records` scheitert — der Aufrufer bekaeme einen
      //    Serverfehler statt seiner Wiederholung.
      //
      // 2. Der ganze Block steht VOR der Auswaehlbarkeitspruefung. `active` ist
      //    veraenderlich: wird eine Person nach dem ersten Aufruf deaktiviert,
      //    scheiterte ein spaeterer Retry an einer Bedingung, die beim
      //    urspruenglichen Vorgang erfuellt war. Eine Wiederholung darf nicht
      //    davon abhaengen, was sich seither geaendert hat.
      await this.idempotenz.lock(tx, OPERATION, input.idempotencyKey);

      const fingerabdruck = fingerprintOf(input);
      const bekannt = await this.idempotenz.find(tx, OPERATION, input.idempotencyKey);
      if (bekannt !== null) {
        if (bekannt.requestFingerprint !== fingerabdruck) {
          // Derselbe Schluessel, andere Anfrage. Das ist keine Wiederholung,
          // sondern ein Aufruferfehler — und die alte Antwort zurueckzugeben
          // waere die schlechteste Reaktion: der Aufrufer bekaeme ein
          // "angelegt" fuer etwas, das er nie geschickt hat.
          return {
            ok: false as const,
            problem: { kind: "IDEMPOTENCY_KEY_REUSED" as const },
          };
        }
        const wieder = await tx.query<AssignmentInsertRow>(
          `select id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc
             from public.assignments where id = $1`,
          [bekannt.subjectId],
        );
        const zeile = wieder.rows[0];
        if (zeile === undefined) {
          // Der Schluessel ist bekannt, das Objekt nicht mehr da. Still einen
          // NEUEN Einsatz anzulegen waere die schlechteste Antwort: der
          // Aufrufer bekaeme fuer denselben Vorgang zwei verschiedene Ids.
          throw new Error(
            `EYT-92: Idempotenzschluessel verweist auf Einsatz ${bekannt.subjectId}, den es nicht mehr gibt.`,
          );
        }
        return { ok: true as const, assignment: zuAssignment(zeile), replayed: true };
      }

      // Auswaehlbarkeit serverseitig, nicht nur im Formular. RLS macht fremde
      // Zeilen unsichtbar, also bedeutet "keine Zeile" hier zugleich "gehoert
      // einem anderen Mandanten" und "existiert nicht" — und genau diese
      // Ununterscheidbarkeit ist erwuenscht.
      for (const [feld, tabelle, id] of [
        ["employeeId", "public.employees", input.employeeId],
        ["worksiteId", "public.worksites", input.worksiteId],
      ] as const) {
        const treffer = await tx.query<ActiveRow>(`select active from ${tabelle} where id = $1`, [
          id,
        ]);
        const zeile = treffer.rows[0];
        if (zeile === undefined || !zeile.active) {
          return {
            ok: false as const,
            problem: { kind: "RESOURCE_NOT_SELECTABLE" as const, feld },
          };
        }
      }

      // ---------------------------------------------------------------
      // Pruefen und Einfuegen serialisieren
      // ---------------------------------------------------------------
      // Ab hier darf keine zweite Transaktion desselben Mandanten dieselbe
      // Person gleichzeitig einplanen. Siehe Migration 0012: `read committed`
      // laesst sonst beide Ueberlappungspruefungen durchgehen, weil keine die
      // noch nicht committete Zeile der anderen sieht.
      await tx.query("select app.lock_employee_planning($1)", [input.employeeId]);

      // Entwurf der Woche holen oder anlegen — und WISSEN, wer ihn angelegt hat.
      //
      // Die erste Fassung fragte vorher ab, ob schon ein Entwurf existiert.
      // Das war ein Wettrennen: zwei Transaktionen fuer verschiedene Personen
      // derselben Woche haetten beide "existiert nicht" gesehen und beide die
      // veroeffentlichte Baseline kopiert — der Entwurf traege danach jede
      // Zeile doppelt.
      //
      // `returning id` beantwortet die Frage ohne Vorabblick: nur die
      // Transaktion, die tatsaechlich eine Zeile eingefuegt hat, bekommt eine
      // Id zurueck. `on conflict do nothing` liefert der anderen nichts, und
      // der partielle Unique-Index `plan_versions_one_draft_per_week` ist die
      // Autoritaet dafuer, dass es genau eine gibt.
      const angelegt = await tx.query<IdRow>(
        `insert into public.plan_versions (org_id, week_key)
         select id, $1 from public.organizations
         on conflict do nothing
         returning id`,
        [input.weekKey],
      );
      const selbstAngelegt = angelegt.rows[0];

      const entwurf =
        selbstAngelegt ??
        (
          await tx.query<IdRow>(
            `select id from public.plan_versions
              where week_key = $1 and published_at is null`,
            [input.weekKey],
          )
        ).rows[0];
      if (entwurf === undefined) {
        // Kein stiller Erfolg. Wenn nach dem Einfuegen kein Entwurf sichtbar
        // ist, stimmt eine Annahme nicht — das gehoert als Fehler gemeldet,
        // nicht als leere Woche.
        throw new Error("EYT-92: Entwurf der Woche konnte nicht ermittelt werden.");
      }

      // ---------------------------------------------------------------
      // Der erste Entwurf ueber einer veroeffentlichten Woche
      // ---------------------------------------------------------------
      // Ohne diesen Block verschwindet der bisherige Planstand STILL. Die
      // Leseroute zeigt den Entwurf, sobald es einen gibt (Entscheidungsnotiz
      // 2026-07-27, Punkt 2) — ein frisch angelegter, leerer Entwurf ersetzt
      // damit eine vollstaendig geplante, veroeffentlichte Woche durch eine
      // einzige neue Zeile. Fuer die Planerin saehe es aus, als haette ihr
      // Speichern alles andere geloescht.
      //
      // Der Entwurf startet deshalb als KOPIE der zuletzt veroeffentlichten
      // Version. `published_at` bleibt dabei NULL: die Kopien sind Entwurf,
      // nicht veroeffentlicht, und die Exclusion-Constraint aus 0010 greift
      // fuer sie bewusst nicht.
      //
      // Seit EYT-158 ist die Kopie fuer BEIDE Schreibpfade dieselbe: erst die
      // Tageskonfigurationen (stabile Tagesidentitaet, lock_version bleibt),
      // dann die Zuweisungen, an die kopierte Revision gehaengt. Sonst hinge
      // es vom ersten Klick nach dem Publish ab, ob ein Baustellentag im
      // Folgedraft eine Karte bleibt oder in Legacy-Zeilen zerfaellt.
      if (selbstAngelegt !== undefined) {
        const predecessorId = await this.zuletztVeroeffentlichte(tx, org.id, input.weekKey);
        if (predecessorId !== undefined) {
          await this.kopiereTageskonfigurationen(tx, entwurf.id, predecessorId, org.id);
          await this.kopiereZuweisungen(tx, entwurf.id, predecessorId, org.id);
        }
      }

      const kollisionen = await tx.query<OverlapQueryRow>(
        `select id, starts_at_utc, ends_at_utc
           from public.assignments
          where plan_version_id = $1
            and employee_id = $2
            and during && tstzrange($3::timestamptz, $4::timestamptz, '[)')
          order by starts_at_utc asc, id asc
          limit 1`,
        [entwurf.id, input.employeeId, input.startsAtUtc, input.endsAtUtc],
      );
      const kollision = kollisionen.rows[0];
      if (kollision !== undefined) {
        return {
          ok: false as const,
          problem: {
            kind: "OVERLAPPING_ASSIGNMENT" as const,
            overlap: {
              assignmentId: kollision.id,
              startsAtUtc: kollision.starts_at_utc,
              endsAtUtc: kollision.ends_at_utc,
            },
          },
        };
      }

      const eingefuegt = await tx.query<AssignmentInsertRow>(
        `insert into public.assignments
           (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
         select pv.org_id, pv.id, $2, $3, $4, $5
           from public.plan_versions pv
          where pv.id = $1
         returning id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc`,
        [entwurf.id, input.employeeId, input.worksiteId, input.startsAtUtc, input.endsAtUtc],
      );
      const zeile = eingefuegt.rows[0];
      if (zeile === undefined) {
        throw new Error("EYT-92: Einfuegen lieferte keine Zeile zurueck.");
      }

      // Fehlerinjektion GENAU hier: der Einsatz steht, Auditspur und Outbox
      // nicht. Wer die Transaktionsklammer aufbricht, bekommt einen Einsatz
      // ohne Auditspur — und dieser Punkt ist die einzige Stelle, an der sich
      // das beweisen laesst. Siehe `fehlerNach`.
      this.vielleichtScheitern("assignment");

      // ---------------------------------------------------------------
      // Auditspur und Outbox — SELBE Transaktion
      // ---------------------------------------------------------------
      // Nicht danach, nicht in einem Nachlauf. Ein Einsatz ohne Auditzeile
      // waere eine Aenderung, die niemand nachvollziehen kann; eine
      // Outbox-Nachricht ohne Einsatz waere eine Zustellung fuer etwas, das es
      // nicht gibt. Beides faellt mit dem Rollback dieser Transaktion weg.
      //
      // `actor_user_id` wird NICHT uebergeben, sondern kommt aus
      // `app.current_user_id()`: die Policy `audit_events_insert_in_org`
      // verlangt genau das und wuerde eine frei gewaehlte Urheberangabe
      // ablehnen (Migration 0008).
      await tx.query(
        `insert into public.audit_events
           (org_id, actor_user_id, event_type, subject_type, subject_id, context)
         values ($1, app.current_user_id(), 'planning.assignment_created', 'assignment', $2, $3::jsonb)`,
        [
          org.id,
          zeile.id,
          // Nur Ids und Codes. CLAUDE.md verbietet Personendaten im Kontext,
          // und `label` waere genau das.
          JSON.stringify({
            weekKey: input.weekKey,
            planVersionId: zeile.plan_version_id,
            employeeId: zeile.employee_id,
            worksiteId: zeile.worksite_id,
          }),
        ],
      );

      this.vielleichtScheitern("audit");

      await tx.query(
        `insert into public.outbox_messages
           (org_id, message_type, payload, idempotency_key)
         values ($1, 'planning.assignment_created', $2::jsonb, $3)`,
        [
          org.id,
          JSON.stringify({ assignmentId: zeile.id, weekKey: input.weekKey }),
          input.idempotencyKey,
        ],
      );

      // Zuletzt das Idempotenzergebnis. Die Reihenfolge ist gleichgueltig,
      // solange alles in einer Transaktion liegt — aber sie steht am Ende,
      // damit beim Lesen klar ist, dass sie den ABGESCHLOSSENEN Vorgang
      // festhaelt.
      await this.idempotenz.remember(
        tx,
        org.id,
        OPERATION,
        input.idempotencyKey,
        zeile.id,
        fingerabdruck,
      );

      this.vielleichtScheitern("outbox");

      return { ok: true as const, assignment: zuAssignment(zeile), replayed: false };
    });
  }

  /**
   * Plant einen Baustellentag als EINE atomare Wirkung (EYT-152).
   *
   * `worksite_days` ist die stabile Identitaet, die Konfiguration gehoert
   * dagegen genau zu dem durch `app.lock_week_draft` ermittelten Entwurf. Die
   * Funktion ist bewusst der einzige Erwerb des Klassen-2-Wochenlocks: ein
   * eigener Select/Insert-Pfad wuerde die in Migration 0019 bewiesene
   * Nebenlaeufigkeitsgrenze wieder auf Anwendungscode verteilen.
   */
  async planWorksiteDay(input: PlanWorksiteDayInput): Promise<PlanWorksiteDayResult> {
    try {
      return await this.runner.run({ userId: this.subjectUserId }, async (tx) => {
        const fingerabdruck = worksiteDayFingerprintOf(input);

        // Replay wird vor jeder veraenderlichen Beobachtung beantwortet. Der
        // Ergebnislesepfad ist absichtlich die security-definer-Funktion aus
        // 0019; `result_payload` besitzt kein Tabellen-SELECT-Grant.
        await this.idempotenz.lock(tx, PLAN_WORKSITE_DAY_OPERATION, input.idempotencyKey);
        const bekannt = await this.idempotenz.find(
          tx,
          PLAN_WORKSITE_DAY_OPERATION,
          input.idempotencyKey,
        );
        if (bekannt !== null) {
          if (bekannt.requestFingerprint !== fingerabdruck) {
            return { ok: false as const, problem: { kind: "IDEMPOTENCY_KEY_REUSED" as const } };
          }
          const payload = await this.idempotenz.readResultPayload(
            tx,
            PLAN_WORKSITE_DAY_OPERATION,
            input.idempotencyKey,
          );
          if (payload === null) {
            throw new Error("EYT-152: Idempotenzschluessel ohne Replay-Ergebnis.");
          }
          return { ok: true as const, worksiteDay: replayWorksiteDay(payload), replayed: true };
        }

        const orgs = await tx.query<OrgRow>("select id, time_zone from public.organizations");
        if (orgs.rows.length === 0)
          return { ok: false as const, problem: { kind: "NO_ORGANISATION" as const } };
        if (orgs.rows.length > 1)
          return { ok: false as const, problem: { kind: "AMBIGUOUS_ORGANISATION" as const } };
        const org = orgs.rows[0];
        if (org === undefined)
          return { ok: false as const, problem: { kind: "NO_ORGANISATION" as const } };

        const zone = createTimeZone(org.time_zone);
        if (!zone.ok) {
          throw new Error(`EYT-152: unbekannte Zeitzone "${org.time_zone}" in organizations.`);
        }
        const requestedDay = localDateParts(input.localDate);
        const requestedWeek = planningWeekKey(isoWeekOfLocalDate(requestedDay));
        if (requestedWeek !== input.weekKey) {
          return {
            ok: false as const,
            problem: { kind: "OUTSIDE_WEEK" as const, tatsaechlicheWoche: requestedWeek },
          };
        }

        for (const member of input.team) {
          const interval = TimeInterval.create(member.startsAtUtc, member.endsAtUtc);
          if (!interval.ok) {
            throw new Error(
              `EYT-152: ungueltiges Intervall erreichte die Domain (${interval.error}).`,
            );
          }
          // Halb-offen: ein Ende exakt am Folgetag um 00:00 gehoert noch zum
          // angefragten lokalen Tag. Ein Anfang oder ein letztes enthaltenes
          // Millisekundenfragment ausserhalb dagegen nicht.
          const startsOnRequestedDay = localBusinessDate(member.startsAtUtc, zone.timeZone);
          const endsOnRequestedDay = localBusinessDate(
            new Date(member.endsAtUtc.getTime() - 1),
            zone.timeZone,
          );
          if (
            !isSameLocalDate(startsOnRequestedDay, requestedDay) ||
            !isSameLocalDate(endsOnRequestedDay, requestedDay)
          ) {
            return { ok: false as const, problem: { kind: "INTERVAL_OUTSIDE_DAY" as const } };
          }
        }

        const worksite = await tx.query<ActiveRow>(
          "select active from public.worksites where id = $1",
          [input.worksiteId],
        );
        if (worksite.rows[0] === undefined || !worksite.rows[0].active) {
          return {
            ok: false as const,
            problem: { kind: "RESOURCE_NOT_SELECTABLE" as const, feld: "worksiteId" as const },
          };
        }
        for (const employeeId of [
          ...new Set(input.team.map((member) => member.employeeId)),
        ].sort()) {
          const employee = await tx.query<ActiveRow>(
            "select active from public.employees where id = $1",
            [employeeId],
          );
          if (employee.rows[0] === undefined || !employee.rows[0].active) {
            return {
              ok: false as const,
              problem: { kind: "RESOURCE_NOT_SELECTABLE" as const, feld: "employeeId" as const },
            };
          }
        }

        // Der Datenbankvertrag erwirbt/erstellt den Draft und haelt ihn bis zum
        // Commit. Kein zweiter Draft-Aufloesungspfad ist hier zulaessig.
        const draft = await tx.query<IdRow>("select app.lock_week_draft($1) as id", [
          input.weekKey,
        ]);
        const draftId = draft.rows[0]?.id;
        if (draftId === undefined) throw new Error("EYT-152: Wochenentwurf lieferte keine Id.");

        // Nur der INSERT-Gewinner übernimmt die veröffentlichte Baseline.
        // Der Helfer gibt bewusst nur die ID zurück. xmin benennt die
        // erzeugende Transaktion, ohne einen zweiten Draft-Auflösungspfad
        // oder einen racy Vorab-Existenztest einzuführen. Der Runner benutzt
        // eine Top-Level-Transaktion, keine Savepoints/Subtransaktionen.
        const selbstAngelegt = await tx.query<IdRow>(
          `select d.id from public.plan_versions d
           where d.id = $1 and d.org_id = $2 and d.xmin = pg_current_xact_id()::xid`,
          [draftId, org.id],
        );
        const predecessorId =
          selbstAngelegt.rows[0] === undefined
            ? undefined
            : await this.zuletztVeroeffentlichte(tx, org.id, input.weekKey);

        const insertedDay = await tx.query<WorksiteDayRow>(
          `insert into public.worksite_days (org_id, worksite_id, local_date)
         values ($1, $2, $3::date)
         on conflict (org_id, worksite_id, local_date) do nothing
         returning id`,
          [org.id, input.worksiteId, input.localDate],
        );
        const worksiteDayId =
          insertedDay.rows[0]?.id ??
          (
            await tx.query<WorksiteDayRow>(
              `select id from public.worksite_days
              where worksite_id = $1 and local_date = $2::date`,
              [input.worksiteId, input.localDate],
            )
          ).rows[0]?.id;
        if (worksiteDayId === undefined) {
          throw new Error("EYT-152: stabile Baustellentag-Identitaet nicht lesbar.");
        }

        // Klasse (3) ist abgeschlossen, bevor Konfigurationen (4) entstehen.
        // Stabile Tagesidentität und lock_version bleiben erhalten; die
        // Default-ID erzeugt eine NEUE Konfigurationsrevision (EYT-158).
        if (predecessorId !== undefined) {
          await this.kopiereTageskonfigurationen(tx, draftId, predecessorId, org.id);
        }

        const configuration = await tx.query<WorksiteDayConfigurationRow>(
          `insert into public.worksite_day_configurations (org_id, worksite_day_id, plan_version_id)
         values ($1, $2, $3)
         on conflict (plan_version_id, worksite_day_id) do nothing
         returning id, lock_version`,
          [org.id, worksiteDayId, draftId],
        );
        const config = configuration.rows[0];
        if (config === undefined) {
          throw new WorksiteDayRejectedError({ kind: "DUPLICATE_WORKSITE_DAY" });
        }

        // Globale Reihenfolge der Mitarbeiterlocks verhindert A->B / B->A-
        // Deadlocks. Die Konfiguration liegt bereits in der Transaktion und
        // verschwindet bei jedem Konflikt oder Fehler wieder mit ihr.
        const inheritedEmployees =
          predecessorId === undefined
            ? []
            : (
                await tx.query<{ employee_id: string }>(
                  `select distinct employee_id from public.assignments
             where plan_version_id = $1 and org_id = $2`,
                  [predecessorId, org.id],
                )
              ).rows.map((row) => row.employee_id);
        for (const employeeId of [
          ...new Set([...inheritedEmployees, ...input.team.map((member) => member.employeeId)]),
        ].sort()) {
          await tx.query("select app.lock_employee_planning($1)", [employeeId]);
        }

        // Erst NACH allen sortierten Employee-Locks (5) folgen Inserts (6).
        // Legacy-Einplanungen behalten NULL; keine Tag-Adoption/Backfills.
        if (predecessorId !== undefined) {
          await this.kopiereZuweisungen(tx, draftId, predecessorId, org.id);
        }

        const team: Array<CreatedWorksiteDayRow["team"][number]> = [];
        for (const member of [...input.team].sort((a, b) => {
          const byEmployee = a.employeeId.localeCompare(b.employeeId);
          if (byEmployee !== 0) return byEmployee;
          return a.startsAtUtc.getTime() - b.startsAtUtc.getTime();
        })) {
          const kollision = await tx.query<OverlapQueryRow>(
            `select id, starts_at_utc, ends_at_utc
             from public.assignments
            where plan_version_id = $1
              and employee_id = $2
              and during && tstzrange($3::timestamptz, $4::timestamptz, '[)')
            order by starts_at_utc asc, id asc
            limit 1`,
            [draftId, member.employeeId, member.startsAtUtc, member.endsAtUtc],
          );
          const overlap = kollision.rows[0];
          if (overlap !== undefined) {
            throw new WorksiteDayRejectedError({
              kind: "OVERLAPPING_ASSIGNMENT",
              overlap: {
                assignmentId: overlap.id,
                startsAtUtc: overlap.starts_at_utc,
                endsAtUtc: overlap.ends_at_utc,
              },
            });
          }

          const assignment = await tx.query<WorksiteDayAssignmentInsertRow>(
            `insert into public.assignments
             (org_id, plan_version_id, worksite_day_configuration_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
           select pv.org_id, pv.id, $2, $3, $4, $5, $6
             from public.plan_versions pv
            where pv.id = $1
           returning id, employee_id, starts_at_utc, ends_at_utc`,
            [
              draftId,
              config.id,
              member.employeeId,
              input.worksiteId,
              member.startsAtUtc,
              member.endsAtUtc,
            ],
          );
          const inserted = assignment.rows[0];
          if (inserted === undefined)
            throw new Error("EYT-152: Teamzuweisung wurde nicht angelegt.");
          team.push({
            assignmentId: inserted.id,
            employeeId: inserted.employee_id,
            startsAtUtc: inserted.starts_at_utc,
            endsAtUtc: inserted.ends_at_utc,
          });
        }

        const worksiteDay: CreatedWorksiteDayRow = {
          worksiteDayId,
          configurationId: config.id,
          worksiteId: input.worksiteId,
          localDate: input.localDate,
          lockVersion: config.lock_version,
          team,
        };

        await tx.query(
          `insert into public.audit_events
           (org_id, actor_user_id, event_type, subject_type, subject_id, context)
         values ($1, app.current_user_id(), 'planning.worksite_day_planned', 'worksite_day', $2, $3::jsonb)`,
          [
            org.id,
            worksiteDayId,
            JSON.stringify({
              weekKey: input.weekKey,
              configurationId: config.id,
              worksiteId: input.worksiteId,
              localDate: input.localDate,
              assignmentIds: team.map((member) => member.assignmentId),
            }),
          ],
        );

        await this.idempotenz.rememberWithResultPayload(
          tx,
          org.id,
          PLAN_WORKSITE_DAY_OPERATION,
          input.idempotencyKey,
          worksiteDayId,
          fingerabdruck,
          serialisiereWorksiteDay(worksiteDay),
        );
        return { ok: true as const, worksiteDay, replayed: false };
      });
    } catch (error) {
      if (error instanceof WorksiteDayRejectedError) {
        return { ok: false, problem: error.problem };
      }
      throw error;
    }
  }

  /**
   * Den Entwurf einer Woche veroeffentlichen (EYT-107).
   *
   * ## Was diese Methode selbst tut — und was die Datenbank tut
   *
   * Sie setzt `plan_versions.published_at` GENAU EINMAL. Alles Weitere gehoert
   * dem Schema und bleibt dort:
   *
   *   - Der Trigger `plan_versions_publish_assignments` (0010, security
   *     definer) spiegelt den Marker nach `assignments.published_at`. Diese
   *     Methode fasst die Spalte nicht an; das Spalten-Grant aus 0010 liesse es
   *     ohnehin nicht zu.
   *   - Dabei greift `assignments_no_published_overlap`: ueberlappende
   *     Zuweisungen derselben Person werden erst in dem Moment unzulaessig, in
   *     dem sie veroeffentlicht werden. Das kommt als `23P01` zurueck und wird
   *     unten in `BLOCKING_CONFLICT` uebersetzt.
   *   - `plan_versions_published_immutable` macht die Zeile danach
   *     unveraenderlich.
   *
   * ## Warum die Konfliktpruefung trotzdem hier steht
   *
   * Sie ist REDUNDANT zur Exclusion-Constraint, und das ist bewusst so: die
   * Datenbank verhindert den falschen Zustand, aber sie kann nicht sagen,
   * WELCHE Regel verletzt wurde. `23P01` ist fuer eine Planerin keine
   * Auskunft. Die Anwendungspruefung erzeugt die benannte Konfliktliste; die
   * Constraint erzeugt die Garantie unter Nebenlaeufigkeit. Wer die Pruefung
   * entfernt, bekommt weiterhin keinen falschen Zustand — aber eine
   * unbrauchbare Fehlermeldung.
   *
   * ## Reihenfolge, und warum sie so ist
   *
   * 1. Idempotenzsperre VOR jeder Abfrage — sonst sehen zwei gleichzeitige
   *    Anfragen mit demselben Schluessel beide „nicht vorhanden".
   * 2. Replay beantworten, bevor irgendetwas Veraenderliches gelesen wird.
   * 3. Entwurf mit `for update` sperren, BEVOR `expectedVersionId` verglichen
   *    wird. Ohne die Sperre laesen zwei Veroeffentlicher denselben Stand und
   *    beide faenden ihn aktuell.
   * 4. Fachpruefungen.
   * 5. Ein `update`.
   * 6. Audit, Outbox, Idempotenzergebnis — dieselbe Transaktion.
   */
  /**
   * Die zuletzt veroeffentlichte Version einer Woche — die Baseline, die ein
   * frisch angelegter Folgedraft uebernimmt. Dieselbe Ordnung wie in der
   * Leseroute (`published_at, created_at, id`), damit Schreib- und Lesepfad
   * denselben Vorgaenger meinen.
   */
  private async zuletztVeroeffentlichte(
    tx: TenantQuery,
    orgId: string,
    weekKey: string,
  ): Promise<string | undefined> {
    const zeilen = await tx.query<IdRow>(
      `select id from public.plan_versions
        where org_id = $1 and week_key = $2 and published_at is not null
        order by published_at desc, created_at desc, id desc
        limit 1`,
      [orgId, weekKey],
    );
    return zeilen.rows[0]?.id;
  }

  /**
   * Baseline-Kopie, Teil 1 (EYT-158): die Tageskonfigurationen des Vorgaengers
   * als NEUE Revisionen im Folgedraft. Die stabile Tagesidentitaet
   * (`worksite_day_id`) und `lock_version` bleiben; die Default-Id erzeugt die
   * neue Revision. Laeuft VOR dem Anlegen eigener Konfigurationen, damit ein im
   * Vorgaenger vorhandener Tag im Folgedraft als Duplikat erkannt wird.
   */
  private async kopiereTageskonfigurationen(
    tx: TenantQuery,
    draftId: string,
    predecessorId: string,
    orgId: string,
  ): Promise<void> {
    await tx.query(
      `insert into public.worksite_day_configurations
         (org_id, plan_version_id, worksite_day_id, lock_version)
       select org_id, $1, worksite_day_id, lock_version
         from public.worksite_day_configurations
        where plan_version_id = $2 and org_id = $3
        order by worksite_day_id`,
      [draftId, predecessorId, orgId],
    );
  }

  /**
   * Baseline-Kopie, Teil 2: die Zuweisungen des Vorgaengers, an die kopierte
   * Revision desselben Tages gehaengt. Legacy-Einplanungen (ohne Tag) behalten
   * NULL — keine Tag-Adoption, kein Backfill. `published_at` bleibt NULL: die
   * Kopien sind Entwurf, und die Exclusion-Constraint aus 0010 greift fuer sie
   * bewusst nicht. Muss NACH den Personensperren laufen, wo es welche gibt.
   */
  private async kopiereZuweisungen(
    tx: TenantQuery,
    draftId: string,
    predecessorId: string,
    orgId: string,
  ): Promise<void> {
    await tx.query(
      `insert into public.assignments
         (org_id, plan_version_id, worksite_day_configuration_id,
          employee_id, worksite_id, starts_at_utc, ends_at_utc)
       select a.org_id, $1, copied.id, a.employee_id, a.worksite_id,
              a.starts_at_utc, a.ends_at_utc
         from public.assignments a
         left join public.worksite_day_configurations original
           on original.id = a.worksite_day_configuration_id and original.org_id = a.org_id
         left join public.worksite_day_configurations copied
           on copied.worksite_day_id = original.worksite_day_id
          and copied.org_id = a.org_id and copied.plan_version_id = $1
        where a.plan_version_id = $2 and a.org_id = $3
        order by a.employee_id, a.starts_at_utc, a.id`,
      [draftId, predecessorId, orgId],
    );
  }

  async publishPlan(input: PublishPlanInput): Promise<PublishPlanResult> {
    const fingerabdruck = publishFingerprintOf(input);
    try {
      return await this.runner.run({ userId: this.subjectUserId }, async (tx) => {
        // --- 1. Sperre je Organisation, Vorgang und Schluessel ---------------
        await this.idempotenz.lock(tx, PUBLISH_OPERATION, input.idempotencyKey);

        // --- 2. Wiederholung? ------------------------------------------------
        const bekannt = await this.idempotenz.find(tx, PUBLISH_OPERATION, input.idempotencyKey);
        if (bekannt !== null) {
          if (bekannt.requestFingerprint !== fingerabdruck) {
            return { ok: false as const, problem: { kind: "IDEMPOTENCY_KEY_REUSED" as const } };
          }
          const wieder = await this.leseVeroeffentlichteVersion(tx, bekannt.subjectId);
          if (wieder === null) {
            // Der Schluessel ist bekannt, die Version nicht mehr sichtbar.
            // Erneut zu veroeffentlichen waere die schlechteste Antwort: derselbe
            // Vorgang bekaeme zwei verschiedene Versions-Ids.
            throw new Error(
              `EYT-107: Idempotenzschluessel verweist auf Planversion ${bekannt.subjectId}, die nicht mehr sichtbar ist.`,
            );
          }
          return { ok: true as const, version: wieder, replayed: true };
        }

        // --- 3. Organisation und Zeitzone ------------------------------------
        const orgs = await tx.query<OrgRow>("select id, time_zone from public.organizations");
        if (orgs.rows.length === 0)
          return { ok: false as const, problem: { kind: "NO_ORGANISATION" as const } };
        if (orgs.rows.length > 1)
          return { ok: false as const, problem: { kind: "AMBIGUOUS_ORGANISATION" as const } };
        const org = orgs.rows[0];
        if (org === undefined)
          return { ok: false as const, problem: { kind: "NO_ORGANISATION" as const } };

        // --- 4. Den Stand der Woche sperren und lesen ------------------------
        // `for update` sperrt jede Version dieser Woche bis zum Commit. Ohne
        // die Sperre entscheiden zwei gleichzeitige Veroeffentlicher unter
        // `read committed` beide auf ihrem eigenen Snapshot, finden beide den
        // Entwurf unveroeffentlicht und schreiben beide Nebenwirkungen.
        const versionen = await tx.query<VersionRow>(
          `select id, published_at from public.plan_versions
            where week_key = $1
            order by published_at asc nulls last, created_at asc, id asc
              for update`,
          [input.weekKey],
        );
        const entwurf = versionen.rows.find((zeile) => zeile.published_at === null) ?? null;
        const veroeffentlichte = versionen.rows.filter((zeile) => zeile.published_at !== null);

        if (entwurf === null) {
          const letzte = veroeffentlichte[veroeffentlichte.length - 1];
          if (letzte !== undefined) {
            // Die Woche ist fertig. Das ist etwas anderes als „veralteter
            // Stand": die Planerin muss nichts erneut entscheiden, sie muss
            // nur neu laden.
            return {
              ok: false as const,
              problem: { kind: "ALREADY_PUBLISHED" as const, versionId: letzte.id },
            };
          }
          return {
            ok: false as const,
            problem: { kind: "STALE_VERSION" as const, aktuelleVersionId: null },
          };
        }

        // --- 5. Arbeitet der Client auf DIESEM Stand? -------------------------
        if (input.expectedVersionId !== entwurf.id) {
          return {
            ok: false as const,
            problem: { kind: "STALE_VERSION" as const, aktuelleVersionId: entwurf.id },
          };
        }

        // --- 6. Die Zuweisungen des Entwurfs ---------------------------------
        const bestand = await tx.query<RawExistingRow>(
          `select id, employee_id, worksite_id, starts_at_utc, ends_at_utc
             from public.assignments
            where plan_version_id = $1
            order by starts_at_utc asc, id asc`,
          [entwurf.id],
        );

        // --- 7. Gehoert jede Zuweisung in diese Woche? -----------------------
        // Das Schema verknuepft `week_key` mit keinem Zeitstempel (Luecke aus
        // EYT-49). Ohne diese Pruefung koennte eine Woche mit fachlich fremden
        // Zeiten verbindlich werden.
        const fremde = zuweisungenAusserhalbDerWoche(
          bestand.rows.map((zeile) => ({ id: zeile.id, startsAtUtc: zeile.starts_at_utc })),
          input.weekKey,
          this.wochenschluessel,
          org.time_zone,
        );
        const ersteFremde = fremde[0];
        if (ersteFremde !== undefined) {
          return {
            ok: false as const,
            problem: {
              kind: "ASSIGNMENT_OUTSIDE_WEEK" as const,
              tatsaechlicheWoche: ersteFremde.tatsaechlicheWoche,
            },
          };
        }

        // --- 8. Blockierende Konflikte, benannt ------------------------------
        const blockierend = this.blockierendeKonflikte(bestand.rows, org);
        if (blockierend.length > 0) {
          return {
            ok: false as const,
            problem: { kind: "BLOCKING_CONFLICT" as const, conflicts: blockierend },
          };
        }

        // --- 9. Die EINE Schreibstelle ---------------------------------------
        // `published_by` kommt aus `app.current_user_id()`, nicht aus dem
        // Aufruf: die RLS-Policy aus 0015 verlangt genau das und wuerde eine
        // frei gewaehlte Urheberangabe ablehnen.
        //
        // `and published_at is null` ist der Guertel zum Hosentraeger der
        // Sperre: selbst wenn die Sperre eines Tages faellt, veroeffentlicht
        // dieses Statement keine bereits veroeffentlichte Version erneut.
        let veroeffentlichtAm: Date | null = null;
        const gesetzt = await tx.query<PublishedVersionRow>(
          `update public.plan_versions
              set published_at = now(),
                  published_by = app.current_user_id()
            where id = $1 and published_at is null
            returning id, week_key, published_at`,
          [entwurf.id],
        );
        const veroeffentlicht = gesetzt.rows[0];
        if (veroeffentlicht !== undefined) {
          if (veroeffentlicht.published_at === null) {
            // `returning` liefert den Stand NACH dem Update; `published_at`
            // kann dort nicht null sein, weil dieses Statement es gerade
            // gesetzt hat. Trifft es doch zu, stimmt eine Annahme nicht —
            // laut melden statt einen Zeitpunkt zu erfinden.
            throw new Error("EYT-107: published_at ist nach dem Veroeffentlichen leer.");
          }
          veroeffentlichtAm = veroeffentlicht.published_at;
        }
        if (veroeffentlicht === undefined) {
          // Null betroffene Zeilen heisst hier NICHT „schon veroeffentlicht" —
          // das haette Schritt 4 gesehen. Es heisst: die RLS-Policy hat die
          // Zeile aus dem Update herausgefiltert. Zwei Ursachen kommen in
          // Frage, und beide gehoeren laut gemeldet statt als Erfolg
          // beantwortet:
          //
          //   * die Datenbank sieht das Recht `planning.publish` nicht — dann
          //     laufen Anwendungs-Policy und Datenbank auseinander;
          //   * die Verbindung ist nicht der Laufzeitkanal, also
          //     `session_user <> 'easytree_app'` (P1 zu EYT-107). Das tritt
          //     ein, wenn die Anwendung ueber eine andere Loginrolle verbunden
          //     ist — etwa ueber den Supavisor-Transaktionspooler, wo
          //     `session_user` `postgres.<tenant>` lautet.
          //
          // Beide sind Betriebsfehler, keine fachlichen Ablehnungen. Deshalb
          // eine Ausnahme und kein `GatewayResult`: ein FORBIDDEN waere hier
          // eine Luege gegenueber einer Person, die das Recht sehr wohl hat.
          throw new Error(
            "EYT-107: Veroeffentlichen betraf keine Zeile. Die Datenbank verweigert entweder das Recht planning.publish oder den Laufzeitkanal (Migration 0015: app.is_runtime_channel).",
          );
        }

        // Fehlerinjektion GENAU hier: die Version steht, Auditspur und Outbox
        // nicht. Ohne diesen Punkt liesse sich die Transaktionsklammer nicht
        // belegen — ein gruener Normalfall zeigt nur, dass nichts schiefging.
        this.vielleichtScheitern("published");

        // --- 10. Audit, Outbox, Idempotenz — SELBE Transaktion ---------------
        const assignmentIds = bestand.rows.map((zeile) => zeile.id);

        await tx.query(
          `insert into public.audit_events
             (org_id, actor_user_id, event_type, subject_type, subject_id, context)
           values ($1, app.current_user_id(), 'planning.plan_published', 'plan_version', $2, $3::jsonb)`,
          [
            org.id,
            veroeffentlicht.id,
            // Nur Ids und Zahlen. Die Liste der Zuweisungen bleibt draussen:
            // sie waechst unbegrenzt, und der Auditkontext ist keine Kopie des
            // Plans. Die Anzahl genuegt, um eine Veroeffentlichung
            // wiederzuerkennen.
            JSON.stringify({
              weekKey: veroeffentlicht.week_key,
              assignmentCount: assignmentIds.length,
            }),
          ],
        );

        this.vielleichtScheitern("audit");

        await tx.query(
          `insert into public.outbox_messages
             (org_id, message_type, payload, idempotency_key)
           values ($1, 'planning.plan_published', $2::jsonb, $3)`,
          [
            org.id,
            JSON.stringify({
              planVersionId: veroeffentlicht.id,
              weekKey: veroeffentlicht.week_key,
            }),
            input.idempotencyKey,
          ],
        );

        await this.idempotenz.remember(
          tx,
          org.id,
          PUBLISH_OPERATION,
          input.idempotencyKey,
          veroeffentlicht.id,
          fingerabdruck,
        );

        this.vielleichtScheitern("outbox");

        return {
          ok: true as const,
          version: {
            versionId: veroeffentlicht.id,
            weekKey: veroeffentlicht.week_key,
            publishedAtUtc: veroeffentlichtAm as Date,
            assignmentIds,
          },
          replayed: false,
        };
      });
    } catch (fehler) {
      const code = fehlerCode(fehler);
      if (code === EXCLUSION_VIOLATION) {
        // Der Sync-Trigger hat die Zuweisungen gestempelt und
        // `assignments_no_published_overlap` hat abgelehnt. Die Anwendung
        // haette es in Schritt 8 sehen muessen; kommt es trotzdem hier an,
        // gewinnt die Datenbank — und der Aufrufer bekommt denselben
        // Fachcode, nicht einen Serverfehler.
        return {
          ok: false,
          problem: {
            kind: "BLOCKING_CONFLICT",
            conflicts: [
              {
                code: "EMPLOYEE_INTERVAL_OVERLAP",
                blocking: true,
                message: KONFLIKT_TEXT.EMPLOYEE_INTERVAL_OVERLAP,
              },
            ],
          },
        };
      }
      if (code === UNIQUE_VIOLATION) {
        // Zwei gleichzeitige Anfragen mit demselben Schluessel, bei denen die
        // Sperre nicht griff: der unique-Index ist die letzte Autoritaet.
        return { ok: false, problem: { kind: "IDEMPOTENCY_KEY_REUSED" } };
      }
      throw fehler;
    }
  }

  /** Eine bereits veroeffentlichte Version samt ihrer Zuweisungen, oder `null`. */
  private async leseVeroeffentlichteVersion(
    tx: TenantQuery,
    versionId: string,
  ): Promise<PublishedPlanVersionRow | null> {
    const version = await tx.query<PublishedVersionRow>(
      `select id, week_key, published_at from public.plan_versions where id = $1`,
      [versionId],
    );
    const zeile = version.rows[0];
    if (zeile === undefined || zeile.published_at === null) return null;

    const zuweisungen = await tx.query<IdRow>(
      `select id from public.assignments
        where plan_version_id = $1
        order by starts_at_utc asc, id asc`,
      [versionId],
    );
    return {
      versionId: zeile.id,
      weekKey: zeile.week_key,
      publishedAtUtc: zeile.published_at,
      assignmentIds: zuweisungen.rows.map((eintrag) => eintrag.id),
    };
  }

  /**
   * Jede blockierende Regel, die es HEUTE gibt, auf den ganzen Entwurf.
   *
   * Verwendet dieselbe Domainfunktion wie die Validierungsroute: jede
   * Zuweisung wird einmal als „Entwurf" gegen alle uebrigen geprueft, mit
   * sich selbst ausgeschlossen. Eine eigene Ueberlappungsschleife hier waere
   * eine zweite Regel neben derselben Aussage.
   *
   * `NO_CAPACITY_LIMIT`: es gibt im Fachschema keine Wochenstundengrenze. Eine
   * geratene Zahl waere eine erfundene Regel. Die Kapazitaetspruefung ist
   * damit heute wirkungslos — das steht so im Runbook und wird nicht als
   * geprueft behauptet.
   *
   * NICHT geprueft, weil es dafuer keinen Produzenten gibt: `EMPLOYEE_INACTIVE`
   * und `WORKSITE_NOT_PUBLISHABLE`. Beide Codes stehen im Vertrag, aber keine
   * Regel im Repository erzeugt sie.
   */
  private blockierendeKonflikte(
    zeilen: readonly RawExistingRow[],
    org: OrgRow,
  ): ValidatedConflict[] {
    const zone = createTimeZone(org.time_zone);
    if (!zone.ok) {
      throw new Error(`EYT-107: unbekannte Zeitzone "${org.time_zone}" in organizations.`);
    }

    const alle: AssignmentDraft[] = [];
    for (const zeile of zeilen) {
      const intervall = TimeInterval.create(zeile.starts_at_utc, zeile.ends_at_utc);
      if (!intervall.ok) {
        // `assignments_interval_ordered` (0007) laesst das nicht zu. Kommt es
        // trotzdem an, ist eine Annahme falsch — laut melden, nicht ueberspringen.
        throw new Error(`EYT-107: Zuweisung ${zeile.id} traegt ein ungueltiges Intervall.`);
      }
      alle.push({
        id: unsafeIdentifier<AssignmentId>(zeile.id),
        orgId: unsafeIdentifier<OrgId>(org.id),
        employeeId: unsafeIdentifier<EmployeeId>(zeile.employee_id),
        worksiteId: unsafeIdentifier<WorksiteId>(zeile.worksite_id),
        interval: intervall.interval,
      });
    }

    const gesehen = new Set<ConflictCode>();
    const konflikte: ValidatedConflict[] = [];
    for (const kandidat of alle) {
      for (const konflikt of validateDraft({
        draft: kandidat,
        existing: alle,
        excludeId: kandidat.id,
        timeZone: zone.timeZone,
        capacityLimit: NO_CAPACITY_LIMIT,
      })) {
        if (!konflikt.blocking || gesehen.has(konflikt.code)) continue;
        gesehen.add(konflikt.code);
        konflikte.push({
          code: konflikt.code,
          blocking: true,
          message: KONFLIKT_TEXT[konflikt.code],
        });
      }
    }
    return konflikte;
  }

  /**
   * Kontrollierter Abbruch fuer den Teilwirkungsnachweis.
   *
   * Ohne einen erzwungenen Fehler MITTEN im Schreibvorgang laesst sich nicht
   * belegen, dass die Transaktionsklammer haelt — ein gruener Normalfall zeigt
   * nur, dass nichts schiefging.
   *
   * Der Punkt kommt als KONSTRUKTORARGUMENT, nicht aus der Umgebung. Eine
   * fruehere Fassung las `EASYTREE_FAULT_AFTER` in `AppModule`; das war
   * falsch, denn ein Testhaken in der Produktionswurzel ist ein
   * Produktionsschalter, egal wie er heisst. Der Integrationstest konstruiert
   * dieses Repository ohnehin direkt und setzt den Punkt dort — die
   * Produktionsverdrahtung uebergibt ihn nie und laeuft damit immer auf `null`.
   *
   * Der Schalter kann nur SCHEITERN lassen, nie etwas gruen faerben. Er ist
   * damit das Gegenteil eines Skip-Schalters.
   */
  private vielleichtScheitern(punkt: "assignment" | "audit" | "outbox" | "published"): void {
    if (this.fehlerNach === punkt) {
      throw new Error(`EYT-92: erzwungener Fehler nach "${punkt}" (Testhaken).`);
    }
  }
}
