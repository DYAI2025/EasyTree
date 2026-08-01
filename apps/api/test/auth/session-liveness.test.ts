/**
 * AK1b — Sessionpruefung am Auth-Server, fail-closed (EYT-106).
 *
 * Der Auth-Server sitzt hinter einem injizierten `fetch`; geprueft wird die
 * ENTSCHEIDUNGSLOGIK: was gilt als lebendig, was als widerrufen, und dass
 * Nichtwissen niemals Durchlass bedeutet.
 */
import { describe, expect, it } from "vitest";

import {
  GotrueSessionLiveness,
  SessionRejectedError,
  type SessionRejection,
} from "../../src/platform/auth/session-liveness";

const SUPABASE_URL = "https://beispiel.supabase.co";
const ANON_KEY = "anon-platzhalter";

function liveness(antwort: () => Promise<Response>): GotrueSessionLiveness {
  return new GotrueSessionLiveness({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    fetchImpl: antwort as unknown as typeof fetch,
  });
}

async function erwarteAblehnung(
  pruefung: GotrueSessionLiveness,
  code: SessionRejection,
): Promise<void> {
  try {
    await pruefung.assertAlive("token-material");
    expect.unreachable(`Session haette mit ${code} abgelehnt werden muessen`);
  } catch (fehler) {
    expect(fehler).toBeInstanceOf(SessionRejectedError);
    expect((fehler as SessionRejectedError).code).toBe(code);
  }
}

describe("GotrueSessionLiveness", () => {
  it("laesst eine lebende Session durch (200)", async () => {
    // Gegenmutation: die Statuspruefung invertieren -> rot.
    await expect(
      liveness(() => Promise.resolve(new Response("{}", { status: 200 }))).assertAlive("t"),
    ).resolves.toBeUndefined();
  });

  it("ruft den Auth-Server mit Token als Bearer und anon-Key als apikey auf", async () => {
    // Ohne diese Zusicherung koennte die Implementierung irgendein URL/Header-
    // Paar verwenden und der 200-Fall bliebe trotzdem gruen.
    // Gegenmutation: den Authorization-Header weglassen -> rot.
    let gesehen: { url: string; auth: string | null; apikey: string | null } | null = null;
    const pruefung = new GotrueSessionLiveness({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      fetchImpl: ((eingabe: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        gesehen = {
          url: String(eingabe),
          auth: headers.get("authorization"),
          apikey: headers.get("apikey"),
        };
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof fetch,
    });
    await pruefung.assertAlive("das-access-token");
    expect(gesehen).toEqual({
      url: `${SUPABASE_URL}/auth/v1/user`,
      auth: "Bearer das-access-token",
      apikey: ANON_KEY,
    });
  });

  it("lehnt eine widerrufene Session ab (401 -> SESSION_REVOKED)", async () => {
    // Der Kern von AK1b: kryptografisch gueltig, aber widerrufen.
    // Gegenmutation: die Livenesspruefung ueberspringen (sofort return) -> rot.
    await erwarteAblehnung(
      liveness(() => Promise.resolve(new Response("{}", { status: 401 }))),
      "SESSION_REVOKED",
    );
  });

  it("lehnt 403 ebenfalls als widerrufen ab", async () => {
    await erwarteAblehnung(
      liveness(() => Promise.resolve(new Response("{}", { status: 403 }))),
      "SESSION_REVOKED",
    );
  });

  it("lehnt ab, wenn der Auth-Server nicht erreichbar ist (fail-closed)", async () => {
    // PO-Vorgabe woertlich: Auth-Server unerreichbar => kein Zugriff,
    // nicht "im Zweifel durchlassen".
    // Gegenmutation: Netzfehler zu Durchlass machen -> rot.
    await erwarteAblehnung(
      liveness(() => Promise.reject(new Error("ECONNREFUSED"))),
      "AUTH_SERVER_UNAVAILABLE",
    );
  });

  it("lehnt einen 5xx als Nichtwissen ab, nicht als Durchlass", async () => {
    await erwarteAblehnung(
      liveness(() => Promise.resolve(new Response("kaputt", { status: 503 }))),
      "AUTH_SERVER_UNAVAILABLE",
    );
  });

  it("nimmt kein Tokenmaterial in die Fehlermeldung auf", async () => {
    try {
      await liveness(() => Promise.resolve(new Response("{}", { status: 401 }))).assertAlive(
        "sehr-geheimes-token-material",
      );
      expect.unreachable("haette werfen muessen");
    } catch (fehler) {
      // Beide Haelften noetig: die zweite allein waere auf dem Skelett gruen,
      // weil auch dessen generische Meldung kein Token enthaelt.
      expect(fehler).toBeInstanceOf(SessionRejectedError);
      expect(String((fehler as Error).message)).not.toContain("sehr-geheimes-token-material");
    }
  });
});
