/**
 * Ausgabeform des Next-Builds (EYT-126).
 *
 * ## Warum das ein Schalter ist und keine Konstante
 *
 * Fuer das OCI-Image wird `output: "standalone"` gebraucht: Next legt dann
 * unter `.next/standalone/` einen selbsttragenden Server samt der wirklich
 * benutzten `node_modules` ab. Ohne ihn muesste das Laufzeit-Image den
 * gesamten Workspace inklusive Entwicklungsabhaengigkeiten tragen.
 *
 * Unbedingt setzen ginge trotzdem nicht: `@opennextjs/cloudflare` erwartet die
 * Standardausgabe, und der Cloudflare-Bundlebau laeuft heute im Pflichtjob
 * `build-web`. Cloudflare ist zwar kein Zielruntime mehr (Confluence 30998530),
 * aber sein Abbau ist ein eigener Slice (EYT-149) — bis dahin darf dieser
 * Slice ihn nicht nebenbei rot machen.
 *
 * Der Schalter ist deshalb Bauzeitkonfiguration, genau wie
 * `EASYTREE_API_PROXY_TARGET`, und traegt aus demselben Grund KEIN
 * `NEXT_PUBLIC_`-Praefix.
 *
 * ## Fail-closed
 *
 * Ein unbekannter Wert ist ein Tippfehler, kein Wunsch. Er wirft, statt still
 * auf die Standardausgabe zurueckzufallen — sonst baute das Image ohne
 * `standalone`, und der Fehler faellt erst im Dockerfile auf, wo `server.js`
 * fehlt.
 */

export class InvalidNextOutputError extends Error {}

/** Erlaubte Werte von `EASYTREE_NEXT_OUTPUT`. */
export const NEXT_OUTPUT_STANDALONE = "standalone";

/**
 * Absichtlich ein Index-Typ und kein Objekt mit genau einem optionalen Feld:
 * TypeScript verweigert sonst `resolveNextOutput(process.env)` mit
 * "Type 'ProcessEnv' has no properties in common" — die Schwachtyp-Erkennung
 * greift, weil `ProcessEnv` die Variable nicht deklariert. Gemessen 21.08.2026.
 */
export type NextOutputEnvironment = {
  readonly [name: string]: string | undefined;
};

/**
 * Liefert das Fragment, das in die Next-Konfiguration gespreizt wird —
 * `{}` fuer die Standardausgabe, `{ output: "standalone" }` fuer das Image.
 */
export function resolveNextOutput(env: NextOutputEnvironment): { output?: "standalone" } {
  const roh = env.EASYTREE_NEXT_OUTPUT?.trim() ?? "";
  if (roh === "") return {};
  if (roh === NEXT_OUTPUT_STANDALONE) return { output: NEXT_OUTPUT_STANDALONE };
  throw new InvalidNextOutputError(
    `EASYTREE_NEXT_OUTPUT kennt nur "" oder "${NEXT_OUTPUT_STANDALONE}", erhalten: "${roh}".`,
  );
}
