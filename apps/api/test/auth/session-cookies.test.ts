/**
 * Attribute der Sitzungscookies (EYT-106 AK8, EYT-134).
 *
 * ## Die Luecke, die diese Datei schliesst
 *
 * `session-cookies.ts` hatte KEINEN Test. Die Auth-Reise unter
 * `apps/web/e2e/auth-journey/` prueft `HttpOnly` und `SameSite=Strict` gegen
 * einen echten Browser — aber sie spricht http gegen 127.0.0.1 und sichert
 * dort ausdruecklich `Secure=false` zu. Ein `Secure`-Cookie waere ueber http
 * gar nicht uebertragbar, die Reise koennte es also nie sehen.
 *
 * Damit war genau die Haelfte des Kriteriums unbewiesen, die im Betrieb
 * zaehlt: „im HTTPS-Modus `Secure=true`". Loeschte jemand `; Secure` aus
 * `attribute()`, blieb alles gruen — und die Sitzungscookies reisten
 * fortan auch ueber unverschluesselte Verbindungen.
 *
 * Eine Produktionsreise waere der andere Weg gewesen. Sie ist hier nicht
 * noetig und waere auch kein besserer Nachweis: sie belegte EINEN Lauf,
 * waehrend diese Datei die Regel selbst festhaelt.
 *
 * ## Gegenmutationen
 *
 *  - `; Secure` aus `attribute()` entfernen        -> die drei Produktionsfaelle rot
 *  - `SameSite=Strict` zu `Lax`                    -> die Strict-Zusicherung rot
 *  - `HttpOnly` entfernen                          -> die HttpOnly-Zusicherung rot
 *  - in `clearSessionCookies` andere Attribute     -> der Loeschfall rot
 */
import { describe, expect, it } from "vitest";

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  serializeAccessCookie,
  serializeRefreshCookie,
} from "../../src/platform/auth/session-cookies";

/** Produktion: `Secure` gehoert an JEDES Cookie. */
const PRODUKTION = { secure: true } as const;
/** Lokale Entwicklung ueber http — ein `Secure`-Cookie kaeme nie an. */
const LOKAL = { secure: false } as const;

const TOKEN = "beispiel-token-ohne-bedeutung";

describe("Sitzungscookies tragen im HTTPS-Modus Secure (EYT-134)", () => {
  it.each([
    ["Access", serializeAccessCookie(TOKEN, 3600, PRODUKTION)],
    ["Refresh", serializeRefreshCookie(TOKEN, PRODUKTION)],
  ])("%s-Cookie traegt Secure, HttpOnly und SameSite=Strict", (_name, cookie) => {
    expect(cookie).toContain("; Secure");
    expect(cookie).toContain("; HttpOnly");
    expect(cookie).toContain("; SameSite=Strict");
  });

  it("die Loeschung traegt DIESELBEN Attribute", () => {
    // Weicht ein Attribut ab, betrachtet der Browser es als ANDERES Cookie
    // und das Original bleibt stehen — die Sitzung waere nach dem Abmelden
    // weiterhin gueltig. Deshalb Zeichen fuer Zeichen derselbe Suffix.
    const [access, refresh] = clearSessionCookies(PRODUKTION);
    for (const cookie of [access, refresh]) {
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("Path=/; HttpOnly; SameSite=Strict; Secure");
    }
    expect(access).toContain(`${ACCESS_COOKIE}=;`);
    expect(refresh).toContain(`${REFRESH_COOKIE}=;`);
  });

  it.each([
    ["Access", serializeAccessCookie(TOKEN, 3600, LOKAL)],
    ["Refresh", serializeRefreshCookie(TOKEN, LOKAL)],
  ])("%s-Cookie traegt lokal KEIN Secure — sonst kaeme es ueber http nie an", (_name, cookie) => {
    // Gegenprobe zur Zeile oben. Ohne sie waeren die Produktionsfaelle auch
    // dann gruen, wenn `Secure` bedingungslos gesetzt wuerde — und die
    // Auth-Reise ueber http bekaeme gar keine Sitzung mehr.
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("; HttpOnly");
    expect(cookie).toContain("; SameSite=Strict");
  });

  it("das Access-Cookie traegt eine Lebensdauer, das Refresh-Cookie nicht", () => {
    // Refresh ist ein Sitzungscookie: der Browser raeumt es beim Schliessen.
    // Ein Max-Age darauf ueberlebte das Fenster und waere genau der stille
    // Unterschied, den niemand bemerkt.
    expect(serializeAccessCookie(TOKEN, 3600, PRODUKTION)).toContain("Max-Age=3600");
    expect(serializeRefreshCookie(TOKEN, PRODUKTION)).not.toContain("Max-Age");
  });

  it("eine Lebensdauer unter einer Sekunde wird auf eine Sekunde angehoben", () => {
    // `Max-Age=0` waere eine LOESCHANWEISUNG. Ein abgelaufener Grant duerfte
    // das Cookie nicht versehentlich entfernen statt es kurz zu setzen.
    expect(serializeAccessCookie(TOKEN, 0, PRODUKTION)).toContain("Max-Age=1");
    expect(serializeAccessCookie(TOKEN, -5, PRODUKTION)).toContain("Max-Age=1");
  });
});
