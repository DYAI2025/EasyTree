/**
 * Leichte API-Metadaten (EYT-50).
 *
 * Bewusst ein eigenes Modul ohne Abhaengigkeiten: `openapi/document.ts` laedt
 * saemtliche Schemata und fuehrt die Dokumenterzeugung aus. Wer nur den
 * Basispfad braucht — die Kompositionswurzel im Browser, das globale Praefix
 * der API —, soll dafuer nicht den ganzen Generator in sein Buendel ziehen.
 *
 * Drei Stellen importieren von hier, und keine fuehrt eine eigene Kopie:
 *   - das OpenAPI-Dokument (`servers[0].url`),
 *   - `apps/api` (globales Praefix),
 *   - die Gateway-Fabrik im Web.
 *
 * Der bestehende Drifttest sichert weiterhin Konstante -> erzeugtes Dokument.
 */

/**
 * Versionssegment des PFADS — bewusst nicht `API_VERSION`.
 *
 * `openapi/document.ts` fuehrt bereits ein `API_VERSION` mit dem Wert
 * "1.0.0": das ist die Version des DOKUMENTS, nicht der URL. Zwei Begriffe
 * unter einem Namen waeren die naechste stille Verwechslung.
 */
export const API_PATH_VERSION = "v1";

/** Basispfad mit fuehrendem Slash, so wie `servers[0].url` ihn traegt. */
export const API_BASE_PATH = `/api/${API_PATH_VERSION}`;
