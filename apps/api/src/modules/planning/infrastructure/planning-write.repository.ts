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

interface VersionRow {
  readonly id: string;
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

interface OverlapQueryRow {
  readonly id: string;
  readonly starts_at_utc: Date;
  readonly ends_at_utc: Date;
}

interface IdempotencyRow {
  readonly subject_id: string;
  readonly request_fingerprint: string;
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
      await tx.query("select app.lock_idempotency_key($1, $2)", [OPERATION, input.idempotencyKey]);

      const fingerabdruck = fingerprintOf(input);
      const frueher = await tx.query<IdempotencyRow>(
        `select subject_id, request_fingerprint from public.idempotency_records
          where operation = $1 and idempotency_key = $2`,
        [OPERATION, input.idempotencyKey],
      );
      const bekannt = frueher.rows[0];
      if (bekannt !== undefined) {
        if (bekannt.request_fingerprint !== fingerabdruck) {
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
      if (selbstAngelegt !== undefined) {
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
        `insert into public.idempotency_records
           (org_id, operation, idempotency_key, subject_id, request_fingerprint)
         values ($1, $2, $3, $4, $5)`,
        [org.id, OPERATION, input.idempotencyKey, zeile.id, fingerprintOf(input)],
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
  private vielleichtScheitern(punkt: "assignment" | "audit" | "outbox"): void {
    if (this.fehlerNach === punkt) {
      throw new Error(`EYT-92: erzwungener Fehler nach "${punkt}" (Testhaken).`);
    }
  }
}
