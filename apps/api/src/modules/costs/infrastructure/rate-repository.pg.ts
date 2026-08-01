/**
 * Satzverwaltung gegen PostgreSQL (EYT-108).
 *
 * Kein `pg`-Import: dieses Modul sieht nur `TenantQuery` — die Regel
 * `api-dependency-allowlist` erlaubt den Treiber ausschliesslich unter
 * `platform/`. Jeder Aufruf laeuft in EINER Transaktion mit gesetztem
 * Mandantenkontext; RLS und `app.has_cost_permission` entscheiden dort
 * unabhaengig von der Anwendungsschicht noch einmal (EYT-106 AK4).
 *
 * ## Warum Betraege als Zeichenkette reisen
 *
 * `bigint` kommt aus `pg` als String zurueck, und das ist gut so: eine
 * JSON-Zahl verlaesst oberhalb von 2^53 still die Genauigkeit. Der Wert wird
 * hier NICHT in `number` gewandelt — nirgends auf dem Weg.
 */
import type {
  TenantQuery,
  TenantQueryRunner,
} from "../../../platform/database/tenant-query-runner";
import type {
  NewRateVersion,
  RateRepository,
  RateWriteResult,
} from "../application/rate-repository.port";
import type { RateVersionRecord } from "../domain/rate-version";

/** PostgreSQL-Fehlercodes, die hier eine fachliche Bedeutung tragen. */
const EXCLUSION_VIOLATION = "23P01";
const FOREIGN_KEY_VIOLATION = "23503";

interface RateRow {
  readonly id: string;
  readonly employee_id: string;
  readonly amount_minor_units: string;
  readonly currency: string;
  readonly valid_from: string;
  readonly valid_to: string | null;
  readonly predecessor_id: string | null;
  readonly reason: string;
  readonly created_at: string;
  readonly created_by: string;
}

function toRecord(row: RateRow): RateVersionRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    amountMinorUnits: row.amount_minor_units,
    currency: "EUR",
    validFrom: row.valid_from,
    validTo: row.valid_to,
    predecessorId: row.predecessor_id,
    reason: row.reason,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export class PgRateRepository implements RateRepository {
  constructor(
    private readonly runner: TenantQueryRunner,
    private readonly subjectUserId: string,
  ) {}

  async versionsFor(employeeId: string): Promise<readonly RateVersionRecord[]> {
    const rows = await this.run(async (tx) => {
      const ergebnis = await tx.query<RateRow>(
        `select id, employee_id, amount_minor_units::text as amount_minor_units, currency,
                to_char(valid_from, 'YYYY-MM-DD') as valid_from,
                to_char(valid_to, 'YYYY-MM-DD') as valid_to,
                predecessor_id, reason,
                to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
                created_by
           from public.employee_rate_versions
          where employee_id = $1
          order by valid_from desc`,
        [employeeId],
      );
      return ergebnis.rows;
    });
    return rows.map(toRecord);
  }

  async append(version: NewRateVersion): Promise<RateWriteResult> {
    try {
      const row = await this.run(async (tx) => {
        // Der erwartete aktive Stand wird IN DERSELBEN Transaktion geprueft.
        // Ausserhalb waere zwischen Lesen und Schreiben Platz fuer eine
        // fremde Aenderung — genau der Fall, den STALE_VERSION meldet.
        if (version.expectedActiveVersionId !== null) {
          const vorhanden = await tx.query<{ id: string }>(
            `select id from public.employee_rate_versions
              where id = $1 and employee_id = $2`,
            [version.expectedActiveVersionId, version.employeeId],
          );
          if (vorhanden.rowCount === 0) return null;
        }

        const eingefuegt = await tx.query<RateRow>(
          `insert into public.employee_rate_versions
             (org_id, employee_id, amount_minor_units, currency,
              valid_from, valid_to, predecessor_id, reason, created_by, correlation_id)
           values ($1::uuid, $2::uuid, $3::bigint, 'EUR',
                   $4::date, $5::date, $6::uuid, $7, app.current_user_id(), $8)
           returning id, employee_id, amount_minor_units::text as amount_minor_units, currency,
                     to_char(valid_from, 'YYYY-MM-DD') as valid_from,
                     to_char(valid_to, 'YYYY-MM-DD') as valid_to,
                     predecessor_id, reason,
                     to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
                     created_by`,
          [
            version.organisationId,
            version.employeeId,
            version.amountMinorUnits,
            version.validFrom,
            version.validTo,
            version.expectedActiveVersionId,
            version.reason,
            version.correlationId,
          ],
        );
        // Kein Treffer heisst: die Person existiert nicht ODER liegt in einer
        // fremden Organisation — RLS macht beides ununterscheidbar, und das
        // ist Absicht (kein Existenzleck).
        return eingefuegt.rows[0] ?? undefined;
      });

      if (row === null) return { ok: false, problem: "STALE_ACTIVE_VERSION" };
      if (row === undefined) return { ok: false, problem: "EMPLOYEE_UNKNOWN" };
      return { ok: true, version: toRecord(row) };
    } catch (fehler) {
      const code = fehlerCode(fehler);
      if (code === EXCLUSION_VIOLATION) return { ok: false, problem: "RATE_INTERVAL_OVERLAP" };
      if (code === FOREIGN_KEY_VIOLATION) return { ok: false, problem: "EMPLOYEE_UNKNOWN" };
      throw fehler;
    }
  }

  private run<T>(work: (tx: TenantQuery) => Promise<T>): Promise<T> {
    return this.runner.run({ userId: this.subjectUserId }, work);
  }
}

function fehlerCode(fehler: unknown): string | null {
  if (typeof fehler === "object" && fehler !== null && "code" in fehler) {
    const code = (fehler as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}
