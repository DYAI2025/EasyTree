/**
 * Gemeinsame Transportbausteine (EYT-47).
 *
 * ## Warum `strictObject` überall
 *
 * `z.object` **entfernt** unbekannte Schlüssel und meldet Erfolg. Ein
 * Antwortschema mit `z.object` würde also grün bleiben, wenn der Server ein
 * undokumentiertes Feld mitschickt — etwa interne Kosten oder eine fremde
 * `orgId`. Das veröffentlichte OpenAPI-Dokument sagt gleichzeitig
 * `additionalProperties: false`. Beides zusammen ist genau die Lücke, durch die
 * ein Domainfeld unbemerkt über die Leitung geht.
 *
 * `packages/config/src/schema.ts` verwendet aus demselben Grund
 * `z.strictObject` für die Umgebungsvariablen. Hier gilt dieselbe Hausregel.
 *
 * ## Warum das Instant-Format festgenagelt ist
 *
 * `z.iso.datetime()` akzeptiert `…T06:00:00Z`, `…T06:00:00.0Z` und
 * `…T06:00:00.000Z` — drei Schreibweisen desselben Zeitpunkts. Der
 * Idempotenz-Fingerabdruck bildet sich über den kanonischen Rumpf; drei
 * Schreibweisen ergäben drei Fingerabdrücke, ein legitimer Client-Retry würde
 * als neue Anfrage gelten und die Schreiboperation liefe zweimal. Deshalb genau
 * eine erlaubte Form: UTC, drei Nachkommastellen, `Z`.
 */
import { z } from "zod";

/** Genau eine erlaubte Schreibweise: `2026-08-03T06:00:00.000Z`. Kein Offset. */
export const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const InstantSchema = z
  .string()
  .regex(
    INSTANT_PATTERN,
    "Zeitpunkt muss UTC mit drei Nachkommastellen sein, z. B. 2026-08-03T06:00:00.000Z",
  )
  .describe("UTC-Zeitpunkt nach ISO 8601, drei Nachkommastellen, Suffix Z");

export type Instant = z.infer<typeof InstantSchema>;

/** UUID v4 als Bezeichner. Die nominale Härtung liegt in der Domain, nicht im Transport. */
export const IdSchema = z.uuid().describe("UUID");

/**
 * Fehlerantwort.
 *
 * Bewusst kein zweites Fehlerformat: die Felder spiegeln exakt das, was
 * `apps/api/src/common/http-exception.filter.ts` heute schon ausgibt
 * (RFC-7807-nah, mit `correlationId`). Ein Test in `apps/api` prüft die
 * Übereinstimmung gegen die echte Filterausgabe.
 */
export const ProblemDocumentSchema = z.strictObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  correlationId: z.string(),
});

export type ProblemDocument = z.infer<typeof ProblemDocumentSchema>;

/**
 * Cursor-Pagination.
 *
 * Cursor statt Offset, weil Planungsdaten sich zwischen zwei Seitenabrufen
 * ändern: mit Offset überspringt oder wiederholt man Einträge, sobald jemand
 * parallel einen Einsatz anlegt. `nextCursor === null` heisst „letzte Seite",
 * nicht „keine Daten".
 */
export function cursorPage<T extends z.ZodTypeAny>(item: T) {
  return z.strictObject({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    pageSize: z.number().int().positive(),
  });
}

/**
 * Idempotenzschlüssel für schreibende Kommandos.
 *
 * Wird als Header `Idempotency-Key` übertragen. Der Schlüsselraum ist
 * mandantengebunden (ADR-001 Z. 87: „Alle Caches, Jobs, Dateien, Audit- und
 * Idempotency-Datensätze sind tenant-gebunden") — derselbe Schlüssel in zwei
 * Organisationen sind zwei verschiedene Vorgänge.
 *
 * Der Wiederholungsfall gibt dieselbe Antwort wie der Erstaufruf zurück, nicht
 * einen Konflikt: ein Client, dem die Antwort verloren ging, muss sie holen
 * können, ohne den Effekt zu verdoppeln.
 */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/, "Nur URL-sichere Zeichen erlaubt");

export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
