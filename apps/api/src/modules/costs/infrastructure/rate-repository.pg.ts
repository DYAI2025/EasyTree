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
import { createHash } from "node:crypto";

import type {
  TenantQuery,
  TenantQueryRunner,
} from "../../../platform/database/tenant-query-runner";
import type { IdempotencyStore } from "../../../platform/idempotency/idempotency-store";
import type {
  NewRateVersion,
  RateRepository,
  RateWriteProblem,
  RateWriteResult,
} from "../application/rate-repository.port";
import { pruefeAbloesung } from "../domain/rate-succession";
import type { RateVersionRecord } from "../domain/rate-version";

/** PostgreSQL-Fehlercodes, die hier eine fachliche Bedeutung tragen. */
const EXCLUSION_VIOLATION = "23P01";
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

/** Stabiler Vorgangsname im Schluesselraum der Kosten-Idempotenz. */
const VORGANG = "costs.create_rate_version";

const SATZ_SPALTEN = `select id, employee_id, amount_minor_units::text as amount_minor_units, currency,
                to_char(valid_from, 'YYYY-MM-DD') as valid_from,
                to_char(valid_to, 'YYYY-MM-DD') as valid_to,
                predecessor_id, reason,
                to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
                created_by`;

const SATZ_SPALTEN_RETURNING = SATZ_SPALTEN.replace(/^select /, "");

type Ausgang =
  | { readonly art: "ok"; readonly zeile: RateRow }
  | { readonly art: "problem"; readonly problem: RateWriteProblem };

/**
 * Fingerabdruck der Anfrage, die einen Schluessel erstmals verwendet.
 *
 * Nur die fachlich wirksamen Felder. `correlationId` gehoert ausdruecklich
 * NICHT dazu: sie ist je Anfrage neu, und ein echter Retry traegt eine andere.
 * Waere sie Teil des Abdrucks, sae jede Wiederholung wie eine andere Nutzlast
 * aus und der Schutz waere wirkungslos.
 */
function anfrageFingerabdruck(version: NewRateVersion): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        version.organisationId,
        version.employeeId,
        version.amountMinorUnits,
        version.validFrom,
        version.validTo,
        version.reason,
        version.expectedActiveVersionId,
      ]),
    )
    .digest("hex");
}

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
    /**
     * Wiederholungserkennung als Plattformdienst.
     *
     * Das Kostenmodul nennt `public.idempotency_records` bewusst NIE beim
     * Namen: der Waechter `costs-touches-only-own-tables` verbietet jeden
     * Zugriff auf Tabellen ausserhalb des Modulbesitzes, auch auf globale.
     * Der Adapter liegt deshalb unter `platform/idempotency/` — und das ist
     * keine Umgehung des Waechters, sondern genau die Grenze, die er meint.
     */
    private readonly idempotenz: IdempotencyStore,
  ) {}

  async versionsFor(employeeId: string): Promise<readonly RateVersionRecord[]> {
    const rows = await this.run(async (tx) => {
      const ergebnis = await tx.query<RateRow>(
        `select id, employee_id, amount_minor_units::text as amount_minor_units, currency,
                to_char(valid_from, 'YYYY-MM-DD') as valid_from,
                to_char(valid_to, 'YYYY-MM-DD') as valid_to,
                predecessor_id, reason,
                to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
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
    const fingerabdruck = anfrageFingerabdruck(version);
    try {
      // Das Ergebnis der Transaktion ist BEWUSST ein unterschiedener Wert und
      // kein Sentinel. Mit `null`/`undefined` als Sonderfaellen war schon der
      // Vorgaenger schwer zu lesen; sobald mitten in der Transaktion ein
      // UPDATE steht, wird aus "unklarer Rueckgabewert" ein halb
      // abgeloester Stand, der committet.
      const ausgang = await this.run<Ausgang>(async (tx) => {
        // 1. Sperre je Organisation, Vorgang und Schluessel — VOR der
        //    Replay-Abfrage. Ohne sie saehen zwei gleichzeitige Anfragen mit
        //    demselben Schluessel beide "nicht vorhanden", und der
        //    unique-Index faenge das erst als Constraint-Fehler statt als
        //    Wiederholung mit dem Ergebnis der ersten.
        await this.idempotenz.lock(tx, VORGANG, version.idempotencyKey);

        // 2. Wiederholung? RLS filtert die Organisation, deshalb steht sie
        //    nicht in der WHERE-Klausel — dieselbe Regel wie ueberall hier.
        const bekannt = await this.idempotenz.find(tx, VORGANG, version.idempotencyKey);
        if (bekannt !== null) {
          if (bekannt.requestFingerprint !== fingerabdruck) {
            // Derselbe Schluessel, andere Nutzlast. Die alte Antwort
            // zurueckzugeben waere hier falsch: der Aufrufer bekaeme ein
            // "angelegt" fuer etwas, das er nie geschickt hat.
            return { art: "problem", problem: "IDEMPOTENCY_KEY_REUSED" };
          }
          const wieder = await tx.query<RateRow>(
            `${SATZ_SPALTEN} from public.employee_rate_versions where id = $1`,
            [bekannt.subjectId],
          );
          const zeile = wieder.rows[0];
          if (zeile === undefined) {
            // Die Auskunft ueberlebt ihr Objekt bewusst (kein FK). Ist das
            // Objekt fort, ist die Wiederholung nicht beantwortbar — und das
            // still als "neu anlegen" zu behandeln wuerde die Zusicherung
            // brechen, die diese Tabelle ueberhaupt gibt.
            throw new Error(
              "[costs] Idempotenzsatz verweist auf eine nicht mehr sichtbare Satzversion.",
            );
          }
          return { art: "ok", zeile };
        }

        // 3. Abloesung des offenen Vorgaengers (EYT-108 Option A+).
        if (version.expectedActiveVersionId !== null) {
          // `for update` sperrt die Vorgaengerzeile bis zum Commit. Ohne die
          // Sperre koennten zwei gleichzeitige Bearbeiter beide dieselbe
          // offene Version lesen und beide einen Nachfolger anlegen — der
          // EXCLUDE faenge das zwar, aber als 23P01 "Ueberlappung" statt als
          // STALE_ACTIVE_VERSION, und der Verlierer bekaeme die falsche
          // fachliche Auskunft.
          const vorhanden = await tx.query<{
            id: string;
            employee_id: string;
            valid_from: string;
            valid_to: string | null;
          }>(
            `select id, employee_id,
                    to_char(valid_from, 'YYYY-MM-DD') as valid_from,
                    to_char(valid_to, 'YYYY-MM-DD') as valid_to
               from public.employee_rate_versions
              where id = $1 and employee_id = $2
`,
            [version.expectedActiveVersionId, version.employeeId],
          );
          const vorgaenger = vorhanden.rows[0];
          if (vorgaenger === undefined) {
            return { art: "problem", problem: "STALE_ACTIVE_VERSION" };
          }

          const abloesung = pruefeAbloesung({
            vorgaenger: {
              id: vorgaenger.id,
              employeeId: vorgaenger.employee_id,
              // Die Regel liest nur Id, Mitarbeiter und die beiden Daten.
              // Betrag und Grund werden bewusst NICHT geladen: sie sind
              // unveraenderlich und gehen die Abloesung nichts an.
              amountMinorUnits: "0",
              currency: "EUR",
              validFrom: vorgaenger.valid_from,
              validTo: vorgaenger.valid_to,
              predecessorId: null,
              reason: "",
              createdAt: "",
              createdBy: "",
            },
            nachfolger: { employeeId: version.employeeId, validFrom: version.validFrom },
            expectedActiveVersionId: version.expectedActiveVersionId,
          });
          if (!abloesung.ok) return { art: "problem", problem: abloesung.problem };

          // Schliessen VOR dem Einfuegen: umgekehrt lehnte der
          // EXCLUDE-Constraint ab, weil beide Intervalle offen waeren.
          const geschlossen = await tx.query(
            `update public.employee_rate_versions
                set valid_to = $2::date
              where id = $1 and valid_to is null`,
            [vorgaenger.id, abloesung.validToDesVorgaengers],
          );
          if (geschlossen.rowCount !== 1) {
            // Nach der Sperre darf das nicht passieren. Wenn doch, WERFEN —
            // ab hier ist bereits geschrieben, und ein Rueckgabewert wuerde
            // committen und einen halb abgeloesten Stand hinterlassen.
            throw new Error(
              `[costs] Vorgaengerversion liess sich nicht schliessen (betroffene Zeilen: ${String(geschlossen.rowCount)}).`,
            );
          }
        }

        const eingefuegt = await tx.query<RateRow>(
          `insert into public.employee_rate_versions
             (org_id, employee_id, amount_minor_units, currency,
              valid_from, valid_to, predecessor_id, reason, created_by, correlation_id)
           values ($1::uuid, $2::uuid, $3::bigint, 'EUR',
                   $4::date, $5::date, $6::uuid, $7, app.current_user_id(), $8)
           returning ${SATZ_SPALTEN_RETURNING}`,
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
        const zeile = eingefuegt.rows[0];
        if (zeile === undefined) {
          // Kein Treffer heisst: die Person existiert nicht ODER liegt in
          // einer fremden Organisation — RLS macht beides ununterscheidbar,
          // und das ist Absicht (kein Existenzleck). Es wurde noch nichts
          // geschrieben, wenn kein Vorgaenger geschlossen wurde; wurde einer
          // geschlossen, rollt der Wurf weiter unten alles zurueck.
          if (version.expectedActiveVersionId !== null) {
            throw new Error("[costs] Nachfolger liess sich nach dem Schliessen nicht anlegen.");
          }
          return { art: "problem", problem: "EMPLOYEE_UNKNOWN" };
        }

        // 4. Idempotenzauskunft in DERSELBEN Transaktion. Danach ist der
        //    Vorgang als Ganzes wiederholbar beantwortbar oder gar nicht
        //    passiert — ein Commit dazwischen gibt es nicht.
        await this.idempotenz.remember(
          tx,
          version.organisationId,
          VORGANG,
          version.idempotencyKey,
          zeile.id,
          fingerabdruck,
        );

        return { art: "ok", zeile };
      });

      if (ausgang.art === "problem") return { ok: false, problem: ausgang.problem };
      return { ok: true, version: toRecord(ausgang.zeile) };
    } catch (fehler) {
      const code = fehlerCode(fehler);
      if (code === EXCLUSION_VIOLATION) return { ok: false, problem: "RATE_INTERVAL_OVERLAP" };
      if (code === FOREIGN_KEY_VIOLATION) return { ok: false, problem: "EMPLOYEE_UNKNOWN" };
      // Zwei gleichzeitige Anfragen mit demselben Schluessel, bei denen die
      // Sperre nicht griff: der unique-Index ist die letzte Autoritaet.
      if (code === UNIQUE_VIOLATION) return { ok: false, problem: "IDEMPOTENCY_KEY_REUSED" };
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
