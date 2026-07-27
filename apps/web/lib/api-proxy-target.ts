/**
 * Ziel des Same-Origin-Proxys (EYT-50).
 *
 * ## Warum der Browser die API-Adresse nicht kennt
 *
 * Der Browser ruft ausschliesslich relative Pfade — `/api/v1/...`, `/health`,
 * `/ready`. Next leitet sie serverseitig weiter. Damit gibt es genau eine
 * sichtbare Origin, und die API braucht kein CORS: keine Freigabe, keine
 * Wildcard, keine zusaetzliche oeffentliche Oberflaeche.
 *
 * Deshalb ist diese Variable bewusst NICHT `NEXT_PUBLIC_*`. Alles mit diesem
 * Praefix wird in das Browserbuendel eingebacken und beim Build festgeschrieben
 * — eine interne Adresse gehoert dort nicht hin, und ein Wert, der zur Bauzeit
 * feststeht, laesst sich in einer anderen Umgebung nicht mehr aendern.
 */

/** Lokaler Standard. Produktion und CI setzen den Wert explizit. */
export const DEFAULT_API_PROXY_TARGET = "http://127.0.0.1:3001";

export class InvalidProxyTargetError extends Error {}

/**
 * Prueft und normalisiert das Proxyziel.
 *
 * Streng, weil ein Tippfehler hier keinen sichtbaren Fehler erzeugt, sondern
 * eine Weiterleitung ins Leere — und die sieht im Browser aus wie eine leere
 * Woche.
 */
export function normalizeProxyTarget(raw: string | undefined): string {
  const value = (raw ?? DEFAULT_API_PROXY_TARGET).trim();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidProxyTargetError(
      `EASYTREE_API_PROXY_TARGET muss eine absolute URL sein, erhalten: "${value}".`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidProxyTargetError(
      `EASYTREE_API_PROXY_TARGET erlaubt nur http: oder https:, erhalten: "${url.protocol}".`,
    );
  }
  if (url.search !== "" || url.hash !== "") {
    // Ein Querystring am Ziel wuerde beim Zusammensetzen mit `/api/:path*`
    // stillschweigend verschluckt oder verdoppelt.
    throw new InvalidProxyTargetError(
      "EASYTREE_API_PROXY_TARGET darf weder Querystring noch Fragment enthalten.",
    );
  }

  // Ohne abschliessenden Slash: die Ziele werden mit `/api/:path*` verkettet,
  // und `//api/...` ist ein anderer Pfad.
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
