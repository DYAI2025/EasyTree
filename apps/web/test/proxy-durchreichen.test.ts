/**
 * Die Durchreiche wird gemessen, nicht geglaubt (EYT-126).
 *
 * Der Kern dieses Slices ist EINE Eigenschaft: das Ziel wird bei JEDER Anfrage
 * neu aus der Umgebung gelesen. Deshalb steht der entsprechende Fall hier nicht
 * am Rand, sondern in der Mitte — und er faellt, sobald jemand den Wert beim
 * Modulladen einfriert.
 *
 * Die zweite Eigenschaft ist genauso wichtig und war im ersten Entwurf nicht
 * abgedeckt: die interne Adresse darf den Browser auf KEINEM Weg erreichen.
 * `x-middleware-rewrite` zu vermeiden reicht dafuer nicht — ein `location`-Kopf
 * der API traegt sie genauso nach draussen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvalidProxyTargetError } from "../lib/api-proxy-target";
import { aktuellesProxyziel, durchreichen } from "../lib/proxy-durchreichen";

const URSPRUNG = { ...process.env };
/**
 * Next deklariert `ProcessEnv.NODE_ENV` als `readonly`, deshalb der Umweg. Die
 * Umgebung MUSS hier echt umgestellt werden: `aktuellesProxyziel()` liest sie
 * selbst, und genau das ist die gemessene Eigenschaft.
 */
function setzeNodeEnv(wert: string): void {
  (process.env as Record<string, string | undefined>)["NODE_ENV"] = wert;
}

function antwort(koerper: unknown, kopf: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(koerper), {
    status: 200,
    headers: { "content-type": "application/json", ...kopf },
  });
}

/** Eine Weiterleitung der API, wie sie oben ankaeme. */
function weiterleitung(ort: string): Response {
  return new Response(null, { status: 302, headers: { location: ort } });
}

beforeEach(() => {
  setzeNodeEnv("test");
  process.env.EASYTREE_API_PROXY_TARGET = "http://api-a.invalid:3001";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...URSPRUNG };
});

describe("durchreichen", () => {
  it("liest das Ziel bei JEDER Anfrage neu aus der Umgebung", async () => {
    const holen = vi.fn(async () => antwort({ ok: true }));
    vi.stubGlobal("fetch", holen);

    await durchreichen(new Request("http://web.invalid/health"));
    process.env.EASYTREE_API_PROXY_TARGET = "http://api-b.invalid:3001";
    await durchreichen(new Request("http://web.invalid/health"));

    const ziele = holen.mock.calls.map((aufruf) => String((aufruf as unknown[])[0]));
    expect(ziele).toEqual(["http://api-a.invalid:3001/health", "http://api-b.invalid:3001/health"]);
  });

  it("uebernimmt Methode, Pfad und Querystring unveraendert", async () => {
    const holen = vi.fn(async () => antwort({ ok: true }));
    vi.stubGlobal("fetch", holen);

    await durchreichen(
      new Request("http://web.invalid/api/v1/planung?woche=2026-W35", { method: "DELETE" }),
    );

    const [url, optionen] = holen.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://api-a.invalid:3001/api/v1/planung?woche=2026-W35");
    expect(optionen.method).toBe("DELETE");
  });

  it("reicht Anfrage-Cookies an die API weiter", async () => {
    const holen = vi.fn(async () => antwort({ ok: true }));
    vi.stubGlobal("fetch", holen);

    await durchreichen(
      new Request("http://web.invalid/api/v1/auth/me", {
        headers: { cookie: "sb-access=abc; andere=x" },
      }),
    );

    const [, optionen] = holen.mock.calls[0] as unknown as [URL, RequestInit];
    expect(new Headers(optionen.headers).get("cookie")).toBe("sb-access=abc; andere=x");
  });

  it("reicht einen POST-Koerper an die API weiter", async () => {
    const holen = vi.fn(async () => antwort({ ok: true }));
    vi.stubGlobal("fetch", holen);

    await durchreichen(
      new Request("http://web.invalid/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"email":"a@b.test"}',
      }),
    );

    const [, optionen] = holen.mock.calls[0] as unknown as [URL, RequestInit];
    expect(optionen.method).toBe("POST");
    expect(optionen.body).not.toBeUndefined();
    // `duplex: "half"` fehlt sonst und undici lehnt einen Stream-Koerper ab —
    // das faellt erst im Browser auf, nicht im Typcheck.
    expect((optionen as { duplex?: string }).duplex).toBe("half");
  });

  it("erhaelt MEHRERE set-cookie-Koepfe einzeln", async () => {
    const oben = new Response("{}", { status: 200 });
    oben.headers.append("set-cookie", "sb-access=abc; HttpOnly; Path=/");
    oben.headers.append("set-cookie", "sb-refresh=def; HttpOnly; Path=/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => oben),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/auth/login"));

    expect(ergebnis.headers.getSetCookie()).toEqual([
      "sb-access=abc; HttpOnly; Path=/",
      "sb-refresh=def; HttpOnly; Path=/",
    ]);
  });

  it("nennt die interne Adresse in KEINEM Antwortkopf", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => antwort({ ok: true }, { "x-upstream": "egal" })),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/health"));

    const alles = [...ergebnis.headers.entries()].map(([n, w]) => `${n}: ${w}`).join("\n");
    expect(alles).not.toContain("api-a.invalid");
    expect(ergebnis.headers.get("x-middleware-rewrite")).toBeNull();
    // Eingangsbremse: haette die Antwort gar keine Koepfe, pruefte das nichts.
    expect(alles).toContain("x-upstream");
  });

  it("entfernt Verbindungskoepfe in beide Richtungen", async () => {
    const oben = antwort({ ok: true }, { connection: "keep-alive", "content-encoding": "gzip" });
    const holen = vi.fn(async () => oben);
    vi.stubGlobal("fetch", holen);

    const ergebnis = await durchreichen(
      new Request("http://web.invalid/health", {
        headers: { connection: "keep-alive", "accept-encoding": "gzip" },
      }),
    );

    const gesendet = new Headers((holen.mock.calls[0] as unknown as [URL, RequestInit])[1].headers);
    expect(gesendet.get("connection")).toBeNull();
    expect(gesendet.get("accept-encoding")).toBeNull();
    expect(ergebnis.headers.get("connection")).toBeNull();
    expect(ergebnis.headers.get("content-encoding")).toBeNull();
  });

  it("gibt Status und Koerper der API unveraendert zurueck", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"fehler":"nein"}', { status: 409 })),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.status).toBe(409);
    expect(await ergebnis.text()).toBe('{"fehler":"nein"}');
  });

  it("nennt die interne Adresse nicht, wenn die API unerreichbar ist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed: getaddrinfo ENOTFOUND api-a.invalid");
      }),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.status).toBe(502);
    const koerper = await ergebnis.text();
    const koepfe = [...ergebnis.headers.entries()].map(([n, w]) => `${n}: ${w}`).join("\n");
    expect(koerper).not.toContain("api-a.invalid");
    expect(koepfe).not.toContain("api-a.invalid");
  });
});

/**
 * Der Kopf `location` ist der zweite Weg nach draussen.
 *
 * `x-middleware-rewrite` zu vermeiden genuegt NICHT: antwortet die API mit
 * `Location: http://<interner-host>:3001/foo?x=1`, traegt der Browser die
 * interne Adresse in die Adresszeile und ruft sie als naechstes selbst auf.
 * Same-Origin-JavaScript liest sie ausserdem aus `response.headers`.
 */
describe("durchreichen — Weiterleitungen lecken die interne Adresse nicht", () => {
  it("uebersetzt eine absolute Weiterleitung auf das interne Ziel in einen relativen Pfad", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => weiterleitung("http://api-a.invalid:3001/foo?x=1")),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/alt"));

    expect(ergebnis.status).toBe(302);
    expect(ergebnis.headers.get("location")).toBe("/foo?x=1");
  });

  it("erhaelt dabei auch das Fragment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => weiterleitung("http://api-a.invalid:3001/foo?x=1#teil")),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/alt"));

    expect(ergebnis.headers.get("location")).toBe("/foo?x=1#teil");
  });

  it("streift den Basispfad des Ziels ab, damit der Pfad same-origin stimmt", async () => {
    process.env.EASYTREE_API_PROXY_TARGET = "https://gateway.invalid/easytree";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => weiterleitung("https://gateway.invalid/easytree/api/v1/neu?a=2")),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/alt"));

    expect(ergebnis.headers.get("location")).toBe("/api/v1/neu?a=2");
  });

  it("laesst ein EXTERNES Weiterleitungsziel semantisch unveraendert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => weiterleitung("https://login.example.org/oauth?state=xyz")),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/auth/start"));

    expect(ergebnis.status).toBe(302);
    expect(ergebnis.headers.get("location")).toBe("https://login.example.org/oauth?state=xyz");
  });

  it("laesst eine bereits relative Weiterleitung unveraendert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => weiterleitung("/api/v1/neu?a=2")),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/alt"));

    expect(ergebnis.headers.get("location")).toBe("/api/v1/neu?a=2");
  });

  it("folgt der Weiterleitung nicht selbst — sie gehoert dem Browser", async () => {
    const holen = vi.fn(async () => weiterleitung("http://api-a.invalid:3001/foo"));
    vi.stubGlobal("fetch", holen);

    await durchreichen(new Request("http://web.invalid/api/v1/alt"));

    const [, optionen] = holen.mock.calls[0] as unknown as [URL, RequestInit];
    expect(optionen.redirect).toBe("manual");
  });
});

describe("aktuellesProxyziel", () => {
  it("wirft in production ohne Wert", () => {
    setzeNodeEnv("production");
    delete process.env.EASYTREE_API_PROXY_TARGET;
    expect(() => aktuellesProxyziel()).toThrow(InvalidProxyTargetError);
  });

  it("wirft in production bei ungueltigem Wert", () => {
    setzeNodeEnv("production");
    process.env.EASYTREE_API_PROXY_TARGET = "ftp://api.invalid";
    expect(() => aktuellesProxyziel()).toThrow(InvalidProxyTargetError);
  });
});
