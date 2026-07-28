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
import type {
  CreateAssignmentInput,
  CreateAssignmentResult,
  CreatedAssignmentRow,
  PlanningWrites,
} from "../application/planning-writes.port";
import type { TenantQueryRunner } from "../../../platform/database/tenant-query-runner";

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

export class PlanningWriteRepository implements PlanningWrites {
  constructor(
    private readonly runner: TenantQueryRunner,
    private readonly subjectUserId: string,
    /** Bildet einen Instant auf seine ISO-Woche in der Zone der Organisation ab. */
    private readonly wochenschluessel: (instant: Date, timeZone: string) => string,
  ) {}

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

      // Entwurf der Woche holen oder anlegen. `on conflict do nothing` plus
      // nachgelagertes `select` statt `returning` allein: bei gleichzeitigem
      // Anlegen liefert `returning` keine Zeile, und ein blindes Weiterlaufen
      // haette hier `undefined` als plan_version_id eingesetzt. Der partielle
      // Unique-Index `plan_versions_one_draft_per_week` ist die Autoritaet.
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

      const assignment: CreatedAssignmentRow = {
        id: zeile.id,
        planVersionId: zeile.plan_version_id,
        employeeId: zeile.employee_id,
        worksiteId: zeile.worksite_id,
        startsAtUtc: zeile.starts_at_utc,
        endsAtUtc: zeile.ends_at_utc,
      };
      return { ok: true as const, assignment };
    });
  }
}
