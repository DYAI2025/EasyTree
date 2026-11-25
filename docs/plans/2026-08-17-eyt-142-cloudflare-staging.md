# EYT-142 — Cloudflare als primäres Staging-Deploymentziel (Implementation Plan)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **Status: `derived_noncanonical` — NICHT zur Implementierung freigegeben.**
> Rev. 3 (18.08.2026), zweiter Plan-Repair nach Owner-Review. Nichts davon wurde ausgeführt.
>
> **Rev. 3 — drei Korrekturen, sonst nichts:**
> 1. **A4** war falsch aufgebaut (Socket im Modulscope) und wäre am A3-Gate gescheitert, statt die
>    Requestgrenze zu messen. Neu: `null`-Referenz im Modulscope, Socketerzeugung **in Request 1**,
>    Wiederverwendungsversuch in Request 2, plus Kontrollfall. A3 bleibt der Global-Scope-Test.
> 2. **B6** setzte `count(*) from supabase_migrations.schema_migrations` als App-Query voraus. Das
>    hätte `easytree_app` einen zusätzlichen Grant auf eine Control-Plane-Systemtabelle gegeben.
>    Neu: **App-Runtime-Evidenz** und **Control-Plane-Migrationsevidenz** getrennt erhoben, im
>    Bericht korreliert. Kein zusätzlicher Grant.
> 3. **B2** verlangte eine Cloudflare-Preview mit echter BYPASSRLS-Credential. Gestrichen. Der
>    Negativnachweis liegt jetzt in **A5** (gestellter Reader, ohne DB) plus Gegenmutation, ein
>    echter DB-Fall nur in der isolierten NON-PRODUCTION-/CI-Datenbank; Staging beweist
>    ausschließlich **positiv**.
>
> **Dokumenthygiene (Owner-Auflage):** Diese Datei bleibt **untracked** im bestehenden Arbeitsbaum
> und wird **nicht committet**. Die 13 vorbestehenden Dirty Paths sind unverändert. Es wurden und
> werden **keine weiteren unrelated untracked Dateien** angelegt.
>
> **Was Rev. 2 geändert hat:** §3 (Matrix), §5 (Sequenzierung), §6 (Worker-Naht + TLS-Konfigform),
> §7 (Env-Inventar), §8 (Phase A / Phase B), §10 (Free-Tier ohne DB messbar), §13 (D-1 entschieden,
> D-2 ersetzt, neues Risiko R-CROSSREQ), §14, §15, Aufgabenteil.
> **Unverändert:** §1, §2, §4, §9, §11, §12.

**Goal:** Die bestehende Kette `Browser → Next.js Web → Same-Origin-Rewrite → NestJS API → PostgreSQL/RLS + Supabase Auth` auf Cloudflare Workers als primäres Staging-Ziel betreiben, ohne Domain-, Auth-, Tenant-, RLS- oder TLS-Grenze aufzuweichen — und ohne Railway zu entfernen.

**Architecture:** Zwei Cloudflare Workers, die die bestehende Railway-Topologie 1:1 spiegeln: ein Next.js-Worker (via `@opennextjs/cloudflare`) und ein API-Worker, der denselben `AppModule` über `cloudflare:node`/`httpServerHandler` bedient. Der Browser bleibt auf EINER Origin; der bestehende `next.config.ts`-Rewrite leitet `/api/*`, `/health`, `/ready` serverseitig an den API-Worker weiter. Kein neuer Datenspeicher, keine neue Domainlogik, kein Ersatz von NestJS.

**Tech Stack:** pnpm/Turborepo, Next.js 16.2.11 (App Router), NestJS 11 + `@nestjs/platform-express`, `pg` 8.22, Zod-validierte `@easytree/config`, Supabase (GoTrue + PostgreSQL 17.6 + RLS), Cloudflare Workers (`nodejs_compat`), Wrangler, optional Cloudflare Hyperdrive.

---

## 1. START STATE

Alle Werte read-only gemessen am 17.08.2026 in `/Users/benjaminpoersch/EasyTree`.

| Größe | Wert |
|---|---|
| Lokaler Branch | `feat/eyt-109-daily-plan-cost-snapshot` |
| Lokaler HEAD | `f0f7cac8ea25d1cc5843fff9ea18d53909e09b24` |
| `origin/master` (nach `git fetch --prune`) | `0e9c43874f3fddb2d47d404f4bf14972e7f78800` |
| `origin/master` Betreff | `Merge PR #69: EYT-109 daily personnel cost snapshot` (Sun Aug 16 21:59:10 2026 +0200) |
| Offene Pull Requests | `gh pr list --state open --json …` → `[]` (keine) |
| Remote | `https://github.com/DYAI2025/EasyTree.git` |
| Dateien im Baum bei `origin/master` | 514 |

`git status --porcelain=v1` — 13 Einträge, **unverändert gelassen**:

```
 M docs/canvas/sprint-5-daily-cost-export.canvas.md
?? "docs/architecture/EasyTree – Softwaredokumentation.md"
?? docs/plans/2026-08-02-eyt-108-rate-succession.md
?? docs/plans/2026-08-02-eyt-133-env-template-parser-hardening.md
?? docs/plans/2026-08-02-eyt-133-secret-guard-hardening.md
?? docs/plans/2026-08-02-sprint-5-durchstich-abschluss.md
?? docs/plans/2026-08-07-planning-data-api-least-privilege.md
?? docs/plans/2026-08-08-eyt-136-abschluss.md
?? docs/plans/2026-08-08-eyt-136-unabhaengiger-po-review.md
?? docs/plans/2026-08-12-eyt-109-multi-org-kontext.md
?? docs/plans/2026-08-12-eyt-139-snapshot-label-provenance.md
?? docs/plans/2026-08-15-eyt-109-d1-validto-semantik.md
?? scripts/ops/
```

**Bewertung der STOP-Bedingungen:** `origin/master` entspricht exakt der verifizierten Baseline
`0e9c438…`. Der lokale HEAD weicht ab, aber das ist laut ausdrücklichem Override kein Blocker.
Die gesamte Analyse lief über `git show origin/master:<path>` / `git ls-tree` / `git grep origin/master`
— **kein Checkout, kein Reset, kein Stash, kein Commit**. Der bestehende Arbeitsbaum wurde nicht angefasst.
Die einzige erzeugte Datei ist dieses Plandokument (neu, untracked, im bereits etablierten
`docs/plans/`-Muster).

---

## 2. REPOSITORY DEPLOYMENT MAP

| Datei (bei `origin/master`) | Verantwortung | Status |
|---|---|---|
| `package.json` | Turbo-Root: `build/lint/test/typecheck`. `packageManager: pnpm@10.28.0`, `engines.node >=22` | IMPLEMENTED |
| `pnpm-workspace.yaml` | Workspaces `apps/*`, `packages/*` | IMPLEMENTED |
| `turbo.json` | Task-Graph; `build.outputs` kennt `dist/**` und `.next/**` — **kennt `.open-next/**` nicht** | PARTIAL |
| `.nvmrc` | `22` | IMPLEMENTED |
| `tsconfig.base.json` | `module/moduleResolution: NodeNext`, `target ES2022`, `verbatimModuleSyntax` | IMPLEMENTED |
| `apps/api/tsconfig.build.json` | `rootDir: src` → `outDir: dist`, `experimentalDecorators` + `emitDecoratorMetadata` | IMPLEMENTED |
| `apps/api/package.json` | `start: node dist/main.js`, `start:worker: node dist/worker.js`; deps `@nestjs/{common,core,platform-express}`, `pg`, `jose`, `rxjs`, `reflect-metadata` | IMPLEMENTED |
| `apps/api/src/main.ts` | `createApiApp()` (Wiring + `setGlobalPrefix` + `enableShutdownHooks` + **`verifyDatabaseRole`**) und `bootstrapApi()` (= `createApiApp` + `app.listen(config.apiPort)`) | IMPLEMENTED |
| `apps/api/src/worker.ts` | **Node-Hintergrundprozess** (Outbox), `createApplicationContext`, KEIN Port. **Namenskollision mit „Cloudflare Worker" — kritisch** | IMPLEMENTED |
| `apps/api/src/app.module.ts` | Kompositionswurzel: TokenVerifier, SessionLiveness, TenantQueryRunnerProvider, alle Repository-Fabriken je Subjekt | IMPLEMENTED |
| `apps/api/src/health/health.controller.ts` | `GET /health` (200 `{status:"ok"}`), `GET /ready` (200/503 mit `checks[]`); beide vom Global-Prefix ausgenommen | IMPLEMENTED |
| `apps/api/src/health/readiness.ts` | `READINESS_INDICATORS` = `config` + `database` | IMPLEMENTED |
| `apps/api/src/platform/database/pg-connection.ts` | **Die eine** `ClientConfig`-Fabrik. Mit Wurzelzertifikat: `stripUrlQuery(url)` + `ssl:{ca, rejectUnauthorized:true}`. Ohne: URL unverändert | IMPLEMENTED |
| `apps/api/src/platform/database/role-privileges.ts` | EYT-45-Startgate: `select current_user, rolsuper, rolbypassrls, rolinherit`; wirft bei Superuser/BYPASSRLS/INHERIT **und bei Verbindungsfehler** (fail-closed) | IMPLEMENTED |
| `apps/api/src/platform/database/tenant-query-runner.ts` | Eine Transaktion je Lauf: `set_config('request.jwt.claims', …, true)` → `set local role authenticated` → Rumpf → commit. `release(err)` zerstört vergiftete Verbindungen | IMPLEMENTED |
| `apps/api/src/platform/database/tenant-query-runner.provider.ts` | Pool je Prozess als Nest-Provider mit `OnApplicationShutdown` | IMPLEMENTED |
| `apps/api/src/platform/auth/session-cookies.ts` | `eyt_access`/`eyt_refresh`, `HttpOnly; SameSite=Strict`, `Secure` **nur wenn `NODE_ENV === "production"`** | IMPLEMENTED |
| `apps/api/test/architecture/rules.ts` | `api-dependency-allowlist`: alles unter `apps/api/src/` **außer** `apps/api/src/platform/` darf nur aus einer kurzen Allowlist importieren | IMPLEMENTED |
| `apps/api/test/env-template.test.ts` + `architecture/env-template-rules.ts` | Versionierte `.env*`-Vorlagen dürfen nur Platzhalter tragen; fail-closed bei 0 Funden | IMPLEMENTED |
| `packages/config/src/schema.ts` | `z.strictObject` je `NODE_ENV`. **production**: keine Defaults, keine localhost-URLs, `DATABASE_SSL_ROOT_CERT` **Pflicht**. Unbekannte Variablen → Startfehler | IMPLEMENTED |
| `packages/config/src/certificate.ts` | PEM-Normalisierung (roh / `\n`-escaped / base64) | IMPLEMENTED |
| `apps/web/next.config.ts` | `rewrites()` für `/api/:path*`, `/health`, `/ready` → `normalizeProxyTarget(process.env.EASYTREE_API_PROXY_TARGET)` | IMPLEMENTED |
| `apps/web/lib/api-proxy-target.ts` | Strenge Validierung; **kein Default in production** (wirft). Ausdrücklich **nicht** `NEXT_PUBLIC_*` | IMPLEMENTED |
| `apps/web/app/providers.tsx` | `SAME_ORIGIN = ""` — Browser ruft ausschließlich relativ | IMPLEMENTED |
| `apps/web/app/planung/page.tsx` | Async Server Component (liest `searchParams`) → **die Web-App ist nicht rein statisch**, SSR wird gebraucht | IMPLEMENTED |
| `.github/workflows/ci.yml` | 8 Jobs: `format`, `lint`, `typecheck`, `unit-tests`, `build-web`, `web-smoke`, `build-api`, `secret-scan`, `db-gates`, `read-through`, `auth-journey`. **Kein Deploy-Job für Web oder API** | IMPLEMENTED (CI) / MISSING (Deploy) |
| `scripts/smoke-api.sh`, `smoke-api-role-gate.sh`, `smoke-worker.sh` | Prozess-Smokes gegen `dist/main.js` bzw. `dist/worker.js` | IMPLEMENTED |
| `supabase/config.toml` | Nur **lokaler** `project_id = "easytree"`. **Kein `project_ref`, kein Staging-Projekt** | MISSING (Staging) |
| `supabase/migrations/*.sql` | 18 Migrationen, zuletzt `20260809120000_0018_cost_snapshots.sql` | IMPLEMENTED |
| Railway-Konfigurationsdatei | **existiert nicht im Repository.** `git ls-tree -r --name-only origin/master \| grep -iE 'railway\|docker\|nixpacks\|procfile\|fly\.\|vercel\|netlify'` → nur `.gitleaks.toml`, `supabase/config.toml` | MISSING (bewusst) |
| Railway-Betriebswissen | `CLAUDE.md` §„Deployment (Railway) — measured 01.08.2026": Service `EasyTree`, Builder **Railpack**, Start/Build über Servicevariablen `RAILPACK_BUILD_CMD`/`RAILPACK_START_CMD`, `PORT = API_PORT = 3001`, Supabase-Direct-Host **IPv6-only** | IMPLEMENTED (extern) |

**Konsequenz, die den ganzen Plan trägt:** Railway ist **nicht** über Repository-Dateien konfiguriert,
sondern über Dashboard-Variablen gegen den generischen Startpfad `node dist/main.js`. Cloudflare kann
deshalb **additiv** danebengestellt werden, ohne eine einzige Railway-relevante Datei zu berühren.

**Zweite Konsequenz — Migrationseigentum:** Es gibt in `.github/workflows/` **keinen** Job, der
Migrationen anwendet. Das Schema wird nach Merge auf `master` von der externen Supabase↔GitHub-Integration
angewandt (gemessene EYT-109-Sequenz). Cloudflare darf diese Autorität nicht duplizieren — siehe Task A9.

---

## 3. CLOUDFLARE COMPATIBILITY MATRIX

Alle Plattformaussagen aus aktueller Cloudflare-/OpenNext-Primärdokumentation, abgerufen 17.08.2026.

| Bereich | Verdikt | Evidenz |
|---|---|---|
| **Next.js 16 auf Workers** | **PASS** | `@opennextjs/cloudflare` unterstützt „All minor and patch versions of Next.js 16 and the latest minors of Next.js 14 and 15" und deployt nach **Workers** (nicht Pages). Repo hat `next ^16.2.11`. Einschränkung: „Node Middleware introduced in 15.2 are not yet supported" — das Repo nutzt keine Middleware (`git ls-tree` zeigt keine `apps/web/middleware.ts`). |
| **NestJS/Express auf Workers** | **ASSUMPTION** (widerlegbar in A2, ohne Datenbank) | `node:http`/`node:https` sind mit `nodejs_compat` und Kompatibilitätsdatum ab 2025-08-15 verfügbar; `http.createServer`/`http.Server` werden mit `enable_nodejs_http_server_modules` unterstützt (ab Datum 2025-09-01 automatisch). Cloudflare dokumentiert Express explizit mit `import { httpServerHandler } from "cloudflare:node"` und `export default httpServerHandler({ port: 3000 })`. Für NestJS gibt es **keine** eigene Cloudflare-Anleitung → Annahme, kein Nachweis. |
| **Node-APIs allgemein** | **PASS mit Lücken** | Kompatibilitätsmatrix: `crypto` 🟢, `http` 🟢, `https` 🟢, `net` 🟢; `tls` 🟡 **partially supported**, `dns` 🟡. Ab Kompatibilitätsdatum `2026-08-04` ist Node-Kompatibilität ohne Flag aktiv; davor `nodejs_compat` nötig. |
| **`pg` (node-postgres)** | **PASS** | Cloudflare listet node-postgres als „TCP Socket via database driver"; Hyperdrive nennt `pg` „the recommended driver", Mindestversion **8.16.3** — Repo hat `pg ^8.22.0`. |
| **`node:tls` mit eigenem Root-CA (`ssl:{ca, rejectUnauthorized:true}`)** | **BLOCKER-Kandidat / ASSUMPTION** | Die `node:tls`-Doku listet genau vier APIs: `connect`, `TLSSocket`, `checkServerIdentity`, `createSecureContext`. Die `ca`-Option wird **nirgends** dokumentiert; das Beispiel zeigt nur `key`/`cert`. „All other APIs … are not supported and will throw a `Not implemented` error." Cloudflares eigenes Postgres-Tutorial zeigt ausschließlich `ssl: true` — **keine** Zertifikatsprüfung, kein CA. Das ist genau die Grenze, die `pg-connection.ts` bewusst hält. |
| **Supabase Auth (GoTrue)** | **PASS** | `GotruePasswordLogin` nutzt globales `fetch(eingabe, init)`; `supabase-token-verifier.factory.ts` nutzt `jose` (WebCrypto). Beides sind Web-Standard-APIs, auf Workers nativ vorhanden. Kein `node:`-Import auf diesem Pfad. |
| **PostgreSQL-Erreichbarkeit** | **ASSUMPTION** | Workers-TCP-Sockets erlauben ausgehende Verbindungen zu beliebigen Hosts/Ports (außer Cloudflare-IP-Ranges, Port 25, privaten Netzen). **IPv6 wird in der TCP-Socket-Doku nicht erwähnt** — und `CLAUDE.md` misst den Supabase-Direct-Host als **IPv6-only (AAAA, kein A)**. Direkte Verbindung ist damit unbewiesen; Hyperdrive umgeht das. |
| **RLS / Tenant-Kontext** | **PASS (strukturell)** | `tenant-query-runner.ts` setzt `request.jwt.claims` **transaktionslokal** (`set_config(…, true)`) und `set local role authenticated` — genau die Form, die Transaction-Mode-Pooling überlebt; in CI gegen echten Supavisor bewiesen (`[tenant-pooling] mode=required … skipped=0`). Hyperdrive ist ein Transaction-Pooler; das Muster trägt dort ebenso. **Aber:** siehe Hyperdrive-Caching. |
| **`app.is_runtime_channel()` / `session_user = 'easytree_app'`** | **PASS-Kandidat / ASSUMPTION** | Sowohl direkt als auch über Hyperdrive verbindet die Ursprungsverbindung mit dem Benutzer aus dem Connection-String. `set local role authenticated` verändert `current_user`, nicht `session_user`. Muss im Smoke gemessen werden, nicht angenommen. |
| **`verifyDatabaseRole` (EYT-45)** | **ASSUMPTION → braucht äquivalente Grenze** | Auf `origin/master` ruft `createApiApp()` **bereits** `verifyDatabaseRole(...)` und damit `new Client(...)` + `client.connect()` + `client.query(...)` — **echtes DB-I/O**. „Workers do not allow I/O from outside a request context." Das Startgate **kann deshalb nicht** im Modulscope laufen. Es braucht eine gleichwertige, belegte Grenze (Phase-B-Task B2). |
| **I/O-Objekte über Requestgrenzen (`pg.Pool`, Sockets)** | **BLOCKER-Kandidat — der schwerwiegendste Befund von Rev. 2** | Cloudflare: der Fehler „entsteht meist dadurch, dass ein I/O-Objekt im globalen Scope zwischengespeichert und in einem späteren Request benutzt wird". `TenantQueryRunnerProvider` hält **genau ein** `pg.Pool` je Nest-Instanz und benutzt es über alle Requests hinweg (`PgTenantQueryRunner.run()` → `pool.connect()` / `client.release()`). Ein Isolate-weiter Nest-Singleton ist damit auf Workers **strukturell unzulässig**, sobald der zweite Request eine im ersten geöffnete Verbindung wiederverwendet. Stützende Gegenevidenz aus derselben Doku: Hyperdrive „maintains the underlying database connection pool, so creating a new client is fast and **recommended**" — Cloudflare erwartet einen **frischen Client je Request**. |
| **`process.env` aus `vars` + Secrets** | **PASS** | Mit `nodejs_compat` wird `process.env` aus Bindings mit Text-/JSON-Werten (inkl. Secrets) befüllt; die Flag ist bei Kompatibilitätsdatum **ab 2025-04-01** standardmäßig aktiv, und die Befüllung geschieht **lazy beim ersten `process`-Zugriff**. Env-Variablen und Secrets sind ausdrücklich auch im Top-Level-Kontext lesbar (I/O ist es nicht). → `apps/api/src/config/config.module.ts` (`declaredEnvSubset(process.env)`) und `packages/config` **bleiben unverändert**. Eine ganze befürchtete Änderungsklasse entfällt. |
| **Worker-Startzeit** | **PASS** | Startzeitlimit wurde von 400 ms auf **1 Sekunde** angehoben (Changelog 2025-10-10). Reines DI-Wiring (kein I/O) darf dort liegen. |
| **CPU pro Request (Free)** | **RISIKO — siehe §10** | Workers Free: **„10 milliseconds of CPU time per invocation"**. Paid: „Max of 5 minutes … (default: 30 seconds)". |
| **Worker-Bundlegröße (Free)** | **RISIKO — siehe §10** | Free: **3 MB komprimiert** / 64 MB unkomprimiert. Für Next.js auf Workers ist das Überschreiten der 3-MiB-Grenze ein dokumentiert häufiger Fall (u. a. Cloudflare-Discussion „Next.js starter does not (cannot?) deploy on Cloudflare on Free Tier"). |
| **Gleichzeitige offene Verbindungen** | **ASSUMPTION** | Free wie Paid: **6 simultaneous open connections** je Invocation. `pg.Pool` je Isolate + Nachbarverbindungen müssen darunter bleiben. |
| **Subrequests** | **PASS** | Free: **50/request**. Der Web→API-Rewrite braucht 1. |
| **`/health` + `/ready`** | **PASS** | Beide sind reine HTTP-Routen ohne Portbezug; `main.ts` schließt sie vom Global-Prefix aus. `/ready` pingt die DB — dieser Ping ist Request-I/O, also im Worker erlaubt. |
| **Hyperdrive TLS** | **PASS — und damit kein Grund für eine Abschwächung** | Hyperdrive unterstützt für PostgreSQL die `sslmode`-Werte `require`, **`verify-ca`** und **`verify-full`** sowie ein hochgeladenes Root-/Intermediate-CA: `npx wrangler cert upload certificate-authority --ca-cert <PEM> --name <NAME>`, danach `--ca-certificate-id <UUID>`. Bei `verify-full` prüft Hyperdrive zusätzlich die Hostnamen-Identität. Cloudflare nennt als Zweck ausdrücklich, „to avoid man-in-the-middle attacks". **Damit ist die EasyTree-TLS-Grenze auf beiden Transporten haltbar** — sie wandert nur vom In-Prozess-`ssl`-Objekt in die Hyperdrive-Konfiguration. `verify-full` + dieselbe Supabase-CA ist für diesen Plan **Pflicht**, nicht Option. |
| **Hyperdrive Query-Caching** | **BLOCKER, solange nicht deaktiviert** | „Query caching is enabled by default." Gecacht werden „eligible read-only query responses". Unter RLS liefert **derselbe SQL-Text für verschiedene Mandanten verschiedene Zeilen** — ein Response-Cache über dem RLS-Filter ist ein Mandantenleck. **Auflage für diesen Sprint:** jede Hyperdrive-Konfiguration wird mit `--caching-disabled` angelegt; **kein** gecachter Pfad für tenant-, auth-, permissions-, planning- oder cost-relevante Reads. Aufhebung nur gegen explizite Gegenevidenz, die eine nachweislich unbedenkliche Queryklasse abgrenzt — und die gibt es in diesem Sprint nicht. Negativnachweis: Phase-B-Task B5. |
| **Hyperdrive Free-Verfügbarkeit** | **PASS** | Free: 10 Konfigurationen/Account, **~20 Ursprungsverbindungen**, 100 000 Queries/Tag. Paid: 25 / ~100 / unbegrenzt. |
| **Workers Builds (native GitHub-Integration)** | **PASS** | Free: **3 000 Buildminuten/Monat**, 1 gleichzeitiger Build, 20 min Timeout, 2 vCPU, 8 GB RAM, 20 GB Disk, keine Zusatzkosten. Unterstützt Preview-Builds (`wrangler versions upload`). |

---

## 4. OPTIONS

### Option A — Zwei Cloudflare Workers (Next-Worker + API-Worker) **[empfohlen, mit Spike-Gate]**

Spiegelt die bestehende Railway-Topologie exakt: ein Web-Prozess, ein API-Prozess, Same-Origin-Rewrite dazwischen.

- **Nutzen:** Cloudflare wird tatsächlich primäres Ziel für Web *und* API. Keine zweite Datenwahrheit, kein Domainrefactoring, NestJS bleibt. Browser sieht weiterhin genau eine Origin; CORS bleibt zu.
- **Änderungen:** neuer ESM-Worker-Entrypoint für die API (Wiring wiederverwendet), Aufspaltung von `createApiApp` in „verdrahten" (I/O-frei) und „Rollengate", ein Rollengate-Latch, zwei `wrangler.jsonc`, eine `open-next.config.ts`, zwei devDependencies, ein Staging-Smoke-Skript, ein Runbook. Kein Fachcode.
- **Risiko:** NestJS-auf-Workers ist nicht dokumentiert (ASSUMPTION). CPU- und Bundlegrenze auf Free. TLS-CA-Pfad unbewiesen. Zweite öffentlich erreichbare Origin (`*.workers.dev`) für die API.
- **Free-Tier-Fit:** unsicher → §10.
- **Railway-Portabilität:** vollständig. `main.ts`/`bootstrapApi()`/`dist/main.js` bleiben unverändert der Node-Startpfad; der Cloudflare-Pfad ist ein *zusätzlicher* Entrypoint.
- **Rollback:** Cloudflare-Worker-Versionen (vorherige Version wieder aktivieren) + Railway bleibt jederzeit aktivierbar.

### Option B — Next-Worker auf Cloudflare, NestJS-API bleibt auf einem Node-Host **[automatischer Fallback]**

- **Nutzen:** Null API-Änderungen, null NestJS-Kompatibilitätsrisiko, null TLS-Risiko (die API behält direkte `pg`-Verbindung mit `DATABASE_SSL_ROOT_CERT`). Cloudflare wird primäre *Eintritts*fläche (Web + Gateway). Schnellster Weg zu einer echten E2E-Reise.
- **Änderungen:** nur `apps/web/*` (wrangler + open-next) und `EASYTREE_API_PROXY_TARGET` auf die Node-API-Origin.
- **Risiko:** Der API-Host muss erreichbar sein — laut Auftrag muss Railway für diesen Slice *nicht* aktiv sein, also ist das eine Voraussetzung, die der Owner herstellen müsste. Erfüllt „Cloudflare primär" nur für Web/Gateway.
- **Free-Tier-Fit:** besser als A (nur ein Worker, keine 10-ms-Frage für den API-Pfad), aber die Next-Bundlegröße bleibt.
- **Railway-Portabilität:** trivial, weil Railway der API-Pfad *ist*.
- **Rollback:** Worker-Version zurückrollen; Web fällt zurück auf den Railway-Web-Service.

### Option C — Ein einziger Worker (Next + Nest im selben Bundle) **[verworfen]**

- **Verworfen, begründet:** (1) Bundlegröße addiert sich, und die 3-MiB-Free-Grenze ist schon für Next allein der dokumentierte Engpass. (2) Web- und API-Deploy wären gekoppelt — ein Web-Rollback rollte die API mit zurück, was der EYT-142-Rollbackzusage widerspricht. (3) Zwei Frameworks in einem Isolate teilen ein CPU-Budget von 10 ms auf Free. (4) Die Komposition von OpenNexts generiertem Worker-Entry mit einem eigenen Handler ist nicht dokumentiert → dritte unbewiesene Annahme.
- Kein Nutzen, den A nicht auch hat.

### Verworfen ohne Prüfung (laut Auftrag)

- Domainlogik in Workers-native Form umschreiben — schreibt Fachcode aus Deploymentkomfort um.
- NestJS durch Hono/itty-router ersetzen — kein belegter Bedarf; `AppModule` trägt die gesamte Autorisierungs- und Repository-Verdrahtung.
- Cloudflare D1 / zweite Datenbank — ausdrücklich out of scope, wäre eine zweite Datenwahrheit.
- Zusätzliche Microservices — kein Nachweis eines Bedarfs.

---

## 5. RECOMMENDATION

**Option A, sequenziert so, dass Option B der verlustfreie Fallback ist.**

Begründung, in dieser Reihenfolge:

1. **Die Web-Arbeit ist in Deploymentvariante A und B identisch.** A1 und A7 (Next-Worker) liefern in
   beiden Varianten denselben Wert. Erst A2–A4 und A8 sind spezifisch für die API auf Workers.
   Scheitert der API-Spike, ist nichts verworfen —
   man setzt `EASYTREE_API_PROXY_TARGET` auf den Node-Host und ist bei B.
2. **Der teuerste Irrtum wird zuerst gemessen — und zwar ohne jede Datenbank.** Die
   Failure-Mode-Kette („baut grün → erster echter Request trifft die Node-/DB-/TLS-Grenze →
   Fehlschlag erst auf Staging") reißt an vier Gliedern, von denen **drei ohne Datenbank
   falsifizierbar sind**: Bundlegröße, Nest-Boot auf Workers, und — neu und am wichtigsten —
   die Frage, ob ein I/O-Objekt eine Requestgrenze überlebt. Das ist Phase A, und Phase A
   braucht weder eine Staging-DB noch die Produktionsdatenbank.
3. **Der Datenpfad wird in Phase A gar nicht entschieden.** Owner-Entscheidung D-1 (18.08.2026)
   verbietet jede Sonde gegen die Produktionsdatenbank, auch eine rein lesende. Damit ist die
   Frage „direkter `pg` oder Hyperdrive" in Phase A **nicht messbar** und wird ausdrücklich
   **offen gelassen**, statt aus Bequemlichkeit vorentschieden zu werden. Beide Transporte
   sind belegt in der Lage, die Supabase-CA zu prüfen (§3) — es gibt deshalb keinen
   Sicherheitsgrund, sich früh festzulegen, und keinen Anlass, die Grenze abzuschwächen.
4. **Die kleinste reversible Lösung** ist damit: zwei neue Konfigurationsdateien, ein neuer
   Entrypoint, eine Aufspaltung einer bestehenden Funktion ohne Verhaltensänderung für Node,
   ein Latch, ein Smoke. Kein Fachcode, keine Migration, keine Railway-Änderung, **keine
   Schemaänderung in `packages/config`, solange Phase A läuft**.

**CI/CD:** Cloudflare Workers Builds (native), nicht GitHub Actions — Begründung in §9.

---

## 6. EXACT PLANNED FILE CHANGES

> Noch **nicht** ausgeführt. Pfade sind relativ zu `/Users/benjaminpoersch/EasyTree`.

### Neu anzulegen

| Pfad | Zweck |
|---|---|
| `apps/api/cloudflare/entry.mjs` | ESM-Worker-Entrypoint der API. **Hand geschrieben, nicht von `tsc` erzeugt** — Begründung unten. Enthält ausschließlich Verdrahtung. **Form erst nach Spike A4 festzulegen** (siehe „Die Worker-Naht ist noch nicht entschieden"). |
| `apps/api/wrangler.jsonc` | Worker-Definition der API: `name`, `main: cloudflare/entry.mjs`, `compatibility_date` (≥ `2025-09-01` für `enable_nodejs_http_server_modules`, ≥ `2025-04-01` für `process.env`-Befüllung), `compatibility_flags: ["nodejs_compat"]`, `vars` (nicht-geheim), `build.command`. |
| `apps/api/src/platform/runtime/role-gate-latch.ts` | Getestete TS-Logik: einmal-je-Isolate-Rollengate, **fail-closed** bis der Nachweis vorliegt. Speichert ausschließlich einen **einfachen Wert** (`verified` / `failedReason`) — **niemals** ein I/O-Objekt und **niemals ein noch laufendes Promise**, weil beides eine Requestgrenze nicht überleben darf. Liegt unter `platform/`, also außerhalb der `api-dependency-allowlist`-Scope-Grenze. |
| `apps/api/test/platform/role-gate-latch.test.ts` | Vitest-Suite dazu inkl. Rot-Fall (Gate wirft → jeder Aufruf lehnt ab, auch der zehnte) und Nachweis, dass **kein** Promise über Aufrufgrenzen hinweg festgehalten wird. |
| `apps/web/wrangler.jsonc` | Worker-Definition der Web-App (von `@opennextjs/cloudflare` erwartet). |
| `apps/web/open-next.config.ts` | OpenNext-Adapterkonfiguration (minimal, Default-Cache). |
| `scripts/smoke-cloudflare-staging.sh` | HTTP-Smoke gegen die deployte Staging-URL: `/health` = 200, `/ready` = 200 mit `database:true`, `session_user`-Sonde, Negativfall. |
| `docs/runbooks/cloudflare-staging.md` | Deploy, Variablen, Diagnose, Rollback, Datengrenze. |

### Zu ändern

| Pfad | Änderung | Warum minimal |
|---|---|---|
| `apps/api/src/main.ts` | `createApiApp` in zwei exportierte Funktionen aufspalten: `wireApiApp()` (alles außer dem Rollengate — **kein I/O**) und `createApiApp(readRolePrivileges?)` (= `wireApiApp()` + `verifyDatabaseRole`, **Signatur und Verhalten unverändert**). `bootstrapApi` bleibt unberührt. | Der Cloudflare-Entry braucht das Wiring im Modulscope, das Gate aber im Requestscope. Ohne die Aufspaltung müsste der Entry `setGlobalPrefix` & Co. duplizieren — genau die zweite Baustelle, die `createApiApp` laut eigenem Kommentar verhindern soll. |
| `apps/api/package.json` | devDependency `wrangler`; scripts `build:cf` (= `pnpm build`), `cf:dry-run` (`wrangler deploy --dry-run --outdir .wrangler-dry`). **Keine Änderung an `start`/`start:worker`.** | Railway startet weiter über `node dist/main.js`. |
| `apps/web/package.json` | devDependencies `wrangler`, `@opennextjs/cloudflare`; scripts `build:cf` (`opennextjs-cloudflare build`), `cf:dry-run`. **`build`/`start` unverändert.** | Railway-Startpfad `next start` bleibt. |
| `turbo.json` | `build.outputs` um `".open-next/**"` ergänzen. | Sonst cached Turbo den OpenNext-Output nicht und der zweite Build ist still leer. |
| `.gitignore` | `.open-next/`, `.wrangler/`, `.wrangler-dry/` ergänzen. | Sonst landen Buildartefakte im nächsten `git add -A` — das ist im Repo schon einmal passiert (siehe `.gitignore`-Kommentar zu `penpot/`). |
| `.github/workflows/ci.yml` | **Zwei Steps in bestehende Jobs**, kein neuer Job: in `build-api` ein `wrangler deploy --dry-run`, in `build-web` ein `opennextjs-cloudflare build` + Größenausgabe. | `CLAUDE.md`: ein neuer Job wäre ein Status-Check, den das Ruleset nicht kennt, und `setup-/verify-branch-protection.sh` meldeten Drift. |
| `docs/runbooks/database-workflow.md` | Ein Absatz: Cloudflare deployt Web/API, **niemals** das Schema; Migrationseigentum bleibt bei Supabase↔GitHub. | Verhindert die zweite konkurrierende Migration-Authority als geschriebene Regel, nicht als Absicht. |

### Bewusst **nicht** geändert

- `apps/api/src/worker.ts` — der Node-Hintergrundprozess. **Der Cloudflare-Entry heißt ausdrücklich nicht `worker.ts`.**
- `apps/api/src/config/config.module.ts` — `declaredEnvSubset(process.env)` trägt auf Workers unverändert, weil `process.env` aus `vars` und Secrets befüllt wird (§3).
- `packages/config/src/load.ts`, `redact.ts`, `certificate.ts` — unberührt.
- **Ganz `packages/config` und `.env.example` in Phase A** — die Transportfrage wird dort erst in Phase B entschieden (siehe unten), und dann **ohne** Lockerung der production-Auflagen.
- `apps/api/src/platform/database/tenant-query-runner.ts` — die Transaktionsklammer (`set_config('request.jwt.claims', …, true)` → `set local role authenticated` → Rumpf) bleibt **wortgleich**. Nur die Frage, *woher die Verbindung kommt*, steht zur Entscheidung.
- `apps/api/test/architecture/rules.ts` — der Entry liegt unter `apps/api/cloudflare/`, nicht `apps/api/src/`; `api-dependency-allowlist` hat `inScope: (file) => file.startsWith("apps/api/src/") && !file.startsWith("apps/api/src/platform/")` und greift dort nicht. Der Latch liegt unter `src/platform/` und ist damit ebenfalls außerhalb.
- Alles unter `supabase/`.

### Warum `entry.mjs` hand geschrieben ist (und nicht `tsc`-Ausgabe)

Drei gemessene Zwänge, die zusammen nur diese Lösung übrig lassen:

1. **Nest braucht `emitDecoratorMetadata`.** Esbuild (und damit Wranglers Bundler) kann das nicht.
   Der Nest-Code muss also von `tsc` kommen → `apps/api/dist/`.
2. **`apps/api` emittiert CommonJS.** `tsconfig.base.json` setzt `module: NodeNext`, und
   `apps/api/package.json` trägt kein `"type": "module"` → CJS. Eine ESM-Kompilierung von `apps/api`
   ist nicht ohne Weiteres möglich: NodeNext-ESM verlangt explizite `.js`-Endungen in relativen
   Importen, und die Quellen importieren extensionslos (`./app.module`).
3. **Wrangler verlangt einen ESM-Entry mit `export default`.**

→ Ein winziger ESM-Shim, der das kompilierte CJS importiert, ist die einzige Brücke. Er enthält
**keine Logik** (die liegt getestet in `role-gate-latch.ts`) und wird durch den Deploy-Smoke bewiesen,
nicht durch einen Unittest.

### Die Worker-Naht ist noch NICHT entschieden

Rev. 1 dieses Plans zeigte an dieser Stelle eine fertige `entry.mjs` mit `const app = await wireApiApp()`
im Modulscope. **Das war voreilig und in einem Punkt sachlich falsch**, und der Owner-Review hat zu
Recht darauf gezeigt:

1. Auf `origin/master` ruft `createApiApp()` **bereits** `verifyDatabaseRole(...)` — also `new Client`,
   `connect()`, `query()`. Es als „reine Nest-DI" zu behandeln war unzutreffend. Die Aufspaltung in
   `wireApiApp()` bleibt der richtige Weg, aber dass die verbleibende Hälfte **wirklich** I/O-frei ist,
   ist eine **Messung (Spike A3)**, keine Zusage.
2. Schwerwiegender: `TenantQueryRunnerProvider` hält **ein** `pg.Pool` je Nest-Instanz. Läge die
   Nest-Instanz im Modulscope, überlebten die vom Pool gehaltenen Sockets die Requestgrenze — genau
   das Muster, das Workers verbieten. Eine Naht, die das nicht auflöst, „baut grün" und stirbt beim
   **zweiten** Request. Das ist die Failure-Mode-Kette in Reinform.

**Verbindliche Zusicherungen, die jede zulässige Naht erfüllen muss** (das ist die Spezifikation;
die Bauform folgt erst danach):

| # | Zusicherung | Wie sie belegt wird |
|---|---|---|
| N1 | Während der Modulinitialisierung des Workers findet **kein** `connect()` und **keine** Query statt. | Spike A3 + Rot-Fall: absichtliches Modulscope-`connect()` **muss** „Disallowed operation…" auslösen |
| N2 | Keine `pg.Pool`-/`Client`-/Socket-Ressource wird über eine Requestgrenze hinweg wiederverwendet. | Spike A4 (Negativnachweis) + Phase-B-Task B3 |
| N3 | Kein noch **laufendes** Promise wird über Requestgrenzen festgehalten; zwischengespeichert werden nur einfache Werte. | Latch-Unittests (B2) |
| N4 | Das Rollen-/RLS-Gate greift **vor** jeder fachlichen DB-Nutzung und ist fail-closed. Keine Anfrage führt vor bestandener Prüfung eine Fachquery aus. | B2-Unittests + B6-Rot-Fall auf Staging |
| N5 | Die Transaktionsklammer aus `tenant-query-runner.ts` bleibt **wortgleich**: transaktionslokale `request.jwt.claims`, danach `set local role authenticated`. | Diff = leer außerhalb der Verbindungsherkunft |
| N6 | `bootstrapApi()` / `node dist/main.js` verhält sich unverändert. | `scripts/smoke-api.sh` unverändert grün (Railway-Regressionsprobe) |
| N7 | So wenig bestehende Nest-/Domainlogik wie möglich wird verändert. | Reviewkriterium |

**Kandidatennähte — bewusst NICHT vorentschieden.** Die Wahl trifft Spike A4, nicht dieser Plan:

- **K1 — verbindungsfrische Poolattrappe.** `PgTenantQueryRunner` nimmt seinen Pool als
  Konstruktorargument entgegen und wird in `test/tenant-query-runner-lifecycle.test.ts` bereits mit
  einem **strukturellen Fake** (`{ connect(), end() }`) versorgt. Eine Implementierung, deren
  `connect()` je Aufruf einen frischen `Client` öffnet und deren `release()` ihn schließt, erfüllt
  dieselbe Form. **Änderung an `PgTenantQueryRunner`, `TenantQueryRunnerProvider`, den Repositories
  oder der Domain: keine.** Stützende Evidenz: Cloudflare nennt „creating a new client is fast and
  recommended" für Hyperdrive. Kosten: ein Verbindungsaufbau je `run()`, was ohne Hyperdrive einen
  TLS-Handschlag je Request bedeutet — CPU-relevant auf Free (§10).
- **K2 — Nest-Instanz je Request.** Robust gegenüber jeder Form von I/O-Caching, aber die
  DI-Container-Erzeugung landet im 10-ms-Requestbudget statt im 1-s-Startbudget. Vermutlich zu teuer;
  A2 misst es.
- **K3 — Nest-Instanz im Modulscope, Verbindungsherkunft je Request injiziert.** Kombination aus K1
  und dem bestehenden Modulscope-Wiring. Attraktiv, aber nur zulässig, wenn A3 belegt, dass
  `wireApiApp()` tatsächlich I/O-frei ist.

**Was ausdrücklich nicht geplant wird, bevor A3/A4 gemessen sind:** eine neue Abstraktion, ein neuer
Provider-Typ, ein neues Konfigurationsfeld für den Verbindungslebenszyklus. Rev. 1 hätte hier
beinahe eine Abstraktion erfunden, die eine Messung vielleicht überflüssig macht.

---

## 7. SECRET / ENV INVENTORY

Nur Namen und Geltungsbereiche. **Keine Werte, keine Beispiele, die wie Zugangsdaten aussehen.**

| Name | Scope | Zeitpunkt | Geheim? | Wo zu setzen | Schon im Repositoryvertrag? | Cloudflare-spezifisch? |
|---|---|---|---|---|---|---|
| `NODE_ENV` | API (Worker) | Runtime | nein | `wrangler.jsonc` → `vars` | ja (`packages/config` Schema, `.env.example`) | nein |
| `DATABASE_URL` | API (Worker) | Runtime | **ja** | `wrangler secret put` | ja (Schema; als `secret: true` in `ENV_VAR_META`) | nein |
| `DATABASE_SSL_ROOT_CERT` | API (Worker) | Runtime | **ja** (als solches markiert; Grund ist Lesbarkeit, nicht Vertraulichkeit) | `wrangler secret put` (mehrzeiliges PEM; `certificate.ts` akzeptiert roh, `\n`-escaped und base64) | ja (Schema, in production Pflicht) | nein |
| `SUPABASE_URL` | API (Worker) | Runtime | nein | `wrangler.jsonc` → `vars` | ja | nein |
| `SUPABASE_ANON_KEY` | API (Worker) | Runtime | **ja** | `wrangler secret put` | ja | nein |
| `API_PORT` | API (Worker) | Runtime | nein | `wrangler.jsonc` → `vars` | ja | nein — aber **Semantik ändert sich**: im Worker bindet nichts einen echten TCP-Port; der Wert ist nur noch der interne Kanalschlüssel zwischen `app.listen(PORT)` und `httpServerHandler({port})`. Muss im Runbook stehen, sonst liest ihn jemand als „öffentlicher Port". |
| `LOG_LEVEL` | API (Worker) | Runtime | nein | `wrangler.jsonc` → `vars` | ja | nein |
| `EASYTREE_API_PROXY_TARGET` | Web | **Build-time** | nein (aber interne Adresse) | Workers-Builds-Buildvariable des Web-Workers | ja (`apps/web/lib/api-proxy-target.ts`, CI setzt sie in `build-web` und `web-smoke`) | nein. **Ausdrücklich nicht `NEXT_PUBLIC_*`** — sonst landet die Adresse im Browserbundle. |
| `CLOUDFLARE_ACCOUNT_ID` | CI | — | nein | **entfällt** bei Workers Builds | nein | ja |
| `CLOUDFLARE_API_TOKEN` | CI | — | **ja** | **entfällt** bei Workers Builds; nur nötig, falls doch GitHub Actions + Wrangler gewählt wird | nein | ja |

**Ergebnis der geforderten Prüfung:** Mit der empfohlenen CI/CD-Variante (Workers Builds) werden
`CLOUDFLARE_ACCOUNT_ID` und `CLOUDFLARE_API_TOKEN` **nicht** gebraucht. Die Authentifizierung läuft über
die Cloudflare-GitHub-App auf Repositoryebene; es entsteht **kein neues GitHub-Secret**. Das ist die
kleinste Geheimnisoberfläche der beiden Varianten und der Hauptgrund für die Entscheidung in §9.

**Nur in Phase B, und nur falls der Transport Hyperdrive wird (Task B4):**

| Name | Scope | Zeitpunkt | Geheim? | Wo | Neu im Vertrag? | CF-spezifisch? |
|---|---|---|---|---|---|---|
| `HYPERDRIVE` (Binding, **kein** Name im Zod-Schema) | API (Worker) | Runtime | Binding trägt Zugangsdaten | `wrangler.jsonc` → `hyperdrive` | ja — neu, aber **außerhalb** von `@easytree/config` | ja |
| `DATABASE_TLS_MODE` | API (Worker) | Runtime | **nein** | `wrangler.jsonc` → `vars` | ja — neu, erfordert Schemaergänzung | **nein — bewusst providerneutral benannt** |

**`DATABASE_TLS_DELEGATED` aus Rev. 1 ist gestrichen.** Der Name legte einen Bypass nahe, und ein
Bypass ist weder nötig noch zulässig: Hyperdrive kann für PostgreSQL `verify-full` **und** ein
eigenes Root-CA (§3). Es gibt damit keinen Transport, auf dem die Kettenprüfung entfiele — nur zwei
Orte, an denen sie stattfindet.

**Ersatzform, abgeleitet aus den vorhandenen `packages/config`-Konventionen** (geprüft:
`schema.ts`, `load.ts`, `redact.ts`, `certificate.ts`, `config.module.ts`):

- **Geschlossene Menge als exportiertes Tupel + Typ**, wie `NODE_ENVS` und `LOG_LEVELS`:
  `export const DATABASE_TLS_MODES = ["in-process", "delegated-verified"] as const;`
  Beide Namen beschreiben **wo** verifiziert wird, keiner **ob**.
- **Eintrag in `ENV_VAR_META` mit `secret: false`** — `ENV_VAR_META` ist laut Dateikopf die einzige
  Wahrheit für Geheimhaltung, und `config.module.ts` leitet aus ihren Schlüsseln die
  `declaredEnvSubset`-Whitelist ab. Ohne Eintrag ist die Variable schlicht unsichtbar; mit Eintrag
  ist sie automatisch in jedem Preset zu deklarieren.
- **Default `"in-process"` in allen drei Presets.** Das ist heutiges Verhalten. Wer die Variable
  vergisst, bekommt die **strengste** Semantik — fail-closed durch Vorgabe, dieselbe Haltung wie beim
  fehlenden `DATABASE_URL`-Default aus EYT-45.
- **`DATABASE_SSL_ROOT_CERT` bleibt in `production` uneingeschränkt Pflicht — in BEIDEN Modi.**
  Das Schema wird **nicht** gelockert. Im delegierten Modus ist der Wert die Quelle des PEM, das per
  `wrangler cert upload certificate-authority` nach Hyperdrive geht; ein Deployment ohne ihn bleibt
  unmöglich. Damit gabelt sich der Konfigurationsvertrag nicht.
- **`AppConfig` bekommt `databaseTlsMode`** (camelCase, nicht geheim, also **kein** Eintrag in
  `SECRET_CONFIG_KEYS`; `redact.test.ts` koppelt beide Listen und bliebe sonst rot).
- **`pgConnectionConfig` verzweigt genau einmal:** `in-process` → heutiges Verhalten
  (`stripUrlQuery` + `ssl: { ca, rejectUnauthorized: true }`), unverändert.
  `delegated-verified` → `stripUrlQuery` bleibt, **kein** `ssl`-Objekt.
  **In keinem Zweig existiert `rejectUnauthorized: false`, `sslmode=no-verify` oder
  `NODE_TLS_REJECT_UNAUTHORIZED`.** Die bestehende Suite `apps/api/test/pg-connection.test.ts` nennt
  genau diese Gegenmutation und wird rot, wenn jemand sie einführt — sie bleibt unangetastet und
  bekommt einen zweiten Block für den neuen Modus.
- **Eine Umgebungsvariable allein ist kein Nachweis.** `delegated-verified` behauptet nur, dass die
  Plattform prüft. Deshalb ist die Zusicherung **außerhalb** der Anwendung zu messen: der
  Staging-Smoke liest die Hyperdrive-Konfiguration (`wrangler hyperdrive get`) und ist **rot**, wenn
  nicht `sslmode = verify-full` **und** eine gesetzte `ca_certificate_id` **und**
  `caching = disabled` in einer greppbaren Zeile stehen. Behauptung wird Messung — Task B4/B5.

Diese Form ist die kleinste, die (a) keine Zertifikatsprüfung abschaltet, (b) providerneutral bleibt
(Railway läuft im Default weiter, ohne die Variable je zu setzen), (c) fail-closed vorbelegt ist und
(d) die Delegation prüfbar statt behauptet macht.

---

## 8. TEST PLAN — zwei Phasen mit hartem Gate dazwischen

Die Trennlinie ist **nicht** „billig vs. teuer", sondern **„braucht eine Datenbank oder nicht"**.
Das ist die Linie, die Owner-Entscheidung D-1 gezogen hat, und sie ist bindend.

### PHASE A — ZERO-RISK COMPATIBILITY FALSIFICATION

**Voraussetzung: keine.** Läuft ohne Staging-Datenbank, **ohne jede Verbindung zu EasyTree-Supabase**,
ohne externe Datenwrites, ohne Jira/Confluence, ohne Railway. Kein `DATABASE_URL` von EasyTree wird
irgendwo gesetzt — auch nicht read-only, auch nicht in einer Preview.

| # | Test | Kosten | Was er widerlegt | Abbruchkriterium |
|---|---|---|---|---|
| **A1** | Detached Worktree auf `0e9c438`, `pnpm install --frozen-lockfile`, `opennextjs-cloudflare build`, `wrangler deploy --dry-run`, **gzip-Größe ablesen** | ~30 min, keine Repo-Änderung | „Next 16 baut für Workers und passt in 3 MB komprimiert" | > 3 MB → Free für Web widerlegt, §10 → `BLOCKED_PAID_REQUIREMENT` |
| **A2** | **Nest-Boot-Spike**, Wegwerf-Worker: minimales Nest-Modul (`@nestjs/core` + `platform-express` + `reflect-metadata`, `tsc` mit `emitDecoratorMetadata`) + `httpServerHandler`, `GET /health`, **ohne jeden DB-Provider**; erst `wrangler dev`, dann Preview-Deploy zur echten CPU-/Startzeitmessung | ~1,5 h | „Nest bootet auf Workers, und ein Request bleibt unter 10 ms CPU" | Boot scheitert → Option A stirbt, Fallback B. `1102` warm → Free widerlegt |
| **A3** | **Global-Scope-I/O-Nachweis, beide Richtungen.** (a) **Positiv:** ein Modul-Scope-`fetch()` bzw. `connect()` **muss** „Disallowed operation called within global scope" auslösen — sonst misst der Test nichts. (b) **Negativ:** derselbe Spike mit dem **echten** `AppModule`-Providersatz (`new Pool`, `PgDatabasePing`, `createSupabaseTokenVerifier`, `GotruePasswordLogin`) im Modulscope konstruiert **ohne** Fehler | ~1,5 h | „`wireApiApp()` ist wirklich I/O-frei" — **Messung statt Zusage** | (a) kein Fehler → der Test ist vakuös, neu bauen. (b) Fehler → Kandidat K3 stirbt, K1/K2 bleiben |
| **A4** | **Cross-Request-Reuse-Negativnachweis, ohne Datenbank. Misst NUR die Requestgrenze — Global-Scope ist A3.** Modulscope hält nur eine `null`-Referenz. **Request 1** erzeugt den Socket **im Requestkontext**, benutzt ihn erfolgreich und legt ausschließlich die Referenz ab. **Request 2** versucht **denselben** Socket. **Kontrollfall:** jeder Request erzeugt seinen eigenen Socket. Beliebiger öffentlicher TCP-Endpunkt — kein EasyTree-System, keine Datenbank, kein Produktivhost, kein Write | ~1 h | „Ein I/O-Objekt überlebt eine Requestgrenze" — die Kernannahme hinter dem Isolate-weiten `pg.Pool` | Request 1 rot → Aufbau misst die falsche Grenze, reparieren. Request 2 abgelehnt (erwartet) + Kontrollfall grün → **N2 verbindlich**, Naht K1/K2, Entscheidung fällt hier. Request 2 grün → Annahme war falsch, §6 neu bewerten |
| **A5** | Latch-Unittests (`role-gate-latch.test.ts`) lokal, ohne Netz, mit gestelltem `RolePrivilegeReader` — inkl. `superuser=true`- und `bypassrls=true`-Rot-Fällen, Gegenmutation und „kein laufendes Promise über Aufrufgrenzen" | ~1 h | „Der Latch ist fail-closed und bleibt es" (N3, N4) — **ohne jede privilegierte Credential** | rot → nicht weiter |
| **A6** | `pnpm test` + `pnpm typecheck` + `pnpm lint` + `pnpm format` vollständig, lokal | Minuten | „Die `main.ts`-Aufspaltung ändert am Node-Verhalten nichts" (N6) | rot → zurück |
| **A7** | `bash scripts/smoke-api.sh` unverändert gegen den lokalen Supabase-Stack | Minuten | **Railway-Regressionsprobe** | rot → **sofort stoppen** |
| **A8** | `wrangler deploy --dry-run` für **beide** Worker in den bestehenden CI-Jobs `build-api` / `build-web` | Minuten | „Es baut reproduzierbar aus dem CI-Commit" | rot → nicht weiter |
| **A9** | Wächtertest gegen eine zweite Migration-Authority + dessen Rot-Fall | ~1 h | „Kein Cloudflare-Build führt Schema-Writes aus" | rot → nicht weiter |

**Was Phase A ausdrücklich NICHT beweist:** dass die Anwendung gegen eine echte Datenbank läuft.
Ein grüner A2-Preview-Deploy ist **kein** App-Runtime-Nachweis, und ein grüner
Supabase-/PostgREST-Healthcheck war nie einer. Die Kette
`Cloudflare Web → EasyTree API → Domain → DB → RLS/Auth` wird ausschließlich in Phase B belegt.

### GATE A→B (hart)

Phase B beginnt **erst**, wenn **alle** folgenden Punkte erfüllt sind:

1. A1–A9 grün bzw. mit dokumentiertem Ergebnis, das Option A nicht tötet.
2. **Eine eindeutig als NON-PRODUCTION identifizierte EasyTree-Datengrenze existiert und ist
   nachgewiesen** — Projekt-Ref, Migrationsstand und die Aussage „das ist nicht
   `inypnrvpawvhgiyagxbd`" jeweils gemessen, nicht behauptet. **Diese Erhebung ist eine
   Control-Plane-Beobachtung über die autorisierte Supabase-/Deployment-Sicht — nicht die
   Anwendung, nicht `easytree_app`, kein zusätzlicher Grant.**
3. Owner-Freigabe für Phase B liegt vor.

Solange (2) fehlt, ist **jede** Zeile aus Phase B blockiert. Es wird **kein** Cloudflare Worker gegen
die Produktions-Supabase gerichtet — weder für einen Spike, noch für einen Healthcheck, noch
„nur einmal zum Schauen".

### PHASE B — NON-PRODUCTION INTEGRATION *(BLOCKED)*

| # | Test | Was er belegt |
|---|---|---|
| **B1** | Transportspike gegen die **Staging**-DB: (a) direkter `pg` mit `ssl:{ca, rejectUnauthorized:true}`; (b) Hyperdrive mit hochgeladener CA, `sslmode=verify-full`, `--caching-disabled`. Nur `select current_user, session_user, 1` | Entscheidet den Transport. **Prüft `node:tls`-CA-Unterstützung und IPv6-Erreichbarkeit** — die Fragen, die D-1 aus Phase A entfernt hat |
| **B2** | Rollengate **positiv** auf Staging: Gate bestanden, `session_user = easytree_app`, danach normale Bedienung. Der **Negativnachweis** liegt bereits in **A5** (gestellter Reader mit `superuser=true` / `bypassrls=true` → fail-closed) und, falls ein echter DB-Fall nötig ist, in der **isolierten NON-PRODUCTION-/CI-Testdatenbank** — **nie** als Cloudflare-Secret | Das Gate ist nicht vakuös, **ohne** dass je eine privilegierte Credential in Cloudflare liegt |
| **B3** | Verbindungslebenszyklus: `run()` öffnet und schließt je Aufruf; über 50 Requests keine wachsende Verbindungszahl, kein „different request" Fehler (N2) | Die in A4 gewählte Naht trägt real |
| **B4** | Hyperdrive-Konfigurationsnachweis: `wrangler hyperdrive get` zeigt in einer greppbaren Zeile `sslmode = verify-full`, eine gesetzte `ca_certificate_id`, `caching = disabled` | Die TLS-Delegation ist gemessen, nicht behauptet |
| **B5** | **Cache-/Kontext-Negativtest.** Zwei verschiedene Tenant-/User-Kontexte **nacheinander über denselben Deploymentpfad**, dieselbe SQL-Textform: jeder sieht ausschließlich seine Zeilen. Danach **Reihenfolge tauschen** und wiederholen. Zusätzlich: `session_user`, `current_user` und `request.jwt.claims` des zweiten Kontexts tragen **keinen** Rest des ersten | **Kein** Daten-, Session- oder RLS-Zustandsübergang — weder durch Hyperdrive-Caching noch durch Verbindungs- oder Isolate-Wiederverwendung. **Leck → BLOCKER, keine Ausnahme** |
| **B6a** *(App-Runtime)* | Deploy-Smoke **über die App**: `/health` = 200 **über die Web-Origin** (beweist den Rewrite), `/ready` = 200 mit `database:true`, `session_user = easytree_app`, Rollengate bestanden, deployte Revision/Commit-SHA — alles in greppbaren Zeilen. **Keine Abfrage von `supabase_migrations`, keine Systemtabelle, kein neuer Grant für `easytree_app`** | Die App läuft real gegen die DB unter der vorgesehenen Identität |
| **B6b** *(Control-Plane, getrennt)* | Migrationsstand **außerhalb der App** über die dafür autorisierte Supabase-/Deployment-Beobachtung ablesen | Der Schemastand ist belegt — **ohne** App-Runtime-Berechtigung dafür |
| **B6c** *(Korrelation im Bericht)* | App-Revision **X** aus B6a + verifizierter Schemastand **Y** aus B6b nebeneinanderstellen | „Schema- und App-Version passen zusammen" — als Korrelation zweier getrennt erhobener Belege, nicht als eine Query |
| **B7** | **E2E-Reise** (EYT-142 AK): Login → Woche → Assignment → Reload → Publish → Snapshot **erzeugen** → Snapshot **lesen** → Positionen/Summen → Reload → zweiter Browserkontext | Die Kernreise läuft real |
| **B8** | Negativreise: fehlendes Recht, fremder Mandant, fehlender/mehrdeutiger Satz | Fail-closed bleibt fail-closed |
| **B9** | Secret-/Bundle-Negativprüfung: Browserbundle und Logs ohne Service-Role-Key, DB-Passwort, Sessiontoken | EYT-142 AK |
| **B10** | Rollback-Probe: vorherige Worker-Version reaktivieren, B6 erneut | Rollbackzusage ist geprüft |

**Der Snapshot-Write in B7 wird NICHT** durch Mock, Fixture oder PostgREST-Direktinsert ersetzt,
und er läuft **ausschließlich** gegen die NON-PRODUCTION-Datengrenze aus Gate A→B (2).

---

## 9. CI/CD DECISION

**Entscheidung: Cloudflare Workers Builds (native GitHub-Integration).** Nicht GitHub Actions + Wrangler.

| Kriterium | Workers Builds | GitHub Actions + Wrangler |
|---|---|---|
| Geheimnisoberfläche | **0 neue GitHub-Secrets** (Cloudflare-GitHub-App) | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` als Repo-Secrets |
| Commit-/Head-Bezug | Build je Commit, Commit-SHA im Dashboard | Build je Commit |
| Preview/Staging | Preview-Builds über `wrangler versions upload` (dokumentiert) | manuell zu bauen |
| Rollback | Worker-Versionen, vorherige Version reaktivierbar | dito, plus eigener Workflow |
| Pflichtkosten | Free: **3 000 Buildminuten/Monat**, 1 gleichzeitiger Build, 20 min Timeout | GitHub-Actions-Minuten |
| Bestehende CI bleibt kanonisches Qualitätsgate | ja, unberührt | Risiko, dass der Deployjob zum zweiten Gate wird |
| Neue Pflicht-Status-Checks | **keine** | ein neuer Job = neuer Status-Check, den `scripts/verify-branch-protection.sh` als Drift meldet |

**„Keine Deployment-Freigabe bei roter CI" — wie das ohne Actions durchgesetzt wird:**
Workers Builds deployt ausschließlich von `master`. `master` ist durch das bestehende Ruleset
(`scripts/setup-branch-protection.sh` / `verify-branch-protection.sh`) geschützt; ein Merge nach `master`
ist ohne grüne Pflichtchecks nicht möglich. Der `master`-Head ist damit per Konstruktion CI-grün,
bevor Workers Builds ihn überhaupt sieht. Branch-Builds gehen als **Preview-Versionen** (`versions upload`)
und werden **nicht** promotet.

**Der ehrliche Restbedarf:** Workers Builds prüft den GitHub-Check-Status **nicht selbst**. Ein Direct-Push
auf `master` unter Umgehung des Rulesets (Admin-Bypass) würde deployen. Das ist ein Ruleset-Thema,
kein Cloudflare-Thema — und `verify-branch-protection.sh` existiert bereits, um genau das zu messen.
Im Runbook festhalten, nicht durch einen zweiten Deploymentweg „lösen".

**Migration-Authority — explizit geplant, nicht angenommen:**
- Cloudflare deployt **Web und API**, niemals das Datenbankschema.
- `build.command` beider Worker enthält ausschließlich `pnpm --filter … build`. Kein
  `supabase db push`, kein `supabase migration up`, kein `prisma migrate`, kein `psql`.
- Task A9 fügt einen Wächter hinzu, der genau das misst statt es zuzusagen — inklusive Rot-Fall.
- **Schema-/App-Versionsabgleich für Staging — in zwei getrennten Erhebungen, nicht in einer Query.**
  Die App belegt ihre eigene Laufzeit (`/health`, `/ready` mit `database:true`,
  `session_user = easytree_app`, deployte Revision). Den **Migrationsstand** liest die dafür
  autorisierte Supabase-/Deployment-Beobachtung — **außerhalb** der Anwendung. Der Abnahmebericht
  korreliert anschließend App-Revision **X** mit verifiziertem Schemastand **Y**.
  **`easytree_app` bekommt dafür keinen zusätzlichen Grant, und `supabase_migrations` ist kein
  Bestandteil des Anwendungs-Healthchecks.** Begründung: eine Leseberechtigung auf eine
  Control-Plane-Systemtabelle nur für einen Healthcheck vergrößert die Rechte der Laufzeitrolle,
  die dieses Projekt ausdrücklich klein hält (EYT-45, Migration 0003 `NOINHERIT`) — und ein
  Migrationsstand ist ohnehin eine Aussage über die Deploymentkette, nicht über die App.
- Eine providerneutrale Migrationspipeline wäre später sinnvoll — **Follow-up-Risiko, nicht dieser Slice.**

---

## 10. FREE-TIER GATE

**Verdikt: `PASS_WITH_ASSUMPTIONS`** — mit zwei benannten Annahmen, die **A1 und A2 in Phase A
widerlegen können, beide ohne jede Datenbank**, und einer klaren Konsequenz, wenn sie fallen.
Owner-Entscheidung D-1 kostet diesen Gate nichts: Bundlegröße und CPU/Startzeit sind
DB-freie Messungen.

| Grenze | Free (Primärquelle) | Bewertung für EasyTree |
|---|---|---|
| CPU/Invocation | **10 ms** | **Höchstes Risiko, und Rev. 2 hat es verschärft.** Das Nest-DI-Wiring darf ins Startzeitbudget (seit 2025-10-10 **1 Sekunde**), nicht ins Requestbudget — falls Naht K1/K3 trägt (A3/A4). Der warme Requestpfad ist Express-Routing + `jose`-JWT-Verifikation + eine DB-Transaktion; plausibel unter 10 ms, **nicht gemessen** (A2). **Neu:** Da N2 einen Isolate-weiten `pg.Pool` ausschließt, kommt je Request ein Verbindungsaufbau hinzu. **Ohne** Hyperdrive ist das ein voller TLS-Handschlag je Request und sprengt das Budget mit hoher Wahrscheinlichkeit. Das ist ein zweites, unabhängiges Argument für Hyperdrive — dieses Mal aus CPU-Gründen, nicht aus Latenzgründen, und es wird in B1/B3 gemessen. |
| Worker-Größe | **3 MB komprimiert** / 64 MB unkomprimiert | **Zweithöchstes Risiko, und es betrifft den Web-Worker.** Dass Next.js-auf-Workers die 3-MiB-Free-Grenze reißt, ist ein dokumentiert häufiger Fall. Diese App ist klein (17 Client-Komponenten, 5 Routen, keine `@vercel/og`-Nutzung) — **messbar in A1, ohne Datenbank**, nicht schätzbar. |
| Requests | 100 000/Tag | unkritisch für Staging |
| Subrequests | 50/Request | Web→API braucht 1 |
| Gleichzeitige Verbindungen | 6 | `pg.Pool` muss `max` klein halten; im Runbook festhalten |
| Hyperdrive | verfügbar: 10 Konfigurationen, ~20 Ursprungsverbindungen, 100 000 Queries/Tag | ausreichend |
| Workers Builds | 3 000 min/Monat, 1 gleichzeitig, 20 min Timeout | ausreichend |

**Wenn A1 oder A2 fällt:** Das Verdikt wird `BLOCKED_PAID_REQUIREMENT`, und das Mittel ist der
**Workers-Paid-Plan** (CPU/Invocation dann „max of 5 minutes … default 30 seconds", Worker-Größe 10 MB).
Den **Preis nenne ich hier nicht** — er stammt nicht aus einer von mir gelesenen Primärquelle
(→ §13, SOURCE_NEEDED). Die Kostenentscheidung ist ohnehin Owner-Sache, nicht Teil dieses Slices.

---

## 11. RAILWAY PRESERVATION CHECK

**Befund zuerst, ohne Beschönigung:** Es gibt **keine einzige Railway-Konfigurationsdatei im Repository.**
Gemessen: `git ls-tree -r --name-only origin/master | grep -iE 'railway|docker|nixpacks|procfile|fly\.|vercel|netlify|render\.yaml'` liefert nur `.gitleaks.toml` und `supabase/config.toml`.
**Ich erfinde keine.** Railway ist ausschließlich über Dashboard-Servicevariablen konfiguriert
(`RAILPACK_BUILD_CMD`, `RAILPACK_START_CMD`, `PORT`), dokumentiert in `CLAUDE.md` §„Deployment (Railway) — measured 01.08.2026".

Was Railway aus dem Repository heraus tatsächlich braucht — und was der Plan davon anfasst:

| Railway-relevanter Pfad | Angefasst? |
|---|---|
| `apps/api/package.json` → `"start": "node dist/main.js"` | **nein** |
| `apps/api/package.json` → `"start:worker": "node dist/worker.js"` | **nein** |
| `apps/api/src/main.ts` → `bootstrapApi()` + `app.listen(config.apiPort)` + `require.main === module`-Guard | **nein** (nur `createApiApp` wird intern aufgeteilt; Signatur, Reihenfolge und Fehlerverhalten bleiben identisch) |
| `apps/api/src/worker.ts` | **nein** |
| `apps/web/package.json` → `"build": "next build"`, `"start": "next start"` | **nein** |
| `apps/api/tsconfig.build.json` → `dist/` | **nein** |
| `packages/config` Schema und `DATABASE_SSL_ROOT_CERT`-Semantik | **nein** in ganz Phase A. In Phase B nur, falls B1 den Hyperdrive-Transport wählt — und dann **ohne** Lockerung der production-Auflagen (§7) |
| `scripts/smoke-api.sh` / `smoke-worker.sh` / `smoke-api-role-gate.sh` | **nein** |

**Die gewählte Grenze ist ein zusätzlicher Entrypoint, nicht die Änderung des bestehenden** — genau
die Frage, die der Auftrag gestellt hat. `apps/api/cloudflare/entry.mjs` existiert neben
`dist/main.js`, statt es zu ersetzen. Fällt Cloudflare aus, ist Railway ohne Codeänderung startbar.
**A7 (`scripts/smoke-api.sh` unverändert grün) misst das nach jedem Schritt, statt es zuzusagen.**

**Zwei Cloudflare-Änderungen sind NICHT providerneutral** und werden als solche markiert:
1. die `main.ts`-Aufspaltung — verhaltensneutral für Node, aber sie existiert nur wegen Workers;
2. die in A4 gewählte Verbindungsherkunft (R-CROSSREQ) — Railway läuft im heutigen Poolmodus weiter,
   Workers bekommt die verbindungsfrische Variante, und **beide** benutzen dieselbe
   `PgTenantQueryRunner`-Klammer (N5).

Beide bekommen in **A6/A7** ein eigenes Rot/Grün. Kein Railway-Startpfad wird umgestellt.

---

## 12. PROPOSED JIRA WORDING

**Keine Mutation ausgeführt.** Nur Vorschläge; jede Zeile ist ein Ersetzen, kein Neuschreiben.

### EYT-137 (Story, Status „Zu erledigen")

| Ort | Ist | Vorschlag |
|---|---|---|
| Sprintziel | „…existiert erstmals ein real bedienbares EasyTree-Increment auf **Railway-Staging**, mit dem…" | „…existiert erstmals ein real bedienbares EasyTree-Increment auf einer **überprüfbaren Staging-Umgebung — primär Cloudflare Workers, mit Railway als erhaltenem kompatiblem Fallback** —, mit dem…" |
| AK (Kernreise-Pfad) | „Die Kernreise läuft auf **Railway-Staging** über Web → Gateway → API → PostgreSQL/RLS…" | „Die Kernreise läuft auf **der Staging-Umgebung (primär Cloudflare)** über Web → Gateway → API → PostgreSQL/RLS…" |
| Commit-Enabler | „EYT-126 – **Railway-Staging** für Web/API/Supabase-Kernreise" | „EYT-126 – **Staging (primär Cloudflare, Railway als Fallback)** für Web/API/Supabase-Kernreise" |
| Labels | `staging`, … | unverändert; `staging` ist bereits providerneutral |

Alles Übrige in EYT-137 ist bereits providerneutral formuliert und bleibt unangetastet.

### EYT-142 (Sub-Task von EYT-137, Status „Zu erledigen")

| Ort | Ist | Vorschlag |
|---|---|---|
| Summary | „Sprint 6: Reale Admin-Kernreise auf **Railway-Staging** bereitstellen und E2E abnehmen" | „Sprint 6: Reale Admin-Kernreise auf **Cloudflare-Staging** bereitstellen und E2E abnehmen" |
| Nutzer-/Release-Ergebnis | „…auf einer überprüfbaren **Railway-Staging-Umgebung** real bedienbar…" | „…auf einer überprüfbaren **Cloudflare-Staging-Umgebung** real bedienbar…" |
| In Scope, Bullet 1 | „Web und API … auf **Railway-Staging** bereitstellen; …" | „Web und API … auf **Cloudflare-Staging (Workers)** bereitstellen; **Railway bleibt als kompatibler Fallback-Pfad erhalten und wird weder entfernt noch absichtlich inkompatibel gemacht**; …" |
| In Scope, **neu** | — | „**Cloudflare deployt ausschließlich Web und API. Das Datenbankschema bleibt im Eigentum der bestehenden Supabase↔GitHub-Integration; kein Cloudflare-Build führt Schema-Writes aus.**" |
| In Scope, **neu** | — | „**Die Staging-Reise läuft gegen eine eindeutig als NON-PRODUCTION identifizierte Datengrenze.**" |
| AK 1 | „Der geprüfte Sprint-6-Head ist auf **Railway-Staging** eindeutig identifizierbar." | „Der geprüfte Sprint-6-Head ist auf **Cloudflare-Staging** eindeutig identifizierbar (Commit-SHA am deployten Artefakt ablesbar)." |
| AK, **neu** | — | „**Kein Schreibpfad der Abnahme berührt die Produktionsdatenbank; Schema- und App-Version des Stagingstands sind gemeinsam nachweisbar.**" |
| Rollback | „Vorheriger erfolgreicher Staging-Deploy muss wieder aktivierbar sein." | „Vorheriger erfolgreicher Staging-Deploy muss wieder aktivierbar sein (**Cloudflare-Worker-Versionsrollback; Railway bleibt als paralleler Pfad aktivierbar**)." |
| Labels | `railway`, `staging`, … | `railway` → **`cloudflare`**; `staging` bleibt; **`railway-fallback`** ergänzen, damit die Fallbackzusage auffindbar bleibt |

---

## 13. RISKS / MISSING / SOURCE_NEEDED

### BLOCKER_ENVIRONMENT_SEPARATION

**Es existiert keine getrennte Supabase-Stagingumgebung — weder im Repository deklariert noch vorgesehen.**

Gemessen:
- `supabase/config.toml` trägt nur `project_id = "easytree"`. Das ist der **lokale** Projektname der
  Supabase-CLI, **kein** Remote-`project_ref`.
- `git grep -in 'inypnrvpawvhgiyagxbd' origin/master` findet den Produktions-Ref an genau **zwei**
  Stellen, beide reine Dokumentation über *lesende* MCP-Messungen:
  `docs/plans/2026-08-04-eyt-107-p1-publish-channel-boundary.md:117` und
  `docs/reviews/2026-08-07-data-api-grant-inventar.md:22`.
- Kein zweiter Projekt-Ref, keine `staging`-Umgebung, kein Branching-Hinweis irgendwo im Baum.

**Konsequenz, wie beauftragt:**
- Es wird **keine schreibende E2E-Reise gegen Produktion geplant**.
- **Kein** Assignment-, Publish- oder Snapshot-Test gegen Produktion.
- **Keine neue Supabase-Umgebung erzeugt.** Auch nicht vorgeschlagen zu erzeugen — vorgeschlagen wird
  eine *Entscheidung*.

**Kleinste sichere Staging-Lösung (Owner-Entscheidung, drei Optionen, nicht ausgeführt):**
1. **Zweites Supabase-Projekt „easytree-staging"**, gefüttert ausschließlich über `supabase/migrations/*`
   (18 Dateien, identische Reihenfolge) und `supabase/seed.sql` — Letzteres ist laut `CLAUDE.md`
   ausdrücklich synthetische Entwicklungsdaten und wurde nie auf Produktion angewandt. Kleinster
   Eingriff, klarste Grenze, gleicher Migrationspfad. **Empfohlen.**
2. Supabase-Branching (Preview-Branches) — sauber, aber planabhängig; Verfügbarkeit für dieses Konto
   ist hier **nicht gemessen** (SOURCE_NEEDED).
3. Nichts tun → EYT-142 kann **Phase A** vollständig abschließen (Baufähigkeit, Bundlegröße,
   Nest-Naht, Global-I/O- und Cross-Request-Nachweise, Latch, CI-Wächter), aber **die gesamte
   Phase B und damit die EYT-142-Abnahme bleiben offen**. Ehrlicher Teilabschluss, kein „fertig".

### Owner-Entscheidungen

- **D-1 — ENTSCHIEDEN (Owner, 18.08.2026): NEIN.**
  **Kein Cloudflare-Worker-Probe gegen die EasyTree-Produktionsdatenbank. Auch kein read-only
  `select current_user, session_user, 1`.** Jede DB-identitätsbezogene und jede schreibende
  Remote-Abnahme setzt zuerst eine eindeutig als NON-PRODUCTION identifizierte Datengrenze voraus.
  Eine separate EasyTree-Supabase-Staging-Grenze ist derzeit **nicht nachgewiesen**.
  **Kein Cloudflare Worker benutzt Produktions-Supabase als Ersatz für Staging.**
  *Wirkung auf diesen Plan:* Der frühere TLS-/Rollen-Spike ist aus der frühen Phase entfernt und
  liegt jetzt als **B1** hinter dem Gate. Phase A wurde so umgebaut, dass sie **ohne jede Datenbank** trägt —
  §8. Ein separates Supabase-Staging-Projekt ist als **Option vorgesehen** (Punkt 1 oben) und wird
  in diesem Plan **nicht erzeugt**.

- **D-2 — IN DER ALTEN FORM VERWORFEN.**
  Rev. 1 stellte die Frage, ob die Zertifikatsprüfung an Hyperdrive „delegiert" werden dürfe, und
  schleppte dabei den irreführenden Namen `DATABASE_TLS_DELEGATED` mit. Die Frage ist gegenstandslos:
  Hyperdrive unterstützt für PostgreSQL **custom CA certificates**, **`verify-ca`**, **`verify-full`**
  und bei `verify-full` die **Hostnamen-Verifikation** (§3). Es gibt damit **keinen** Transport, auf
  dem die Prüfung entfiele, und folglich **keinen Anlass für eine generische Abschwächung**.

  **Ersetzt durch eine verbindliche Sicherheitssemantik, nicht durch eine Entscheidung:**
  - **Direkter `pg`:** EasyTree prüft die Supabase-CA wie bisher — `stripUrlQuery` +
    `ssl: { ca, rejectUnauthorized: true }`, unverändert.
  - **Hyperdrive:** Hyperdrive bekommt **dieselbe** geeignete Supabase-CA und **muss** die
    Ursprungsverbindung mit **`verify-full`** prüfen.
  - **Ausgeschlossen, ohne Ausnahme:** `rejectUnauthorized: false`, `sslmode=no-verify`,
    `NODE_TLS_REJECT_UNAUTHORIZED`, jede Form von Bypass.
  - Falls die Anwendung die beiden Transporte unterscheiden muss, geschieht das über einen
    **kleinen, providerneutralen, fail-closed vorbelegten Transportmodus**, der **nur beschreibt,
    WO** verifiziert wird — konkrete Form, aus den `packages/config`-Konventionen abgeleitet, in
    **§7**. `DATABASE_SSL_ROOT_CERT` bleibt in `production` in **beiden** Modi Pflicht; das Schema
    wird **nicht** gelockert.
  - Ob der Modus überhaupt gebraucht wird, entscheidet **B1**. Wird der direkte Pfad gewählt, ist
    die Änderung an `packages/config` **null**.

- **D-3 — offen:** Workers Paid, falls A1 oder A2 die Free-Grenzen reißt (§10). Kostenentscheidung
  des Owners, nicht Teil dieses Slices.

### Risiken

| ID | Risiko | Wirkung | Frühester Nachweis |
|---|---|---|---|
| **R-CROSSREQ** | **Ein Isolate-weiter `pg.Pool` (heutiger `TenantQueryRunnerProvider`) hält I/O-Objekte über Requestgrenzen.** Neu in Rev. 2 und der schwerwiegendste Befund: „baut grün", stirbt beim **zweiten** Request | Naht K1/K2 nötig; ohne Nachweis intermittierende Laufzeitfehler statt eines klaren Fehlschlags | **A4 — ohne Datenbank**, danach B3 |
| R-IO-GLOBAL | `wireApiApp()` ist doch nicht I/O-frei (z. B. eager JWKS-Abruf) | Modulscope-Naht K3 stirbt | **A3 — ohne Datenbank** |
| R-CPU | Nest sprengt 1-s-Startzeit oder 10-ms-Requestpfad; verschärft durch den je Request nötigen Verbindungsaufbau (R-CROSSREQ) | Free fällt → D-3 | **A2 — ohne Datenbank** |
| R-BUNDLE | OpenNext-Bundle > 3 MB komprimiert | Free für Web fällt → D-3 | **A1 — ohne Datenbank** |
| R-TLS-CA | `node:tls` unterstützt die `ca`-Option nicht | Direkter `pg` stirbt → Hyperdrive + Transportmodus (§7) | **B1 (blockiert)** |
| R-IPV6 | Supabase-Direct-Host ist IPv6-only, Workers-IPv6 undokumentiert | wie oben | **B1 (blockiert)** |
| R-HD-CACHE | Hyperdrive-Query-Caching (Default **an**) cached RLS-gefilterte Antworten | **Mandantenleck** | **B5**, plus zwingend `--caching-disabled` bei der Anlage und `B4` als Konfigurationsnachweis |
| R-ENV-SEP | Kein NON-PRODUCTION-Ziel vorhanden | Ganze Phase B blockiert | bereits eingetreten |
| R-PUBORIGIN | Zweite öffentliche Origin (`*.workers.dev`) für die API | Für Nicht-Browser-Clients erreichbar. Browser-CORS bleibt zu (API setzt keine CORS-Header), Cookies bleiben `SameSite=Strict` auf der Web-Origin. Mitigation: `workers.dev`-Route der API deaktivieren, sobald eine Custom-Domain existiert; oder Cloudflare Access davor. **Bewusstes Staging-Restrisiko** | B6 |
| R-NAMING | Namensverwechslung `worker.ts` (Node-Outbox) ↔ Cloudflare Worker | Falscher Prozess deployt/gestoppt | Benennung `cloudflare/entry.mjs` + Runbook |
| R-PORT | `API_PORT` liest sich auf Cloudflare wie ein öffentlicher Port | Fehlkonfiguration | Runbook |
| R-TURBO | Turbo cached `.open-next/` nicht | Zweiter Build still leer → „deployt" alten Stand | `turbo.json`-Änderung + Bundle-Hash-Vergleich im Smoke |
| R-REWRITE | Next-`rewrites()` auf ein externes Ziel unter OpenNext | Web→API-Pfad bricht | B6 (`/health` über die **Web**-Origin, nicht die API-Origin) |
| R-BYPASS | Workers Builds deployt bei Admin-Bypass-Push auf `master` trotz roter CI | Ungeprüfter Stand auf Staging | `verify-branch-protection.sh`, Runbook |

### SOURCE_NEEDED (nicht aus Primärquelle gelesen, deshalb hier nicht behauptet)

- Preis des Workers-Paid-Plans.
- Exaktes Rollback-Kommando/Verfahren für Worker-Versionen (`wrangler rollback` vs. Dashboard-„Deployments") — vor dem Runbook zu verifizieren.
- Ob `enable_nodejs_http_server_modules` bei dem gewählten `compatibility_date` implizit aktiv ist oder explizit gesetzt werden muss.
- Verfügbarkeit von Supabase-Branching für dieses Konto.
- Ob `createSupabaseTokenVerifier` / `createSupabaseSessionLiveness` beim Konstruieren bereits Netzwerk-I/O auslösen (entscheidet, ob `wireApiApp()` wirklich I/O-frei ist) — **muss in A3 gemessen werden, nicht angenommen.**
- Ob Hyperdrives Query-Cache Queries **innerhalb einer expliziten Transaktion** grundsätzlich ausnimmt. Für diesen Sprint irrelevant, weil `--caching-disabled` gesetzt wird — aber die Antwort gehört gemessen, bevor jemand später die Aufhebung erwägt.
- Exakte Feldnamen der `wrangler hyperdrive get`-Ausgabe für die B4-Assertion (`sslmode`, `ca_certificate_id`, `caching`) — vor dem Smoke-Skript zu verifizieren.

*Nicht mehr offen (in Rev. 2 aus Primärquelle geklärt):* Befüllung von `process.env` aus `vars`/Secrets
unter `nodejs_compat`; Hyperdrive-Unterstützung für custom CA / `verify-ca` / `verify-full`.

### MISSING im Repository (Ist-Aussage, keine Kritik)

- Kein Web-/API-Deploy-Job in `.github/workflows/`.
- Keine Railway-Konfigurationsdatei.
- Keine Staging-Supabase-Deklaration.
- Kein `.open-next/`/`.wrangler/`-Eintrag in `.gitignore`.
- `turbo.json` kennt `.open-next/**` nicht.

---

## 14. CRAFTSMANSHIP GATE

### Stärkste Gegenposition

> „Cloudflare Workers ist für diesen bestehenden NestJS-/Next-Stack die falsche Plattform; ein
> klassischer Node-Host wäre robuster."

**Fair geprüft. Sie ist teilweise bestätigt und wird nicht weggeredet.** Vier Punkte tragen sie:

1. **Die Anwendung ist als Node-Prozess entworfen, nicht als Isolate.** `main.ts` prüft die
   Datenbankrolle **vor dem ersten Request** und verweigert sonst den Start. Workers kennen keinen
   Prozess, den man nicht starten könnte, und verbieten I/O außerhalb eines Requestkontexts
   („Workers do not allow I/O from outside a request context"). Die Grenze muss deshalb umgebaut
   werden — vom Startgate zum Request-Latch. Das ist ein realer Verlust an Einfachheit, und der
   ursprüngliche Nachweis (`smoke-api-role-gate.sh`: Prozess beendet sich mit ≠0) hat auf Cloudflare
   keine Entsprechung; er muss durch B2 ersetzt werden.
   **Rev. 2 verschärft das:** die Anwendung hält außerdem einen prozessweiten `pg.Pool`, den Workers
   über Requestgrenzen hinweg nicht dulden (R-CROSSREQ). Die Architektur setzt an zwei Stellen einen
   langlebigen Prozess voraus, den es dort nicht gibt.
2. **Die direkte TLS-Grenze ist die schärfste im Repo — und Cloudflare dokumentiert sie für
   `node:tls` nicht.** `pg-connection.ts` existiert ausschließlich, weil ein `sslmode`-Detail einmal
   die Kettenprüfung verlor; die Datei entfernt deshalb die *gesamte* Query. Cloudflares eigenes
   Postgres-Tutorial zeigt `ssl: true` und kein CA; `node:tls` ist „partially supported" und listet
   die `ca`-Option nicht. Auf einem Node-Host ist dieses Problem gelöst und gemessen.
   *Teilentkräftung:* Für den Hyperdrive-Transport ist die Grenze **belegt haltbar** — custom CA plus
   `verify-full` inklusive Hostnamenprüfung. Der Punkt trifft also den direkten Pfad, nicht Cloudflare
   als Plattform.
3. **Das Free-Tier passt strukturell schlecht.** 10 ms CPU/Request und 3 MB Bundle sind Grenzen, die
   ein Node-Host schlicht nicht kennt. Die Railway-Messung vom 01.08.2026 belegt einen laufenden
   API-Service mit 11/11 Sonden über 5m20s, null Restarts, null SSL-Warnungen. Das ist mehr Evidenz
   für Node als es heute für Workers gibt.
4. **Railway läuft bereits.** Der billigste Weg zu einem realen Staging-Increment ist, den
   funktionierenden Pfad zu benutzen.

**Was die Gegenposition NICHT trägt:**

1. **Sie widerlegt Cloudflare nicht technisch.** `node:http`-Server auf Workers sind dokumentiert
   unterstützt, Cloudflare zeigt Express explizit mit `httpServerHandler`, und `createApiApp` ist
   bereits von `listen()` getrennt — die Trennung, die ein Worker-Entry braucht, ist schon da und
   wurde aus einem *anderen* Grund gebaut. Das ist Glück, aber es ist echtes Glück.
2. **Sie ist keine Produktentscheidung.** Der Owner hat Cloudflare als primäres Staging-Ziel gewählt.
   Meine Aufgabe ist, das billigstmöglich zu prüfen — nicht, die Entscheidung neu zu führen.
3. **Der Plan gibt ihr strukturell recht, ohne sie zu befolgen:** Option B *ist* die Gegenposition,
   und sie ist als automatischer Fallback eingebaut. Fällt A1, A2, A3 oder A4, sind wir nach wenigen
   Stunden dort — ohne verbrannte Repo-Änderung.

**Verdikt: nicht bestätigt, nicht widerlegt — sie wird durch A1–A4 entschieden statt durch Meinung.**
Bemerkenswert an Rev. 2: **alle vier entscheidenden Messungen brauchen keine Datenbank.** D-1 kostet
die Falsifikation damit nichts. Das ist der einzige ehrliche Zustand, in dem dieser Plan enden darf.

### Failure-Mode-Kette

> Kompatibilität oberflächlich annehmen → Deployment baut → erster echter Request trifft die
> inkompatible Node-/DB-/TLS-Grenze → `/ready` oder die Nutzerreise scheitert erst auf Staging →
> Sprintzeit geht für einen späten Plattform-Rewrite verloren.

**Rev. 1 ist selbst ein Glied dieser Kette gewesen** und hat damit den Wert der Gegenmaßnahme belegt:
sie behauptete „`wireApiApp()` — dasselbe Wiring wie der Node-Pfad, ohne I/O", obwohl `createApiApp()`
auf `origin/master` bereits `verifyDatabaseRole` ausführt, und übersah den Isolate-weiten `pg.Pool`.
Beides hätte gebaut, gedeployt und beim zweiten Request versagt. Der Owner-Review hat es gefangen,
nicht der Plan — genau der Fehlertyp, gegen den Phase A jetzt gerichtet ist.

Gegenmaßnahme ist die **Reihenfolge**, nicht ein zusätzlicher Test:

- Die Glieder, an denen die Kette reißt, sind **A2 (CPU/Boot), A3 (Global-Scope-I/O), A4
  (Cross-Request-I/O)** — und erst danach, hinter dem Gate, **B1 (TLS/Rolle)**.
- A1–A4 laufen **vor jeder Repo-Änderung**, im Scratchpad, gegen Wegwerf-Worker, **ohne Datenbank**.
- Ein später Plattform-Rewrite kostet Tage; diese Messungen kosten Stunden.
- **„Baut grün" zählt ausdrücklich nicht als Nachweis.** A8 (`--dry-run`) darf grün sein und B6
  (deployter Smoke mit `database:true` und `session_user=easytree_app`) trotzdem rot — deshalb sind
  es zwei Schritte in zwei verschiedenen Phasen.
- **Ein grüner A2-Preview-Deploy zählt ebenfalls nicht als App-Runtime-Nachweis.** Er misst die
  Plattform, nicht EasyTree.

### Overengineering-, Tool- und Automation-Bias — was ich weggelassen habe

| Versuchung | Weggelassen, weil |
|---|---|
| Hyperdrive „weil es empfohlen ist" | Es zieht ein Binding, eine Cache-Falle und einen Transportmodus in `packages/config` nach sich. **Erst B1 messen, dann greifen.** *Ehrlicher Nachtrag zu Rev. 2:* inzwischen sprechen **zwei** unabhängige Argumente dafür (R-CROSSREQ erzwingt Verbindungen je Request; Cloudflare nennt „creating a new client is fast and recommended"), und die TLS-Grenze ist dort **belegt** haltbar. Es bleibt trotzdem eine Messung, keine Vorwegnahme. |
| Eine neue Verbindungs-Abstraktion erfinden, bevor A4 gemessen ist | Rev. 1 hat an dieser Stelle eine fertige Naht gezeigt und dabei zwei Tatsachen übersehen. §6 listet jetzt **Zusicherungen (N1–N7) und Kandidaten (K1–K3)** statt einer Entscheidung. Die kleinste Kandidatennaht K1 kommt ganz ohne neue Abstraktion aus, weil `PgTenantQueryRunner` seinen Pool bereits strukturell entgegennimmt. |
| Einen read-only Prod-Probe „weil er ja nichts verändert" | Genau das hat Rev. 1 als D-1 zur Abstimmung gestellt. Der Owner hat es abgelehnt, und Phase A wurde so umgebaut, dass sie ihn **nicht braucht**. Ein Test, den man weglassen kann, ohne Aussagekraft zu verlieren, war nie nötig. |
| Eigener GitHub-Actions-Deployworkflow | Zwei neue Repo-Secrets und ein neuer Status-Check, den das Ruleset nicht kennt. Workers Builds erreicht dasselbe mit null neuen Secrets. |
| Neuer CI-Job für Cloudflare | `CLAUDE.md`: neuer Job = neuer Pflichtcheck = Drift in beiden Branch-Protection-Skripten. Zwei Steps in bestehenden Jobs genügen. |
| `NEXT_PUBLIC_API_URL` für die API-Adresse | Backte die Adresse ins Browserbundle und zwänge die API, für eine fremde Origin zu öffnen. Der bestehende Same-Origin-Rewrite löst es ohne CORS. |
| NestJS gegen Hono ersetzen | Kein belegter Bedarf. `AppModule` trägt die gesamte Autorisierungsverdrahtung. |
| `wireApiApp()` „gleich richtig" mit Health-Check-Framework, Metriken, strukturiertem Logging | YAGNI. `/health` und `/ready` existieren und genügen der EYT-142-AK. |
| Ein Skript, das die Staging-DB automatisch anlegt | Ausdrücklich verboten und zurecht: die Umgebungstrennung ist eine Entscheidung, keine Automatisierung. |
| Cloudflare-Worker-Datei `worker.ts` nennen | Kollidiert mit dem Node-Outbox-Prozess. Ein Name, zwei Bedeutungen, irgendwann ein falsch gestoppter Prozess. |

### Welche Evidenz die Empfehlung widerlegen würde

Jede einzelne davon kippt Option A. Die ersten fünf brauchen **keine Datenbank**:

1. **A2:** Nest bootet auf Workers nicht (DI, `reflect-metadata`, unerreichbare Node-API im Bootpfad).
2. **A2:** `Error 1102` auf dem warmen Requestpfad auf Free **und** der Owner will keine Paid-Kosten (D-3).
3. **A1:** OpenNext-Bundle > 3 MB komprimiert **und** der Owner will keine Paid-Kosten (D-3).
4. **A3:** `wireApiApp()` ist **nicht** I/O-frei — der Modulscope-Ansatz (K3) ist tot.
5. **A4:** Keine der Kandidatennähte hält N2, ohne Nest-/Domainlogik anzufassen — dann überschreitet
   Cloudflare die Grenze „kein größerer API-Rewrite" und der Plan **muss** stoppen.
6. **A6/A7:** `pnpm test` oder `scripts/smoke-api.sh` wird durch die `main.ts`-Aufspaltung rot →
   Railway-Regression, sofortiger Rückbau.
7. **B1:** `ssl:{ca}` wird nicht unterstützt **und** Hyperdrive scheidet aus einem anderen Grund aus.
8. **A5:** Der Latch lässt bei gemeldetem `isSuperuser` / `bypassesRls` / `inheritsPrivileges` oder
   bei werfendem Reader auch nur **einen** `ok: true` durch — oder die Gegenmutation macht ihn nicht
   rot. Beides ohne Datenbank messbar, beides tödlich für N4.
9. **B5:** Zwei Mandanten sehen einander, oder ein RLS-/Sessionzustand geht über — dann ist der Pfad
   tot, unabhängig von allem anderen, und **kein** Hyperdrive- oder Latenzkomfort rechtfertigt ihn.

### Kleinste reversible Lösung

Wenn nur **eine** Sache gebaut werden dürfte: **Phase-A-Tasks A1 und A10** (Web-Worker mit
`EASYTREE_API_PROXY_TARGET` auf einen bestehenden Node-API-Host).

Das ist ein echter Cloudflare-Staging-Stand, berührt `apps/api` überhaupt nicht, lässt jede
Sicherheitsgrenze exakt dort, wo sie heute gemessen ist, umgeht R-CROSSREQ vollständig, und ist durch
Löschen von zwei Dateien vollständig rückgängig zu machen. Für eine **Nutzerreise** braucht es
zusätzlich einen erreichbaren API-Host und — für alles Schreibende — weiterhin die
NON-PRODUCTION-Datengrenze aus Gate A→B.

---

## 15. FINAL VERDICT

**`PLAN_READY_WITH_ASSUMPTIONS`** — **gilt ausschließlich für Phase A. Phase B ist `BLOCKED`.**

**Phase A: `PLAN_READY_WITH_ASSUMPTIONS`.** Konkret genug für einen begrenzten
Implementierungsauftrag — Datei für Datei, Test für Test. Sie ist **nicht** frei von unbewiesenen
Plattformannahmen, verschweigt sie aber nicht: die vier entscheidenden (Bundlegröße, Nest-Boot/CPU,
Global-Scope-I/O, Cross-Request-I/O) werden **vor** jeder Repo-Änderung falsifiziert, **ohne jede
Datenbank**, und für jedes Scheitern ist der Fallback benannt. Owner-Entscheidung D-1 kostet
Phase A nichts.

**Phase B: `BLOCKED` — `BLOCKER_ENVIRONMENT_SEPARATION`.** Es existiert keine nachgewiesene,
eindeutig als NON-PRODUCTION identifizierte EasyTree-Datengrenze. Damit sind B1–B10 nicht
ausführbar, und die EYT-142-Abnahme (Assignment → Publish → Snapshot → Reload → zweiter
Browserkontext) bleibt offen. Der Snapshot-Write wird **nicht** durch Mock, Fixture oder
PostgREST-Direktinsert ersetzt, und **kein** Cloudflare Worker wird ersatzweise auf
Produktions-Supabase gerichtet.

**Warum nicht insgesamt `BLOCKED`:** Keine der geprüften STOP-Bedingungen ist eingetreten.
`origin/master` entspricht der Baseline; keine offenen PRs; der EYT-142-Contract ist inhaltlich wie
erwartet (nur providerspezifisch formuliert, §12); Cloudflare erfordert nach heutigem Stand **keinen**
größeren API-Rewrite — ein Entrypoint, eine verhaltensneutrale Funktionsaufspaltung und, je nach A4,
eine Verbindungsherkunft, die die bestehende strukturelle Naht von `PgTenantQueryRunner` benutzt;
RLS-, TLS- und `easytree_app`-Grenzen bleiben erhalten oder bekommen eine benannte, prüfbare
Entsprechung (N1–N7); **keine Sicherheitsgrenze wird abgeschwächt**; Secrets waren zur Beurteilung
der Architektur nicht nötig und wurden nicht gelesen; der Scope bleibt EYT-137/140/141/142, EYT-110
draußen.

**Der Vorbehalt, der `PLAN_READY` verhindert:** Sollte A4 zeigen, dass N2 ohne Eingriff in Nest- oder
Domainlogik nicht erfüllbar ist, ist die STOP-Bedingung „Cloudflare erfordert einen größeren
API-Rewrite" doch erreicht. Dann endet dieser Plan an der Grenze, und die kleinste Alternative ist
Option B — nicht ein selbst geplanter Rewrite.

**Sprint-Scope unverändert:** EYT-137 / EYT-140 / EYT-141 / EYT-142; EYT-110 draußen; Cloudflare
primäres Stagingziel; Railway kompatibler Fallback; Supabase bleibt Auth/PostgreSQL/RLS; kein D1;
keine neue Domainlogik; kein Mobile; keine produktiven Echtdaten; **keine zweite Migration-Authority
— die bestehende Supabase↔GitHub-Integration bleibt Eigentümerin des Migrationspfads.**

---

# Implementierungsaufgaben

> Ausführung erst nach Freigabe. **Phase A ist ohne Datenbank ausführbar** (D-1-konform).
> **Phase B ist blockiert**, bis Gate A→B erfüllt ist.
> A1–A4 ändern **nichts** im Repository und berühren **kein** EasyTree-System.

---

# PHASE A — ZERO-RISK COMPATIBILITY FALSIFICATION

> **Harte Auflage für die gesamte Phase A:** kein EasyTree-`DATABASE_URL` wird gesetzt, gelesen oder
> übergeben — nirgends, auch nicht read-only, auch nicht in einer Preview. Kein Worker richtet sich
> gegen Supabase. Keine externen Datenwrites. Keine Jira-/Confluence-Mutation. Keine Railway-Änderung.

## Task A1: Bundlegröße messen (kein Repository-Eingriff)

**Files:** keine. Arbeitsverzeichnis: `/private/tmp/claude-501/.../scratchpad/eyt142-t0`

**Step 1:** Detached Worktree außerhalb des bestehenden Arbeitsbaums anlegen.

```bash
git -C /Users/benjaminpoersch/EasyTree worktree add --detach \
  "$SCRATCH/eyt142-t0" 0e9c43874f3fddb2d47d404f4bf14972e7f78800
```

**Step 2:** Installieren und Web bauen.

```bash
cd "$SCRATCH/eyt142-t0" && corepack enable && pnpm install --frozen-lockfile
EASYTREE_API_PROXY_TARGET=https://example.invalid pnpm --filter @easytree/web... build
```

**Step 3:** OpenNext-Build ohne Repo-Änderung (nur im Worktree).

```bash
cd "$SCRATCH/eyt142-t0/apps/web"
pnpm add -D @opennextjs/cloudflare wrangler
pnpm exec opennextjs-cloudflare build
pnpm exec wrangler deploy --dry-run --outdir .wrangler-dry
```

**Erwartet:** Wrangler gibt „Total Upload: X KiB / gzip: Y KiB" aus.
**Gate:** `Y < 3072 KiB` → Free möglich. Sonst §10 auf `BLOCKED_PAID_REQUIREMENT` setzen und
D-3 (Paid-Plan) beim Owner eröffnen.

**Step 4:** Worktree entfernen.

```bash
git -C /Users/benjaminpoersch/EasyTree worktree remove --force "$SCRATCH/eyt142-t0"
```

---

## Task A2: Nest-Boot- und CPU-Spike (kein Repository-Eingriff, keine Datenbank)

**Files:** nur Scratchpad.

**Step 1:** Minimalen Wegwerf-Worker anlegen: `@nestjs/core` + `@nestjs/common` +
`@nestjs/platform-express` + `reflect-metadata`, **ein** Controller mit `GET /health`, per `tsc`
mit `emitDecoratorMetadata` nach `dist/` gebaut, ESM-Shim + `httpServerHandler({ port })`.
**Ausdrücklich ohne jeden DB-Provider.**

**Step 2:** `wrangler dev`, dann `curl http://127.0.0.1:8787/health`.
**Erwartet:** `{"status":"ok"}`.
**Gate:** Fehler → Option A stirbt, Option B wird Empfehlung, Plan endet hier.

**Step 3:** Denselben Spike auf einen **Free**-Account deployen (Wegwerf-Worker, kein
EasyTree-Systembezug). 20 aufeinanderfolgende Requests; 10 min warten (Isolate-Eviction); erneut 5.

**Step 4:** `wrangler tail` auf `1102` / „exceeded CPU" prüfen; Startzeit gegen das 1-s-Limit ablesen.
**Erwartet:** kein `1102` auf dem warmen Pfad.
**Gate:** `1102` warm → §10 wird `BLOCKED_PAID_REQUIREMENT`, D-3 beim Owner eröffnen.

**Step 5:** Wegwerf-Worker löschen.

---

## Task A3: Global-Scope-I/O — beide Richtungen (keine Datenbank)

**Files:** nur Scratchpad. Baut auf A2 auf.

**Step 1 — der Test muss zuerst beweisen, dass er misst.** Im Modulscope absichtlich echtes I/O
auslösen (ein `fetch()` gegen einen beliebigen öffentlichen Endpunkt, **kein** EasyTree-System).
**Erwartet:** die Modulinitialisierung scheitert mit „Disallowed operation called within global scope"
bzw. dem äquivalenten Laufzeitfehler.
**Gate:** kein Fehler → der Nachweis ist vakuös; Testaufbau reparieren, **nicht** weitergehen.
*(Ohne diesen Schritt wäre Step 2 ein Test, der auch dann grün bliebe, wenn er nichts prüft — genau
das Muster, das `CLAUDE.md` als vakuöses Gate verbietet.)*

**Step 2 — die eigentliche Messung.** Denselben Providersatz wie `AppModule` im **Modulscope**
konstruieren: `new Pool(pgConnectionConfig(...))` mit einer **syntaktisch gültigen, absichtlich nicht
auflösbaren** Verbindungszeichenkette (kein EasyTree-Host, kein echter Server), dazu `PgDatabasePing`,
`createSupabaseTokenVerifier` und `GotruePasswordLogin` mit einer Wegwerf-URL.
**Erwartet:** die Konstruktion läuft ohne Fehler durch — Konstruieren ist kein I/O.
**Gate:** Fehler → Kandidat **K3 stirbt**; `wireApiApp()` kann nicht im Modulscope liegen. K1/K2 bleiben.

**Step 3:** Ergebnis in §13 (`R-IO-GLOBAL`) und §6 (N1) eintragen. **SOURCE_NEEDED-Eintrag zu
`createSupabaseTokenVerifier` / `createSupabaseSessionLiveness` schließen** — mit dem gemessenen
Ergebnis, nicht mit einer Einschätzung.

---

## Task A4: Cross-Request-I/O-Negativnachweis (keine Datenbank) — **der entscheidende Spike**

**Files:** nur Scratchpad.

**Abgrenzung zu A3 — der Grund für den korrigierten Aufbau.** Rev. 2 öffnete den Socket hier noch im
**Modulscope**. Das war falsch: dieser Aufbau scheitert bereits an der Global-Scope-Grenze, die **A3**
prüft, und hätte die Requestgrenze, um die es A4 geht, **nie erreicht**. Ein Test, der aus dem
falschen Grund rot wird, belegt nichts. **A3 misst Global-Scope-I/O. A4 misst ausschließlich
Cross-Request-Reuse.** Beide Nachweise bleiben getrennt.

**Randbedingungen für alle Schritte:** beliebiger öffentlicher TCP-Endpunkt, **kein EasyTree-System,
keine Datenbank, kein Produktivhost, kein Write, kein Payload über den Handshake hinaus.**

**Step 1 — Modulscope bleibt I/O-frei.** Der Modulscope enthält ausschließlich eine Variable, die
zunächst `null` ist:

```
let geteilterSocket = null;   // Referenz, KEIN connect() hier
```

Kein `connect()`, kein `fetch()`, keine Verbindung — sonst prüft A4 wieder A3.

**Step 2 — Request 1 (muss erfolgreich sein).** Innerhalb des Requestkontexts:
1. Socket über `connect()` aus `cloudflare:sockets` **erzeugen**;
2. ihn **in diesem Request erfolgreich benutzen** (Handshake bzw. minimaler Lese-/Schreibzyklus);
3. **ausschließlich die Referenz** in `geteilterSocket` ablegen — als Präparation des Negativtests,
   nicht als Nutzung.

**Erwartet:** Request 1 antwortet grün.
**Gate:** Scheitert bereits Request 1 → der Aufbau misst nicht die Requestgrenze; reparieren, **nicht**
als Bestätigung von N2 werten.

**Step 3 — Request 2 (der eigentliche Negativtest).** Ein **zweiter** Request versucht, **denselben
von Request 1 erzeugten** Socket aus `geteilterSocket` zu benutzen.
**Erwartet:** Cloudflare lehnt die requestübergreifende I/O-Nutzung ab („Cannot perform I/O on behalf
of a different request" o. ä.).
**Gate:** Ablehnung → **N2 ist verbindlich bestätigt**; ein Isolate-weiter `pg.Pool` ist ausgeschlossen.
Keine Ablehnung → die Annahme hinter R-CROSSREQ war falsch; §6 neu bewerten, bevor irgendetwas
gebaut wird.

**Step 4 — Kontrollfall (belegt, dass Step 3 an der Wiederverwendung liegt, nicht am Aufbau).**
Request 1 erzeugt und benutzt seinen **eigenen** Socket; Request 2 erzeugt und benutzt einen
**neuen eigenen** Socket. `geteilterSocket` bleibt unbenutzt.
**Erwartet:** **beide** Requests grün.
**Gate:** Grün → der Unterschied zwischen Step 3 und Step 4 ist ausschließlich die
Wiederverwendung, und Kandidatennaht **K1** (verbindungsfrische Attrappe) ist tragfähig.
Rot → der Spike misst etwas anderes als angenommen; Ursache klären, bevor eine Naht gewählt wird.

**Step 5 — jetzt erst entscheiden.** Naht aus K1 / K2 / K3 wählen und **in §6 eintragen**, mit der
Messung als Begründung. Vorher wird **keine** Abstraktion geschrieben.
*Hinweis für die Bewertung von K1:* `PgTenantQueryRunner` nimmt seinen Pool bereits als
Konstruktorargument entgegen, und `apps/api/test/tenant-query-runner-lifecycle.test.ts` versorgt ihn
mit einem strukturellen Fake `{ connect(), end() }`. Eine verbindungsfrische Attrappe erfüllt dieselbe
Form — **ohne** Änderung an `PgTenantQueryRunner`, `TenantQueryRunnerProvider`, den Repositories oder
der Domain (N5, N7).

**Step 6:** Wegwerf-Worker löschen.

---

## Task A5: `main.ts` aufspalten (TDD, erste Repo-Änderung)

**Files:**
- Modify: `apps/api/src/main.ts`
- Test: `apps/api/test/harness/…` bestehende Suiten müssen unverändert grün bleiben

**Step 1:** Fehlschlagenden Test schreiben, der `wireApiApp` importiert und belegt, dass es
`setGlobalPrefix` setzt **und** die Rollenprüfung **nicht** aufruft.
**Step 2:** `pnpm --filter @easytree/api exec vitest run test/…` → FAIL (`wireApiApp is not exported`).
**Step 3:** In `main.ts` `wireApiApp()` extrahieren; `createApiApp(readRolePrivileges)` ruft
`wireApiApp()` und danach `verifyDatabaseRole` — Signatur, Reihenfolge und `app.close()`-Verhalten
im Fehlerfall unverändert.
**Step 4:** `pnpm --filter @easytree/api test` → PASS, **alle** bestehenden Suiten grün.
**Step 5:** `pnpm typecheck && pnpm lint && pnpm format` → grün.
**Step 6:** Commit `refactor(api): wireApiApp von der Rollenprüfung trennen (EYT-142)`.

---

## Task A6: Rollengate-Latch (TDD, keine Datenbank)

**Files:**
- Create: `apps/api/src/platform/runtime/role-gate-latch.ts`
- Test: `apps/api/test/platform/role-gate-latch.test.ts`

**Step 1:** Fehlschlagende Tests mit gestelltem `RolePrivilegeReader` (kein Netz, **keine
privilegierte Credential — die Rollenattribute werden gemeldet, nicht besessen**):
(a) erster Aufruf verifiziert genau einmal;
(b) nach Erfolg wird **nicht** erneut geprüft;
(c) wirft die Prüfung, liefert **jeder** folgende Aufruf `{ ok: false }` — auch der zehnte;
(d) **N3:** der Latch hält **kein laufendes Promise** über Aufrufgrenzen; zwischengespeichert werden
    ausschließlich einfache Werte (`verified`, `failedReason`). Nachweis: nach einem Aufruf enthält
    der interne Zustand kein `Promise` (bzw. eine gleichwertige Zusicherung im Test);
(e) **N4:** solange nicht verifiziert wurde, wird **keine** Fachquery ausgeführt — der gestellte
    Reader zählt seine Aufrufe, der Fachpfad seine, und der Fachzähler bleibt bei 0;
(f) **Rot-Fälle des Gates, je einzeln:** Reader meldet `isSuperuser: true` → fail-closed;
    Reader meldet `bypassesRls: true` → fail-closed; Reader meldet `inheritsPrivileges: true` →
    fail-closed; Reader **wirft** (unerreichbare DB) → fail-closed.
    **Das ist der vollständige Negativnachweis des Rollengates, und er braucht weder eine
    BYPASSRLS-Rolle noch eine Datenbank noch ein Cloudflare-Secret** — er erbt die Bauart von
    `assertRoleCannotBypassRls`, das rein und synchron ist.

**Step 1b — Gegenmutation, damit die Suite nicht vakuös ist.** Den Latch so mutieren, dass er das
Gate umgeht (z. B. `ok: true` unabhängig vom Reader). **Mindestens die Fälle (c), (e) und (f) MÜSSEN
rot werden.** Bleiben sie grün, misst die Suite nichts; Mutation zurücknehmen und Tests reparieren,
bevor irgendetwas gebaut wird. Ergebnis im Testkommentar festhalten — eine zurückgenommene Mutation
läuft nie wieder.

**Step 2:** Lauf → FAIL.
**Step 3:** Minimale Implementierung. **Ausdrücklich kein memoisiertes Promise** — Rev. 1 hatte das
so vorgeschlagen, und ein *laufendes* Promise aus Request A, in Request B awaited, ist genau das
requestübergreifende I/O-Objekt, das N2/N3 verbieten. Gespeichert wird nur das **Ergebnis**. Zwei
gleichzeitige Requests dürfen die Prüfung notfalls doppelt ausführen; das ist idempotent und
billiger als der Fehler, den die Alternative erzeugt.
**Step 4:** Lauf → PASS.
**Step 5:** Commit `feat(api): fail-closed Rollengate-Latch für Requestlaufzeiten (EYT-142)`.

---

## Task A7: Web-Worker (OpenNext)

**Files:** Create `apps/web/wrangler.jsonc`, `apps/web/open-next.config.ts`; Modify
`apps/web/package.json`, `turbo.json`, `.gitignore`.

**Step 1..3:** Build, `wrangler deploy --dry-run`, Bundlegröße gegen A1 vergleichen (Regression sichtbar).
**Step 4:** `pnpm --filter @easytree/web test` und der bestehende `web-smoke` lokal grün.
**Step 5:** Commit.

---

## Task A8: API-Worker-Naht bauen *(Form gemäß A4-Ergebnis)*

**Files:** Create `apps/api/cloudflare/entry.mjs`, `apps/api/wrangler.jsonc`; Modify
`apps/api/package.json`, `.gitignore`; ggf. Create `apps/api/src/platform/database/<naht>.ts` + Test.

**Step 1:** Die in A4 **gemessen** gewählte Naht umsetzen. Zusicherungen N1–N7 aus §6 sind das
Abnahmekriterium, nicht eine Beschreibung.
**Step 2:** `wrangler.jsonc`: `nodejs_compat`, `compatibility_date` ≥ `2025-09-01`,
`vars` (`NODE_ENV`, `SUPABASE_URL`, `API_PORT`, `LOG_LEVEL`),
`build.command = "pnpm --filter @easytree/api... build"` — **und sonst nichts**.
**Step 3:** `pnpm --filter @easytree/api exec wrangler deploy --dry-run --outdir .wrangler-dry` → Erfolg.
**Step 4:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format` vollständig grün (A-Test A6).
**Step 5:** `bash scripts/smoke-api.sh` gegen den lokalen Supabase-Stack grün — **Railway-Regressionsprobe** (A-Test A7).
**Step 6:** Commit. **Kein Deploy.**

---

## Task A9: Wächter gegen eine zweite Migration-Authority (TDD)

**Files:** Create `apps/api/test/architecture/deploy-authority-rules.ts` +
`apps/api/test/deploy-authority.test.ts`; Modify `docs/runbooks/database-workflow.md`.

**Step 1:** Fehlschlagender Test: liest **beide** `wrangler.jsonc` und schlägt fehl, wenn irgendein
`build.command`/`deploy`-Feld eines von `supabase db push`, `supabase migration`, `prisma migrate`,
`psql`, `drizzle-kit push` enthält. **Fail-closed:** findet er keine `wrangler.jsonc`, ist er rot.
**Step 2:** Lauf → FAIL (Regel existiert nicht).
**Step 3:** Implementieren.
**Step 4:** Lauf → PASS. Rot-Fall: Wegwerf-Fixture mit `supabase db push` **muss** ihn rot machen.
**Step 5:** Läuft im **bestehenden** Job `unit-tests` — kein neuer Pflichtcheck.
**Step 6:** `docs/runbooks/database-workflow.md`: ein Absatz, dass Cloudflare Web/API deployt und
**niemals** das Schema; Eigentümerin des Migrationspfads bleibt die Supabase↔GitHub-Integration.
**Step 7:** Commit.

---

## Task A10: CI-Steps in bestehenden Jobs

**Files:** Modify `.github/workflows/ci.yml`

**Step 1:** In `build-api` nach dem Build: `wrangler deploy --dry-run --outdir .wrangler-dry`.
**Step 2:** In `build-web` nach dem Build: `opennextjs-cloudflare build` + `wrangler deploy --dry-run`,
gzip-Größe nach `$GITHUB_STEP_SUMMARY` (macht R-BUNDLE dauerhaft sichtbar).
**Step 3:** **Kein neuer Job.** `bash scripts/verify-branch-protection.sh` muss drift-frei bleiben.
**Step 4:** Commit.

**Ende Phase A.** Ergebnis: beide Worker sind **baubar und dry-run-fähig**, die Naht ist gemessen
statt geraten, der Latch ist getestet, der Migrations-Wächter greift, und Railway ist nachweislich
unberührt. **Es wurde nichts deployt und keine Datenbank berührt.**

---

# GATE A→B

Phase B beginnt **erst**, wenn alle drei Punkte erfüllt sind:

1. A1–A10 abgeschlossen, mit dokumentierten Ergebnissen, die Option A nicht töten.
2. **Eine eindeutig als NON-PRODUCTION identifizierte EasyTree-Datengrenze existiert und ist
   nachgewiesen.** Nachweis heißt: Projekt-Ref gemessen, Migrationsstand gemessen, und die Aussage
   „diese Ref ist **nicht** `inypnrvpawvhgiyagxbd`" als Ausgabe belegt — nicht behauptet.
   **Erhoben über die autorisierte Supabase-/Deployment-Control-Plane, nicht über die Anwendung:
   `easytree_app` bekommt für diesen Nachweis keine Rechte** (siehe B6, Findings-Korrektur).
3. Owner-Freigabe für Phase B.

**Solange (2) fehlt, ist jede Zeile von Phase B blockiert.** Es wird kein Cloudflare Worker gegen
Produktions-Supabase gerichtet — nicht für einen Spike, nicht für einen Healthcheck, nicht „einmal
zum Schauen". Das ist D-1.

---

# PHASE B — NON-PRODUCTION INTEGRATION *(BLOCKED)*

> Alles Folgende ist geplant, aber **nicht ausführbar**, bis Gate A→B erfüllt ist.

## Task B1: Transportentscheidung gegen die Staging-DB *(BLOCKED)*

**Step 1:** Variante (a) direkter `pg`: `stripUrlQuery(url)` + `ssl:{ ca, rejectUnauthorized: true }`.
**Step 2:** Variante (b) Hyperdrive: CA per `wrangler cert upload certificate-authority` hochladen,
Konfiguration mit `--ca-certificate-id`, `sslmode=verify-full` **und `--caching-disabled`** anlegen.
**Step 3:** In beiden Varianten **genau eine** Query: `select current_user, session_user, 1 as ok`.
Kein `begin`, kein Write.
**Erwartet:** `session_user = easytree_app`, `ok = 1`, kein `self-signed certificate in certificate chain`,
kein `ENETUNREACH`.
**Gate:** (a) erfolgreich → direkter Transport, **null** Änderung an `packages/config`.
(a) scheitert, (b) erfolgreich → Hyperdrive-Transport **und** der Transportmodus aus §7 wird gebaut.
Beide scheitern → Option A stirbt, Fallback Option B.

## Task B2: Rollengate — positiver Staging-Nachweis *(BLOCKED)*

**Korrektur gegenüber Rev. 2:** dort verlangte B2 eine Cloudflare-Preview-Version mit einer echten
BYPASSRLS-Credential. **Gestrichen.** Eine hochprivilegierte Datenbankidentität wird **nicht** als
Cloudflare-Secret gespeichert — nicht in `vars`, nicht als Secret, nicht temporär, nicht „nur für
einen Testlauf". Der Worker bekommt in Staging wie in Produktion **ausschließlich** die vorgesehene
`easytree_app`-Identität. Ein Beweis, für den man die Grenze öffnen muss, die er beweisen soll, ist
kein Beweis.

Der Nachweis zerfällt in vier Teile; **drei kommen ohne jede privilegierte Credential aus**:

1. **Negativfall ohne Datenbank — bereits in A5 erbracht.** `role-gate-latch.test.ts` speist einen
   gestellten `RolePrivilegeReader`, der `isSuperuser: true` bzw. `bypassesRls: true` (und
   `inheritsPrivileges: true`) meldet.
   **Erwartet:** fail-closed — `{ ok: false }`, **keine** Fachquery, auch beim zehnten Aufruf.
   Die Bauart ist im Repo vorhanden: `assertRoleCannotBypassRls` ist rein und synchron und damit
   ohne Datenbank prüfbar.
2. **Echter DB-Integrationsfall, nur falls nötig:** ausschließlich in der isolierten
   **NON-PRODUCTION-/CI-Testdatenbank**. Der bestehende `db-gates`-Job hält dort bereits eine
   `postgres`-Rolle mit BYPASSRLS und fährt mit `scripts/smoke-api-role-gate.sh` genau diesen Fall
   gegen `node dist/main.js`. **Nicht** als Cloudflare-Worker-Secret, **nicht** über einen
   deployten Worker.
3. **Gegenmutation — der Beleg, dass der Test nicht vakuös ist.** Rollengate umgehen bzw. entfernen.
   **Der relevante Test MUSS rot werden.** Bleibt er grün, misst er nichts und der Nachweis gilt als
   nicht erbracht (`CLAUDE.md`: jede Eigenschaftszusicherung braucht eine benannte Gegenmutation).
4. **Staging-Runtime — ausschließlich positiv.** Auf dem deployten Worker belegen:
   `session_user = easytree_app`, Rollengate **erfolgreich abgeschlossen**, und erst danach
   fachliche Bedienung — als greppbare Zeile, nicht als Screenshot oder Behauptung.

## Task B3: Verbindungslebenszyklus *(BLOCKED)*

50 Requests über den deployten Pfad: keine wachsende Verbindungszahl an der DB, kein
„different request"-Fehler, kein Verbindungsleck (N2 real bestätigt statt nur in A4 simuliert).

## Task B4: Transport-Konfigurationsnachweis *(BLOCKED)*

Nur bei Hyperdrive: `wrangler hyperdrive get` gibt in einer greppbaren Zeile `sslmode = verify-full`,
eine gesetzte `ca_certificate_id` und `caching = disabled` aus. Fehlt eines davon → Smoke rot.
Zusätzlich: `packages/config`-Änderung aus §7 mit **Rot-Fall** — ohne gesetzten Modus verlangt
`production` unverändert `DATABASE_SSL_ROOT_CERT`, und in **keinem** Zweig existiert
`rejectUnauthorized: false`. Die bestehende `pg-connection.test.ts` bleibt unangetastet und grün.

## Task B5: Cache-/Kontext-Negativtest *(BLOCKED — Pflicht vor jedem weiteren Schritt)*

Zwei verschiedene Tenant-/User-Kontexte **nacheinander über denselben Deploymentpfad**, dieselbe
SQL-Textform. Jeder sieht ausschließlich seine Zeilen. Danach **Reihenfolge tauschen** und wiederholen.
Zusätzlich belegen: `session_user`, `current_user` und `request.jwt.claims` des zweiten Kontexts
tragen **keinen** Rest des ersten. **Jedes Leck ist ein BLOCKER — ohne Ausnahme, ohne Abwägung.**

## Task B6: Deploy, Smoke, Rollback-Probe *(BLOCKED)*

**Files:** Create `scripts/smoke-cloudflare-staging.sh`, `docs/runbooks/cloudflare-staging.md`

**Korrektur gegenüber Rev. 2:** dort ließ der Smoke die App
`count(*) from supabase_migrations.schema_migrations` abfragen. **Gestrichen.** Das hätte
`easytree_app` eine Leseberechtigung auf eine Supabase-**Control-Plane**-Systemtabelle gegeben, nur
damit ein Healthcheck eine Zahl ausgeben kann — ein zusätzlicher Grant für die Laufzeitrolle, die
dieses Projekt bewusst klein hält (EYT-45, Migration 0003 `NOINHERIT`). **Kein zusätzlicher Grant.
Keine Supabase-Systemtabelle im Anwendungs-Healthcheck.** Der Nachweis wird stattdessen getrennt.

**Step 1:** Workers Builds für beide Worker verbinden (GitHub-App, **keine** neuen Repo-Secrets).
**Step 2:** Secrets per `wrangler secret put` — Namen aus §7, Werte **nie** im Repo.
**Ausschließlich die `easytree_app`-Identität; keine privilegierte Credential (B2).**

**Step 3 — APP-RUNTIME EVIDENCE (`scripts/smoke-cloudflare-staging.sh`, rein über die App):**
- `/health` = 200 **über die Web-Origin** — beweist den Rewrite, nicht nur die API;
- `/ready` = 200 mit `database:true` — reale DB-Verbindung;
- `session_user = easytree_app`;
- Rollengate **bestanden**, und **keine Fachquery vor bestandenem Gate** (N4);
- deployte **Revision/Commit-SHA** der App.
Alles als greppbare Zeilen. **Keine Systemtabelle, keine `supabase_migrations`-Abfrage.**

**Step 4 — DB/DEPLOYMENT-CONTROL-PLANE EVIDENCE (getrennt, außerhalb der App):**
Migrationsstand über die dafür **autorisierte** Supabase-/Deployment-Beobachtung erheben — dieselbe
Autorität, die die Migrationen anwendet (Supabase↔GitHub). **Die App-Runtime hat dafür keine
Berechtigung und bekommt auch keine.**

**Step 5 — KORRELATION im Abnahmebericht:** App-Revision **X** (Step 3) neben verifiziertem
Schemastand **Y** (Step 4). Die Aussage „Schema- und App-Version passen zusammen" ist damit eine
Korrelation zweier getrennt erhobener Belege — nicht das Nebenprodukt einer Query, die es ohne einen
neuen Grant gar nicht geben dürfte.

**Step 6:** Rollback-Probe: vorherige Worker-Version reaktivieren, Step 3 erneut.
**Step 7:** Runbook — inklusive der drei Fallen: `worker.ts` ≠ Cloudflare Worker; `API_PORT` ist kein
öffentlicher Port; `EASYTREE_API_PROXY_TARGET` ist eine **Build**-Variable. Dazu der Absatz, dass
Migrationsevidenz **nie** aus der App kommt.

## Task B7: E2E-Kernreise *(BLOCKED)*

Login → Woche → Assignment → Reload → Publish → Snapshot **erzeugen** → Snapshot **lesen** →
Positionen/Summen prüfen → Reload → zweiter Browserkontext.
**Der Snapshot-Write wird NICHT durch Mock, Fixture oder PostgREST-Direktinsert ersetzt**, und er
läuft ausschließlich gegen die NON-PRODUCTION-Datengrenze aus Gate A→B (2).

## Task B8: Negativreise *(BLOCKED)*

Fehlendes Recht, fremder Mandant, fehlender/mehrdeutiger Satz — fail-closed bleibt fail-closed.

## Task B9: Secret-/Bundle-Negativprüfung *(BLOCKED)*

Browserbundle und Logs ohne Service-Role-Key, ohne DB-Passwort, ohne Sessiontoken.
