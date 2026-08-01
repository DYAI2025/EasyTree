/**
 * Sitzungscookies (EYT-106): Namen, Serialisierung, Loeschung, Lesen.
 *
 * PO-Entscheidung 31.07.2026: Access- UND Refresh-Token leben ausschliesslich
 * in HttpOnly-Cookies — nie in localStorage, sessionStorage oder React State.
 * `SameSite=Strict` immer; `Secure` in staging/production (hier: sobald
 * NODE_ENV production ist — der lokale Entwicklungsserver spricht http).
 *
 * Eine Datei, damit Setzen, Loeschen und Lesen dieselben Namen und Attribute
 * verwenden — drei Stellen mit je eigener Schreibung waeren drei Gelegenheiten
 * fuer ein Cookie, das gesetzt, aber nie wieder gefunden wird.
 */

export const ACCESS_COOKIE = "eyt_access";
export const REFRESH_COOKIE = "eyt_refresh";

export interface CookieEnvironment {
  /** `true` in production — dann traegt jedes Cookie `Secure`. */
  readonly secure: boolean;
}

function attribute(secure: boolean): string {
  return `Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/** Setzt das Access-Cookie mit der Lebensdauer des Tokens. */
export function serializeAccessCookie(
  token: string,
  maxAgeSeconds: number,
  env: CookieEnvironment,
): string {
  return `${ACCESS_COOKIE}=${encodeURIComponent(token)}; Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}; ${attribute(env.secure)}`;
}

/** Refresh als Sitzungscookie — kein Max-Age; der Browser raeumt beim Schliessen. */
export function serializeRefreshCookie(token: string, env: CookieEnvironment): string {
  return `${REFRESH_COOKIE}=${encodeURIComponent(token)}; ${attribute(env.secure)}`;
}

/** Loeschung = Max-Age=0 mit IDENTISCHEN Attributen, sonst bleibt das Original stehen. */
export function clearSessionCookies(env: CookieEnvironment): readonly string[] {
  return [
    `${ACCESS_COOKIE}=; Max-Age=0; ${attribute(env.secure)}`,
    `${REFRESH_COOKIE}=; Max-Age=0; ${attribute(env.secure)}`,
  ];
}

/**
 * Liest ein benanntes Cookie aus einem `Cookie:`-Header.
 *
 * Bewusst ohne Bibliothek: das Format ist `name=wert; name2=wert2`, mehr
 * braucht es nicht — und `api-dependency-allowlist` bleibt unangetastet.
 */
export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (cookieHeader === undefined || cookieHeader === "") return null;
  for (const teil of cookieHeader.split(";")) {
    const gleich = teil.indexOf("=");
    if (gleich === -1) continue;
    if (teil.slice(0, gleich).trim() === name) {
      const wert = teil.slice(gleich + 1).trim();
      try {
        return decodeURIComponent(wert);
      } catch {
        return null;
      }
    }
  }
  return null;
}
