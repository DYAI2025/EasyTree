# EYT Sprint 1 — „Boilerplate & Plattformgrundlage" Implementierungsplan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eine lokal reproduzierbare technische Basis für easyTree: Ein frischer Checkout startet Web-Shell (Next.js/PWA), Backend-API, getrennten Worker und lokalen Supabase-Stack — mit bewiesener Tenant-Isolation (RLS) als Abschlussgate.

**Architecture:** TypeScript-Monorepo (pnpm + Turborepo) mit `apps/web` (Next.js PWA), `apps/api` + `apps/worker` (NestJS, ein Codepaket, zwei Entrypoints), `packages/config` (validierte Env-Konfiguration), `packages/ui` (domänenfreie Primitives) und `supabase/` (Migrationen als einzige Schemaquelle, Seed, pgTAP). Shared-Schema-Multitenancy mit Row Level Security; keine Microservices, kein Kubernetes, kein Kafka, kein Event Sourcing (per ADR-Vorgabe aus EYT-13).

**Tech Stack:** pnpm, Turborepo, TypeScript (strict), Next.js, NestJS, Supabase (Postgres, Auth, Storage), Zod, Vitest, pgTAP, ESLint/Prettier.

---

## Evidenzbasis (Jira, live gelesen)

- Quelle: JQL `project = EYT AND sprint in openSprints()` auf `dyai2026.atlassian.net`, 23.07.2026, Europe/Berlin. Vollständig, keine weitere Seite. Sprint: **EYT Sprint 1**, 23.07.–06.08.2026, Board 72.
- Alle 7 Vorgänge: Status „Zu erledigen" (EYT-40/41/42/43/44 laut Backlog-Ansicht; FUF-Verwechslung ausgeschlossen), Parent-Epic **EYT-2**, Due Date 09.08.2026, kein Assignee.

| Ticket                                                 | Titel                                                   | Priorität | Plan-Task |
| ------------------------------------------------------ | ------------------------------------------------------- | --------- | --------- |
| [EYT-13](https://dyai2026.atlassian.net/browse/EYT-13) | Boilerplate-ADR und technische Leitplanken finalisieren | Highest   | Task 1    |
| [EYT-40](https://dyai2026.atlassian.net/browse/EYT-40) | pnpm-/Turborepo-Workspace und Qualitätskonfiguration    | Highest   | Task 2    |
| [EYT-43](https://dyai2026.atlassian.net/browse/EYT-43) | Konfiguration, Secrets und Umgebungsgrenzen             | High      | Task 3    |
| [EYT-42](https://dyai2026.atlassian.net/browse/EYT-42) | NestJS-Backend mit API- und Worker-Entrypoint           | Highest   | Task 4    |
| [EYT-41](https://dyai2026.atlassian.net/browse/EYT-41) | Next.js-Web-/PWA-Shell mit Accessibility-Baseline       | Highest   | Task 5    |
| [EYT-44](https://dyai2026.atlassian.net/browse/EYT-44) | Lokaler Supabase-Stack und SQL-Migrationsworkflow       | Highest   | Task 6    |
| [EYT-15](https://dyai2026.atlassian.net/browse/EYT-15) | Tenant-/Identity-Schema und RLS-Risikospike beweisen    | Highest   | Task 7    |

**Offene Annahmen (vor Task 1 klären):**

- `ASSUMPTION` Es existiert noch kein easyTree-Repository in dieser Session; die Tickets referenzieren `docs/architecture/ADR-001-boilerplate-architecture.md` und `docs/plans/2026-07-23-boilerplate-architecture.md`. Falls ein Repo existiert: zuerst klonen, vorhandene Dateien lesen, diesen Plan dagegen abgleichen.
- `ASSUMPTION` Alle konkreten Versionsnummern sind bei Ausführung gegen npm/Context7 zu prüfen — EYT-13 verlangt ausdrücklich, dass Implementierungsbefehle bis zur Repository-Erzeugung als zu verifizierende Planannahmen markiert bleiben.
- `TOOL_GAP` Kein GitHub-Repo für EYT in project-routing bekannt; Repo-Name/Owner vor Task 1 vom Menschen bestätigen lassen.

## Reihenfolge und Abhängigkeiten

```
Task 1 (EYT-13, ADR)          ── Grundlage für alles
   └─ Task 2 (EYT-40, Workspace)
        ├─ Task 3 (EYT-43, Config-Paket)
        │     └─ Task 4 (EYT-42, NestJS API+Worker)
        │     └─ Task 5 (EYT-41, Next.js Shell)      [parallel zu Task 4 möglich]
        └─ Task 6 (EYT-44, Supabase-Stack)           [parallel zu Task 3–5 möglich]
              └─ Task 7 (EYT-15, RLS-Spike)          ── benötigt Task 4 + 6
                    └─ Task 8 (Sprint-Verifikation & Jira-Pflege)
```

**Stop-Regel (aus EYT-15):** Ist die Tenant-Isolation in Task 7 nicht belegbar, stoppt der Domainausbau — kein Weiterarbeiten an Fachfeatures, stattdessen Befund dokumentieren und Architektur nachschärfen.

---

### Task 1: ADR-001 finalisieren (EYT-13)

**Files:**

- Create: `docs/architecture/ADR-001-boilerplate-architecture.md`

Kein Code, daher kein TDD — Verifikation ist der Akzeptanzkriterien-Abgleich.

**Step 1: Repo-Zustand prüfen**

Run: `ls docs/architecture/ docs/plans/ 2>/dev/null`
Falls ADR-001 bereits existiert: lesen, nur Lücken gegen die Akzeptanzkriterien ergänzen, nicht neu schreiben.

**Step 2: ADR schreiben** — Pflichtsektionen:

```markdown
# ADR-001: Boilerplate-Architektur easyTree

## Status: Accepted (Datum, Entscheider)

## Kontext

## Entscheidung

- Next.js (Web/PWA), NestJS (API + Worker aus einem Codepaket), Supabase
- Shared-Schema-Multitenancy mit RLS, tenantgebundene FKs
- OpenAPI als API-Vertrag, Transactional Outbox + Worker für Async-Arbeit

## Verworfene Optionen (je: Grund + Revisionsbedingung)

- Microservices / Kubernetes / Kafka / Event Sourcing — ausdrücklich KEINE Pflicht
- Schema-per-Tenant, separate DB pro Tenant

## Grenzen

- Modulgrenzen (web/api/worker/packages), Datengrenzen (RLS, Buckets),
  Sicherheitsgrenzen (keine Service Role im Runtime-Pfad), Deploymentgrenzen

## Revisionsbedingungen
```

**Step 3: Traceability-Tabelle einfügen** — Boilerplate-Plan TASK-001…007 ↔ EYT-13/40/41/42/43/44/15 (Mapping siehe Evidenztabelle oben).

**Step 4: Verifikation gegen Akzeptanzkriterien**

Jedes der 6 Kriterien aus EYT-13 explizit abhaken; Implementierungsbefehle im ADR als `PLANANNAHME` markieren.

**Step 5: Commit**

```bash
git add docs/architecture/ADR-001-boilerplate-architecture.md
git commit -m "docs: finalize ADR-001 boilerplate architecture (EYT-13)"
```

---

### Task 2: pnpm-/Turborepo-Workspace (EYT-40)

**Files:**

- Create: `pnpm-workspace.yaml`, `package.json`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`, `eslint.config.mjs`, `.prettierrc.json`, `vitest.workspace.ts`, `README.md`, `.gitignore`

**Step 1: Node/pnpm-Versionen festlegen**

Run: `node --version && pnpm --version` — aktuelle LTS wählen, in `.nvmrc` + README dokumentieren (`PLANANNAHME`: Versionen beim Setup live prüfen).

**Step 2: Workspace-Skelett**

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

```jsonc
// package.json (Root, nur Auszug der Skripte)
{
  "name": "easytree",
  "private": true,
  "packageManager": "pnpm@<VERSION>",
  "scripts": {
    "format": "prettier --check .",
    "format:fix": "prettier --write .",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "build": "turbo run build",
  },
}
```

```jsonc
// turbo.json
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] },
  },
}
```

`tsconfig.base.json` mit `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`.

**Step 3: Platzhalterpaket anlegen, damit die Pipeline testbar ist**

`packages/config` (leer, nur `package.json` + `src/index.ts` + Dummy-Test) — wird in Task 3 gefüllt.

**Step 4: Verifikation (Akzeptanzkriterien EYT-40)**

```bash
rm -rf node_modules && pnpm install --frozen-lockfile   # deterministisch
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @easytree/config test                     # gefiltert
git ls-files | grep -E "package-lock|yarn.lock" ; test $? -eq 1  # keine Parallel-Lockfiles
```

Expected: alle Kommandos exit 0; letzter Check leer.

**Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm/turborepo workspace with quality gates (EYT-40)"
```

---

### Task 3: Config-Paket mit Secret-Schutz (EYT-43)

**Files:**

- Create: `packages/config/src/schema.ts`, `packages/config/src/load.ts`, `packages/config/src/redact.ts`
- Test: `packages/config/test/load.test.ts`, `packages/config/test/redact.test.ts`
- Create: `.env.example` (nur Platzhalterwerte!)

**Step 1: Failing Test — Start bricht bei fehlender/unbekannter/falsch typisierter Variable**

```ts
// packages/config/test/load.test.ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/load";

const valid = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://localhost:54322/postgres",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "anon-placeholder",
  API_PORT: "3001",
};

it("accepts a valid environment", () => {
  expect(loadConfig(valid).apiPort).toBe(3001);
});

it("rejects missing variables", () => {
  const { DATABASE_URL, ...rest } = valid;
  expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
});

it("rejects wrongly typed variables", () => {
  expect(() => loadConfig({ ...valid, API_PORT: "not-a-port" })).toThrow(/API_PORT/);
});

it("rejects unknown variables", () => {
  expect(() => loadConfig({ ...valid, TYPO_VAR: "x" })).toThrow(/TYPO_VAR/);
});
```

**Step 2:** Run `pnpm --filter @easytree/config test` → Expected: FAIL (`loadConfig` fehlt).

**Step 3: Implementierung** — Zod-Schema mit `.strict()`-Objekt (unbekannte Keys ablehnen), getrennte Schemata/Presets für `development` / `test` / `production`, ein gemeinsames technisches Schema für Web/API/Worker.

**Step 4: Failing Test — Secrets erscheinen nie in Fehlermeldungen/Logs**

```ts
// packages/config/test/redact.test.ts
it("redacts secret values in error output", () => {
  const err = captureError(() =>
    loadConfig({ ...valid, SUPABASE_ANON_KEY: "sk-REAL-SECRET", API_PORT: "x" }),
  );
  expect(String(err)).not.toContain("sk-REAL-SECRET");
});
```

**Step 5:** Implementieren (Fehler nennen nur Variablennamen, nie Werte); Tests grün.

**Step 6: `.env.example` prüfen**

Run: `grep -riE "(sk-|eyJ|postgres://.*:.*@)" .env.example ; test $? -eq 1` → Expected: leer (keine echten Zugangsdaten).

**Step 7: Commit** — `feat: add validated config package with secret redaction (EYT-43)`

---

### Task 4: NestJS API + Worker (EYT-42)

**Files:**

- Create: `apps/api/src/main.ts` (API-Entrypoint), `apps/api/src/worker.ts` (Worker-Entrypoint), `apps/api/src/app.module.ts`, `apps/api/src/health/health.controller.ts`, `apps/api/src/common/correlation-id.middleware.ts`, `apps/api/src/common/http-exception.filter.ts`
- Test: `apps/api/test/health.e2e.test.ts`, `apps/api/test/worker.test.ts`

**Step 1: Failing Test — Health & Readiness**

```ts
it("GET /health returns 200 with status ok", async () => {
  const res = await request(app.getHttpServer()).get("/health");
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: "ok" });
});
it("GET /ready reflects dependency readiness", async () => {
  /* 200 | 503 */
});
```

**Step 2:** Run → FAIL. **Step 3:** Minimal implementieren (Health-/Readiness-Controller). **Step 4:** Tests grün.

**Step 5: Failing Test — Worker öffnet keinen HTTP-Port**

```ts
it("worker bootstrap opens no HTTP listener", async () => {
  const ctx = await bootstrapWorker();           // NestFactory.createApplicationContext
  expect((ctx as any).getHttpServer?.).toBeUndefined();
  await ctx.close();
});
```

**Step 6:** Worker-Entrypoint mit `createApplicationContext` implementieren; gemeinsame Module/DI/Config aus `AppModule`-Kern, aber getrennte Bootstraps. Tests grün.

**Step 7: Querschnitt** — Correlation-ID-Middleware (Header `x-correlation-id` erzeugen/durchreichen, im Logger binden), strukturierter Exception-Filter (RFC-7807-artige Fehler ohne Stacktrace/Secrets), Graceful Shutdown (`app.enableShutdownHooks()`, SIGTERM-Test).

**Step 8: Verifikation**

```bash
pnpm --filter @easytree/api build && pnpm --filter @easytree/api test
node apps/api/dist/main.js &   # API startet, /health 200
node apps/api/dist/worker.js & # Worker startet, kein Port belegt (lsof-Check)
```

**Step 9: Commit** — `feat: scaffold NestJS backend with api and worker entrypoints (EYT-42)`

---

### Task 5: Next.js-Web-/PWA-Shell (EYT-41)

**Files:**

- Create: `apps/web/` (App Router), `apps/web/app/manifest.ts` (PWA-Manifest), `packages/ui/` (domänenfreie Primitives), `apps/web/lib/api-client.ts` (injizierter Client)
- Test: `apps/web/test/api-client.test.ts`, `apps/web/test/a11y.test.tsx`

**Step 1: Shell scaffolden** — Responsive Layout, Skip-Link, sichtbare Fokusstile, `lang`-Attribut; kein Supabase-SDK im Web-Paket als operative Schreibquelle.

**Step 2: Failing Test — API-Zugriff nur über injizierten Client**

```ts
it("components receive the api client via provider, never construct it", () => {
  /* Provider-Test */
});
```

Zusätzlich statischer Check: `grep -r "@supabase/supabase-js" apps/web/ ; test $? -eq 1` (kein direkter operativer Supabase-Schreibzugriff aus dem Web).

**Step 3: Accessibility-Baseline verifizieren**

- Automatisiert: axe-Smoke-Test auf der Shell-Seite (0 Violations der WCAG-A/AA-Regeln).
- Manuell dokumentieren (README-Checkliste): Tastaturbedienung, Fokusreihenfolge, 200 %-Zoom ohne Layoutbruch, Statusanzeigen nicht nur über Farbe.

**Step 4: PWA-Manifest** vorhanden; ausdrücklich **keine** Offline-Schreibqueue.

**Step 5: Verifikation** — `pnpm --filter @easytree/web build && pnpm --filter @easytree/web test`, lokaler Start `pnpm --filter @easytree/web dev` erreichbar.

**Step 6: Commit** — `feat: add Next.js PWA shell with a11y baseline and injected api client (EYT-41)`

---

### Task 6: Lokaler Supabase-Stack + Migrationsworkflow (EYT-44)

**Files:**

- Create: `supabase/config.toml`, `supabase/migrations/0001_extensions.sql`, `supabase/seed.sql`, `supabase/tests/0001_smoke.sql` (pgTAP), `docs/runbooks/database-workflow.md`

**Step 1: Supabase CLI initialisieren** (`supabase init`), Konfiguration versionieren.

**Step 2: Erste Migration + privater Bucket**

```sql
-- 0001_extensions.sql: pgtap aktivieren, storage: privaten Bucket anlegen,
-- KEINE public-Policies auf dem Bucket
```

**Step 3: Seed — zwei synthetische Organisationen** (`org_alpha`, `org_beta`) mit je einem synthetischen Benutzer; ausschließlich Fantasiedaten.

**Step 4: pgTAP-Smoke-Test**

```sql
select plan(2);
select has_extension('pgtap');
select ok((select count(*) from public.organizations) >= 2, 'seed orgs present');
select * from finish();
```

**Step 5: Verifikation — Reproduzierbarkeit**

```bash
supabase start && supabase db reset   # zweimal ausführen
supabase test db                      # pgTAP grün
```

Expected: identisches Ergebnis bei beiden Resets; Migrationen sind die einzige Schemaquelle.

**Step 6: Workflow-Dokument** — `database-workflow.md`: Schemaänderungen NUR per Migration im Repo; Remote-Dashboard-Änderungen ausgeschlossen; Reviewpflicht.

**Step 7: Commit** — `feat: add local supabase stack, migrations workflow and pgtap smoke (EYT-44)`

---

### Task 7: Tenant-/Identity-Schema + RLS-Spike (EYT-15) — Sicherheitsgate

**Files:**

- Create: `supabase/migrations/0002_tenancy.sql` (organizations, memberships, tenantgebundene FKs, RLS-Policies, Least-Privilege-Rolle)
- Test: `supabase/tests/0002_rls_isolation.sql` (pgTAP), `apps/api/test/tenant-isolation.integration.test.ts`
- Create: `docs/architecture/tenant-isolation-report.md`

**Step 1: Schema-Migration schreiben** — `organizations`, `users`↔`auth.users`-Mapping, `memberships (org_id, user_id, role, active)`, zusammengesetzte FKs `(id, org_id)` gegen Cross-Tenant-Referenzen, `runtime`-Rolle ohne `BYPASSRLS`/Service Role.

**Step 2: Failing pgTAP-Negativtests zuerst**

```sql
-- als Mitglied von org_alpha (JWT-Claims via request.jwt.claims gesetzt):
select is_empty($$select * from items where org_id = :org_beta$$, 'no cross-tenant read');
select throws_ok($$insert into items(org_id, ...) values (:org_beta, ...)$$, '42501');
select throws_ok($$update items set ... where org_id = :org_beta$$, '42501');
-- manipulierte tenant_id / fehlende aktive Membership => leer bzw. Fehler
-- Cross-Tenant-FK: insert mit fremdem parent => FK-Verletzung
```

**Step 3:** Run `supabase test db` → Expected: FAIL (Policies fehlen noch).

**Step 4: RLS-Policies implementieren** — Tenantkontext ausschließlich aus verifizierter Identität + aktiver Membership ableiten (`exists`-Subquery auf memberships), Policies für select/insert/update/delete aller exponierten Tabellen + Storage-Policies für private Buckets.

**Step 5:** pgTAP grün. **Step 6: Integrationstests API-Pfad** — zwei echte JWTs (org_alpha/org_beta) gegen laufende API: Cross-Tenant-Read/Write → 403/404, IDOR-Versuch (fremde UUID) → kein Leak, Rollenbypass → abgelehnt; Assertion, dass API/Worker-Verbindungsstring die `runtime`-Rolle nutzt.

**Step 7: Pooling-Modus prüfen** — gewählten Connection-Pooling-Modus (Session vs. Transaction) dokumentieren und testen, dass RLS-relevante Session-Settings (JWT-Claims) im gewählten Modus korrekt greifen.

**Step 8: Isolationsreport schreiben** — `tenant-isolation-report.md`: Testmatrix, Ergebnisse, Pooling-Befund. **Bei nicht belegbarer Isolation: STOP des Domainausbaus, Befund an Ben.**

**Step 9: Commit** — `feat: prove tenant isolation with rls, pgtap and integration tests (EYT-15)`

---

### Task 8: Sprint-Verifikation und Jira-Pflege

**Step 1: Sprintziel-Gesamtprobe (frischer Checkout)**

```bash
git clone <repo> /tmp/fresh && cd /tmp/fresh
pnpm install --frozen-lockfile
supabase start && supabase db reset && supabase test db
pnpm build && pnpm test
# API, Worker, Web parallel starten; /health 200; Web-Shell erreichbar
```

**Step 2: Akzeptanzkriterien-Abgleich** — alle Checkboxen der 7 Tickets einzeln gegen Artefakte prüfen; Unerfülltes ehrlich offen lassen.

**Step 3: Jira aktualisieren (je Ticket, mit Read-back)** — Transition „Zu erledigen" → „In Arbeit" beim Start, → „Fertig" nur nach Step 2; Kommentar mit Commit-/PR-Link und Verifikationsnachweis. Keine Massen-Transition ohne Einzelprüfung.

**Step 4: Offene Punkte für Sprint-Review notieren** — inkl. der bekannten Datumsinkonsistenz (Due Dates 09.08. nach Sprintende 06.08.).

---

## Risiken und Gegenmaßnahmen

| Risiko                                | Wirkung                    | Gegenmaßnahme                                                                                         |
| ------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| RLS-Isolation nicht belegbar (EYT-15) | Stop des Domainausbaus     | Task 7 früh genug beginnen (spätestens Sprintmitte); Stop-Regel respektieren                          |
| 7 Tickets, 2 Wochen, kein Assignee    | Überlast/Unklarheit        | Reihenfolge dieses Plans nutzen; Task 6 parallelisieren; Assignees in Jira setzen (separater Auftrag) |
| Versions-/Befehlsannahmen veralten    | Setup-Fehler               | Jede `PLANANNAHME` beim Ausführen live verifizieren (npm/Context7)                                    |
| Pooling-Modus bricht RLS-Kontext      | Falsches Sicherheitsgefühl | Expliziter Pooling-Test in Task 7 Step 7                                                              |
| Secrets landen im Repo                | Sicherheitsvorfall         | Task 3 Redaction-Tests + `.env.example`-Grep als CI-Gate                                              |
