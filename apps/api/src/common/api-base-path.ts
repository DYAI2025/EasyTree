/**
 * Basispfad der Fach-API (EYT-50).
 *
 * Eine Konstante und keine Zeichenkette an zwei Stellen: der Vertrag nennt
 * `/api/v1` als `servers[0].url` (`packages/contracts/openapi/v1.json`), und
 * `apps/api/src/main.ts` setzt genau das als globales Praefix. Laufen die
 * beiden auseinander, zeigt jeder aus dem Vertrag abgeleitete Client ins
 * Leere — und zwar ohne dass irgendetwas rot wird.
 *
 * `apps/api/test/openapi-route-conformance.test.ts` vergleicht deshalb den
 * hier gesetzten Wert mit dem Vertrag, statt ihn zu wiederholen.
 *
 * Ohne fuehrenden Slash, weil `setGlobalPrefix` ihn selbst ergaenzt.
 */
export const API_BASE_PATH = "api/v1";
