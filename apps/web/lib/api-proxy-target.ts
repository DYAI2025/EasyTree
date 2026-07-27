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
 * ## Build-Konfiguration, nicht Laufzeitschalter
 *
 * `rewrites()` laeuft beim Bauen und beim Start des Servers. Fuer diesen Slice
 * ist die Variable damit BUILD- und DEPLOYMENTkonfiguration. Ob ein bereits
 * gebautes Image sie zur Laufzeit noch umschalten kann, ist ungeprueft und
 * wird hier nicht behauptet.
 *
 * Deshalb ist diese Variable bewusst NICHT `NEXT_PUBLIC_*`. Alles mit diesem
 * Praefix wird in das Browserbuendel eingebacken und beim Build festgeschrieben
 * — eine interne Adresse gehoert dort nicht hin, und ein Wert, der zur Bauzeit
 * feststeht, laesst sich in einer anderen Umgebung nicht mehr aendern.
 */

/**
 * Standard fuer development und test — und NUR dort.
 *
 * Hier stand "Produktion und CI setzen den Wert explizit". Das war eine
 * Absicht, keine Tatsache: die Workflows setzten die Variable nicht und liefen
 * still ueber diesen lokalen Wert. Ein Default, auf den sich niemand berufen
 * darf, aber alle verlassen, ist die schlechteste Sorte Vorgabe.
 *
 * In production gibt es deshalb keinen Default mehr — dort bricht der Build ab.
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
    // Fail-closed in production: ein Proxy, der auf localhost zeigt, waehrend
    // die API woanders laeuft, erzeugt keinen Fehler beim Bauen — sondern eine
    // Weiterleitung ins Leere, die im Browser wie eine leere Woche aussieht.
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
    // Zugangsdaten in einer Ziel-URL landen in Konfiguration, Logs und
    // Fehlermeldungen. CLAUDE.md verbietet das Protokollieren von Zugangsdaten;
    // der sicherste Weg ist, sie hier gar nicht erst anzunehmen.
    throw new InvalidProxyTargetError(
      "EASYTREE_API_PROXY_TARGET darf keine Zugangsdaten enthalten.",
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
