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
 * **Ehrlichkeitshinweis zur Grenze dieser Pruefung.** `read committed` schuetzt
 * nicht gegen zwei gleichzeitige Einfuegungen, die einander noch nicht sehen.
 * Zwei parallele Speichervorgaenge derselben Person koennen deshalb beide
 * durchgehen. Die dauerhafte Absicherung ist eine Exclusion-Constraint auch fuer
 * Entwuerfe; sie ist NICHT Teil dieses Slices und darf nicht als vorhanden
 * gemeldet werden. Was hier steht, faengt den Alltagsfall — eine Planerin, ein
 * Formular — und nicht das Wettrennen.
 */
import {
  createTimeZone,
  NO_CAPACITY_LIMIT,
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
  PlanningWrites,
  ValidateDraftInput,
  ValidateDraftResult,
} from "../application/planning-writes.port";
import type { AssignmentDraft, ConflictCode } from "../domain/assignment-draft";
import { validateDraft } from "../domain/draft-validation";
import type { TenantQueryRunner } from "../../../platform/database/tenant-query-runner";

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

interface OverlapQueryRow {
  readonly id: string;
  readonly starts_at_utc: Date;
  readonly ends_at_utc: Date;
}

interface SubjectRow {
  readonly subject_id: string;
}

/** Vorgangsname im Idempotenzspeicher. Siehe Migration 0012. */
const OPERATION = "planning.create_assignment";

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
    /** Testhaken fuer den Teilwirkungsnachweis. `null` im Normalbetrieb. */
    private readonly fehlerNach: "assignment" | "audit" | "outbox" | null = null,
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

      // Bestand derselben Woche — Entwurf, sonst zuletzt Veroeffentlichtes.
      // Dieselbe Auswahl wie im Lesepfad, damit die Pruefung gegen das prueft,
      // was die Planerin auch sieht.
      const bestand = await tx.query<RawExistingRow>(
        `select a.id, a.employee_id, a.worksite_id, a.starts_at_utc, a.ends_at_utc
           from public.assignments a
           join public.plan_versions pv on pv.id = a.plan_version_id
          where pv.week_key = $1
          order by a.starts_at_utc asc, a.id asc`,
        [input.weekKey],
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
      // Wiederholungsschutz: hat dieser Schluessel schon ein Ergebnis?
      // ---------------------------------------------------------------
      // VOR jeder Schreibwirkung. Steht die Abfrage weiter unten, hat der
      // zweite Aufruf bereits einen Entwurf angelegt, bevor er merkt, dass er
      // eine Wiederholung ist.
      const frueher = await tx.query<SubjectRow>(
        `select subject_id from public.idempotency_records
          where operation = $1 and idempotency_key = $2`,
        [OPERATION, input.idempotencyKey],
      );
      const bekannt = frueher.rows[0];
      if (bekannt !== undefined) {
        const wieder = await tx.query<AssignmentInsertRow>(
          `select id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc
             from public.assignments where id = $1`,
          [bekannt.subject_id],
        );
        const zeile = wieder.rows[0];
        if (zeile === undefined) {
          // Der Schluessel ist bekannt, das Objekt nicht mehr da. Still einen
          // NEUEN Einsatz anzulegen waere die schlechteste Antwort: der
          // Aufrufer bekaeme fuer denselben Vorgang zwei verschiedene Ids.
          throw new Error(
            `EYT-92: Idempotenzschluessel verweist auf Einsatz ${bekannt.subject_id}, den es nicht mehr gibt.`,
          );
        }
        return { ok: true as const, assignment: zuAssignment(zeile), replayed: true };
      }

      // ---------------------------------------------------------------
      // Pruefen und Einfuegen serialisieren
      // ---------------------------------------------------------------
      // Ab hier darf keine zweite Transaktion desselben Mandanten dieselbe
      // Person gleichzeitig einplanen. Siehe Migration 0012: `read committed`
      // laesst sonst beide Ueberlappungspruefungen durchgehen, weil keine die
      // noch nicht committete Zeile der anderen sieht.
      await tx.query("select app.lock_employee_planning($1, $2)", [org.id, input.employeeId]);

      // Entwurf der Woche holen oder anlegen. `on conflict do nothing` plus
      // nachgelagertes `select` statt `returning` allein: bei gleichzeitigem
      // Anlegen liefert `returning` keine Zeile, und ein blindes Weiterlaufen
      // haette hier `undefined` als plan_version_id eingesetzt. Der partielle
      // Unique-Index `plan_versions_one_draft_per_week` ist die Autoritaet.
      const entwurfVorher = await tx.query<IdRow>(
        `select id from public.plan_versions
          where week_key = $1 and published_at is null`,
        [input.weekKey],
      );
      const entwurfExistierte = entwurfVorher.rows.length > 0;

      await tx.query(
        `insert into public.plan_versions (org_id, week_key)
         select id, $1 from public.organizations
         on conflict do nothing`,
        [input.weekKey],
      );
      const entwuerfe = await tx.query<IdRow>(
        `select id from public.plan_versions
          where week_key = $1 and published_at is null`,
        [input.weekKey],
      );
      const entwurf = entwuerfe.rows[0];
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
      if (!entwurfExistierte) {
        await tx.query(
          `insert into public.assignments
             (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
           select a.org_id, $1, a.employee_id, a.worksite_id, a.starts_at_utc, a.ends_at_utc
             from public.assignments a
             join public.plan_versions pv on pv.id = a.plan_version_id
            where pv.week_key = $2
              and pv.published_at is not null
              and pv.id = (
                select pv2.id from public.plan_versions pv2
                 where pv2.week_key = $2 and pv2.published_at is not null
                 order by pv2.published_at asc, pv2.created_at asc, pv2.id asc
                 limit 1 offset (
                   select greatest(count(*) - 1, 0) from public.plan_versions pv3
                    where pv3.week_key = $2 and pv3.published_at is not null
                 )
              )`,
          [entwurf.id, input.weekKey],
        );
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
      await tx.query(
        `insert into public.idempotency_records (org_id, operation, idempotency_key, subject_id)
         values ($1, $2, $3, $4)`,
        [org.id, OPERATION, input.idempotencyKey, zeile.id],
      );

      this.vielleichtScheitern("outbox");

      return { ok: true as const, assignment: zuAssignment(zeile), replayed: false };
    });
  }

  /**
   * Kontrollierter Abbruch fuer den Teilwirkungsnachweis.
   *
   * Ohne einen erzwungenen Fehler MITTEN im Schreibvorgang laesst sich nicht
   * belegen, dass die Transaktionsklammer haelt — ein gruener Normalfall zeigt
   * nur, dass nichts schiefging. Der Punkt wird von aussen benannt
   * (`EASYTREE_FAULT_AFTER`), damit der Test nicht den Quelltext aendern muss;
   * eine zurueckgenommene Quelltextaenderung liefe nie wieder.
   *
   * Der Schalter kann nur SCHEITERN lassen, nie etwas gruen faerben. Er ist
   * damit das Gegenteil eines Skip-Schalters — und `loadConfig` kennt ihn
   * nicht, weil `EASYTREE_*` nach CLAUDE.md Tests steuert und niemals die
   * Anwendung.
   */
  private vielleichtScheitern(punkt: "assignment" | "audit" | "outbox"): void {
    if (this.fehlerNach === punkt) {
      throw new Error(`EYT-92: erzwungener Fehler nach "${punkt}" (EASYTREE_FAULT_AFTER).`);
    }
  }
}
