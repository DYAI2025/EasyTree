/**
 * Der Kosten-Snapshot gegen PostgreSQL (EYT-109 Task 11, EYT-138).
 *
 * Kein `pg`-Import: dieses Modul sieht nur `TenantQuery` — die Regel
 * `api-dependency-allowlist` erlaubt den Treiber ausschliesslich unter
 * `platform/`. Jeder Aufruf laeuft in EINER Transaktion mit gesetztem
 * Mandantenkontext; RLS und `app.has_permission` entscheiden dort unabhaengig
 * von der Anwendungsschicht noch einmal (Migration 0018).
 *
 * ## Warum Schreiben genau eine Transaktion ist
 *
 * Ein Snapshot ist ein historisches Dokument: Migration 0018 erteilt weder ein
 * update- noch ein delete-Grant und legt entsprechend auch keine solchen
 * Policies an. Was faelschlich geschrieben wurde, BLEIBT — es gibt keinen Weg,
 * einen Kopf ohne Positionen nachtraeglich zu vervollstaendigen oder
 * loszuwerden. „Alles oder nichts" ist deshalb keine Bequemlichkeit, sondern
 * die einzige Form, die zu dieser Tabelle passt.
 *
 * Aus demselben Grund WIRFT dieses Repository, sobald nach dem Kopf-Insert
 * etwas schiefgeht. Ein Rueckgabewert liesse die Transaktion committen.
 *
 * ## Warum die Positionen mit einer Anweisung entstehen
 *
 * `insert … select … from unnest(...)` schreibt N Zeilen in EINER Rundreise.
 * Jede zusaetzliche Anweisung waere eine weitere Stelle, an der die Transaktion
 * abbrechen kann, und bei einer Woche mit vielen Zuweisungen waeren es hunderte.
 *
 * ## Warum `id`, `created_at` und `created_by` nicht aus dem Prozess kommen
 *
 * Migration 0018 erteilt `insert` SPALTENWEISE. `id` und `created_at` stehen
 * nicht in der Liste — die Serverdefaults bleiben ausserhalb der Reichweite des
 * Clients, und der Versuch, sie mitzugeben, endet mit 42501. `created_by` steht
 * zwar in der Liste, wird aber aus `app.current_user_id()` gefuellt, weil die
 * insert-Policy `created_by = auth.uid()` verlangt: ein Wert aus der Eingabe
 * waere eine Behauptung, die die Policy prueft und ablehnt.
 *
 * ## Warum Lesen nichts nachrechnet
 *
 * `read` selektiert ausschliesslich aus `cost_snapshots` und
 * `cost_snapshot_positions` — kein Join auf `employee_rate_versions`, kein
 * Zugriff auf Planungstabellen (Planentscheidung D7, zusaetzlich abgesichert
 * durch den Waechter `costs-touches-only-own-tables`). Wuerde hier gerechnet,
 * deutete eine spaetere Satzaenderung historische Kosten um: derselbe Snapshot
 * zeigte andere Zahlen, und der Export (EYT-110) lieferte fuer dieselbe Id
 * zweimal etwas anderes.
 *
 * ## Warum Betraege als Zeichenkette reisen
 *
 * `bigint` kommt aus `pg` als String zurueck, und das ist gut so: eine
 * JSON-Zahl verlaesst oberhalb von 2^53 still die Genauigkeit. Der Wert wird
 * hier nirgends durch `number` geschleust — hinein als `String(...)`, heraus
 * ueber `::text` und `BigInt(...)`.
 */
import { createHash } from "node:crypto";

import type {
  TenantQuery,
  TenantQueryRunner,
} from "../../../platform/database/tenant-query-runner";
import type { IdempotencyStore } from "../../../platform/idempotency/idempotency-store";
import type {
  CostSnapshotRepository,
  NewCostSnapshot,
  SnapshotReadResult,
  SnapshotWriteResult,
  StoredCostSnapshot,
  StoredCostSnapshotPosition,
} from "../application/cost-snapshot-repository.port";

/** Stabiler Vorgangsname im Schluesselraum der Kosten-Idempotenz. */
const VORGANG = "costs.create_cost_snapshot";

/**
 * Fingerabdruck der Anfrage, die einen Schluessel erstmals verwendet.
 *
 * Nur die fachlich wirksamen Felder — die Positionen vollstaendig, weil zwei
 * Snapshots mit gleicher Summe und verschiedenen Positionen verschiedene
 * Dokumente sind.
 *
 * `correlationId` gehoert ausdruecklich NICHT dazu: sie ist je Anfrage neu, und
 * ein echter Retry traegt eine andere. Waere sie Teil des Abdrucks, saehe jede
 * Wiederholung wie eine andere Nutzlast aus und der Schutz waere wirkungslos.
 * Gleiche Begruendung und gleiche Bauart wie in `rate-repository.pg.ts`.
 */
function anfrageFingerabdruck(eingabe: NewCostSnapshot): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        eingabe.organisationId,
        eingabe.planVersionId,
        eingabe.worksiteId,
        eingabe.weekKey,
        eingabe.timeZone,
        eingabe.currency,
        eingabe.ruleVersion,
        // `bigint` ist in JSON nicht darstellbar — ohne die Umwandlung wuerfe
        // `JSON.stringify` einen TypeError, und zwar erst zur Laufzeit.
        String(eingabe.totalMinorUnits),
        eingabe.positions.map((position) => [
          position.assignmentId,
          position.worksiteId,
          position.worksiteLabel,
          position.employeeId,
          position.employeeLabel,
          position.localDate,
          String(position.durationMilliseconds),
          position.rateVersionId,
          String(position.amountMinorUnits),
        ]),
      ]),
    )
    .digest("hex");
}

interface KopfZeile {
  readonly id: string;
  readonly org_id: string;
  readonly plan_version_id: string;
  readonly worksite_id: string | null;
  readonly week_key: string;
  readonly time_zone: string;
  readonly currency: string;
  readonly rule_version: string;
  readonly total_minor_units: string;
  readonly created_by: string;
  readonly correlation_id: string;
  readonly created_at: Date;
}

interface PositionsZeile {
  readonly id: string;
  readonly assignment_id: string;
  readonly worksite_id: string;
  readonly worksite_label: string;
  readonly employee_id: string;
  readonly employee_label: string;
  readonly local_date: string;
  readonly duration_ms: string;
  readonly rate_version_id: string;
  readonly amount_minor_units: string;
}

function zuPosition(zeile: PositionsZeile): StoredCostSnapshotPosition {
  return {
    id: zeile.id,
    assignmentId: zeile.assignment_id,
    worksiteId: zeile.worksite_id,
    worksiteLabel: zeile.worksite_label,
    employeeId: zeile.employee_id,
    employeeLabel: zeile.employee_label,
    localDate: zeile.local_date,
    durationMilliseconds: BigInt(zeile.duration_ms),
    rateVersionId: zeile.rate_version_id,
    amountMinorUnits: BigInt(zeile.amount_minor_units),
  };
}

export class PgCostSnapshotRepository implements CostSnapshotRepository {
  constructor(
    private readonly runner: TenantQueryRunner,
    private readonly subjectUserId: string,
    /**
     * Wiederholungserkennung als Plattformdienst.
     *
     * Das Kostenmodul nennt `public.idempotency_records` bewusst NIE beim
     * Namen: der Waechter `costs-touches-only-own-tables` verbietet jeden
     * Zugriff auf Tabellen ausserhalb des Modulbesitzes, auch auf globale.
     */
    private readonly idempotenz: IdempotencyStore,
  ) {}

  async create(eingabe: NewCostSnapshot): Promise<SnapshotWriteResult> {
    const fingerabdruck = anfrageFingerabdruck(eingabe);

    return this.run<SnapshotWriteResult>(async (tx) => {
      // 1. Sperre je Organisation, Vorgang und Schluessel — VOR der
      //    Replay-Abfrage. Ohne sie saehen zwei gleichzeitige Anfragen mit
      //    demselben Schluessel beide "nicht vorhanden".
      await this.idempotenz.lock(tx, VORGANG, eingabe.idempotencyKey);

      // 2. Wiederholung? RLS filtert die Organisation, deshalb steht sie nicht
      //    in der WHERE-Klausel — dieselbe Regel wie ueberall hier.
      const bekannt = await this.idempotenz.find(tx, VORGANG, eingabe.idempotencyKey);
      if (bekannt !== null) {
        if (bekannt.requestFingerprint !== fingerabdruck) {
          // Derselbe Schluessel, andere Nutzlast. Die alte Antwort
          // zurueckzugeben waere hier falsch: die Aufruferin bekaeme ein
          // "angelegt" fuer etwas, das sie nie geschickt hat.
          return { ok: false, problem: "IDEMPOTENCY_KEY_REUSED" };
        }
        // Erster Aufruf und Wiederholung sind durch Konstruktion nicht zu
        // unterscheiden: beide bekommen dieselbe Id. Ein Replay-Kennzeichen
        // waere eine Information, die die Aufruferin nicht braucht und mit der
        // sie etwas anderes tun koennte als beim ersten Mal.
        return { ok: true, snapshotId: bekannt.subjectId };
      }

      // 3. Den Kanal VOR dem Schreiben feststellen.
      //
      //    Gemessen am 12.08.2026 im ersten db-gates-Lauf dieser Suite, und es
      //    widerlegt eine naheliegende Annahme: eine verletzte `with check`-
      //    Klausel liefert bei INSERT NICHT null betroffene Zeilen, sondern
      //    WIRFT — SQLSTATE 42501, "new row violates row-level security policy".
      //    Nur eine `using`-Klausel filtert. Die Null-Zeilen-Mechanik aus
      //    `planning-write.repository.ts` traegt deshalb hier nicht: dort ist
      //    das Veroeffentlichen ein UPDATE mit `using`, hier ist es ein INSERT
      //    mit `with check`. Zwei verschiedene Mechanismen, und die Uebertragung
      //    war falsch.
      //
      //    Ein `catch (42501) -> WRITE_CHANNEL_REJECTED` waere die bequeme
      //    Reparatur und die falsche: 42501 ist mehrdeutig — fehlendes
      //    Spaltenrecht ODER RLS-Verstoss ODER fehlendes `costs.calculate`. Der
      //    Port sagt ausdruecklich, dieser Grund bedeute AUSSCHLIESSLICH den
      //    falschen Kanal und duerfe nicht in einen Auth- oder Mandantenfehler
      //    umgedeutet werden. Also wird genau das gefragt, was gemeint ist.
      //
      //    Ein fehlendes Recht bleibt damit ein WURF und wird nicht zu einer
      //    fachlichen Antwort geglaettet — die `CostAccessPolicy` hat
      //    `costs.calculate` bereits geprueft, ein Widerspruch zwischen beiden
      //    Haelften ist ein Defekt und gehoert laut gemeldet (EYT-106 AK4).
      const kanal = await tx.query<{ ok: boolean }>("select app.is_runtime_channel() as ok");
      if (kanal.rows[0]?.ok !== true) {
        return { ok: false, problem: "WRITE_CHANNEL_REJECTED" };
      }

      // 4. Der Kopf. Ohne `id` und ohne `created_at` — es gibt kein Recht
      //    darauf (Migration 0018, Abschnitt 5).
      const kopf = await tx.query<{ id: string }>(
        `insert into public.cost_snapshots
           (org_id, plan_version_id, worksite_id, week_key, time_zone, currency,
            rule_version, total_minor_units, created_by, correlation_id)
         values ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'EUR',
                 $6, $7::bigint, app.current_user_id(), $8)
         returning id`,
        [
          eingabe.organisationId,
          eingabe.planVersionId,
          eingabe.worksiteId,
          eingabe.weekKey,
          eingabe.timeZone,
          eingabe.ruleVersion,
          String(eingabe.totalMinorUnits),
          eingabe.correlationId,
        ],
      );
      const angelegt = kopf.rows[0];
      if (angelegt === undefined) {
        // Nach der Kanalpruefung ist das unerklaerlich: ein INSERT liefert
        // entweder die Zeile oder wirft. WERFEN statt einen fachlichen Grund
        // zu erfinden — ein `WRITE_CHANNEL_REJECTED` waere hier eine Diagnose,
        // die gerade widerlegt wurde, und schickte die Betreiberin auf die
        // Suche nach einem Kanalproblem, das es nicht gibt.
        throw new Error(
          "[costs] Der Snapshot-Kopf lieferte keine Zeile, obwohl der Laufzeitkanal bestaetigt ist. Die Transaktion wird zurueckgerollt.",
        );
      }
      const snapshotId = angelegt.id;

      // 4. Alle Positionen mit EINER Anweisung. `ordinal` entsteht aus dem
      //    Index — der Port fuehrt bewusst kein eigenes Feld, weil zwei Quellen
      //    derselben Ordnung sich widersprechen koennten, ohne dass es jemandem
      //    auffiele: beide Varianten saehen sortiert aus.
      if (eingabe.positions.length > 0) {
        const eingefuegt = await tx.query(
          `insert into public.cost_snapshot_positions
             (org_id, snapshot_id, assignment_id, worksite_id, worksite_label,
              employee_id, employee_label, local_date, duration_ms,
              rate_version_id, amount_minor_units, ordinal)
           select $1::uuid, $2::uuid, p.assignment_id, p.worksite_id, p.worksite_label,
                  p.employee_id, p.employee_label, p.local_date, p.duration_ms,
                  p.rate_version_id, p.amount_minor_units, p.ordinal
             from unnest($3::uuid[], $4::uuid[], $5::text[], $6::uuid[], $7::text[],
                         $8::date[], $9::bigint[], $10::uuid[], $11::bigint[], $12::int[])
                  as p(assignment_id, worksite_id, worksite_label, employee_id,
                       employee_label, local_date, duration_ms, rate_version_id,
                       amount_minor_units, ordinal)`,
          [
            eingabe.organisationId,
            snapshotId,
            eingabe.positions.map((position) => position.assignmentId),
            eingabe.positions.map((position) => position.worksiteId),
            eingabe.positions.map((position) => position.employeeLabel),
            eingabe.positions.map((position) => position.employeeId),
            eingabe.positions.map((position) => position.worksiteLabel),
            eingabe.positions.map((position) => position.localDate),
            eingabe.positions.map((position) => String(position.durationMilliseconds)),
            eingabe.positions.map((position) => position.rateVersionId),
            eingabe.positions.map((position) => String(position.amountMinorUnits)),
            eingabe.positions.map((_position, index) => index),
          ],
        );
        if (eingefuegt.rowCount !== eingabe.positions.length) {
          // WERFEN, nicht zurueckgeben: der Kopf steht bereits. Ein
          // Rueckgabewert liesse die Transaktion committen und hinterliesse
          // einen Kopf ohne seine Positionen — einen Snapshot ueber 0,00 EUR,
          // den die Datenbank mangels update- und delete-Recht nie wieder
          // loswird.
          throw new Error(
            `[costs] Snapshot ${snapshotId}: ${String(eingefuegt.rowCount)} von ${String(eingabe.positions.length)} Positionen geschrieben. Die Transaktion wird zurueckgerollt.`,
          );
        }
      }

      // 5. Idempotenzauskunft in DERSELBEN Transaktion. Danach ist der Vorgang
      //    als Ganzes wiederholbar beantwortbar oder gar nicht passiert — ein
      //    Commit dazwischen gibt es nicht.
      await this.idempotenz.remember(
        tx,
        eingabe.organisationId,
        VORGANG,
        eingabe.idempotencyKey,
        snapshotId,
        fingerabdruck,
      );

      return { ok: true, snapshotId };
    });
  }

  async read(snapshotId: string): Promise<SnapshotReadResult> {
    return this.run<SnapshotReadResult>(async (tx) => {
      // Beide Abfragen im SELBEN `run`, also in EINER Transaktion: eine Folge
      // unabhaengiger Aufrufe saehe zwei Lesezeitpunkte — derselbe Fehler wie
      // beim Satzfaecher (EYT-138), nur eine Ebene hoeher.
      //
      // Kein `where org_id = …`. Die Mandantengrenze ist RLS; ein Filter aus
      // Anwendungscode waere eine zweite, stillschweigend abweichende Wahrheit.
      const kopf = await tx.query<KopfZeile>(
        `select id, org_id, plan_version_id, worksite_id, week_key, time_zone,
                currency, rule_version, total_minor_units::text as total_minor_units,
                created_by, correlation_id, created_at
           from public.cost_snapshots
          where id = $1`,
        [snapshotId],
      );
      const zeile = kopf.rows[0];
      if (zeile === undefined) {
        // "gibt es nicht", "gehoert einem anderen Mandanten" und "das Subjekt
        // darf Kosten nicht sehen" fallen zu EINER Antwort zusammen. Die
        // Unterscheidung waere ein Existenzleck — wer Ids durchprobiert,
        // erfuehre an der Antwort, welche echt sind.
        return { ok: false, problem: "SNAPSHOT_NOT_FOUND" };
      }

      // `local_date` mit `to_char`: eine `date`-Spalte wandelt der Treiber
      // sonst in ein `Date` in der Zeitzone des PROZESSES — und ein Ortstag ist
      // genau das nicht. `created_at` dagegen roh, weil `timestamptz` einen
      // absoluten Zeitpunkt traegt und der Port ein `Date` verlangt.
      const positionen = await tx.query<PositionsZeile>(
        `select id, assignment_id, worksite_id, worksite_label, employee_id,
                employee_label,
                to_char(local_date, 'YYYY-MM-DD') as local_date,
                duration_ms::text as duration_ms,
                rate_version_id,
                amount_minor_units::text as amount_minor_units
           from public.cost_snapshot_positions
          where snapshot_id = $1
          order by ordinal`,
        [snapshotId],
      );

      const snapshot: StoredCostSnapshot = {
        id: zeile.id,
        organisationId: zeile.org_id,
        planVersionId: zeile.plan_version_id,
        worksiteId: zeile.worksite_id,
        weekKey: zeile.week_key,
        timeZone: zeile.time_zone,
        // Durch `check (currency = 'EUR')` in Migration 0018 garantiert.
        currency: "EUR",
        ruleVersion: zeile.rule_version,
        // Die GESPEICHERTE Summe, nicht die der Positionen. Wer hier
        // nachrechnete, machte aus dem Snapshot einen Cache.
        totalMinorUnits: BigInt(zeile.total_minor_units),
        createdAt: zeile.created_at,
        createdBy: zeile.created_by,
        correlationId: zeile.correlation_id,
        positions: positionen.rows.map(zuPosition),
      };
      return { ok: true, snapshot };
    });
  }

  private run<T>(work: (tx: TenantQuery) => Promise<T>): Promise<T> {
    return this.runner.run({ userId: this.subjectUserId }, work);
  }
}
