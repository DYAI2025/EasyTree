# EYT-126 — Laufzeit-Proxyziel und fail-closed Containerbindung

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ein einziges Web-OCI-Image laesst sich ohne Neubau gegen zwei verschiedene
API-Ziele starten, und der kanonische Compose-Pfad kann kein Image mit
`revision=unknown` und kein stillschweigend geratenes Proxyziel mehr erzeugen.

**Architecture:** Der Same-Origin-Proxy wandert aus `next.config.ts`-`rewrites()`
(Bauzeit, in `routes-manifest.json` eingebacken) in **Route Handler** unter
`apps/web/app/` (`/api/[[...pfad]]`, `/health`, `/ready`). Ein Route Handler ist
dynamischer Servercode: er liest `EASYTREE_API_PROXY_TARGET` bei **jeder Anfrage**
neu und reicht die Anfrage per `fetch` an die API durch. Zusaetzlich prueft
`apps/web/instrumentation.ts` das Ziel **einmal beim Serverstart** — ist es
ungueltig oder fehlt es, verweigert Next die Serverbereitstellung und JEDE Route
(auch `/`) antwortet mit 500. Der Browser ruft weiterhin ausschliesslich relative
Pfade; die interne Adresse verlaesst den Serverprozess nicht.

**Tech Stack:** Next.js 16.2.11 (App Router, `output: standalone`), TypeScript strict,
Vitest, Docker/Compose, Bash-Smoke.

---

## 0. Gemessene Ausgangslage — lies das zuerst

Alles in diesem Abschnitt ist am **21.08.2026** auf `feat/eyt-126-container-staging`
(Head `7cf698c4`) lokal ausgefuehrt worden, nicht abgeleitet. Der Arbeitsbaum wurde
danach vollstaendig zurueckgesetzt (`git diff --stat HEAD -- apps/web` leer).

### 0.1 Der Befund, der den Slice ausloest

`apps/web/Dockerfile` backt `EASYTREE_API_PROXY_TARGET` als `--build-arg` in den
Next-Build. Confluence 30998530 verlangt dieselben Images fuer Coolify/VPS **und**
Railway. Ein an sein Ziel gebundenes Image erfuellt das nicht.

`docker-compose.yml` ist an zwei Stellen fail-open:

```
GIT_SHA: ${GIT_SHA:-unknown}
EASYTREE_API_PROXY_TARGET: ${EASYTREE_API_PROXY_TARGET:-http://api:3001}
```

### 0.2 Der erste Loesungsversuch ist GEMESSEN GESCHEITERT — nicht wiederholen

Next 16 hat `middleware.ts` in `proxy.ts` umbenannt; dessen Runtime ist **strikt
nodejs**, `process.env` wird dort also zur Laufzeit gelesen. Das funktionierte auch:
ein Build, zwei Starts, zwei verschiedene Ziele.

Zwei Gruende sprechen trotzdem dagegen, und beide wurden gemessen:

1. **`NextResponse.rewrite()` auf ein externes Ziel leckt die interne Adresse in
   den Antwortkopf.** Gemessene Antwort auf `/api/v1/auth/login`:

   ```
   HTTP/1.1 200 OK
   x-middleware-rewrite: http://127.0.0.1:3903/api/v1/auth/login
   ```

   Bei gleicher Origin liest Browser-JavaScript diesen Kopf. Der Versuch,
   ihn mit `antwort.headers.delete("x-middleware-rewrite")` zu entfernen, macht
   die Weiterleitung kaputt — der Kopf IST der Mechanismus: die Antwort kam danach
   ohne `content-type`, ohne `set-cookie` und ohne Stub-Koerper zurueck.

2. **`@opennextjs/cloudflare` verweigert Node-Middleware.** `pnpm --filter
   @easytree/web run build:cf` brach ab mit:

   ```
   ERROR Node.js middleware is not currently supported. Consider switching to Edge Middleware.
   ```

   Dieser Befehl laeuft im **Pflichtjob `build-web`**. Ein `proxy.ts` haette den
   Pflichtcheck rot gemacht und den Cloudflare-Abbau (EYT-149) in diesen Slice
   gezogen. Edge-Middleware statt Node-Middleware waere keine Loesung: dort wird
   `process.env` beim Bauen eingebacken, genau das Problem, das der Slice loest.

**Konsequenz: keine `proxy.ts`, keine `middleware.ts`.** Route Handler.

### 0.3 Route Handler — gemessen tragfaehig

Aufbau des Spikes: `lib/proxy-durchreichen.ts` plus drei `route.ts`. **Ein** Build
(`EASYTREE_NEXT_OUTPUT=standalone`), danach dreimal derselbe Standalone-Server mit
unterschiedlichem `EASYTREE_API_PROXY_TARGET` gestartet, ohne Neubau:

```
== Lauf A: Ziel 3901 ==
  /health          -> {"stub":"A","pfad":"/health"}
  /api/v1/x?q=1    -> {"stub":"A","pfad":"/api/v1/x?q=1"}
  POST+Cookie      -> {"stub":"A","pfad":"/api/v1/auth/login"}
  Leck?            -> 0 Treffer (0 = kein Leck)
  /                -> HTTP 200
== Lauf B: Ziel 3902 — KEIN Rebuild ==
  /health          -> {"stub":"B","pfad":"/health"}
  /api/v1/x?q=1    -> {"stub":"B","pfad":"/api/v1/x?q=1"}
  POST+Cookie      -> {"stub":"B","pfad":"/api/v1/auth/login"}
  Leck?            -> 0 Treffer (0 = kein Leck)
  /                -> HTTP 200
== Lauf C: Cookie-Stub 3903 ==
  /health          -> {"empfangeneCookies":"(keine)","methode":"GET","pfad":"/health"}
  POST+Cookie      -> {"empfangeneCookies":"sb=vorher","methode":"POST","pfad":"/api/v1/auth/login"}
  set-cookie       -> 2 Stueck
  Leck?            -> 0 Treffer
```

Weiter gemessen:

- **Cloudflare-Buendel bleibt gruen.** `pnpm --filter @easytree/web run build:cf`
  endete mit `Worker saved in .open-next/worker.js` / `OpenNext build complete.`
- **Der Build braucht die Variable nicht mehr.** `EASYTREE_NEXT_OUTPUT=standalone
  pnpm --filter @easytree/web... build` lief **ohne** gesetztes
  `EASYTREE_API_PROXY_TARGET` durch, obwohl `next build` `NODE_ENV=production` setzt.
- **Kein Wert im Browserbuendel.** `grep -rl "3901\|3902\|3903" apps/web/.next/static`
  war leer.
- **Bestehende Web-Suite bleibt gruen:** `25 passed (25) / 273 passed (273)`.

### 0.4 Startsperre — gemessen

Mit `apps/web/instrumentation.ts`, das das Ziel beim Start prueft:

```
== gueltig ==     /=200  /health=200  /anmelden=200
                  [web] Proxyziel geprueft: http://127.0.0.1:3901
== fehlt ==       /=500  /health=500  /anmelden=500
                  Failed to prepare server Error: An error occurred while loading
                  instrumentation hook: EASYTREE_API_PROXY_TARGET ist in production
                  Pflicht. Es gibt hier bewusst keinen Default.
== ungueltig ==   /=500  /health=500  /anmelden=500
                  Failed to prepare server Error: ... erlaubt nur http: oder https:,
                  erhalten: "ftp:".
```

**Ehrliche Grenze, die in Dokumentation und PR-Text so stehen muss:** der Prozess
bleibt am Leben und haelt den Port. Er liefert aber auf **keiner** Route mehr etwas
anderes als 500 — auch nicht auf `/` und `/anmelden`. Damit wird kein normaler
Anwendungsverkehr bedient, und der Compose-Healthcheck auf `/` schlaegt fehl, der
Container gilt als `unhealthy`. Behaupte nicht "der Container startet nicht".

### 0.5 Der Waechter, der garantiert rot wird

`apps/api/test/secret-surface.test.ts` fuehrt eine Positivliste
`ERLAUBTE_UMGEBUNGSLESER`. Gemessen mit dem Spike im Baum:

```
AssertionError: expected [ …(2) ] to deeply equal []
+   "apps/web/instrumentation.ts:4 [runtime-reads-no-environment] process.env-Zugriff (EASYTREE_API_PROXY_TARGET) …",
+   "apps/web/lib/proxy-durchreichen.ts:16 [runtime-reads-no-environment] process.env-Zugriff (EASYTREE_API_PROXY_TARGET) …",
```

Deshalb liest im Zielentwurf **genau eine** Datei die Variable
(`lib/proxy-durchreichen.ts`); `instrumentation.ts` ruft deren Funktion auf. Eine
Positivlisten-Zeile, nicht zwei.

### 0.6 Werkzeugfallen dieser Sitzung

- Der RTK-Hook hat `curl` und `mktemp` in dieser Shell zeitweise zerschossen
  (`FAILED: curl`, leeres `mktemp`). **Nutze `/usr/bin/curl` mit absolutem Pfad**
  und feste Dateipfade statt `mktemp`, sobald etwas ohne Grund fehlschlaegt.
- `python3 -` ist per Hook gesperrt; `uv run python3 -` funktioniert.
- `pnpm test` ist ein Turbo-Replay-Kandidat. Jede Zahl, die als Beleg dient,
  braucht `--force` und einen Blick auf die `Cached:`-Zeile.

---

## 1. Abgrenzung

**Im Slice:** Laufzeit-Proxyziel, Startsperre, Entfernen der Bauzeitbindung,
fail-closed `GIT_SHA` und `EASYTREE_API_PROXY_TARGET` im Compose-Pfad,
Container-Smoke-Gegenprobe, Dokumentation.

**Nicht im Slice:** Supabase-Projekt/Branch, Staging-Deploy, Produktionsdaten,
Cloudflare-Abbau (EYT-149), Jira auf Done, Merge.

**Nicht angetastet:** NestJS-/Domain-Architektur, Auth/Cookies, RLS/TLS,
Migrationshoheit (weder Docker noch Coolify noch Railway migrieren).

### 1.1 Scope-Autoritaet — Revision 6, bestaetigt 22.08.2026

Der PO hat den bestehenden EYT-126/Sprint-6-Scope um **genau sechs** Pfade
erweitert. `docs/scope/easytree-sprint-6-core-journey.scope.json` traegt jetzt
Revision 6 (`scope_digest`
`sha256:bd4224b230fc968b4d3df7fca50b0a5940c24e143b735274757bdf1c8fbdc4bf`), die
Bindung unter `.plumbline/scope-authority/` wurde neu gezogen
(`d5b483614d8e81c7…` → `2741c0ec0935d01d…`, gegen `shasum -a 256` des Manifests
geprueft). Die Revisionen 1–5 sind unveraendert, kein Pfad ging verloren.

```
+ apps/web/app/api/**
+ apps/web/app/health/**
+ apps/web/app/ready/**
+ apps/web/instrumentation.ts
+ apps/api/test/architecture/secret-surface-rules.ts
+ apps/api/test/container-bindung.test.ts
```

**Mehr war nicht noetig, und das ist gemessen:** alle uebrigen Dateien dieses
Plans liegen bereits in der Scope. `apps/web/lib/**` und `apps/web/test/**` sind
seit Revision 1 Platzhalter — `lib/proxy-durchreichen.ts` und die drei neuen
Testdateien fallen darunter. `next.config.ts`, `turbo.json`, beide `Dockerfile`,
`docker-compose.yml`, `scripts/**`, `.github/workflows/**`, `CLAUDE.md`,
`docs/runbooks/**` und `docs/plans/**` kamen mit Revision 5.

Der Gate laeuft gruen: `PLUMBLINE_SCOPE_BASE=origin/master bash
scripts/plumbline-scope-guard.sh` → `PRIL scope check passed … (33 changed
files)`, Exit 0.

**Zwei Dinge, die man ueber diesen Gate wissen muss, beide gemessen 22.08.2026:**

1. Er laeuft **nicht** in CI (`grep -c plumbline .github/workflows/ci.yml` → `0`).
   Er hindert nicht den Merge, sondern die Aussage „fertig".
2. `.plumbline/` ist per `.gitignore:35` **ausgeschlossen**, der Feature-Marker
   `docs/context/.active-feature` dagegen versioniert. In einem frischen
   Worktree ist der Scope-Check also aktiv, die **Bindung aber abwesend** — und
   der Gate meldet dann trotzdem `passed`, ohne `SCOPE_AUTHORITY_CHANGED`. Wer
   in einem neuen Worktree arbeitet, kopiert `.plumbline/` mit, sonst ist die
   Manipulationsbindung dort schlicht nicht scharf.

---

## Task 1: Laufzeit-Durchreiche — der rote Test zuerst

**Files:**

- Create: `apps/web/test/proxy-durchreichen.test.ts`
- Create: `apps/web/lib/proxy-durchreichen.ts`

**Step 1: Schreibe den fehlschlagenden Test**

Erstelle `apps/web/test/proxy-durchreichen.test.ts`:

```ts
/**
 * Die Durchreiche wird gemessen, nicht geglaubt (EYT-126).
 *
 * Der Kern dieses Slices ist EINE Eigenschaft: das Ziel wird bei JEDER Anfrage
 * neu aus der Umgebung gelesen. Deshalb steht der entsprechende Fall hier nicht
 * am Rand, sondern in der Mitte — und er faellt, sobald jemand den Wert beim
 * Modulladen einfriert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvalidProxyTargetError } from "../lib/api-proxy-target";
import { aktuellesProxyziel, durchreichen } from "../lib/proxy-durchreichen";

const URSPRUNG = { ...process.env };

function antwort(koerper: unknown, kopf: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(koerper), {
    status: 200,
    headers: { "content-type": "application/json", ...kopf },
  });
}

beforeEach(() => {
  process.env.NODE_ENV = "test";
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
    expect(ziele).toEqual([
      "http://api-a.invalid:3001/health",
      "http://api-b.invalid:3001/health",
    ]);
  });

  it("uebernimmt Methode, Pfad und Querystring unveraendert", async () => {
    const holen = vi.fn(async () => antwort({ ok: true }));
    vi.stubGlobal("fetch", holen);

    await durchreichen(
      new Request("http://web.invalid/api/v1/planung?woche=2026-W35", { method: "DELETE" }),
    );

    const [url, optionen] = holen.mock.calls[0] as [URL, RequestInit];
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

    const [, optionen] = holen.mock.calls[0] as [URL, RequestInit];
    expect(new Headers(optionen.headers).get("cookie")).toBe("sb-access=abc; andere=x");
  });

  it("erhaelt MEHRERE set-cookie-Koepfe einzeln", async () => {
    const oben = new Response("{}", { status: 200 });
    oben.headers.append("set-cookie", "sb-access=abc; HttpOnly; Path=/");
    oben.headers.append("set-cookie", "sb-refresh=def; HttpOnly; Path=/");
    vi.stubGlobal("fetch", vi.fn(async () => oben));

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

    const gesendet = new Headers((holen.mock.calls[0] as [URL, RequestInit])[1].headers);
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
});

describe("aktuellesProxyziel", () => {
  it("wirft in production ohne Wert", () => {
    process.env.NODE_ENV = "production";
    delete process.env.EASYTREE_API_PROXY_TARGET;
    expect(() => aktuellesProxyziel()).toThrow(InvalidProxyTargetError);
  });

  it("wirft in production bei ungueltigem Wert", () => {
    process.env.NODE_ENV = "production";
    process.env.EASYTREE_API_PROXY_TARGET = "ftp://api.invalid";
    expect(() => aktuellesProxyziel()).toThrow(InvalidProxyTargetError);
  });
});
```

**Step 2: Test laufen lassen — er MUSS rot sein**

```bash
pnpm --filter @easytree/web exec vitest run test/proxy-durchreichen.test.ts
```

Erwartet: `Failed to resolve import "../lib/proxy-durchreichen"`.
Pruefe zusaetzlich, dass **9** Faelle gemeldet werden — ein Pfadfilter ohne
Treffer endet still mit 0 (siehe Abschnitt 0.6).

**Step 3: Minimale Umsetzung**

Erstelle `apps/web/lib/proxy-durchreichen.ts`:

```ts
/**
 * Same-Origin-Durchreiche zur API (EYT-50, laufzeitfaehig seit EYT-126).
 *
 * ## Warum Route Handler und nicht `rewrites()`
 *
 * `next.config.ts`-`rewrites()` werden beim BAUEN aufgeloest und landen in
 * `.next/routes-manifest.json`. Ein fertiges Image liesse sich damit nicht mehr
 * auf ein anderes Ziel schalten — Confluence 30998530 verlangt aber dieselben
 * Images fuer Coolify/VPS und Railway.
 *
 * ## Warum auch keine `proxy.ts` (Node-Middleware)
 *
 * Zwei Messungen vom 21.08.2026 sprechen dagegen und stehen ausfuehrlich in
 * docs/plans/2026-08-21-eyt-126-laufzeit-proxyziel.md §0.2:
 *
 *   1. `NextResponse.rewrite()` auf ein externes Ziel sendet den Kopf
 *      `x-middleware-rewrite: <interne Adresse>` an den Browser. Er laesst sich
 *      nicht entfernen, ohne die Weiterleitung selbst abzuschalten — er IST der
 *      Mechanismus.
 *   2. `@opennextjs/cloudflare` bricht mit "Node.js middleware is not currently
 *      supported" ab. Dieser Bau laeuft im Pflichtjob `build-web`.
 *
 * Ein Route Handler hat beide Probleme nicht: er baut die Antwort selbst, also
 * bestimmt er jeden Kopf, und er ist gewoehnlicher Servercode.
 *
 * ## Der Browser sieht die Adresse nie
 *
 * Die Variable traegt bewusst KEIN `NEXT_PUBLIC_`-Praefix. Sie wird nur hier
 * gelesen, im Serverprozess, und keiner der zurueckgegebenen Koepfe nennt sie.
 */
import { normalizeProxyTarget } from "./api-proxy-target";

/**
 * Koepfe, die nur fuer EINE Verbindung gelten. Weitergereicht wuerden sie den
 * naechsten Hop belügen — `transfer-encoding` und `content-length` beschreiben
 * eine Rahmung, die hier neu entsteht.
 */
const VERBINDUNGSKOEPFE = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Das Ziel, JETZT. Bewusst eine Funktion und keine Modulkonstante: eine
 * Konstante wuerde beim Laden des Moduls eingefroren, und genau das ist der
 * Fehler, den dieser Slice behebt.
 */
export function aktuellesProxyziel(): string {
  return normalizeProxyTarget(process.env.EASYTREE_API_PROXY_TARGET, process.env.NODE_ENV);
}

export async function durchreichen(request: Request): Promise<Response> {
  const ziel = aktuellesProxyziel();
  const eingang = new URL(request.url);
  const url = new URL(`${ziel}${eingang.pathname}${eingang.search}`);

  const anfrageKopf = new Headers(request.headers);
  for (const name of VERBINDUNGSKOEPFE) anfrageKopf.delete(name);
  anfrageKopf.delete("host");
  anfrageKopf.delete("content-length");
  // Ohne diese Zeile antwortet die API komprimiert, `fetch` entpackt still, und
  // ein weitergereichtes `content-encoding: gzip` beschriebe einen Koerper, den
  // es so nicht mehr gibt.
  anfrageKopf.delete("accept-encoding");

  const hatKoerper = request.method !== "GET" && request.method !== "HEAD";
  const oben = await fetch(url, {
    method: request.method,
    headers: anfrageKopf,
    body: hatKoerper ? request.body : undefined,
    // `manual`: eine Weiterleitung der API gehoert zum Browser, nicht zum Proxy.
    redirect: "manual",
    ...(hatKoerper ? { duplex: "half" } : {}),
  } as RequestInit);

  const antwortKopf = new Headers();
  for (const [name, wert] of oben.headers) {
    if (VERBINDUNGSKOEPFE.has(name)) continue;
    if (name === "content-encoding" || name === "content-length") continue;
    // `set-cookie` NICHT ueber set(): mehrere Koepfe wuerden zu einem
    // zusammengefaltet, und ein zusammengefaltetes Cookie-Paar ist kaputt.
    if (name === "set-cookie") continue;
    antwortKopf.set(name, wert);
  }
  for (const keks of oben.headers.getSetCookie()) antwortKopf.append("set-cookie", keks);

  return new Response(oben.body, {
    status: oben.status,
    statusText: oben.statusText,
    headers: antwortKopf,
  });
}
```

**Step 4: Test laufen lassen — er MUSS gruen sein**

```bash
pnpm --filter @easytree/web exec vitest run test/proxy-durchreichen.test.ts
```

Erwartet: `Test Files 1 passed (1)`, `Tests 9 passed (9)`.

**Step 5: Gegenmutation AUSFUEHREN, messen, zuruecknehmen**

Die Eigenschaft heisst "liest bei jeder Anfrage neu". Die Mutation, die sie
widerlegt, friert den Wert beim Modulladen ein.

```bash
cp apps/web/lib/proxy-durchreichen.ts /tmp/eyt126-durchreichen.bak
```

Ersetze in `apps/web/lib/proxy-durchreichen.ts` den Rumpf von
`aktuellesProxyziel` durch eine Modulkonstante:

```ts
const EINGEFROREN = normalizeProxyTarget(
  process.env.EASYTREE_API_PROXY_TARGET,
  process.env.NODE_ENV,
);

export function aktuellesProxyziel(): string {
  return EINGEFROREN;
}
```

```bash
pnpm --filter @easytree/web exec vitest run test/proxy-durchreichen.test.ts
```

Erwartet: **rot**, und zwar genau in
`liest das Ziel bei JEDER Anfrage neu aus der Umgebung`.
Notiere die Fehlermeldung woertlich fuer den PR-Text.

Zuruecknehmen und die Ruecknahme belegen:

```bash
cp /tmp/eyt126-durchreichen.bak apps/web/lib/proxy-durchreichen.ts
git diff --stat -- apps/web/lib/proxy-durchreichen.ts   # muss LEER sein wenn schon committed,
                                                        # sonst: diff gegen die Sicherung
diff /tmp/eyt126-durchreichen.bak apps/web/lib/proxy-durchreichen.ts && echo IDENTISCH
pnpm --filter @easytree/web exec vitest run test/proxy-durchreichen.test.ts
```

Erwartet: `IDENTISCH`, danach wieder `9 passed`.

**Step 6: Commit**

```bash
git add apps/web/lib/proxy-durchreichen.ts apps/web/test/proxy-durchreichen.test.ts
git commit -m "feat(web): EYT-126 Proxyziel zur Laufzeit lesen statt beim Bauen einbacken"
```

---

## Task 2: Die drei Route Handler

**Files:**

- Create: `apps/web/app/api/[[...pfad]]/route.ts`
- Create: `apps/web/app/health/route.ts`
- Create: `apps/web/app/ready/route.ts`
- Create: `apps/web/test/proxy-routen.test.ts`

**Step 1: Schreibe den fehlschlagenden Test**

Erstelle `apps/web/test/proxy-routen.test.ts`:

```ts
/**
 * Die Routen selbst sind der Nachweis (EYT-126).
 *
 * Ein Test, der nur `durchreichen` prueft, bliebe gruen, wenn eine der drei
 * Routen fehlte oder eine Methode nicht exportiert waere — und genau das waere
 * im Browser ein 404 auf `/ready` statt eines Fehlers.
 */
import { describe, expect, it } from "vitest";

import * as apiRoute from "../app/api/[[...pfad]]/route";
import * as healthRoute from "../app/health/route";
import * as readyRoute from "../app/ready/route";
import { durchreichen } from "../lib/proxy-durchreichen";

describe("Proxyrouten", () => {
  it("reicht /api mit allen Methoden an dieselbe Durchreiche", () => {
    for (const methode of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      expect(apiRoute[methode as keyof typeof apiRoute]).toBe(durchreichen);
    }
  });

  it("reicht /health und /ready lesend an dieselbe Durchreiche", () => {
    expect(healthRoute.GET).toBe(durchreichen);
    expect(healthRoute.HEAD).toBe(durchreichen);
    expect(readyRoute.GET).toBe(durchreichen);
    expect(readyRoute.HEAD).toBe(durchreichen);
  });

  it("erzwingt dynamisches Rendern — sonst waere das Ziel wieder eingebacken", () => {
    expect(apiRoute.dynamic).toBe("force-dynamic");
    expect(healthRoute.dynamic).toBe("force-dynamic");
    expect(readyRoute.dynamic).toBe("force-dynamic");
  });
});
```

**Step 2: Test laufen lassen — er MUSS rot sein**

```bash
pnpm --filter @easytree/web exec vitest run test/proxy-routen.test.ts
```

Erwartet: `Failed to resolve import "../app/health/route"`.

**Step 3: Minimale Umsetzung**

`apps/web/app/api/[[...pfad]]/route.ts`:

```ts
/**
 * Same-Origin-Durchreiche fuer alle API-Pfade (EYT-126).
 *
 * Optionaler Catch-all (`[[...pfad]]`), damit auch `/api` selbst getroffen wird
 * und nicht als 404 aus der Web-App zurueckkommt.
 */
import { durchreichen } from "../../../lib/proxy-durchreichen";

export const dynamic = "force-dynamic";

export const GET = durchreichen;
export const POST = durchreichen;
export const PUT = durchreichen;
export const PATCH = durchreichen;
export const DELETE = durchreichen;
export const OPTIONS = durchreichen;
export const HEAD = durchreichen;
```

`apps/web/app/health/route.ts`:

```ts
/**
 * `/health` gehoert der API, nicht der Web-Shell (EYT-50).
 *
 * Der bestehende ApiClient ruft `/health` relativ zu seiner Basis-URL, und die
 * ist die Web-Origin. Ohne diese Route liefe der Health-Check ins Leere.
 */
import { durchreichen } from "../../lib/proxy-durchreichen";

export const dynamic = "force-dynamic";

export const GET = durchreichen;
export const HEAD = durchreichen;
```

`apps/web/app/ready/route.ts`:

```ts
/**
 * `/ready` gehoert der API, nicht der Web-Shell (EYT-50).
 */
import { durchreichen } from "../../lib/proxy-durchreichen";

export const dynamic = "force-dynamic";

export const GET = durchreichen;
export const HEAD = durchreichen;
```

**Step 4: Test laufen lassen — er MUSS gruen sein**

```bash
pnpm --filter @easytree/web exec vitest run test/proxy-routen.test.ts
```

Erwartet: `Tests 3 passed (3)`.

**Step 5: Commit**

```bash
git add "apps/web/app/api/[[...pfad]]/route.ts" apps/web/app/health/route.ts \
        apps/web/app/ready/route.ts apps/web/test/proxy-routen.test.ts
git commit -m "feat(web): EYT-126 Same-Origin-Proxy als Route Handler"
```

---

## Task 3: Startsperre in `instrumentation.ts`

**Files:**

- Create: `apps/web/instrumentation.ts`
- Create: `apps/web/test/instrumentation.test.ts`

**Step 1: Schreibe den fehlschlagenden Test**

Erstelle `apps/web/test/instrumentation.test.ts`:

```ts
/**
 * Der Start ist die letzte Stelle, an der ein falsches Ziel billig auffaellt
 * (EYT-126).
 *
 * Ohne diese Sperre antwortete nur `/api`, `/health` und `/ready` mit 500 —
 * die Anwendung selbst saehe gesund aus und zeigte im Browser eine leere Woche.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InvalidProxyTargetError } from "../lib/api-proxy-target";
import { register } from "../instrumentation";

const URSPRUNG = { ...process.env };

beforeEach(() => {
  process.env.NODE_ENV = "production";
});

afterEach(() => {
  process.env = { ...URSPRUNG };
});

describe("register", () => {
  it("wirft in production, wenn das Ziel fehlt", () => {
    delete process.env.EASYTREE_API_PROXY_TARGET;
    expect(() => register()).toThrow(InvalidProxyTargetError);
  });

  it("wirft in production bei einem ungueltigen Ziel", () => {
    process.env.EASYTREE_API_PROXY_TARGET = "ftp://api.invalid";
    expect(() => register()).toThrow(InvalidProxyTargetError);
  });

  it("wirft bei Zugangsdaten im Ziel", () => {
    process.env.EASYTREE_API_PROXY_TARGET = "http://nutzer:geheim@api.invalid:3001";
    expect(() => register()).toThrow(InvalidProxyTargetError);
  });

  it("laesst ein gueltiges Ziel durch", () => {
    process.env.EASYTREE_API_PROXY_TARGET = "http://api:3001";
    expect(() => register()).not.toThrow();
  });
});
```

**Step 2: Test laufen lassen — er MUSS rot sein**

```bash
pnpm --filter @easytree/web exec vitest run test/instrumentation.test.ts
```

Erwartet: `Failed to resolve import "../instrumentation"`.

**Step 3: Minimale Umsetzung**

Erstelle `apps/web/instrumentation.ts`:

```ts
/**
 * Startsperre fuer das Proxyziel (EYT-126).
 *
 * `register()` laeuft EINMAL beim Hochfahren des Next-Servers, vor der ersten
 * Anfrage. Wirft es, meldet Next "Failed to prepare server" und beantwortet
 * danach JEDE Route mit 500 — auch `/` und `/anmelden`. Gemessen am 21.08.2026
 * auf Next 16.2.11 im Standalone-Server.
 *
 * Ehrliche Grenze: der Prozess bleibt am Leben und haelt den Port. Er bedient
 * aber keinen normalen Anwendungsverkehr mehr, und der Compose-Healthcheck auf
 * `/` schlaegt fehl, der Container gilt als `unhealthy`. Behaupte nicht, der
 * Container starte nicht.
 *
 * Der Wert wird hier NICHT zwischengespeichert. Die Sperre beantwortet "ist die
 * Umgebung brauchbar", nicht "welches Ziel gilt" — das entscheidet
 * lib/proxy-durchreichen.ts bei jeder Anfrage neu.
 */
import { aktuellesProxyziel } from "./lib/proxy-durchreichen";

export function register(): void {
  const ziel = aktuellesProxyziel();
  console.log(`[web] Proxyziel geprueft: ${ziel}`);
}
```

**Step 4: Test laufen lassen — er MUSS gruen sein**

```bash
pnpm --filter @easytree/web exec vitest run test/instrumentation.test.ts
```

Erwartet: `Tests 4 passed (4)`.

**Step 5: Commit**

```bash
git add apps/web/instrumentation.ts apps/web/test/instrumentation.test.ts
git commit -m "feat(web): EYT-126 Startsperre fuer ein fehlendes oder ungueltiges Proxyziel"
```

---

## Task 4: Positivliste des Geheimnis-Waechters nachziehen

**Files:**

- Modify: `apps/api/test/architecture/secret-surface-rules.ts` (`ERLAUBTE_UMGEBUNGSLESER`,
  aktuell Zeilen 717–733)

**Step 1: Den Waechter rot sehen — bevor du ihn anfasst**

```bash
pnpm --filter @easytree/api exec vitest run test/secret-surface.test.ts
```

Erwartet (gemessen im Spike): ein Fund fuer
`apps/web/lib/proxy-durchreichen.ts:… [runtime-reads-no-environment]`.

Kommt **kein** Fund, dann liest deine Umsetzung die Variable nicht dort, wo sie
soll — pruefe das, bevor du weitermachst.

**Step 2: Eintrag ergaenzen**

Fuege in `ERLAUBTE_UMGEBUNGSLESER` nach dem `apps/web/next.config.ts`-Eintrag ein:

```ts
  {
    datei: "apps/web/lib/proxy-durchreichen.ts",
    grund:
      "Die EINE Laufzeitstelle des Same-Origin-Proxys (EASYTREE_API_PROXY_TARGET). " +
      "Sie laeuft nur im Serverprozess, nie im Browser, und reicht den Wert " +
      "sofort an das strikte normalizeProxyTarget weiter. Der Zugriff MUSS hier " +
      "und nicht beim Modulladen passieren — sonst waere das Ziel wieder an den " +
      "Build gebunden (EYT-126). instrumentation.ts liest die Umgebung deshalb " +
      "nicht selbst, sondern ruft aktuellesProxyziel() auf.",
  },
```

**Step 3: Waechter gruen**

```bash
pnpm --filter @easytree/api exec vitest run test/secret-surface.test.ts
pnpm --filter @easytree/api exec vitest run test/secret-surface.red-case.test.ts
```

Erwartet: beide gruen, keine Funde.

**Step 4: Gegenmutation AUSFUEHREN**

Lies in `apps/web/instrumentation.ts` versuchsweise selbst aus der Umgebung:

```ts
const ziel = normalizeProxyTarget(process.env.EASYTREE_API_PROXY_TARGET, process.env.NODE_ENV);
```

```bash
pnpm --filter @easytree/api exec vitest run test/secret-surface.test.ts
```

Erwartet: **rot**, mit `apps/web/instrumentation.ts:… [runtime-reads-no-environment]`.
Das belegt, dass die Positivliste nicht pauschal `apps/web` freigibt.
Danach zuruecknehmen und `diff` gegen die Sicherung leer belegen.

**Step 5: Commit**

```bash
git add apps/api/test/architecture/secret-surface-rules.ts
git commit -m "test(api): EYT-126 die eine Laufzeitstelle des Proxyziels in die Positivliste"
```

---

## Task 5: Bauzeitbindung aus `next.config.ts` entfernen

**Files:**

- Modify: `apps/web/next.config.ts` (Zeilen 5, 37–44)
- Modify: `apps/web/lib/api-proxy-target.ts` (Zeilen 11–31, 39–49, 105–133)
- Modify: `apps/web/test/api-proxy-target.test.ts` (Zeilen 6–12, 62–90)
- Modify: `turbo.json` (Zeile 6)

**Step 1: `rewrites()` entfernen**

Loesche aus `apps/web/next.config.ts` den gesamten `async rewrites() { … }`-Block
und die Zeile `import { resolveBuildProxyTarget } from "./lib/api-proxy-target";`.
Ersetze den Doc-Kommentar-Abschnitt "Same-Origin statt CORS" durch:

```
 * ## Same-Origin statt CORS
 *
 * Der Browser bleibt auf der Origin der Web-App und ruft relative Pfade. Die
 * Weiterleitung an die API passiert NICHT hier: `rewrites()` wird beim Bauen
 * aufgeloest und in `.next/routes-manifest.json` geschrieben, womit ein
 * fertiges Image an sein Ziel gebunden waere. Zustaendig sind stattdessen die
 * Route Handler unter `app/api/[[...pfad]]`, `app/health` und `app/ready`; sie
 * lesen das Ziel bei jeder Anfrage neu (EYT-126).
```

**Step 2: Gegenprobe — die Muster MUESSEN weg sein**

```bash
grep -n "rewrites\|resolveBuildProxyTarget" apps/web/next.config.ts; echo "exit=$?"
```

Erwartet: keine Ausgabe, `exit=1`.
(Der Exit-Code des `grep` selbst, nichts dahinter gepipt — siehe die Regel in
CLAUDE.md ueber Exit-Codes durch Pipes.)

**Step 3: Toten Cloudflare-Bauzeitpfad entfernen**

`resolveBuildProxyTarget`, `CLOUDFLARE_API_FALLBACK_TARGET` und `ProxyBuildEnvironment`
hatten genau einen Aufrufer: `next.config.ts`. Ohne ihn sind sie tot, und toter
Code mit gruenen Tests behauptet eine Zusage, die niemand mehr einloest.

Loesche aus `apps/web/lib/api-proxy-target.ts`:

- `CLOUDFLARE_API_FALLBACK_TARGET` samt Doc-Kommentar (Zeilen 39–49)
- `ProxyBuildEnvironment` und `resolveBuildProxyTarget` (Zeilen 105–133)

Ersetze den Abschnitt "Build-Konfiguration, nicht Laufzeitschalter" im Dateikopf
durch:

```
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
```

Loesche in `apps/web/test/api-proxy-target.test.ts` den kompletten
`describe("resolveBuildProxyTarget", …)`-Block und die zugehoerigen Importe
`CLOUDFLARE_API_FALLBACK_TARGET` und `resolveBuildProxyTarget`.

**Step 4: `turbo.json` — Cache-Schluessel entschlacken**

Entferne in `turbo.json` Zeile 6 die drei nun unbenutzten Namen aus dem
`env`-Feld der `build`-Aufgabe:

```json
      "env": ["EASYTREE_NEXT_OUTPUT"],
```

**Step 5: Alles laufen lassen**

```bash
pnpm --filter @easytree/web test
pnpm --filter @easytree/web run typecheck
grep -rn "resolveBuildProxyTarget\|CLOUDFLARE_API_FALLBACK_TARGET" apps packages scripts .github turbo.json; echo "exit=$?"
```

Erwartet: Web-Suite gruen (Fallzahl steigt gegenueber `273` um die neuen Faelle
und faellt um die vier geloeschten), `typecheck` ohne Fehler, letzter `grep`
ohne Ausgabe mit `exit=1`.

**Step 6: Der Bau darf die Variable nicht mehr brauchen**

```bash
env -u EASYTREE_API_PROXY_TARGET pnpm --filter @easytree/web... build
```

Erwartet: Exit 0. In der Routentabelle stehen `ƒ /api/[[...pfad]]`, `ƒ /health`,
`ƒ /ready`; die Zeile `ƒ Proxy (Middleware)` darf **nicht** erscheinen.

Das ist die Gegenprobe zur alten Zusage: vor dieser Aenderung brach derselbe
Befehl mit `EASYTREE_API_PROXY_TARGET ist in production Pflicht` ab.

**Step 7: Cloudflare-Buendel bleibt baubar**

```bash
pnpm --filter @easytree/web run build:cf
```

Erwartet: `Worker saved in .open-next/worker.js` und `OpenNext build complete.`
Danach aufraeumen: `rm -rf apps/web/.open-next apps/web/.wrangler-dry`.

**Step 8: Commit**

```bash
git add apps/web/next.config.ts apps/web/lib/api-proxy-target.ts \
        apps/web/test/api-proxy-target.test.ts turbo.json
git commit -m "refactor(web): EYT-126 Bauzeit-Rewrite und toten Cloudflare-Bauzeitpfad entfernen"
```

---

## Task 6: Dockerfiles — Ziel raus, `GIT_SHA` zur Pflicht

**Files:**

- Modify: `apps/web/Dockerfile` (Kopfkommentar Zeilen 1–33, Zeilen 57–58, 70)
- Modify: `apps/api/Dockerfile` (Zeile 72)

**Step 1: Web-Dockerfile — Bauzeitziel entfernen**

Loesche in `apps/web/Dockerfile` die Zeilen

```
ARG EASYTREE_API_PROXY_TARGET
ENV EASYTREE_API_PROXY_TARGET=${EASYTREE_API_PROXY_TARGET}
```

und ersetze den gesamten Kopfkommentar (Zeilen 1–33 bis vor `ARG NODE_IMAGE`) durch:

```dockerfile
# syntax=docker/dockerfile:1.7
#
# easyTree Web-Shell (Next.js App Router) als OCI-Workload — EYT-126.
#
# ## Das Proxyziel ist LAUFZEIT-Konfiguration. Gemessen, nicht vermutet.
#
# Der Same-Origin-Proxy liegt in Route Handlern (`app/api/[[...pfad]]`,
# `app/health`, `app/ready`), nicht mehr in `next.config.ts`-`rewrites()`. Route
# Handler sind dynamischer Servercode: sie lesen `EASYTREE_API_PROXY_TARGET` bei
# JEDER Anfrage neu.
#
# Nachgemessen am 21.08.2026 auf Next 16.2.11: EIN Standalone-Build, danach
# derselbe Server dreimal mit unterschiedlichem Ziel gestartet — die Antworten
# kamen von den drei verschiedenen Stubs, ohne Neubau dazwischen.
#
# Deshalb steht hier KEIN `ARG EASYTREE_API_PROXY_TARGET` mehr. Dieses Image ist
# an keinen Anbieter und an kein Ziel gebunden; dieselbe Datei und derselbe
# Startpfad liefern es fuer Coolify/VPS wie fuer Railway.
#
# ## Fail-closed
#
# `instrumentation.ts` prueft das Ziel beim Serverstart. Fehlt es oder ist es
# ungueltig, meldet Next "Failed to prepare server" und beantwortet JEDE Route
# mit 500 — auch `/`. Der Prozess haelt dabei den Port; er bedient aber keinen
# normalen Anwendungsverkehr, und der Compose-Healthcheck auf `/` schlaegt fehl.
#
# `GIT_SHA` hat bewusst KEINEN Vorgabewert und wird unten erzwungen: ein Image
# mit `revision=unknown` waere ein Deploy ohne Herkunft.
#
# ## Der Browser sieht diese Adresse nie
#
# Das Ziel ist ausdruecklich KEIN `NEXT_PUBLIC_*`. Es wird serverseitig
# aufgeloest; weder im Browserbuendel noch in einem Antwortkopf steht es.
```

**Step 2: `GIT_SHA` in BEIDEN Dockerfiles erzwingen**

Ersetze in `apps/web/Dockerfile` **und** `apps/api/Dockerfile` jeweils

```dockerfile
ARG GIT_SHA=unknown
```

durch

```dockerfile
# Kein Vorgabewert, und der Wert wird geprueft: ein leeres ARG faellt sonst
# still auf ein Label ohne Inhalt zurueck, und "das Image ist gruen" waere eine
# Aussage ueber irgendein Image (EYT-126).
ARG GIT_SHA
RUN test -n "${GIT_SHA}" || { \
      echo "GIT_SHA fehlt. Baue mit --build-arg GIT_SHA=\$(git rev-parse HEAD)." >&2; \
      exit 1; \
    }
```

**Step 3: Gegenprobe — Bau ohne `GIT_SHA` MUSS scheitern**

```bash
docker build -f apps/web/Dockerfile -t easytree-web:ohne-sha . 2>&1 | tail -5; \
  echo "exit=${PIPESTATUS[0]}"
docker build -f apps/api/Dockerfile -t easytree-api:ohne-sha . 2>&1 | tail -5; \
  echo "exit=${PIPESTATUS[0]}"
```

Erwartet: beide mit `exit=1` und der Zeile
`GIT_SHA fehlt. Baue mit --build-arg GIT_SHA=$(git rev-parse HEAD).`

Braucht Docker. Auf diesem Mac ist die Engine `colima` — `colima start`, bevor du
das versuchst.

**Step 4: Gegenprobe — Bau MIT `GIT_SHA` traegt das Label**

```bash
SHA="$(git rev-parse HEAD)"
docker build -f apps/web/Dockerfile --build-arg "GIT_SHA=${SHA}" -t easytree-web:probe .
docker inspect easytree-web:probe \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Erwartet: exakt der Wert von `${SHA}`.

**Step 5: Commit**

```bash
git add apps/web/Dockerfile apps/api/Dockerfile
git commit -m "fix(deploy): EYT-126 Web-Image vom Bauzeitziel loesen und GIT_SHA erzwingen"
```

---

## Task 7: `docker-compose.yml` fail-closed

**Files:**

- Modify: `docker-compose.yml` (Zeilen 20–24, 56–76)

**Step 1: Beide fail-open-Stellen schliessen**

`api.build.args` und `web.build.args`:

```yaml
      args:
        # `:?` statt `:-`: ein Image ohne Herkunft ist kein Kandidat fuer ein
        # Deploy. Frueher stand hier `${GIT_SHA:-unknown}` — damit war
        # `revision=unknown` ueber genau diesen Pfad erzeugbar (EYT-126).
        GIT_SHA: ${GIT_SHA:?GIT_SHA fehlt — baue mit GIT_SHA=$(git rev-parse HEAD)}
```

Im `web`-Dienst **entfaellt** der Build-Arg `EASYTREE_API_PROXY_TARGET` ersatzlos.
Stattdessen unter `web.environment`:

```yaml
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      PORT: "3000"
      HOSTNAME: "0.0.0.0"
      # LAUFZEIT, nicht Bauzeit — gemessen 21.08.2026, siehe den Kopf von
      # apps/web/Dockerfile. Kein Default: ein geratenes Ziel sieht im Browser
      # aus wie eine leere Woche, nicht wie ein Fehler.
      EASYTREE_API_PROXY_TARGET: ${EASYTREE_API_PROXY_TARGET:?EASYTREE_API_PROXY_TARGET fehlt — interner Dienstname der API, z. B. http://api:3001}
```

Passe den Kopfkommentar der Datei an: die Aussage "Nur `web` veroeffentlicht einen
Port" bleibt; ergaenze einen dritten Punkt:

```yaml
#  3. Weder `GIT_SHA` noch `EASYTREE_API_PROXY_TARGET` haben einen Vorgabewert.
#     Beide waren es frueher (`:-unknown`, `:-http://api:3001`) — ein Deploy
#     ohne Herkunft und ein geratenes Proxyziel waren damit ueber genau diesen
#     Pfad erzeugbar (EYT-126).
```

**Step 2: Gegenprobe — Compose ohne die Variablen MUSS scheitern**

```bash
env -u GIT_SHA -u EASYTREE_API_PROXY_TARGET \
  DATABASE_URL=x SUPABASE_URL=x SUPABASE_ANON_KEY=x DATABASE_SSL_ROOT_CERT=x \
  docker compose config >/dev/null 2>/tmp/eyt126-compose.err; echo "exit=$?"
cat /tmp/eyt126-compose.err
```

Erwartet: `exit=1` und die Meldung
`GIT_SHA fehlt — baue mit GIT_SHA=$(git rev-parse HEAD)`.

Danach dieselbe Probe nur ohne das Ziel:

```bash
env -u EASYTREE_API_PROXY_TARGET GIT_SHA="$(git rev-parse HEAD)" \
  DATABASE_URL=x SUPABASE_URL=x SUPABASE_ANON_KEY=x DATABASE_SSL_ROOT_CERT=x \
  docker compose config >/dev/null 2>/tmp/eyt126-compose2.err; echo "exit=$?"
cat /tmp/eyt126-compose2.err
```

Erwartet: `exit=1`, Meldung nennt `EASYTREE_API_PROXY_TARGET`.

Und die Positivprobe, damit die beiden Faelle nicht vakuoes sind:

```bash
GIT_SHA="$(git rev-parse HEAD)" EASYTREE_API_PROXY_TARGET=http://api:3001 \
  DATABASE_URL=x SUPABASE_URL=x SUPABASE_ANON_KEY=x DATABASE_SSL_ROOT_CERT=x \
  docker compose config >/dev/null; echo "exit=$?"
```

Erwartet: `exit=0`.

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "fix(deploy): EYT-126 GIT_SHA und Proxyziel im Compose-Pfad fail-closed"
```

---

## Task 8: Ein Waechter, der das Fail-open nicht zurueckkommen laesst

Die Compose-Probe aus Task 7 ist ein Handgriff. Sie laeuft nie wieder, wenn sie
niemand wiederholt. Dieser Task macht daraus eine dauerhafte Zusicherung.

**Files:**

- Create: `apps/api/test/container-bindung.test.ts`

**Step 1: Schreibe den fehlschlagenden Test**

```ts
/**
 * Die Containerbindung darf nicht stillschweigend wieder fail-open werden
 * (EYT-126).
 *
 * Zwei Regressionen sind hier schon passiert und beide sahen harmlos aus:
 * `GIT_SHA: ${GIT_SHA:-unknown}` und
 * `EASYTREE_API_PROXY_TARGET: ${EASYTREE_API_PROXY_TARGET:-http://api:3001}`.
 * Ein Vorgabewert, auf den sich niemand berufen darf, aber alle sich verlassen,
 * ist die schlechteste Sorte Vorgabe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const WURZEL = join(__dirname, "..", "..", "..");

function lies(datei: string): string {
  const inhalt = readFileSync(join(WURZEL, datei), "utf8");
  // Eingangsbremse: eine leere oder verschobene Datei liesse jede Zusicherung
  // unten vakuoes gruen werden.
  expect(inhalt.length, `${datei} ist leer oder fehlt`).toBeGreaterThan(200);
  return inhalt;
}

describe("docker-compose.yml", () => {
  const compose = lies("docker-compose.yml");

  it("gibt GIT_SHA keinen Vorgabewert", () => {
    expect(compose).not.toMatch(/\$\{GIT_SHA:-/);
    expect(compose).toMatch(/\$\{GIT_SHA:\?/);
  });

  it("gibt dem Proxyziel keinen Vorgabewert", () => {
    expect(compose).not.toMatch(/\$\{EASYTREE_API_PROXY_TARGET:-/);
    expect(compose).toMatch(/\$\{EASYTREE_API_PROXY_TARGET:\?/);
  });

  it("uebergibt das Proxyziel als Laufzeit- und nicht als Bauvariable", () => {
    const bauabschnitt = compose.slice(0, compose.indexOf("environment:", compose.indexOf("web:")));
    expect(bauabschnitt).not.toContain("EASYTREE_API_PROXY_TARGET");
  });
});

describe("Dockerfiles", () => {
  it.each(["apps/web/Dockerfile", "apps/api/Dockerfile"])(
    "%s erzwingt GIT_SHA statt es vorzubelegen",
    (datei) => {
      const inhalt = lies(datei);
      expect(inhalt).not.toMatch(/ARG\s+GIT_SHA\s*=/);
      expect(inhalt).toMatch(/RUN\s+test\s+-n\s+"\$\{GIT_SHA\}"/);
    },
  );

  it("das Web-Image backt kein Proxyziel mehr ein", () => {
    const inhalt = lies("apps/web/Dockerfile");
    expect(inhalt).not.toMatch(/^ARG\s+EASYTREE_API_PROXY_TARGET/m);
    expect(inhalt).not.toMatch(/^ENV\s+EASYTREE_API_PROXY_TARGET/m);
  });
});
```

**Step 2: Test laufen lassen**

```bash
pnpm --filter @easytree/api exec vitest run test/container-bindung.test.ts
```

Erwartet: `Tests 6 passed (6)`. Kommt eine andere Zahl, hat der Pfadfilter etwas
anderes selektiert (er ist ein Substring-Filter) — pruefe die Dateiliste.

**Step 3: Gegenmutation AUSFUEHREN**

```bash
cp docker-compose.yml /tmp/eyt126-compose.bak
sed -i '' 's/\${GIT_SHA:?[^}]*}/${GIT_SHA:-unknown}/' docker-compose.yml
grep -n 'GIT_SHA' docker-compose.yml     # die Mutation MUSS sichtbar sein
pnpm --filter @easytree/api exec vitest run test/container-bindung.test.ts
```

Erwartet: **rot** in `gibt GIT_SHA keinen Vorgabewert`.

Zuruecknehmen und belegen:

```bash
cp /tmp/eyt126-compose.bak docker-compose.yml
diff /tmp/eyt126-compose.bak docker-compose.yml && echo IDENTISCH
pnpm --filter @easytree/api exec vitest run test/container-bindung.test.ts
```

**Step 4: Commit**

```bash
git add apps/api/test/container-bindung.test.ts
git commit -m "test(deploy): EYT-126 Fail-open in Compose und Dockerfiles dauerhaft ausschliessen"
```

---

## Task 9: Container-Smoke — der geforderte Gegentest

Das ist der Kern der PO-Forderung: **ein** Image-Digest, **zwei** Starts, **zwei**
Ziele, **kein** Neubau dazwischen.

**Files:**

- Modify: `scripts/smoke-container.sh` (Zeilen 1–30 Kopf, 97–103 Bau, 176–210
  Web-Start, Abschnittsnummerierung 8 → 10)

**Step 1: Bauaufruf entkoppeln**

Ersetze in Schritt `1/8` den Web-Bau:

```bash
docker build -f apps/web/Dockerfile \
  --build-arg "GIT_SHA=${GIT_SHA}" \
  -t "${WEB_IMAGE}" .
```

Der Build-Arg `EASYTREE_API_PROXY_TARGET` entfaellt ersatzlos. Ergaenze direkt
danach die Digest-Bindung, an die alle folgenden Starts gebunden werden:

```bash
# Ab hier zaehlt der Digest, nicht der Tag. Ein Tag laesst sich zwischen zwei
# Starts umhaengen; der Digest nicht — und genau "kein Neubau dazwischen" ist
# die Aussage, die dieser Smoke belegen soll.
WEB_DIGEST="$(docker image inspect "${WEB_IMAGE}" --format '{{.Id}}')"
echo "  Web-Image-Digest: ${WEB_DIGEST}"
```

**Step 2: Web-Container mit Laufzeitziel starten**

Ergaenze den bestehenden `docker run` fuer `${WEB_CONTAINER}` um

```bash
  -e "EASYTREE_API_PROXY_TARGET=${INTERNES_ZIEL}" \
```

und benutze `"${WEB_DIGEST}"` statt `"${WEB_IMAGE}"` als Image-Referenz.

**Step 3: Neuen Abschnitt 9 einfuegen — ein Image, zwei Ziele**

Fuege nach dem bisherigen Schritt `7/8` (Produktionsprofil ohne Zertifikat) und
vor dem Herunterfahren ein:

```bash
echo "== 9/10 Ein Image, zwei Ziele, kein Neubau =="
# Die PO-Forderung woertlich: derselbe Digest wird zweimal gestartet, jedes Mal
# gegen eine andere API, und es MUSS jedes Mal die richtige antworten. Zwei
# Stub-Container statt der echten API, weil der Nachweis ueber die UNTERSCHEIDUNG
# laeuft — zwei echte APIs waeren nicht unterscheidbar.
ZWEI_ZIEL_A="easytree-stub-a"
ZWEI_ZIEL_B="easytree-stub-b"
ZWEI_WEB="easytree-web-zweiziel"

stub_starten() {
  local name="$1"
  docker run -d --name "${name}" --network "${NETZ}" --network-alias "${name}" \
    -e "STUB_NAME=${name}" \
    "${NODE_IMAGE:-node:22.23.1-bookworm-slim}" \
    node -e "require('http').createServer((q,s)=>{s.writeHead(200,{'content-type':'application/json'});s.end(JSON.stringify({stub:process.env.STUB_NAME,pfad:q.url}))}).listen(3001,'0.0.0.0')" \
    >/dev/null
}

ziel_antwortet() {
  local erwartet="$1" ziel="$2" gelesen
  docker rm -f "${ZWEI_WEB}" >/dev/null 2>&1 || true
  docker run -d --name "${ZWEI_WEB}" --network "${NETZ}" \
    -p "127.0.0.1:${ZWEI_PORT}:3000" \
    -e NODE_ENV=production -e PORT=3000 -e HOSTNAME=0.0.0.0 \
    -e "EASYTREE_API_PROXY_TARGET=${ziel}" \
    "${WEB_DIGEST}" >/dev/null
  warte_auf "http://127.0.0.1:${ZWEI_PORT}/" || {
    docker logs "${ZWEI_WEB}" 2>&1 | tail -20 >&2; return 1; }
  gelesen="$(curl -fsS "http://127.0.0.1:${ZWEI_PORT}/health")"
  echo "  ziel=${ziel} -> ${gelesen}"
  printf '%s' "${gelesen}" | grep -qF "\"stub\":\"${erwartet}\""
}

ZWEI_PORT="${EASYTREE_SMOKE_ZWEI_PORT:-3020}"
stub_starten "${ZWEI_ZIEL_A}"
stub_starten "${ZWEI_ZIEL_B}"

pruefung "derselbe Digest erreicht Ziel A" \
  ziel_antwortet "${ZWEI_ZIEL_A}" "http://${ZWEI_ZIEL_A}:3001"
pruefung "derselbe Digest erreicht Ziel B — ohne Neubau" \
  ziel_antwortet "${ZWEI_ZIEL_B}" "http://${ZWEI_ZIEL_B}:3001"

digest_unveraendert() {
  local jetzt
  jetzt="$(docker image inspect "${WEB_IMAGE}" --format '{{.Id}}')"
  echo "  vorher=${WEB_DIGEST} nachher=${jetzt}"
  [ "${jetzt}" = "${WEB_DIGEST}" ]
}
pruefung "der Image-Digest ist zwischen beiden Laeufen unveraendert" digest_unveraendert

echo "== 9b/10 Fail-closed zur Laufzeit =="
start_verweigert() {
  local beschreibung="$1" antwort
  shift
  docker rm -f "${ZWEI_WEB}" >/dev/null 2>&1 || true
  docker run -d --name "${ZWEI_WEB}" --network "${NETZ}" \
    -p "127.0.0.1:${ZWEI_PORT}:3000" \
    -e NODE_ENV=production -e PORT=3000 -e HOSTNAME=0.0.0.0 \
    "$@" "${WEB_DIGEST}" >/dev/null
  sleep 8
  # Die Startseite, nicht `/health`: die Zusage lautet, dass KEIN normaler
  # Anwendungsverkehr bedient wird.
  antwort="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://127.0.0.1:${ZWEI_PORT}/")"
  echo "  ${beschreibung}: / -> HTTP ${antwort}"
  [ "${antwort}" = "500" ] || return 1
  # Nicht irgendein 500: es MUSS diese Variable sein.
  docker logs "${ZWEI_WEB}" 2>&1 | grep -qF "EASYTREE_API_PROXY_TARGET" || {
    echo "  500, aber das Protokoll nennt EASYTREE_API_PROXY_TARGET nicht" >&2
    docker logs "${ZWEI_WEB}" 2>&1 | tail -20 >&2
    return 1
  }
}
pruefung "ohne Proxyziel wird kein Anwendungsverkehr bedient" \
  start_verweigert "Ziel fehlt"
pruefung "mit ungueltigem Proxyziel wird kein Anwendungsverkehr bedient" \
  start_verweigert "Ziel ungueltig" -e "EASYTREE_API_PROXY_TARGET=ftp://api:3001"

docker rm -f "${ZWEI_WEB}" "${ZWEI_ZIEL_A}" "${ZWEI_ZIEL_B}" >/dev/null 2>&1 || true
```

Ergaenze `aufraeumen()` um dieselben drei Containernamen, damit ein Abbruch
nichts stehen laesst.

**Step 4: Leckpruefung auf das Browserbuendel ausweiten**

Erweitere `seite_ohne_interne_adresse` (Schritt `5/10`) um das ausgelieferte
JavaScript, nicht nur das HTML:

```bash
  # Das HTML allein reicht nicht: der Wert koennte in einem Client-Chunk stehen.
  # Alle vom HTML referenzierten Skripte werden geholt und mitgeprueft.
  local skripte pfad js
  skripte="$(printf '%s' "${html}" | grep -oE '/_next/static/[^"]+\.js' | sort -u)"
  [ -n "${skripte}" ] || { echo "  kein Client-Chunk referenziert — vakuos" >&2; return 1; }
  for pfad in ${skripte}; do
    js="$(curl -fsS "http://127.0.0.1:${WEB_PORT_HOST}${pfad}")" || return 1
    if printf '%s' "${js}" | grep -qF "${API_CONTAINER}"; then
      echo "  Dienstname steht im Client-Chunk ${pfad}" >&2
      return 1
    fi
  done
```

**Step 5: Antwortkoepfe duerfen die Adresse nicht nennen**

Ergaenze im selben Abschnitt:

```bash
koepfe_ohne_interne_adresse() {
  local koepfe
  koepfe="$(curl -fsS -D - -o /dev/null "http://127.0.0.1:${WEB_PORT_HOST}/health")"
  [ -n "${koepfe}" ] || return 1
  if printf '%s' "${koepfe}" | grep -qiF "${API_CONTAINER}"; then
    echo "  interne Adresse steht in den Antwortkoepfen" >&2
    printf '%s\n' "${koepfe}" >&2
    return 1
  fi
  ! printf '%s' "${koepfe}" | grep -qi 'x-middleware-rewrite'
}
pruefung "die Antwortkoepfe nennen die interne API-Adresse nicht" koepfe_ohne_interne_adresse
```

**Step 6: Zaehlung und Kopfkommentar nachziehen**

Alle `N/8` werden zu `N/10`. Ergaenze im Kopfkommentar zwei Punkte:

```
#   9. Ein Image, zwei Ziele: derselbe Digest wird zweimal gestartet und
#      erreicht zwei verschiedene APIs — ohne Neubau dazwischen. Ohne diesen
#      Punkt bliebe "anbieterneutral" eine Behauptung.
#  10. Gegenprobe dazu: fehlt das Ziel oder ist es ungueltig, wird KEIN
#      Anwendungsverkehr bedient (auch `/` antwortet 500) und das Protokoll
#      nennt EASYTREE_API_PROXY_TARGET.
```

**Step 7: Smoke lokal fahren**

Braucht Docker (`colima start`) und eine erreichbare Datenbank. Ohne Datenbank
steigt der Smoke im Modus `local` mit Warnung aus — das ist **kein** Nachweis.

```bash
colima start
GIT_SHA="$(git rev-parse HEAD)" \
EASYTREE_CONTAINER_SMOKE=local \
EASYTREE_SMOKE_DATABASE_URL="postgresql://easytree_app:…@host.docker.internal:54322/postgres" \
EASYTREE_SMOKE_SUPABASE_URL="http://host.docker.internal:54321" \
EASYTREE_SMOKE_ANON_KEY="lokaler-anon-key" \
  bash scripts/smoke-container.sh 2>&1 | tee /tmp/eyt126-smoke.log
grep -E '\[container-smoke\]' /tmp/eyt126-smoke.log
```

Erwartet: `[container-smoke] mode=local executed=… passed=… skipped=0`, wobei
`passed` gleich `executed` ist. Steht dort `skipped=1`, hat der Smoke sich
weggeduckt — dann ist nichts belegt.

Kommt lokal keine Datenbank zustande, ist der Nachweis der CI-Lauf von
`db-gates` (Task 11). Sage in diesem Fall genau das, statt den Smoke als
bestanden zu fuehren.

**Step 8: Commit**

```bash
git add scripts/smoke-container.sh
git commit -m "test(deploy): EYT-126 ein Image gegen zwei Ziele und Fail-closed im Container belegen"
```

---

## Task 10: Bauzeitvariable aus CI und Harness entfernen

Solange CI die Variable beim Bauen setzt, koennte niemand bemerken, dass der
Build sie nicht mehr braucht. Sie zu entfernen ist die staerkste dauerhafte
Gegenprobe.

**Files:**

- Modify: `.github/workflows/ci.yml` (Zeilen 57–63 `build-web`, Zeile 748 `auth-journey`)
- Modify: `scripts/read-through-harness.sh` (Zeile 87)

**Step 1: `build-web` — Job-Umgebung entfernen**

Loesche in `build-web` den kompletten `env:`-Block samt des vorangehenden
Kommentars (er beschreibt eine Bauzeitzusage, die es nicht mehr gibt) und
ersetze ihn durch:

```yaml
    # Kein EASYTREE_API_PROXY_TARGET mehr: seit EYT-126 loest der Same-Origin-
    # Proxy das Ziel zur LAUFZEIT auf. Dass die Variable hier fehlt, ist die
    # dauerhafte Gegenprobe — brauchte der Build sie noch, waere dieser Job rot.
```

**Step 2: `auth-journey` — Bauschritt entkoppeln**

Ersetze in `auth-journey` den Bauschritt:

```yaml
      - name: Bauen — ECHTE API und Web (das Proxyziel kommt erst beim Start)
        run: |
          pnpm --filter @easytree/api... build
          pnpm --filter @easytree/web... build
```

Das Ziel setzt bereits `apps/web/e2e/auth-journey/config.ts:136` in der
`webServer`-Umgebung — also zur Laufzeit. Genau dieser Job beweist damit
zugleich, dass Auth und HttpOnly-Cookies durch die neue Durchreiche gehen.

**Step 3: `read-through-harness.sh` — Bauzeile entkoppeln**

Zeile 87:

```bash
pnpm --filter @easytree/web... build
```

Zeile 107 bleibt unveraendert — dort steht die Variable beim `next start`, und
das ist ab jetzt die einzige Stelle, an der sie zaehlt.

**Step 4: `web-smoke` NICHT anfassen**

Dort steht die Variable auf Job-Ebene und wird von `next start` geerbt; das ist
korrekt und weiterhin noetig. Lass den Block stehen, ergaenze den Kommentar:

```yaml
    # Job-Ebene, damit `next start` sie erbt: seit EYT-126 ist sie eine
    # LAUFZEIT-Variable. Beim Bauen wird sie nicht mehr gelesen.
```

**Step 5: Gegenprobe lokal**

```bash
bash -n scripts/smoke-container.sh && echo "smoke-container.sh: Syntax ok"
bash -n scripts/read-through-harness.sh && echo "read-through-harness.sh: Syntax ok"
env -u EASYTREE_API_PROXY_TARGET pnpm --filter @easytree/web... build && echo "Build ohne Ziel: ok"
```

**Step 6: Commit**

```bash
git add .github/workflows/ci.yml scripts/read-through-harness.sh
git commit -m "ci: EYT-126 Proxyziel nicht mehr beim Bauen setzen"
```

---

## Task 11: Dokumentation auf den gemessenen Stand ziehen

Drei Dokumente behaupten heute wortreich das Gegenteil des neuen Verhaltens. Sie
stehen lassen waere schlimmer als sie nie geschrieben zu haben.

**Files:**

- Modify: `CLAUDE.md` (Zeilen 163–169, 345, 558–566)
- Modify: `docs/runbooks/staging-deploy.md` (Zeilen 105–130, 160–170, 200, 300–340)

**Step 1: Bestandsaufnahme statt Suchen-und-Ersetzen**

```bash
grep -n "BAUZEIT\|Bauzeit\|build-arg EASYTREE_API_PROXY_TARGET\|Build-Variable\|Buildzeit" \
  CLAUDE.md docs/runbooks/staging-deploy.md
```

Jede Fundstelle wird einzeln entschieden. Absolutaussagen ueberleben in
Zusammenfassungen: entschaerfst du nur die Detailstelle, steht die alte Aussage
in Empfehlung, Tabelle oder Fehlersuchspalte weiter.

**Step 2: `CLAUDE.md` §"Deployment — Container first"**

Ersetze den Absatz `**EASYTREE_API_PROXY_TARGET ist BAUZEIT-Konfiguration …**`
vollstaendig durch:

```markdown
**`EASYTREE_API_PROXY_TARGET` ist LAUFZEIT-Konfiguration — gemessen 21.08.2026 auf
Next 16.2.11 (EYT-126).** Der Same-Origin-Proxy liegt seit EYT-126 in Route Handlern
(`apps/web/app/api/[[...pfad]]`, `app/health`, `app/ready`), nicht mehr in
`next.config.ts`-`rewrites()`. Ein Standalone-Build wurde dreimal mit
unterschiedlichem Ziel gestartet und antwortete jedes Mal vom richtigen Stub, ohne
Neubau dazwischen. **Das Web-Image ist damit weder an ein Ziel noch an einen
Anbieter gebunden** — dieselbe Datei und derselbe Startpfad bauen es fuer Coolify
wie fuer Railway, und es gibt kein `--build-arg` mehr, das sich unterscheiden
koennte.

Eine frueher hier stehende Messung (Build mit `http://buildtime-marker.invalid:9999`,
Start mit einem anderen Wert, HTTP 500 mit `ENOTFOUND`) war korrekt — sie galt dem
`rewrites()`-Weg, den es nicht mehr gibt.

Fail-closed bleibt es an zwei Stellen: `apps/web/instrumentation.ts` prueft das Ziel
beim Serverstart, und danach beantwortet Next JEDE Route mit 500 — auch `/`. Der
Prozess haelt dabei den Port; er bedient aber keinen normalen Anwendungsverkehr, und
der Compose-Healthcheck auf `/` schlaegt fehl. `lib/proxy-durchreichen.ts` prueft
zusaetzlich bei jeder Anfrage.

**Zwei nicht wiederholenswerte Sackgassen, beide gemessen:** eine Next-16-`proxy.ts`
(Node-Middleware) funktioniert zwar zur Laufzeit, sendet aber
`x-middleware-rewrite: <interne Adresse>` an den Browser — der Kopf laesst sich nicht
entfernen, ohne die Weiterleitung abzuschalten —, und `@opennextjs/cloudflare` bricht
mit `Node.js middleware is not currently supported` ab, was den Pflichtjob `build-web`
rot machen wuerde. Edge-Middleware scheidet aus, weil dort `process.env` beim Bauen
eingebacken wird.
```

**Step 3: `CLAUDE.md` Zeile 345 (Abschnitt "Web never talks to Supabase")**

Ersetze den Satz ueber `next.config.ts` rewrites durch:

```markdown
The browser calls **relative** paths and `providers.tsx` passes the empty origin;
the Route Handlers under `apps/web/app/api/[[...pfad]]`, `app/health` and `app/ready`
forward them server-side to `EASYTREE_API_PROXY_TARGET`, read fresh on every request
(EYT-126 — `next.config.ts` no longer carries a `rewrites()` block).
```

**Step 4: `CLAUDE.md` Zeilen 163–169 (`pnpm build` Red Herring)**

Der Absatz behauptet, `pnpm build` an der Wurzel scheitere, weil Turbo
`EASYTREE_API_PROXY_TARGET` abstreift. Das ist nach Task 5 ueberholt.
**Miss nach, statt es zu behaupten:**

```bash
pnpm build 2>&1 | tail -20; echo "exit=${PIPESTATUS[0]}"
```

Schreibe das gemessene Ergebnis. Bei `exit=0`: den Absatz durch eine Zeile
ersetzen, die sagt, dass der frueher dokumentierte Bruch mit EYT-126 entfallen
ist und wann das gemessen wurde. Bei `exit != 0`: die tatsaechliche Ursache
zitieren, nicht die alte.

**Step 5: `docs/runbooks/staging-deploy.md`**

- §"Die achte Groesse" (ab Zeile 105) komplett auf Laufzeit umschreiben, mit
  demselben Text wie in CLAUDE.md, plus dem Satz, dass der Wert im Coolify- bzw.
  Railway-Dienst als **Laufzeitvariable** gesetzt wird, nicht als Buildvariable.
- Zeile ~164: das Beispiel `docker build … --build-arg "EASYTREE_API_PROXY_TARGET=…"`
  auf `docker build -f apps/web/Dockerfile --build-arg "GIT_SHA=${SHA}" -t …`
  kuerzen und ein `docker run … -e EASYTREE_API_PROXY_TARGET=http://api:3001`
  daneben stellen.
- Zeile ~200, Fehlersuchtabelle "Leere Woche statt Fehler": die Spalte
  "Bauzeitwert des Web-Images" wird zu "Laufzeitvariable des Web-Dienstes;
  fehlt sie, antwortet auch `/` mit 500 — dann ist es keine leere Woche".
- §~303 "Build-Argument": Ueberschrift und Inhalt auf "Laufzeitvariable" aendern.
- §~320 und ~334: die Verweise auf "beim Bauen des Web-Images" nachziehen.

**Step 6: Gegenprobe — keine Bauzeitbehauptung mehr uebrig**

```bash
grep -n "build-arg EASYTREE_API_PROXY_TARGET\|BAUZEIT" CLAUDE.md docs/runbooks/staging-deploy.md; echo "exit=$?"
```

Erwartet: keine Ausgabe, `exit=1`. Verbleibende Treffer nur dort, wo sie
ausdruecklich die **ueberholte** Fassung beschreiben.

**Step 7: Commit**

```bash
git add CLAUDE.md docs/runbooks/staging-deploy.md
git commit -m "docs(EYT-126): das Proxyziel als Laufzeitgroesse beschreiben"
```

---

## Task 12: Volles Gate, Push, CI

**Step 1: Lokales Gate — mit `--force`, nicht als Turbo-Replay**

```bash
pnpm format
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run test --force 2>&1 | tee /tmp/eyt126-test.log
grep -E "Cached:|Tests|Test Files" /tmp/eyt126-test.log
```

Erwartet: in der `Cached:`-Zeile steht **`0 cached`**. Steht dort etwas anderes,
ist die Zahl daneben kein Nachweis (siehe CLAUDE.md, Turbo-Replay).

`pnpm format` meldet lokal untrackte Dateien, die CI nie sieht — bei Rauschen
mit `pnpm exec prettier --check apps packages docs` eingrenzen.

**Step 2: Bauten einzeln**

```bash
env -u EASYTREE_API_PROXY_TARGET pnpm --filter @easytree/web... build
pnpm --filter @easytree/api... build
pnpm --filter @easytree/web run build:cf && rm -rf apps/web/.open-next apps/web/.wrangler-dry
```

**Step 3: Deliverables greppen**

```bash
git diff --name-only origin/master...HEAD
git diff origin/master...HEAD | grep -nE "offen|TODO|TOOL_GAP|FIXME"; echo "exit=$?"
```

Erwartet: letzter `grep` ohne Treffer, `exit=1`. Ein Treffer ist ein Blocker.

**Step 4: Nur benannte Dateien stagen, dann pruefen**

```bash
git status --porcelain
git diff --cached --name-only
```

Kein verzeichnisweites `git add` — im Baum liegen dreizehn untrackte
Planungsdokumente und `scripts/ops/`, die hier nichts zu suchen haben.

**Step 5: Push und CI abwarten**

```bash
git push
NEUER_HEAD="$(git rev-parse HEAD)"; echo "${NEUER_HEAD}"
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "${NEUER_HEAD}" 3600; echo "exit=$?"
```

`exit=1` kann auch "abgebrochen" heissen — `ci.yml` hat `cancel-in-progress`, ein
nachgeschobener Push verdraengt den Lauf des vorherigen Heads. `exit=0` kann
Timeout heissen. **In beiden Faellen den Endstand direkt gegenlesen:**

```bash
gh run list --commit "${NEUER_HEAD}" --limit 20
gh run view <run-id>
```

**Step 6: Die Gate-Zeilen lesen, nicht den gruenen Haken**

```bash
gh run view <run> --log --job <db-gates-job-id> \
  | grep -oE '\[[a-z-]+\] mode=[a-z]+ executed=[0-9]+ passed=[0-9]+ skipped=[0-9]+' | sort -u
```

Erwartet: `[container-smoke] mode=required executed=… passed=… skipped=0` mit
`passed == executed`, dazu die uebrigen dreizehn Gate-Zeilen unveraendert.

Ein rotes `db-gates` laesst alles NACH dem roten Schritt ungeprueft — der
Container-Smoke laeuft am Ende des Jobs, ein frueher Fehlschlag sagt ueber ihn
also nichts.

**Step 7: Die vier Pflichtnachweise fuer den PR-Text sammeln**

1. **Ein Image, zwei Ziele:** die beiden `ziel=… -> {"stub":"…"}`-Zeilen plus
   `vorher=<digest> nachher=<digest>` aus dem Smoke-Log.
2. **Fehlendes Ziel → fail closed:** `Ziel fehlt: / -> HTTP 500`.
3. **Ungueltiges Ziel → fail closed:** `Ziel ungueltig: / -> HTTP 500`.
4. **`GIT_SHA` fehlt → fail closed:** Ausgabe der Compose-Probe aus Task 7.

Dazu die Gegenmutations-Belege aus Task 1, 4 und 8: jeweils die rote Meldung und
der leere `diff` nach der Ruecknahme.

---

## Definition of Done

- [ ] Ein Web-Image-Digest, zweimal gestartet, erreicht zwei verschiedene APIs —
      im Container-Smoke belegt, nicht nur lokal.
- [ ] Der Digest ist zwischen beiden Laeufen nachweislich unveraendert.
- [ ] Fehlendes Ziel und ungueltiges Ziel: `/` antwortet 500, das Protokoll nennt
      `EASYTREE_API_PROXY_TARGET`.
- [ ] `docker compose config` ohne `GIT_SHA` scheitert; ohne
      `EASYTREE_API_PROXY_TARGET` scheitert es; mit beiden gelingt es.
- [ ] `docker build` ohne `--build-arg GIT_SHA` scheitert fuer BEIDE Images.
- [ ] Weder das ausgelieferte HTML noch ein Client-Chunk noch ein Antwortkopf
      nennt die interne Adresse; kein `x-middleware-rewrite`.
- [ ] `build-web` gruen **ohne** gesetztes `EASYTREE_API_PROXY_TARGET`.
- [ ] `auth-journey` gruen — Auth und HttpOnly-Cookies gehen durch die neue
      Durchreiche.
- [ ] `read-through` gruen.
- [ ] `db-gates` gruen mit `[container-smoke] mode=required … skipped=0`.
- [ ] Alle elf CI-Jobs gruen auf dem neuen Head, per `gh run view` gegengelesen.
- [ ] Drei Gegenmutationen ausgefuehrt, rot gemessen, zurueckgenommen, Ruecknahme
      mit leerem `diff` belegt.
- [ ] `CLAUDE.md` und `docs/runbooks/staging-deploy.md` behaupten nirgends mehr
      Bauzeit.
- [ ] Kein `offen|TODO|TOOL_GAP|FIXME` im Diff gegen `origin/master`.

**Ausdruecklich NICHT Teil des Done:** Merge, Jira auf Done, Staging-Deploy,
Supabase-Projekt. `BLOCKER_ENVIRONMENT_SEPARATION` bleibt offen und wird von
diesem Slice nicht beruehrt.

---

## Risiken

| Risiko | Warum es zaehlt | Gegenmassnahme |
| --- | --- | --- |
| `duplex: "half"` beim Weiterreichen des Anfragekoerpers | Ohne das Feld lehnt undici einen Stream-Koerper ab; ein POST auf `/api/v1/auth/login` faellt dann erst im Browser auf | `auth-journey` faehrt einen echten Login mit Koerper; Task 1 deckt POST im Unittest ab |
| `getSetCookie()` steht nicht in allen Laufzeiten | Zwei zusammengefaltete `set-cookie`-Koepfe zerstoeren die Sitzung lautlos | Node 22 hat es; Task 1 prueft zwei Koepfe einzeln, `auth-journey` prueft es echt |
| Route Handler koennten von einem Cache bedient werden | Ein gecachtes `/health` wuerde das alte Ziel weiterreichen | `export const dynamic = "force-dynamic"` in allen drei Routen, in Task 2 zugesichert |
| `db-gates` bricht vor dem Container-Smoke ab | Der Smoke liegt am Jobende; ein frueher roter Schritt laesst ihn ungeprueft | Gate-Zeilen zaehlen, nicht den Haken; bei Rot zuerst den benannten Schritt lesen |
| Cloudflare-Buendel waechst durch drei neue Routen | `build-web` meldet die gzip-Groesse gegen 3072 KiB | Die Zahl steht in der Jobzusammenfassung; drei duenne Route-Dateien sind unkritisch, aber lies sie |
| `apps/web/app/api/` kollidiert spaeter mit einer echten Web-API-Route | Ein optionaler Catch-all faengt alles unter `/api` | Heute existiert keine; ein spaeterer Bedarf braucht einen spezifischeren Pfad, der Vorrang hat |

---

## Was dieser Slice ausdruecklich NICHT belegt

- **Kein Staging-Deploy.** `BLOCKER_ENVIRONMENT_SEPARATION` steht unveraendert:
  es gibt keine EasyTree-Datengrenze mit einem anderen `project_ref` als
  `inypnrvpawvhgiyagxbd`, und die Supabase-Free-Quota zaehlt pro Nutzer.
- **CI-echt ist nicht Staging-echt.** Ein echter Stack in CI belegt Funktion,
  nicht Bereitstellung.
- **Kein Cloudflare-Abbau.** `build:cf` und `cf:dry-run` bleiben im Pflichtjob;
  dass sie gruen bleiben, ist hier Nebenbedingung, nicht Ziel. EYT-149.
- **Keine Aussage zur Migrationshoheit.** Sie bleibt bei der
  Supabase-GitHub-Integration; `apps/api/test/deploy-authority.test.ts` erzwingt
  das unveraendert.
