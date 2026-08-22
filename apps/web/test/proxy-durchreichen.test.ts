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
 * `location` ist nicht der einzige Kopf, der eine Adresse traegt.
 *
 * Gemessen an einem echten Gegenbeispiel: antwortet die API mit
 * `X-Upstream-Url: http://<interner-host>:3001/private` oder mit einem
 * `Link`-Kopf, der auf sie selbst zeigt, dann steht die interne Adresse im
 * Browser — same-origin-JavaScript liest sie ueber `response.headers`, und
 * `Link` wertet der Browser sogar selbst aus.
 *
 * Ein Kopf ohne festgelegte Bedeutung laesst sich nicht sinnvoll uebersetzen;
 * eine erfundene Umschreibung waere schlimmer als der Verlust. Deshalb faellt
 * er weg. `location` bleibt davon unberuehrt — der hat eine Bedeutung und
 * seine eigene Uebersetzung, eine Zeile weiter oben.
 */
describe("durchreichen — gewoehnliche Antwortkoepfe lecken die interne Adresse nicht", () => {
  it("entfernt einen gewoehnlichen Kopf, der das interne Ziel nennt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        antwort(
          { ok: true },
          {
            "x-upstream-url": "http://api-a.invalid:3001/private",
            link: '<http://api-a.invalid:3001/foo>; rel="self"',
            "x-request-id": "r-42",
          },
        ),
      ),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    const alles = [...ergebnis.headers.entries()].map(([n, w]) => `${n}: ${w}`).join("\n");
    expect(alles).not.toContain("api-a.invalid");
    expect(ergebnis.headers.get("x-upstream-url")).toBeNull();
    expect(ergebnis.headers.get("link")).toBeNull();
    // Eingangsbremse: fiele einfach ALLES weg, pruefte dieser Test nichts.
    expect(ergebnis.headers.get("x-request-id")).toBe("r-42");
  });

  it("entfernt auch einen Kopf, der nur den internen Hostnamen nennt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        antwort(
          { ok: true },
          { "x-upstream-host": "api-a.invalid", "content-location": "http://api-a.invalid:3001/f" },
        ),
      ),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.headers.get("x-upstream-host")).toBeNull();
    expect(ergebnis.headers.get("content-location")).toBeNull();
    const alles = [...ergebnis.headers.entries()].map(([n, w]) => `${n}: ${w}`).join("\n");
    expect(alles).not.toContain("api-a.invalid");
    // Eingangsbremse: die Antwort traegt weiterhin ihren content-type.
    expect(ergebnis.headers.get("content-type")).toBe("application/json");
  });

  it("erkennt die interne Adresse unabhaengig von der Schreibweise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        antwort({ ok: true }, { "x-upstream-url": "HTTP://API-A.INVALID:3001/private" }),
      ),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.headers.get("x-upstream-url")).toBeNull();
  });

  it("laesst gewoehnliche Koepfe unveraendert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        antwort(
          { ok: true },
          { "cache-control": "no-store", etag: '"abc123"', "x-correlation-id": "korr-7" },
        ),
      ),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.headers.get("cache-control")).toBe("no-store");
    expect(ergebnis.headers.get("etag")).toBe('"abc123"');
    expect(ergebnis.headers.get("x-correlation-id")).toBe("korr-7");
    expect(ergebnis.headers.get("content-type")).toBe("application/json");
  });

  it("laesst einen Kopf mit einer EXTERNEN URL unveraendert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        antwort(
          { ok: true },
          {
            link: '<https://login.example.org/foo>; rel="next"',
            "content-location": "https://cdn.example.org/a.json",
          },
        ),
      ),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.headers.get("link")).toBe('<https://login.example.org/foo>; rel="next"');
    expect(ergebnis.headers.get("content-location")).toBe("https://cdn.example.org/a.json");
  });

  it("entfernt nur das leckende Cookie und erhaelt die uebrigen einzeln", async () => {
    const oben = new Response("{}", { status: 200 });
    oben.headers.append("set-cookie", "sb-access=abc; HttpOnly; Path=/");
    oben.headers.append("set-cookie", "leck=1; Domain=api-a.invalid; Path=/");
    oben.headers.append("set-cookie", "sb-refresh=def; HttpOnly; Path=/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => oben),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/auth/login"));

    // Zwei bleiben zwei — der Riegel darf nicht zusammenfalten, was er nicht faltet.
    expect(ergebnis.headers.getSetCookie()).toEqual([
      "sb-access=abc; HttpOnly; Path=/",
      "sb-refresh=def; HttpOnly; Path=/",
    ]);
    const alles = [...ergebnis.headers.entries()].map(([n, w]) => `${n}: ${w}`).join("\n");
    expect(alles).not.toContain("api-a.invalid");
  });

  it("misst gegen das AKTUELLE Ziel und nicht gegen ein eingefrorenes", async () => {
    // Dasselbe Modul, dieselbe Antwort — nur die Umgebung wechselt. Waere das
    // Ziel beim Modulladen eingefroren, bliebe genau die falsche Adresse stehen.
    process.env.EASYTREE_API_PROXY_TARGET = "http://api-b.invalid:3001";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        antwort(
          { ok: true },
          {
            "x-upstream-url": "http://api-b.invalid:3001/private",
            "x-frueheres-ziel": "http://api-a.invalid:3001/egal",
          },
        ),
      ),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.headers.get("x-upstream-url")).toBeNull();
    // Das ALTE Ziel ist jetzt eine fremde Adresse und bleibt deshalb stehen.
    expect(ergebnis.headers.get("x-frueheres-ziel")).toBe("http://api-a.invalid:3001/egal");
  });
});

/**
 * Der Riegel muss die ADRESSE treffen, nicht das Wort.
 *
 * Die erste Fassung verglich Teilstrings — volle Adresse, Autoritaet UND
 * nackter Dienstname — und zwar ueber Kopfnamen und Wert zusammen. Fuer die
 * vorgesehene Containertopologie `http://api:3001` ist der Dienstname das
 * Wort "api", und damit fiel jeder harmlose Kopf, in dem diese drei Buchstaben
 * irgendwo vorkommen: `X-Api-Version`, eine Doku-URL auf `api.example.org`,
 * ein Cookie namens `api_session`. Das ist kein Leck, das ist ein Ausfall.
 *
 * Deshalb steht das Ziel hier auf genau dem echten Wert `http://api:3001` —
 * mit `api-a.invalid` waere der Fehler unsichtbar geblieben, weil dieser Name
 * in keinem harmlosen Kopf vorkommt.
 */
describe("durchreichen — der Riegel trifft die Adresse, nicht das Wort", () => {
  beforeEach(() => {
    // Die vorgesehene interne Topologie, woertlich. Der Dienstname ist "api".
    process.env.EASYTREE_API_PROXY_TARGET = "http://api:3001";
  });

  it("laesst einen Kopf stehen, dessen NAME den Dienstnamen enthaelt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => antwort({ ok: true }, { "x-api-version": "1" })),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.headers.get("x-api-version")).toBe("1");
  });

  it("laesst einen Kopf mit einer FREMDEN Adresse unter demselben Wort stehen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        antwort({ ok: true }, { "x-documentation": "https://api.example.org/public" }),
      ),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.headers.get("x-documentation")).toBe("https://api.example.org/public");
  });

  it("laesst ein Cookie stehen, dessen Name den Dienstnamen enthaelt", async () => {
    const oben = new Response("{}", { status: 200 });
    oben.headers.append("set-cookie", "api_session=abc123; Path=/; HttpOnly");
    oben.headers.append("set-cookie", "sb-refresh=def; HttpOnly; Path=/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => oben),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/auth/login"));

    expect(ergebnis.headers.getSetCookie()).toEqual([
      "api_session=abc123; Path=/; HttpOnly",
      "sb-refresh=def; HttpOnly; Path=/",
    ]);
  });

  it("laesst einen Wert stehen, in dem der Dienstname nur ein Wortteil ist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => antwort({ ok: true }, { "x-label": "capitalized-api-response" })),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.headers.get("x-label")).toBe("capitalized-api-response");
  });

  it("entfernt trotzdem die echte interne Adresse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        antwort(
          { ok: true },
          {
            "x-upstream-url": "http://api:3001/private",
            link: '<http://api:3001/foo>; rel="self"',
            "x-api-version": "1",
          },
        ),
      ),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.headers.get("x-upstream-url")).toBeNull();
    expect(ergebnis.headers.get("link")).toBeNull();
    // Im selben Lauf: der harmlose Kopf ueberlebt. Sonst waere die Zeile
    // darueber auch mit einem Riegel gruen, der alles wegwirft.
    expect(ergebnis.headers.get("x-api-version")).toBe("1");
  });

  it("entfernt trotzdem die nackte Autoritaet ohne Schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => antwort({ ok: true }, { "x-upstream": "api:3001" })),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.headers.get("x-upstream")).toBeNull();
  });

  it("verwechselt eine laengere Portnummer nicht mit der internen", async () => {
    // `api:30011` ist ein anderer Endpunkt. Ein Vergleich ohne Grenze haette
    // ihn als Treffer gelesen.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => antwort({ ok: true }, { "x-upstream": "api:30011" })),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/planung"));

    expect(ergebnis.headers.get("x-upstream")).toBe("api:30011");
  });

  it("entfernt ein Cookie, dessen Domain-Attribut den internen Host nennt", async () => {
    const oben = new Response("{}", { status: 200 });
    oben.headers.append("set-cookie", "api_session=abc123; Path=/; HttpOnly");
    oben.headers.append("set-cookie", "leck=1; Domain=api; Path=/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => oben),
    );

    const ergebnis = await durchreichen(new Request("http://web.invalid/api/v1/auth/login"));

    expect(ergebnis.headers.getSetCookie()).toEqual(["api_session=abc123; Path=/; HttpOnly"]);
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
