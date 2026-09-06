/**
 * Wiederholungserkennung als Plattformdienst (EYT-92, EYT-108).
 *
 * ## Warum hier und nicht im Modul
 *
 * `public.idempotency_records` (Migration 0012) ist generisch ENTWORFEN: die
 * Spalte `operation` trennt die Schluesselraeume, und die Migration nennt
 * `'planning.create_assignment'` ausdruecklich nur als Beispiel. Die Tabelle
 * gehoert deshalb keinem Modul — im Besitzregister traegt sie `owner: null`.
 *
 * Der Waechter `costs-touches-only-own-tables` verbietet dem Kostenmodul
 * jeden Tabellenzugriff ausserhalb seines Besitzes, und zwar auch auf globale
 * Tabellen: er prueft `owner !== "costs"` und meldet `Besitzer: global`
 * genauso wie ein fremdes Modul. Eine Registrierung allein oeffnet den Weg
 * also nicht.
 *
 * Deshalb steht der SQL-Zugriff hier, unter `platform/`. Das Kostenmodul
 * kennt nur den Port (`IdempotencyStore`) und nie einen Tabellennamen. Die
 * Alternative — eine zweite, kostenmodul-eigene Tabelle — waere eine
 * Duplizierung genau des Musters, das 0012 bereits plattformweit loest.
 *
 * ## Warum die Methoden eine Transaktion hereinbekommen
 *
 * Die Idempotenzauskunft MUSS im selben Commit liegen wie die fachliche
 * Wirkung. Ein eigener Verbindungspool waere ein zweiter Commit, und dazwischen
 * gaebe es einen Zustand, in dem die Wirkung existiert und die Auskunft nicht
 * — ein Retry legte dann ein zweites Mal an. Der Aufrufer reicht deshalb den
 * `TenantQuery` seiner laufenden Transaktion herein.
 */
import type { TenantQuery } from "../database/tenant-query-runner";

export interface IdempotencyRecord {
  /** Id des beim ERSTEN Aufruf erzeugten Objekts. */
  readonly subjectId: string;
  readonly requestFingerprint: string;
}

export interface IdempotencyStore {
  /**
   * Serialisiert Replay-Pruefung und Anlage je Organisation, Vorgang und
   * Schluessel. Transaktionsgebunden — die Sperre faellt mit dem Commit.
   *
   * Muss VOR `find` laufen: ohne sie saehen zwei gleichzeitige Anfragen mit
   * demselben Schluessel beide "nicht vorhanden".
   */
  lock(tx: TenantQuery, operation: string, key: string): Promise<void>;

  /** Das Ergebnis eines frueheren Aufrufs, oder `null`. */
  find(tx: TenantQuery, operation: string, key: string): Promise<IdempotencyRecord | null>;

  /**
   * Liest einen historischen Antwortkoerper ausschliesslich ueber die
   * operation-gebundene Datenbankfunktion. Nicht jeder Vorgang hat ein Payload.
   */
  readResultPayload(tx: TenantQuery, operation: string, key: string): Promise<unknown | null>;

  /** Haelt das Ergebnis des ERSTEN Aufrufs fest. */
  remember(
    tx: TenantQuery,
    organisationId: string,
    operation: string,
    key: string,
    subjectId: string,
    requestFingerprint: string,
  ): Promise<void>;

  /** Speichert ein unveraenderliches Erstantwort-Payload im selben Commit. */
  rememberWithResultPayload(
    tx: TenantQuery,
    organisationId: string,
    operation: string,
    key: string,
    subjectId: string,
    requestFingerprint: string,
    resultPayload: unknown,
  ): Promise<void>;
}

export const IDEMPOTENCY_STORE = "PLATFORM_IDEMPOTENCY_STORE";
