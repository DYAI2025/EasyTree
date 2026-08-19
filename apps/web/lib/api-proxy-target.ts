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
 */
export const DEFAULT_API_PROXY_TARGET = "http://127.0.0.1:3001";

/**
 * Sprint-6-Fallback fuer Cloudflare Builds.
 *
 * Cloudflare ist die primaere Web-Staging-Grenze. Solange der API-Worker die
 * separaten Runtime-/TLS-/RLS-Gates aus EYT-142 noch nicht bestanden hat,
 * bleibt der bereits existierende Railway-API-Service der ausdruecklich
 * dokumentierte Fallback. Ein explizit gesetztes EASYTREE_API_PROXY_TARGET hat
 * immer Vorrang und kann spaeter ohne Codeaenderung auf einen Cloudflare-API-
 * Endpunkt zeigen.
 */
export const CLOUDFLARE_API_FALLBACK_TARGET = "https://easytree-production.up.railway.app";

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

export type ProxyBuildEnvironment = {
  EASYTREE_API_PROXY_TARGET?: string;
  NODE_ENV?: string;
  WORKERS_CI?: string;
  CF_PAGES?: string;
};

/**
 * Loest das Build-Ziel auf, ohne die allgemeine Production-Fail-Closed-Regel
 * aufzuweichen.
 *
 * Cloudflare Workers Builds setzt WORKERS_CI=1, Cloudflare Pages setzt
 * CF_PAGES=1. Nur in diesen beiden expliziten Build-Kontexten darf bei
 * fehlendem EASYTREE_API_PROXY_TARGET der dokumentierte Railway-Fallback
 * verwendet werden. Ein expliziter Wert gewinnt immer.
 */
export function resolveBuildProxyTarget(
  env: ProxyBuildEnvironment = process.env,
): string {
  const explicit = env.EASYTREE_API_PROXY_TARGET?.trim();
  if (explicit) {
    return normalizeProxyTarget(explicit, env.NODE_ENV);
  }

  const isCloudflareBuild = env.WORKERS_CI === "1" || env.CF_PAGES === "1";
  if (isCloudflareBuild) {
    return normalizeProxyTarget(CLOUDFLARE_API_FALLBACK_TARGET, env.NODE_ENV);
  }

  return normalizeProxyTarget(undefined, env.NODE_ENV);
}
