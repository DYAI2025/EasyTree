import { describe, expect, it, vi } from "vitest";

import { leseServerSitzung } from "../lib/feld/sitzung-server";

/**
 * Serverseitige Sitzungslesung (EYT-113): Server Components fragen die echte
 * API (`GET /auth/session`) mit den Cookies der eingehenden Anfrage. Die
 * Antwort entscheidet fail-closed in drei Zustaenden:
 *
 *   angemeldet  — 200 und der Body besteht das strikte SessionDto-Schema
 *   abgemeldet  — die API sagt 401 (verifiziertes Nichtangemeldetsein)
 *   unbekannt   — alles andere (Netzfehler, 5xx, kaputter Body, fehlendes
 *                 Proxyziel): Nichtwissen ist NICHT abgemeldet, sonst wuerde
 *                 ein API-Ausfall angemeldete Nutzer zur Anmeldung umleiten.
 *
 * Gegenmutationen, die diese Suite rot machen: 401 auf "unbekannt" mappen,
 * 500 auf "abgemeldet" mappen, den Cookie-Header nicht weiterreichen oder
 * die Schemapruefung durch `await res.json() as SessionDto` ersetzen.
 */
const ZIEL = "http://api.intern:3001";

const GUELTIGE_SITZUNG = {
  userId: "00000000-0000-4000-8000-000000000001",
  organisations: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Baumpflege Nord",
      role: "member",
      permissions: [],
    },
  ],
};

function antwort(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("leseServerSitzung (EYT-113)", () => {
  it("liefert 'angemeldet' samt geparster Session bei 200 und gueltigem Body", async () => {
    const fetchImpl = vi.fn(async () => antwort(200, GUELTIGE_SITZUNG));
    const ergebnis = await leseServerSitzung("eyt_access=abc", fetchImpl, () => ZIEL);
    expect(ergebnis).toEqual({ zustand: "angemeldet", session: GUELTIGE_SITZUNG });
  });

  it("fragt das Proxyziel unter dem Vertragspfad und reicht die Cookies weiter", async () => {
    const fetchImpl = vi.fn(async () => antwort(200, GUELTIGE_SITZUNG));
    await leseServerSitzung("eyt_access=abc; eyt_refresh=def", fetchImpl, () => ZIEL);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.intern:3001/api/v1/auth/session");
    expect(new Headers(init.headers).get("cookie")).toBe("eyt_access=abc; eyt_refresh=def");
    expect(init.cache).toBe("no-store");
  });

  it("sendet ohne eingehende Cookies keinen Cookie-Header", async () => {
    const fetchImpl = vi.fn(async () => antwort(401, {}));
    await leseServerSitzung(null, fetchImpl, () => ZIEL);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has("cookie")).toBe(false);
  });

  it("liefert 'abgemeldet' bei 401", async () => {
    const fetchImpl = vi.fn(async () => antwort(401, {}));
    expect(await leseServerSitzung(null, fetchImpl, () => ZIEL)).toEqual({
      zustand: "abgemeldet",
    });
  });

  it("liefert 'unbekannt' bei 500 — Nichtwissen ist nicht abgemeldet", async () => {
    const fetchImpl = vi.fn(async () => antwort(500, {}));
    expect(await leseServerSitzung("eyt_access=abc", fetchImpl, () => ZIEL)).toEqual({
      zustand: "unbekannt",
    });
  });

  it("liefert 'unbekannt', wenn der Body das strikte Schema nicht besteht", async () => {
    const fetchImpl = vi.fn(async () =>
      antwort(200, { userId: "kein-uuid-noetig?", organisations: "kaputt" }),
    );
    expect(await leseServerSitzung("eyt_access=abc", fetchImpl, () => ZIEL)).toEqual({
      zustand: "unbekannt",
    });
  });

  it("liefert 'unbekannt', wenn fetch selbst scheitert", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await leseServerSitzung("eyt_access=abc", fetchImpl, () => ZIEL)).toEqual({
      zustand: "unbekannt",
    });
  });

  it("liefert 'unbekannt', wenn das Proxyziel fehlt oder ungueltig ist", async () => {
    const fetchImpl = vi.fn(async () => antwort(200, GUELTIGE_SITZUNG));
    const ergebnis = await leseServerSitzung("eyt_access=abc", fetchImpl, () => {
      throw new Error("Proxyziel fehlt");
    });
    expect(ergebnis).toEqual({ zustand: "unbekannt" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
