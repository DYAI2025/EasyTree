/**
 * `public.idempotency_records` als Plattformadapter (EYT-92, EYT-108).
 *
 * Die einzige Stelle ausserhalb des Planungsmoduls, die diese Tabelle beim
 * Namen nennt. Warum sie hier liegt und nicht im aufrufenden Modul, steht im
 * Port (`idempotency-store.ts`).
 *
 * Kein `pg`-Import: dieser Adapter sieht nur `TenantQuery`. Die
 * Mandantengrenze zieht RLS, deshalb steht `org_id` in KEINER WHERE-Klausel —
 * dieselbe Regel wie in allen Repositories dieses Projekts.
 */
import type { TenantQuery } from "../database/tenant-query-runner";
import type { IdempotencyRecord, IdempotencyStore } from "./idempotency-store";

export class PgIdempotencyStore implements IdempotencyStore {
  async lock(tx: TenantQuery, operation: string, key: string): Promise<void> {
    // `app.lock_idempotency_key` (Migration 0012) nimmt einen
    // transaktionsgebundenen Advisory-Lock ueber Organisation, Vorgang und
    // Schluessel. Die Organisation leitet die Funktion selbst aus dem
    // RLS-Kontext ab und glaubt sie dem Aufrufer nicht.
    await tx.query(`select app.lock_idempotency_key($1, $2)`, [operation, key]);
  }

  async find(tx: TenantQuery, operation: string, key: string): Promise<IdempotencyRecord | null> {
    const ergebnis = await tx.query<{ subject_id: string; request_fingerprint: string }>(
      `select subject_id, request_fingerprint
         from public.idempotency_records
        where operation = $1 and idempotency_key = $2`,
      [operation, key],
    );
    const zeile = ergebnis.rows[0];
    if (zeile === undefined) return null;
    return { subjectId: zeile.subject_id, requestFingerprint: zeile.request_fingerprint };
  }

  async readResultPayload(
    tx: TenantQuery,
    operation: string,
    key: string,
  ): Promise<unknown | null> {
    const ergebnis = await tx.query<{ payload: unknown | null }>(
      `select app.read_idempotency_result($1, $2) as payload`,
      [operation, key],
    );
    return ergebnis.rows[0]?.payload ?? null;
  }

  async remember(
    tx: TenantQuery,
    organisationId: string,
    operation: string,
    key: string,
    subjectId: string,
    requestFingerprint: string,
  ): Promise<void> {
    await tx.query(
      `insert into public.idempotency_records
         (org_id, operation, idempotency_key, subject_id, request_fingerprint)
       values ($1::uuid, $2, $3, $4::uuid, $5)`,
      [organisationId, operation, key, subjectId, requestFingerprint],
    );
  }

  async rememberWithResultPayload(
    tx: TenantQuery,
    organisationId: string,
    operation: string,
    key: string,
    subjectId: string,
    requestFingerprint: string,
    resultPayload: unknown,
  ): Promise<void> {
    await tx.query(
      `insert into public.idempotency_records
         (org_id, operation, idempotency_key, subject_id, request_fingerprint, result_payload)
       values ($1::uuid, $2, $3, $4::uuid, $5, $6::jsonb)`,
      [
        organisationId,
        operation,
        key,
        subjectId,
        requestFingerprint,
        JSON.stringify(resultPayload),
      ],
    );
  }
}
