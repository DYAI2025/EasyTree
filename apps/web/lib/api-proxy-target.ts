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
 * ## Laufzeitkonfiguration, seit EYT-126
 *
 * Frueher stand hier, der Wert sei Bauzeitkonfiguration und ein fertiges Image
 * lasse sich nicht mehr umschalten. Das galt fuer den Weg ueber
 * `next.config.ts`-`rewrites()` und ist mit dem Wechsel auf Route Handler
 * ueberholt: `lib/proxy-durchreichen.ts` liest die Variable bei JEDER Anfrage
 * neu, `instrumentation.ts` prueft sie einmal beim Serverstart. Ein Image,
 * zwei Ziele, kein Neubau — gemessen am 21.08.2026, Next 16.2.11.
 *
 * Die Variable traegt weiterhin bewusst KEIN `NEXT_PUBLIC_`-Praefix: alles mit
 * diesem Praefix landet im Browserbuendel, und eine interne Adresse gehoert
 * dort nicht hin.
 */

/**
 * Standard fuer development und test — und NUR dort.
 */
export const DEFAULT_API_PROXY_TARGET = "http://127.0.0.1:3001";

export class InvalidProxyTargetError extends Error {}

/**
 * Prueft und normalisiert das Proxyziel.
 *
 * Streng, weil ein Tippfehler hier keinen sichtbaren Fehler erzeugt, sondern
 * eine Weiterleitung ins Leere — und die sieht im Browser aus wie eine leere
 * Woche.
 */
export function normalizeProxyTarget(
  raw: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  const explizit = raw?.trim() ?? "";

  if (explizit === "") {
    if (nodeEnv === "production") {
      throw new InvalidProxyTargetError(
        "EASYTREE_API_PROXY_TARGET ist in production Pflicht. Es gibt hier bewusst keinen Default.",
      );
    }
    return DEFAULT_API_PROXY_TARGET;
  }

  const value = explizit;

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
  if (url.username !== "" || url.password !== "") {
    throw new InvalidProxyTargetError(
      "EASYTREE_API_PROXY_TARGET darf keine Zugangsdaten enthalten.",
    );
  }
  if (url.search !== "" || url.hash !== "") {
    throw new InvalidProxyTargetError(
      "EASYTREE_API_PROXY_TARGET darf weder Querystring noch Fragment enthalten.",
    );
  }

  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
