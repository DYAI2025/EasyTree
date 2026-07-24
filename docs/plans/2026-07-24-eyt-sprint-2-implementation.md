# EYT Sprint 2 — Quality Gates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (bzw. subagent-driven execution) to implement this plan task-by-task.

**Goal:** Eine mergegeschützte, reproduzierbare EasyTree-Foundation: Jeder PR gegen `master` muss Frozen-Install, Statik, Unit-Tests, Builds, Secret-Scan, DB-/Tenant-Gates (fail-closed), Runtime- und Accessibility-Smokes bestehen; `master` ist technisch gegen ungeprüfte Merges gesperrt.

**Architecture:** GitHub Actions als einziges Pflicht-Gate (Jobs = Required Checks). Tenant-Sicherheitstests laufen fail-closed (`EASYTREE_TENANT_TESTS=required`): unerreichbare DB oder Skips ⇒ rot. Supabase-Stack (Docker auf GH-Runnern) liefert die echte DB inkl. Transaction-Pooler (54329). Browser-Smokes via Playwright/Chromium gegen den Produktions-Build der Web-Shell. Branch Protection via GitHub Ruleset, per Read-back und negativem Test-PR bewiesen.

**Tech Stack:** pnpm 10.28 / Node 22 / Turborepo, Vitest 4, NestJS 11, Next 16, Supabase CLI 2.109 (pgTAP), Playwright + @axe-core/playwright, gitleaks (CLI, gepinnt), GitHub Rulesets API.

**Jira-Mapping:** EYT-56 (Task 2), EYT-66 (Task 3), EYT-57 (Task 4), EYT-15 (Task 5), EYT-58 (Tasks 6–7), EYT-41 (Task 8), EYT-67 (Task 9).

**Branch:** `feat/sprint-2-quality-gates` (von `master`, enthält bereits den gemergten Doku-Branch `agent/sprint-1-review-sprint-2-plan` und die Sprint-1-Retro).

---

## Rahmenregeln (aus docs/retros/2026-07-24-sprint-1-modell-retrospektive.md — verbindlich)

1. **AC-Deckel:** Vor jeder Jira-Fertig-Transition jedes AC wörtlich gegen ein Artefakt prüfen. Ein offenes TOOL_GAP/„offen“ ⇒ Status maximal „In Arbeit“, außer der PO descoped schriftlich.
2. **Fail-closed-Default:** Kein Test-Skip ohne expliziten, benannten Opt-out. CI führt Pflichttests aus oder wird rot.
3. **Evidenz-Hierarchie:** CI-Lauf > lokaler Lauf > Subagent-Bericht > Plan. Statusaussagen nennen die Stufe. Sandbox-Läufe ohne Docker sind „lokal verifiziert, CI ausstehend“.
4. **Empfehlungs-Konservatismus:** Bei Restpunkten ist die vorsichtigste Option die empfohlene.
5. **Grep-Gate:** Vor Statuspflege `grep -riE "offen|TODO|TOOL_GAP|FIXME" <deliverables>`; Treffer sind Blocker oder explizit descoped.

**Harte Bedingungen (aus docs/plans/2026-07-24-sprint-2-quality-gates.md):** keine `continue-on-error` auf Pflichtchecks, keine echten Daten, minimale Action-Permissions, keine Service-Role-Keys in normalen Pfaden, kein Deployment, kein Fachausbau.

**Umgebungs-Constraints:** Cloud-Sandbox hat kein Docker ⇒ `supabase start` läuft nur in GitHub Actions. Lokale Verifikation für DB-Tasks = Kommando-/SQL-Review + fail-closed-Pfad (unerreichbare DB); der Grün-Beweis ist der CI-Lauf auf dem PR. Playwright/Chromium ist in der Sandbox vorhanden (`/opt/pw-browsers`), Web-Smokes sind lokal voll verifizierbar.

---

## Task 1: Branch & Doku-Konsolidierung ✅ (bereits erledigt)

- `feat/sprint-2-quality-gates` von `master`; Merge von `origin/agent/sprint-1-review-sprint-2-plan`; Commit der Retro (`df460f2`). Dieser Plan wird als `docs/plans/2026-07-24-eyt-sprint-2-implementation.md` committet.

**Commit:** `docs: add Sprint 2 implementation plan`

---

## Task 2 (EYT-56): PR-CI-Baseline

**Files:**

- Create: `.github/workflows/ci.yml`
- Create: `.github/actions/setup-pnpm/action.yml` (DRY-Setup)
- Modify: `README.md` (Abschnitt „CI & Pflichtchecks“)

**Step 1: Composite-Setup-Action schreiben**

```yaml
# .github/actions/setup-pnpm/action.yml
name: Setup Node + pnpm (frozen)
description: Node 22 + corepack-pinned pnpm + frozen-lockfile install
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version-file: .nvmrc
    - name: Enable corepack (pinned pnpm from packageManager)
      shell: bash
      run: corepack enable
    - name: Get pnpm store path
      id: store
      shell: bash
      run: echo "path=$(pnpm store path --silent)" >> "$GITHUB_OUTPUT"
    - uses: actions/cache@v4
      with:
        path: ${{ steps.store.outputs.path }}
        key: pnpm-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
        restore-keys: pnpm-${{ runner.os }}-
    - name: Install (frozen lockfile only)
      shell: bash
      run: pnpm install --frozen-lockfile
```

**Step 2: Workflow-Grundgerüst mit Baseline-Jobs**

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [master]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-pnpm
      - run: pnpm format

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-pnpm
      - run: pnpm lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-pnpm
      - run: pnpm typecheck

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-pnpm
      # Tenant-Integrationstests laufen hier im Local-Mode (Skip mit Warnung);
      # das PFLICHT-Gate dafür ist der Job db-gates (fail-closed, EYT-66/57).
      - run: pnpm test

  build-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-pnpm
      - run: pnpm --filter @easytree/web... build

  build-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-pnpm
      - run: pnpm --filter @easytree/api... build

  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Fail if real .env files are tracked
        run: |
          tracked="$(git ls-files | grep -E '(^|/)\.env(\.local|\.production|\.development|\.test)?$' || true)"
          if [ -n "$tracked" ]; then
            echo "::error::Tracked .env files found:"; echo "$tracked"; exit 1
          fi
      - name: Fail if private key files are tracked
        run: |
          keys="$(git ls-files | grep -E '\.(pem|p12|pfx|key)$' || true)"
          if [ -n "$keys" ]; then
            echo "::error::Tracked key material found:"; echo "$keys"; exit 1
          fi
      - name: Run gitleaks (pinned)
        env:
          GITLEAKS_VERSION: "8.24.3"
        run: |
          curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" -o /tmp/gitleaks.tgz
          tar -xzf /tmp/gitleaks.tgz -C /tmp gitleaks
          /tmp/gitleaks git --redact --no-banner --exit-code 1 .
```

Hinweise: gitleaks als CLI (nicht `gitleaks-action`) — keine Org-Lizenz nötig, Version gepinnt. `--redact` verhindert Secret-Echo in Logs. `.env.example` bleibt erlaubt.

**Step 3: Lokal exakt die CI-Kommandos ausführen (Sandbox)**

```bash
pnpm install --frozen-lockfile && pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: alles grün (Tenant-Suite skippt im Local-Mode mit Warnung — bis Task 3 ist das noch das alte Verhalten).

**Step 4: Workflow statisch prüfen**

```bash
actionlint .github/workflows/ci.yml   # Binary bei Bedarf herunterladen (gepinnt)
```

Expected: keine Fehler.

**Step 5: Synthetisches Testsecret erkennen (AC-Beweis, lokal)**

```bash
echo 'aws_secret_access_key = "AKIAIOSFODNN7EXAMPLE1234"' > /tmp/leak-probe/planted.txt  # außerhalb des Repos
/tmp/gitleaks dir --no-banner /tmp/leak-probe ; echo "exit=$?"
```

Expected: Finding gemeldet, Exit ≠ 0. Output als Evidenz in den PR-/Jira-Kommentar. Nichts committen.

**Step 6: README-Abschnitt „CI & Pflichtchecks“** — Tabelle Job ⇒ Zweck ⇒ merge-blockierend ja/nein (alle ja); Hinweis, dass Branch Protection die Checks erzwingt (EYT-67).

**Step 7: Commit**

```bash
git add .github README.md && git commit -m "ci: add PR baseline workflow with mandatory quality checks (EYT-56)"
```

---

## Task 3 (EYT-66): Tenant-Gate fail-closed

**Files:**

- Modify: `apps/api/test/tenant-isolation.integration.test.ts`
- Create: `apps/api/test/tenant-gate.fail-closed.test.ts`
- Modify: `docs/runbooks/database-workflow.md` (Modi dokumentieren)

**Step 1: Failing Regressionstest schreiben (TDD)**

```ts
// apps/api/test/tenant-gate.fail-closed.test.ts
/**
 * EYT-66: Fail-closed-Beweis. Im Required-Modus MUSS eine unerreichbare
 * Testdatenbank die Tenant-Suite fehlschlagen lassen (kein grüner Lauf
 * durch Skips). Spawnt einen Kind-Vitest-Lauf mit unerreichbarer DB-URL.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

describe("tenant gate fail-closed (EYT-66)", () => {
  it("required mode + unreachable DB => non-zero exit and no skipped-as-green", async () => {
    let exitCode = 0;
    let output = "";
    try {
      const res = await run(
        "pnpm",
        ["exec", "vitest", "run", "test/tenant-isolation.integration.test.ts"],
        {
          cwd: __dirname + "/..",
          env: {
            ...process.env,
            EASYTREE_TENANT_TESTS: "required",
            EASYTREE_TEST_DB_URL: "postgresql://postgres:postgres@127.0.0.1:59999/postgres",
          },
          timeout: 120_000,
        },
      );
      output = res.stdout + res.stderr;
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string };
      exitCode = e.code ?? 1;
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(exitCode).not.toBe(0);
    expect(output).toContain("fail-closed");
  }, 150_000);
});
```

**Step 2: Rot laufen lassen**

```bash
pnpm --filter @easytree/config build && cd apps/api && pnpm exec vitest run test/tenant-gate.fail-closed.test.ts
```

Expected: FAIL — aktueller Code skippt im Required-Modus trotzdem (Exit 0, kein „fail-closed“ im Output).

**Step 3: Minimal implementieren** — in `tenant-isolation.integration.test.ts`:

```ts
const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local"; // "required" | "local"
let executedCount = 0;
let skippedCount = 0;
```

`beforeAll`: bei `!dbAvailable && TENANT_TESTS_MODE === "required"` ⇒
`throw new Error("[tenant-isolation] fail-closed: Pflicht-Tenant-Tests koennen nicht laufen — DB unter " + DB_URL + " nicht erreichbar (EYT-66).")`.
`dbIt`: im Skip-Zweig `skippedCount++`, sonst `executedCount++` vor `fn()`.
`afterAll` (neu, zusätzlich):

```ts
afterAll(() => {
  // Report fuer CI-Step-Summary (EYT-66 AC: Zahlen ausweisen)
  console.info(
    `[tenant-isolation] mode=${TENANT_TESTS_MODE} executed=${executedCount} skipped=${skippedCount}`,
  );
  if (TENANT_TESTS_MODE === "required" && skippedCount > 0) {
    throw new Error(
      `[tenant-isolation] fail-closed: ${skippedCount} Pflicht-Tenant-Tests uebersprungen (EYT-66).`,
    );
  }
});
```

Kopfkommentar der Datei aktualisieren: „CI-Schutz“-Formulierung ersetzen durch Fail-closed-Beschreibung + expliziten lokalen Opt-out (`EASYTREE_TENANT_TESTS=local` ist Default nur für Entwicklermaschinen).

**Step 4: Tests grün laufen lassen**

```bash
cd apps/api && pnpm exec vitest run test/tenant-gate.fail-closed.test.ts   # PASS
pnpm exec vitest run test/tenant-isolation.integration.test.ts             # Local-Mode: skips + Warnung, Exit 0
EASYTREE_TENANT_TESTS=required pnpm exec vitest run test/tenant-isolation.integration.test.ts; echo $?  # Exit != 0 (Sandbox ohne DB — erwartetes fail-closed)
```

**Step 5: Runbook ergänzen** — Tabelle der Modi (`local`/`required`), wer wann was setzt (CI: `required` im db-gates-Job).

**Step 6: Commit**

```bash
git add apps/api/test docs/runbooks/database-workflow.md && git commit -m "test: make tenant isolation gate fail-closed with executed/skipped report (EYT-66)"
```

---

## Task 4 (EYT-57): DB-, Migrations- und Tenant-Gates in CI

**Files:**

- Modify: `.github/workflows/ci.yml` (Job `db-gates`)

**Step 1: Job `db-gates` anfügen**

```yaml
db-gates:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: ./.github/actions/setup-pnpm
    - name: Start local Supabase stack (Docker)
      run: pnpm exec supabase start -x studio
    - name: Reset 1 — migrations + seed on empty DB
      run: pnpm exec supabase db reset
    - name: pgTAP suite (run 1)
      run: pnpm exec supabase test db
    - name: Reset 2 — reproducibility proof
      run: pnpm exec supabase db reset
    - name: pgTAP suite (run 2, must be identical)
      run: pnpm exec supabase test db
    - name: Build workspace deps for api tests
      run: pnpm --filter @easytree/config build
    - name: Tenant isolation gate (fail-closed, direct connection)
      env:
        EASYTREE_TENANT_TESTS: required
        EASYTREE_TEST_DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      run: |
        pnpm --filter @easytree/api exec vitest run test/tenant-isolation.integration.test.ts 2>&1 | tee /tmp/tenant-direct.log
        grep -E "\[tenant-isolation\] mode=required executed=[1-9][0-9]* skipped=0" /tmp/tenant-direct.log
    - name: Tenant report -> step summary
      if: always()
      run: grep "\[tenant-isolation\]" /tmp/tenant-direct.log >> "$GITHUB_STEP_SUMMARY" || true
```

Der `grep` nach `skipped=0` ist ein zweites, unabhängiges Fail-closed-Netz auf Job-Ebene (Report-Zeile muss existieren UND null Skips zeigen).

**Step 2: Lokal verifizieren, was ohne Docker geht**

```bash
actionlint .github/workflows/ci.yml
EASYTREE_TENANT_TESTS=required EASYTREE_TEST_DB_URL=postgresql://127.0.0.1:59999/postgres \
  pnpm --filter @easytree/api exec vitest run test/tenant-isolation.integration.test.ts; echo $?   # != 0
```

Expected: actionlint sauber; fail-closed-Pfad bewiesen. Grün-Pfad-Evidenz = CI-Lauf auf dem PR (Evidenz-Stufe „CI“ — erst dann AC-erfüllt).

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml && git commit -m "ci: run migration, pgTAP and fail-closed tenant gates on real Supabase stack (EYT-57)"
```

---

## Task 5 (EYT-15): Realer Pooling-Pfad

**Files:**

- Modify: `supabase/config.toml` (`[db.pooler] enabled = true`)
- Create: `apps/api/test/tenant-pooling.integration.test.ts`
- Modify: `.github/workflows/ci.yml` (Pooler-Steps in `db-gates`)
- Modify: `docs/architecture/tenant-isolation-report.md` (Pooling-Evidenz Sprint 2)

**Step 1: Pooler aktivieren** — in `supabase/config.toml`: `[db.pooler] enabled = true` (transaction mode, Port 54329 sind bereits konfiguriert).

**Step 2: Failing Pooling-Test schreiben (TDD)** — gleiche fail-closed-Semantik wie Task 3; Kern:

```ts
// apps/api/test/tenant-pooling.integration.test.ts (Auszug — volle Datei analog tenant-isolation)
const POOLER_URL =
  process.env["EASYTREE_TEST_POOLER_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54329/postgres";

// (1) Kontext funktioniert DURCH den Pooler (ein Client, Muster wie gehabt)
// (2) Parallelitaet: 8 gleichzeitige Clients (4x User A, 2x User C, 2x ohne Claims)
//     - jeder A-Client sieht ausschliesslich Org-Alpha-Zeilen
//     - C-/No-Claims-Clients sehen 0 Zeilen
// (3) Leak-Probe: nach allen Transaktionen liefert eine frische Transaktion
//     ohne Claims auth.uid() IS NULL und 0 Items.
```

Vollständige Datei: Verbindungslogik, `inTenantTx` und Konstanten aus `tenant-isolation.integration.test.ts` extrahieren in `apps/api/test/tenant-context.helper.ts` (DRY) und aus beiden Dateien importieren. Parallelität via `Promise.all` über 8 eigene `pg.Client`-Instanzen gegen `POOLER_URL`.

**Step 3: Rot/Fail-closed lokal**

```bash
EASYTREE_TENANT_TESTS=required pnpm --filter @easytree/api exec vitest run test/tenant-pooling.integration.test.ts; echo $?  # != 0 (Sandbox ohne DB)
```

**Step 4: CI-Steps anfügen** (in `db-gates`, nach dem Direct-Gate):

```yaml
- name: Tenant isolation gate (fail-closed, TRANSACTION POOLER)
  env:
    EASYTREE_TENANT_TESTS: required
    EASYTREE_TEST_POOLER_URL: postgresql://postgres:postgres@127.0.0.1:54329/postgres
  run: |
    pnpm --filter @easytree/api exec vitest run test/tenant-pooling.integration.test.ts 2>&1 | tee /tmp/tenant-pooled.log
    grep -E "\[tenant-pooling\] mode=required executed=[1-9][0-9]* skipped=0" /tmp/tenant-pooled.log
```

**Step 5: Report aktualisieren** — `docs/architecture/tenant-isolation-report.md`: neuer Abschnitt „Pooling-Evidenz (Sprint 2, real)“ mit Testdatei, CI-Job, Platzhalter für Run-URL (nach erstem grünen Lauf eintragen — erst dann gilt EYT-15-AC „reproduzierbar belegt“).

**Step 6: Commit**

```bash
git add supabase/config.toml apps/api/test .github/workflows/ci.yml docs/architecture/tenant-isolation-report.md
git commit -m "test: prove tenant context through real transaction pooler incl. parallel clients (EYT-15)"
```

---

## Task 6 (EYT-58a): Readiness mit echtem DB-Ping + Prozess-Smokes

**Files:**

- Create: `apps/api/src/health/pg-database-ping.ts`
- Modify: `apps/api/src/app.module.ts` (DI: `DATABASE_PING` ⇒ `PgDatabasePing`)
- Modify: `apps/api/package.json` (`pg` von devDependencies ⇒ dependencies)
- Modify: `apps/api/test/health.e2e.test.ts` (Ready-Fälle über DI-Override)
- Create: `scripts/smoke-api.sh`, `scripts/smoke-worker.sh`
- Modify: `.github/workflows/ci.yml` (Runtime-Steps in `db-gates`)

**Step 1: Failing e2e-Test** — in `health.e2e.test.ts` zwei Fälle ergänzen: `DATABASE_PING` überschrieben mit `ping: () => false` ⇒ `GET /ready` = 503 mit `{ status: "unready" }`; mit `true` ⇒ 200. Run: FAIL (Stub ist fest verdrahtet).

**Step 2: Implementieren**

```ts
// apps/api/src/health/pg-database-ping.ts
import { Client } from "pg";
import type { DatabasePing } from "./readiness";

/** Echter DB-Ping (EYT-58): SELECT 1 mit hartem Timeout, niemals throw. */
export class PgDatabasePing implements DatabasePing {
  constructor(private readonly databaseUrl: string) {}
  async ping(): Promise<boolean> {
    const client = new Client({
      connectionString: this.databaseUrl,
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
    });
    try {
      await client.connect();
      await client.query("select 1");
      return true;
    } catch {
      return false;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
```

In `app.module.ts`: Provider `DATABASE_PING` als Factory aus `APP_CONFIG` (`new PgDatabasePing(config.databaseUrl)`). `StubDatabasePing` bleibt nur noch für Tests.

**Step 3: Tests grün** — `pnpm --filter @easytree/api test` (alle e2e inkl. neue Ready-Fälle).

**Step 4: Smoke-Skripte**

```bash
# scripts/smoke-api.sh — API-Start, /health+/ready, SIGTERM, sauberer Exit
#!/usr/bin/env bash
set -euo pipefail
node apps/api/dist/main.js & PID=$!
trap 'kill -9 $PID 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:${API_PORT}/health"
READY_STATUS=$(curl -s -o /tmp/ready.json -w "%{http_code}" "http://127.0.0.1:${API_PORT}/ready")
echo "ready=${READY_STATUS} $(cat /tmp/ready.json)"
[ "${READY_STATUS}" = "${EXPECT_READY:-200}" ]
kill -TERM $PID
for i in $(seq 1 10); do kill -0 $PID 2>/dev/null || { trap - EXIT; echo "graceful shutdown OK"; exit 0; }; sleep 1; done
echo "::error::API did not shut down gracefully"; exit 1
```

```bash
# scripts/smoke-worker.sh — Worker: kein HTTP-Port, Graceful Shutdown
#!/usr/bin/env bash
set -euo pipefail
node apps/api/dist/worker.js & PID=$!
trap 'kill -9 $PID 2>/dev/null || true' EXIT
sleep 5
if ss -ltnp 2>/dev/null | grep -q "pid=${PID},"; then
  echo "::error::Worker opened an unexpected listening port"; exit 1
fi
kill -TERM $PID
for i in $(seq 1 10); do kill -0 $PID 2>/dev/null || { trap - EXIT; echo "worker shutdown OK"; exit 0; }; sleep 1; done
echo "::error::Worker did not shut down gracefully"; exit 1
```

**Step 5: CI-Steps in `db-gates`** (Supabase läuft dort bereits):

```yaml
- name: Build api for runtime smokes
  run: pnpm --filter @easytree/api... build
- name: API smoke — healthy runtime (ready must be 200)
  env:
    {
      NODE_ENV: test,
      API_PORT: "3001",
      EXPECT_READY: "200",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "ci-local-anon-key",
    }
  run: bash scripts/smoke-api.sh
- name: API smoke — dependency down (ready must be 503)
  env:
    {
      NODE_ENV: test,
      API_PORT: "3002",
      EXPECT_READY: "503",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:59999/postgres",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "ci-local-anon-key",
    }
  run: bash scripts/smoke-api.sh
- name: Worker smoke — no port, graceful shutdown
  env:
    {
      NODE_ENV: test,
      API_PORT: "3003",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "ci-local-anon-key",
    }
  run: bash scripts/smoke-worker.sh
```

(`SUPABASE_ANON_KEY` ist im lokalen CI-Stack kein echtes Secret; Wert erfüllt nur das Schema. Kein Service-Role-Key irgendwo.)

**Step 6: Lokal verifizieren** — Sandbox: Build + beide Smokes mit unerreichbarer DB (`EXPECT_READY=503`) und Worker-Smoke vollständig; der 200-Pfad ist CI-Evidenz.

**Step 7: Commit**

```bash
git add apps/api scripts .github/workflows/ci.yml && git commit -m "feat(api): real database readiness ping + process smokes in CI (EYT-58)"
```

---

## Task 7 (EYT-58b): Web-Browser- und Accessibility-Smoke

**Files:**

- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/shell-smoke.spec.ts`
- Modify: `apps/web/package.json` (devDeps `@playwright/test`, `@axe-core/playwright`; Script `test:e2e`)
- Modify: `.github/workflows/ci.yml` (Job `web-smoke`)

**Step 1: Playwright-Setup**

```ts
// apps/web/playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm exec next start -p 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
```

**Step 2: Failing Spec schreiben, dann grün machen**

```ts
// apps/web/e2e/shell-smoke.spec.ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "320px (200%-Zoom-Aequivalent)", width: 320, height: 720 },
  { name: "375px (mobile Kernbreite)", width: 375, height: 812 },
];

test("laedt ohne ungefangene Console-Fehler", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Tastatur: Skip-Link ist erstes Tab-Ziel und springt zu #hauptinhalt", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.locator("a[href='#hauptinhalt']");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#hauptinhalt")).toBeFocused();
});

test("sichtbarer Fokus auf interaktiven Elementen", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth };
  });
  expect(outline.outlineStyle).not.toBe("none");
  expect(parseFloat(outline.outlineWidth)).toBeGreaterThan(0);
});

for (const vp of VIEWPORTS) {
  test(`kein horizontales Scrollen bei ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("Statusanzeige traegt Information nicht nur ueber Farbe", async ({ page }) => {
  await page.goto("/");
  const status = page.getByRole("status");
  await expect(status).toBeVisible();
  await expect(status).not.toHaveText(/^\s*$/); // Textinhalt, nicht nur Farbe
});

test("axe im echten Browser: 0 Violations inkl. color-contrast", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
});
```

Run rot ⇒ ggf. Shell fixen ⇒ grün. Exakte Selektoren beim Implementieren gegen die echte Shell prüfen (Skip-Link-Markup aus `app-shell.tsx`).

**Step 3: CI-Job**

```yaml
web-smoke:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: ./.github/actions/setup-pnpm
    - run: pnpm --filter @easytree/web... build
    - run: pnpm --filter @easytree/web exec playwright install --with-deps chromium
    - run: pnpm --filter @easytree/web run test:e2e
```

**Step 4: Lokal (Sandbox, Chromium vorhanden) voll ausführen** — `pnpm --filter @easytree/web run test:e2e`. Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web .github/workflows/ci.yml && git commit -m "test(web): real-browser smoke incl. keyboard, focus, viewports and axe (EYT-58, EYT-41)"
```

---

## Task 8 (EYT-41): Accessibility-Baseline abschließen

**Files:**

- Modify: `docs/runbooks/a11y-checklist.md`

**Steps:**

1. Punkte 1–6 der Checkliste sind durch Task 7 im echten Browser automatisiert belegt ⇒ Status je Zeile auf „bestanden (Datum, Prüfer: Claude, Chromium real, CI-Job web-smoke)“ setzen, mit Verweis auf Spec-Namen.
2. Punkt 7 (Screenreader-Smoke) ist NICHT automatisierbar-ehrlich: VoiceOver-Durchgang durch Ben (5 Min: Landmarks, Titel, Überschriften) ODER schriftliches PO-Descoping. Bis dahin bleibt die Zeile „offen“ und EYT-41 maximal „In Arbeit“ (AC-Deckel!).
3. Befunde aus Browser-Läufen ⇒ Jira-Bugs unter EYT-41.
4. Commit: `docs: record real-browser a11y evidence in checklist (EYT-41)`

---

## Task 9 (EYT-67): Branch Protection erzwingen und beweisen

**Files:**

- Create: `docs/runbooks/branch-protection.md`

**Voraussetzung:** PR aus diesem Branch ist offen, CI-Checks existieren und sind auf dem PR sichtbar (Namen = Jobnamen).

**Step 1: Ruleset per API setzen** (PAT mit Administration:write; Werte exakt so):

```bash
curl -sS -X POST -H "Authorization: Bearer $EYT_GH_PAT" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/DYAI2025/Arborga/rulesets -d '{
  "name": "master-quality-gate",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/master"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "format" }, { "context": "lint" }, { "context": "typecheck" },
          { "context": "unit-tests" }, { "context": "build-web" }, { "context": "build-api" },
          { "context": "secret-scan" }, { "context": "db-gates" }, { "context": "web-smoke" } ] } }
  ]}'
```

`required_approving_review_count: 0` ist bewusst: Solo-Maintainer kann eigenen PR nicht approven; Pflicht-Reviews > 0 würden jeden Merge unmöglich machen. Diese Einschränkung wird im Runbook als dokumentierte Plan-/Team-Limitation festgehalten (AC „soweit technisch verfügbar“ — Review-Thread-Auflösung ist aktiv).

**Step 2: Read-back-Verifikation** — `GET /repos/DYAI2025/Arborga/rulesets` + `GET /repos/DYAI2025/Arborga/rules/branches/master`; JSON als Evidenz sichern.

**Step 3: Negativer Beweis-PR**

```bash
git checkout -b test/eyt-67-negative-proof master
# absichtlich fehlschlagender Test + synthetisches Testsecret (Dummy, klar markiert)
# -> push, PR oeffnen ("DO NOT MERGE - EYT-67 negative proof")
# warten bis Checks rot; dann:
curl -sS -H "Authorization: Bearer $EYT_GH_PAT" \
  https://api.github.com/repos/DYAI2025/Arborga/pulls/<N> | jq '{mergeable_state}'   # erwartet: "blocked"
# direkter Push-Versuch auf master (vom Sandbox-Clone): git push origin HEAD:master  # erwartet: rejected (ruleset)
# PR schliessen, Branch loeschen
```

**Step 4: Runbook schreiben** — Regeln, warum 0 Approvals, was der Plan nicht kann, wie man das Ruleset ändert, Evidenz-Links (Ruleset-ID, Test-PR, abgelehnter Push).

**Step 5: Commit** — `docs: document enforced branch protection with negative proof (EYT-67)`

---

## Task 10: Sprint-Abschluss

1. PR „Sprint 2: mergegeschützte Quality Foundation (EYT-56/57/58/66/15/41/67)“ — alle Pflichtchecks grün; Run-URLs in `tenant-isolation-report.md` und Jira nachtragen.
2. **Grep-Gate:** `grep -riE "offen|TODO|TOOL_GAP|FIXME" docs/runbooks/a11y-checklist.md docs/architecture/tenant-isolation-report.md .github/` — Treffer auflösen oder explizit descopen lassen.
3. Jira pro Ticket (AC-wörtlich, konservativ): EYT-56/57/58/66/15 ⇒ „Fertig“ nur mit grünem CI-Link; EYT-67 ⇒ „Fertig“ nur mit Ruleset-Read-back + blockiertem Test-PR; EYT-41 ⇒ „Fertig“ NUR wenn Punkt 7 erledigt/descoped, sonst „In Arbeit“ mit Kommentar.
4. Statusdokument ins Claude-Projekt (project_write): Sprintziel, Evidenzlinks, Restpunkte.
5. Merge des Sprint-PRs erst NACH Ruleset-Aktivierung — der Sprint-PR selbst ist damit der erste positive Beweis des Gates.

## Risiken & stärkste Gegenargumente

- **Supavisor-Pooler in CI instabil** (bekannt aus Sprint 1 Sandbox): Falls `supabase start` mit Pooler auf GH-Runnern scheitert ⇒ Pooler-Step zunächst als separater, ebenfalls PFLICHTIGER Job mit Retry; scheitert er strukturell, ist das ein dokumentierter EYT-15-Blocker (kein Silent-Skip!).
- **Check-Namen vs. Ruleset:** Required-Check-Kontexte müssen exakt den Jobnamen entsprechen; nach jeder Umbenennung Ruleset nachziehen (im Runbook festgehalten).
- **`strict_required_status_checks_policy: true`** erzwingt Up-to-date-Branches — bei Solo-Arbeit geringe Kosten, hoher Schutz.
- **Ein Sprint ohne Nutzerfeature** — bewusste PO-Entscheidung, Begründung im Strategiedokument (Failure-Mode-Kette).
