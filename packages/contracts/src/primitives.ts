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
  // Das Muster prueft nur die FORM. "2026-99-99T29:61:61.000Z" hat die richtige
  // Form und ist trotzdem kein Zeitpunkt. Der Rueckweg ueber Date faengt das:
  // ein ungueltiges Datum ergibt NaN, und toISOString liefert genau dann denselben
  // String zurueck, wenn der Wert kanonisch UTC mit drei Nachkommastellen ist.
  .refine((value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  }, "Kein gueltiger Zeitpunkt im gregorianischen Kalender")
  .describe("UTC-Zeitpunkt nach ISO 8601, drei Nachkommastellen, Suffix Z");

export type Instant = z.infer<typeof InstantSchema>;

/** UUID v4 als Bezeichner. Die nominale Härtung liegt in der Domain, nicht im Transport. */
export const IdSchema = z.uuid().describe("UUID");

/**
 * Lokaler Kalendertag ohne Uhrzeit und ohne Zone — `2026-08-03`.
 *
 * ## Warum das Muster allein nicht genuegt
 *
 * `^\d{4}-\d{2}-\d{2}$` nimmt `2026-02-30` an. Diesen Tag gibt es nicht, und ein
 * Baustellentag darauf koennte nie aus `worksite_days.local_date` (Typ `date`)
 * stammen — die Datenbank haette die Zeile abgelehnt. Ein Vertrag, der
 * nachsichtiger ist als der Speicher, verschiebt den Fehler nur nach hinten.
 *
 * Geprueft wird ueber den Rueckweg, dieselbe Bauart wie bei {@link InstantSchema}:
 * `Date` normalisiert `2026-02-30` still zum 2. Maerz, und der Vergleich mit der
 * Eingabe faellt dann auseinander (gemessen: `2026-02-30` -> `2026-03-02`,
 * `2026-04-31` -> `2026-05-01`, `2025-02-29` -> `2025-03-01`; `2026-13-01` und
 * `2026-00-10` ergeben gar kein Datum). Das angehaengte `T00:00:00.000Z` gehoert
 * dazu: ohne Zeitanteil duerfte eine Laufzeit den Wert als LOKALE Zeit lesen, und
 * eine westliche Zone verschoebe den Rueckweg um einen Tag.
 *
 * ## Abgrenzung zu `BusinessDateSchema`
 *
 * `costs/schemas.ts` fuehrt fuer denselben Begriff ein SCHWAECHERES Schema: nur
 * das Muster, ohne Kalenderregel. Das ist bekannt und bleibt hier absichtlich
 * unberuehrt — es zu verschaerfen aenderte die Laufzeitsemantik von
 * Satzversionen und Kostenpositionen, und das ist keine additive
 * Vertragserweiterung. Bis die beiden jemand mit eigenen Kostentests
 * zusammenfuehrt, ist DIES die strengere Seite, und neue Felder nehmen dieses
 * Schema, nicht das andere.
 */
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Lokales Datum im Format JJJJ-MM-TT")
  .refine((wert) => {
    const parsed = new Date(`${wert}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === wert;
  }, "Kein realer Kalendertag im gregorianischen Kalender")
  .describe("Lokaler Kalendertag im Format 2026-08-03 — ohne Uhrzeit, ohne Zone");

export type LocalDate = z.infer<typeof LocalDateSchema>;

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

/**
 * GEBRANDET, und das ist der Punkt.
 *
 * Ohne `.brand()` waere `IdempotencyKey` auf Typebene schlicht `string`. Jeder
 * beliebige String — auch ein leerer, auch einer mit Leerzeichen — haette als
 * geprueft gegolten, und die Regeln unten waeren eine Zusage gewesen, die
 * niemand einloest: das Schema existierte, aber niemand fuehrte es aus.
 *
 * Mit dem Brand kommt man nur ueber {@link newIdempotencyKey} oder ein
 * ausdrueckliches `IdempotencyKeySchema.parse(...)` an einen Wert. Beide Wege
 * fuehren die Pruefung wirklich aus.
 */
export const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/, "Nur URL-sichere Zeichen erlaubt")
  .brand<"IdempotencyKey">();

export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

/**
 * Erzeugt einen Schluessel fuer EINEN fachlichen Vorgang.
 *
 * Die Lebensdauer ist der Vorgang, nicht der Aufruf. Wer wiederholt, weil eine
 * Antwort verloren ging, verwendet denselben Schluessel weiter — sonst ist die
 * Wiederholung fuer den Server ein zweiter Vorgang, und der Doppeleffekt, den
 * der Schluessel verhindern soll, tritt genau dann ein, wenn er gebraucht wird.
 *
 * Deshalb steht diese Funktion hier und NICHT im HTTP-Client: ein Client, der
 * sich selbst einen Schluessel erzeugen kann, erzeugt bei jedem Aufruf einen
 * neuen. Der Aufrufer muss ihn besitzen.
 */
export function newIdempotencyKey(): IdempotencyKey {
  // Durch das Schema, nicht daran vorbei. Ein `as IdempotencyKey` haette
  // denselben Typ geliefert und nichts geprueft — genau die Abkuerzung, die
  // den Brand wertlos macht.
  return IdempotencyKeySchema.parse(crypto.randomUUID());
}
