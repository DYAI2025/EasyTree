# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

easyTree (product name "Arboscus Teamplaner") — a multi-tenant crew/site planner for the
tree-care industry. TypeScript pnpm + Turborepo monorepo implementing the **split monolith**
from [`docs/architecture/ADR-001-boilerplate-architecture.md`](docs/architecture/ADR-001-boilerplate-architecture.md).
Read ADR-001 before any structural change — it is the binding architecture contract.

**Every versioned document here is v1.3**; a reference to v1.0/v1.1/v1.2 is stale. The repo root
holds raw generator artifacts, `docs/` the curated condensations — cite `docs/`:
`docs/prd/CURRENT_PRD_v1.3.md` (**product source of truth**),
`docs/traceability/REQUIREMENT_TO_JIRA_v1.3.csv`, `docs/validation/PRD_VALIDATION_v1.3.md`. Where
a root artifact disagrees with the PRD, the PRD wins and the divergence is a defect.

Architecture spans three documents, none superseding another: ADR-001 (binding),
`docs/architecture/ARCHITECTURE_DECISIONS_v1.3.md` (provider, hosting, retention) and
[ADR-002](docs/architecture/ADR-002-integration-canonical-repo.md) (this repo is the one canonical
product repository; "Arborga" is its **former name**, not a second repo). ADR-003 adds the `costs`
module. `docs/architecture/zwei-client-shells.md` records the **implemented** state of the two
client shells (EYT-113). Work is tracked as Jira `EYT-*`.

**Für den MVP-Scope gilt zusätzlich Confluence PRD v1.4 (Seite 7766017)** als fachliche
Produktbaseline: sie ersetzt v1.3 §10 und führt **interne Kostensätze, Plan-/Ist-Kosten und den
Excel-Export „Im MVP"**; **Post-MVP** bleiben Maschinenverleiherlöse, Rechnung/Steuer/Zahlung und
Payroll. Die Grenze wird enger gezogen, nicht aufgehoben; sonst bleibt v1.3 die kanonische
Repository-Autorität. Design-Baseline für alles Frontend ist Confluence **Basisdesign v2.0**
(Seite 8814623), die Zwei-Client-Architektur Seite 8486960.

[`docs/handoff/AGENT_HANDOFF_v1.3.md`](docs/handoff/AGENT_HANDOFF_v1.3.md) holds the agent
guardrails: required working method, prohibited actions, evidence rules, stop conditions, human
review checkpoints. **Read it before changing code** — the rules below summarise what bites most
often, they do not replace it. Its mandatory sections are guarded by
`apps/api/test/handoff-guardrails.test.ts`, because they were once removed unnoticed (EYT-89).

## Where the work is tracked

Jira project `EYT`, board 72 — https://dyai2026.atlassian.net/jira/software/c/projects/EYT/boards/72
Use the `claude_ai_Atlassian` MCP tools; the `/jira-automation` skill documents Rube MCP, which is
**not** connected here. Do not trust the search `count` mode — it once reported "8 not done" for a
sprint in which all 8 were done; query with `issues` mode. Sprint contents, ticket states and
branch/PR positions come from Jira and `git`/`gh`, never from here — likewise the contract
operations and the `NOT_YET_IMPLEMENTED` list, **counted from
`apps/api/test/openapi-route-conformance.test.ts`**, which fails both ways: an operation without
route or entry, and an entry for one since implemented.

**Establish repository identity before any mutation** (EYT-137,
`docs/evals/agent-repository-identity.eval.json`, guarded by the handoff test): `pwd`,
`git remote -v`, `git rev-parse --show-toplevel`, `git fetch --prune`,
`git rev-parse origin/master`. Wrong repository → stop, no file edit, no branch, no commit.
Compare a branch against **`origin/master`, never local `master`** — local `master` once lay 25
commits behind and made four evidence findings wrong. Several worktrees of this repo exist side
by side (`git worktree list`); a checkout can sit on a branch that is already merged.
`docs/prd/planning-draft-conflict-slice.prd.md` and `docs/traceability.md` (Plumbline) sit beside
the v1.3 authorities — **which wins is undecided; ask before citing either.**

## Sprint 7 — Binding UI/UX Acceptance Gate (temporary)

Until Jira Sprint 7 (Sprint ID 579) is formally PO-accepted and closed,
`.claude/rules/sprint-7-ui-ux-acceptance.md` is binding for all Sprint-7
frontend/UI/UX/browser/accessibility/Playwright/visual-regression work. The
rule file contains the full executable contract; it is loaded into every
session via the import below.

@.claude/rules/sprint-7-ui-ux-acceptance.md

Key governance: acceptance journeys run the real Auth → API → PostgreSQL/RLS
path — no mocks, clickdummies or placeholders as product acceptance; EYT-148
is the final integrated UI/journey gate; Claude may report technical PASS but
can never create human PO acceptance — the highest agent state is
`READY_FOR_PO_VISUAL_REVIEW`; golden visual baselines require explicit PO
approval (never an automatic `--update-snapshots`); re-read the current
Jira/GitHub/Confluence state before acting. Guarded by
`apps/api/test/sprint7-acceptance-rule-guardrails.test.ts`. `.claude/rules/` is therefore
**tracked**; only `.claude/settings.local.json` is ignored.

## Commands

Node 22 (`.nvmrc`), pnpm 10.28.0 via corepack. **pnpm is the only permitted package manager.**

```bash
pnpm install --frozen-lockfile   # deterministic install (what CI does)
pnpm format        # prettier --check .   (pnpm format:fix writes)
pnpm lint          # turbo run lint
pnpm typecheck     # turbo run typecheck  (depends on ^build)
pnpm test          # turbo run test       (depends on ^build)
pnpm build         # turbo run build
```

**⚠️ Four of those five run through Turbo, and a Turbo replay is not a run.** `pnpm test` can
print `Cached: 10 cached, 10 total >>> FULL TURBO`, show a green summary, and have executed **not
one package** — worst right after a counter-mutation, where reverting the file restores the
pre-mutation cache key. **Any number meant as evidence needs `--force` plus a look at the
`Cached:` line.** The cache is shared across worktrees too, so a
"cache hit" can be a replay from a worktree where the task never ran. And a `vitest` path filter
that matches nothing **exits 0 without having checked anything** — read the printed file count,
never the exit code. Two Turbo settings you will trip over: the `test` task lists `CLAUDE.md`,
`.claude/rules/**`, `docs/handoff/**` and `docs/evals/**` as **inputs**, because three guard suites
read those files — editing them invalidates the test cache on purpose. And Turbo runs tasks in
**strict env mode**: `EASYTREE_TENANT_TESTS`/`EASYTREE_TEST_*` never reach a task through
`pnpm test`, so the integration suites silently run in `local` mode and skip. Either call the
package directly (as CI does) or add `--env-mode=loose`.

Two local-only red herrings. First, `pnpm format` flags files CI never sees — **not** because
`penpot/` is unignored (Prettier 3 reads `.gitignore`; measured 23.08.2026, `penpot/**/*.md` gives
0 findings by default and 127 with `--ignore-path .prettierignore`), but because untracked-yet-
unignored files under `docs/plans/` are checked — 8 of them that day, and
`prettier --check apps packages docs` does **not** filter them out. Check the tracked set instead,
as in _Verification_. Second, `.nvmrc` pins Node 22 while `engines.node` says only `>=22`. No build needs
`EASYTREE_API_PROXY_TARGET` (EYT-126).

```bash
pnpm --filter @easytree/api exec vitest run test/health.e2e.test.ts   # one file (filter is a substring)
pnpm --filter @easytree/api exec vitest run -t "returns 503"          # one case
pnpm --filter @easytree/web dev                     # Next dev server :3000
pnpm --filter @easytree/api... build                # package + workspace deps
pnpm --filter @easytree/contracts run openapi:write # regenerate openapi/v1.json
```

`typecheck`/`test` depend on `^build`, so a package consuming another needs it built
(`pnpm --filter @easytree/config build`) before its tests resolve `dist/`. A red build leaves the
**old** `dist/` in place (`noEmitOnError` is set nowhere), so a single-file test can go green
against stale compiled code.

Playwright has **four** configs, and `pnpm --filter @easytree/web run test:e2e -- <filter>` does
**not** filter — pass the file to `exec playwright test` instead. The first three start `next start` against a production build (port 3000 must be free); the
staging suite starts nothing:

```bash
EASYTREE_API_PROXY_TARGET=http://127.0.0.1:3001 \
  pnpm --filter @easytree/web exec playwright test            # web-smoke: shell-smoke + planungswerkbank
pnpm --filter @easytree/web exec playwright test -c e2e/auth-journey/config.ts   # real GoTrue + API + DB
pnpm --filter @easytree/web exec playwright test -c e2e/staging/staging.config.ts # against VPS staging
bash scripts/read-through-harness.sh                           # read-through.spec via harness config
```

Without a proxy target the smoke's `webServer` times out — `instrumentation.ts` refuses the start
fail-closed, and the error text does not say why. The auth journey and the staging suite use the
`.pwtest.ts` suffix so neither the default Playwright match nor vitest picks them up; the auth
journey needs the local Supabase stack plus a built API (read the `auth-journey` job for the exact
environment), the staging suite needs `EYT_STAGING_URL` (**HTTPS enforced**),
`EYT_JOURNEY_WOCHE` and `EYT_SATZ_FEHLT_WOCHE` as **fresh** ISO weeks — a published week is
immutable even for a superuser, so every run consumes its weeks.

Database (Docker required; always `pnpm exec supabase`):

```bash
pnpm exec supabase start        # local stack (API 54321, PG 54322, pooler 54329)
pnpm exec supabase migration new <name>
pnpm exec supabase db reset     # rebuild from migrations + seed.sql
pnpm exec supabase test db      # pgTAP (supabase/tests/*.sql)
pnpm exec supabase status       # local URLs/keys
```

Tenant suites read their own variables, not `DATABASE_URL`: `EASYTREE_TEST_DB_URL` and
`EASYTREE_TEST_POOLER_URL` (Supavisor; see the database runbook). The direct connection is only
**half** the gate — `db-gates` also runs the pooling suite, so only CI covers both.

## Verification

One command per kind of change, and the string that makes it evidence. A green tick, an exit code
behind a pipe, or "looks correct" is not a done-condition; print the number, not a judgement.

| Kind of change                    | Command                                                                                                                                                             | Done when                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Formatting                        | `git ls-files -z \| xargs -0 pnpm exec prettier --ignore-unknown --check`                                                                                           | exit 0                                                                                                    |
| Lint / types                      | `pnpm exec turbo run lint --force` · `… typecheck --force`                                                                                                          | `Cached: 0 cached` **and** `Tasks: N successful`                                                          |
| Any test number cited as evidence | `pnpm exec turbo run test --force`                                                                                                                                  | `Cached: 0 cached`; a replay proves nothing                                                               |
| One package / one file            | `pnpm --filter @easytree/api test` · `… exec vitest run test/<name>.test.ts`                                                                                        | deps built first; printed **file count ≥ 1**                                                              |
| Build                             | `env -u EASYTREE_API_PROXY_TARGET pnpm build`                                                                                                                       | exit 0, `Cached: 0 cached`                                                                                |
| Contract schema                   | `pnpm --filter @easytree/contracts run openapi:write`, then `… test`                                                                                                | `v1.json` regenerated **and committed**, `openapi-drift.test.ts` green                                    |
| Migration                         | `pnpm exec supabase db reset` twice, then `pnpm exec supabase test db`                                                                                              | both resets reproduce, pgTAP green twice                                                                  |
| Tenant isolation                  | `pnpm --filter @easytree/config build`, then `EASYTREE_TENANT_TESTS=required pnpm --filter @easytree/api exec vitest run test/tenant-isolation.integration.test.ts` | `[tenant-isolation] mode=required … skipped=0`                                                            |
| API runtime                       | `NODE_ENV=test API_PORT=3001 EXPECT_READY=200 DATABASE_URL=… … bash scripts/smoke-api.sh`                                                                           | exit 0 (`/health`, `/ready` 200, clean SIGTERM)                                                           |
| Worker / role gate                | `bash scripts/smoke-worker.sh` · `bash scripts/smoke-api-role-gate.sh`                                                                                              | both exit 0 — "probe could not run" is RED, and the role gate passes only if the API **refused** to start |
| Read path e2e                     | `bash scripts/read-through-harness.sh`                                                                                                                              | exit 0 (Docker + browser)                                                                                 |
| Identity e2e                      | `pnpm --filter @easytree/web exec playwright test -c e2e/auth-journey/config.ts`                                                                                    | exit 0 against the real GoTrue signup and cookies                                                         |
| Staging acceptance                | `EYT_STAGING_URL=https://… EYT_JOURNEY_WOCHE=… EYT_SATZ_FEHLT_WOCHE=… pnpm --filter @easytree/web exec playwright test -c e2e/staging/staging.config.ts`            | `ids.json` written — only a fully green run writes it, anything else leaves `ids.partial-…`               |
| Container / deploy                | `EASYTREE_CONTAINER_SMOKE=required bash scripts/smoke-container.sh`                                                                                                 | `[container-smoke] mode=required … skipped=0`                                                             |
| Branch protection                 | `bash scripts/verify-branch-protection.sh`                                                                                                                          | `=== Ergebnis: 0 offen`                                                                                   |
| What CI proved                    | `gh run view <run> --log --job <db-gates-job-id> \| grep -oE '\[[a-z-]+\] mode=[a-z]+ executed=[0-9]+ passed=[0-9]+ skipped=[0-9]+' \| sort -u`                     | every gate line present with `skipped=0`                                                                  |

## Architecture

```
apps/api            NestJS, ONE code package, TWO entrypoints
apps/web            Next.js 16 App Router / React 19, one app, TWO client shells (Werkbank, Feld)
packages/contracts  Zod schemas, gateway ports, generated openapi/v1.json
packages/domain     framework-free core: types, invariants, state models
packages/config     strict Zod env validation + secret redaction
packages/ui         domain-free primitives + basisdesign-v2.css (the design tokens)
supabase/           migrations (schema source of truth), seed.sql, pgTAP tests
docs/               ADRs, plans, runbooks, retros, evidence — mostly German
```

Workspace dependencies (read them from `package.json`, they move): `api` → `config` +
`contracts` + `domain`; `web` → `contracts` + `domain` + `ui`; **`contracts` and `domain` depend
on no workspace package at all**. `contracts` deliberately does not import `domain`: `domain`'s
`TimeInterval` is a class with private fields that cannot travel over the wire — do not
"simplify" that away.

**Two entrypoints, one module graph** (ADR-001 §2): `src/main.ts` listens on `API_PORT`,
`src/worker.ts` boots the _same_ `AppModule` via `createApplicationContext` with **no HTTP
listener and no port**. Anything added to `AppModule` runs in both.
Both call `enableShutdownHooks()`; the worker holds the event loop open with a `setInterval` so
SIGTERM can close it gracefully.

**Config is validated once, at bootstrap, and injected**: `loadConfig(env)` uses a
`z.strictObject` per `NODE_ENV`, so unknown variables are rejected. `test` has **no** connection
defaults, `production` has none _and_ rejects localhost. `ConfigValidationError` names variables
only — never attach the ZodError or log raw config; use `redact()`.

The canonical set is exactly seven: `NODE_ENV`, `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `API_PORT`, `LOG_LEVEL`, `DATABASE_SSL_ROOT_CERT` (secret, **required in
`production`**). Strict schema plus defaultless `test` means **adding or renaming one touches all
of**: `packages/config/src/schema.ts` (`ENV_VAR_META`, all three presets, `AppConfig`), the
mapping in `load.ts`, `apps/api/test/setup.ts`, `.env.example`, the `env:` blocks of `db-gates`,
`scripts/smoke-api.sh`, `scripts/smoke-worker.sh` — plus `SECRET_CONFIG_KEYS` (`redact.ts`) for a
secret. Miss one and a suite fails. `EASYTREE_*` variables steer tests, never the app, and must
never enter `ENV_VAR_META`.

**PostgreSQL connections are built in exactly one place**,
`apps/api/src/platform/database/pg-connection.ts`: with a root certificate it returns
`ssl: { ca, rejectUnauthorized: true }` and strips the **entire query** from `DATABASE_URL`,
because `pg` merges the connection string OVER the explicit `ssl` object, so a parameter denylist
is defeatable. Never reintroduce SSL parameters there or build a `pg` config elsewhere —
static guards in `apps/api/test/pg-connection.test.ts`, including one asserting the EFFECTIVE pg
config, go red if you try. The chain verifies against `DATABASE_SSL_ROOT_CERT` (Supabase Root
2021 CA, cryptographically verified against the live chain before use).
`DATABASE_URL` must connect as `easytree_app`: on the hosted project `postgres` carries
**BYPASSRLS**, which the EYT-45 start gate refuses.

**The login role is part of the security boundary** (EYT-107, migrations `0015`/`0016`): because
`supabase/config.toml` exposes `public` as a PostgREST **Data API**, publishing is enforced by the
database, not only by the application. Three rules on `public.plan_versions`:
(1) `app.is_runtime_channel()` compares `session_user` against `easytree_app` and sits in **both**
`using` and `with check` of the update policy — API and worker log in as that role and only then
`set local role authenticated`, so `session_user` never changes; two independent bolts.
(2) Column grants: `update` reaches only `published_at`/`published_by`, `insert` only
`(id, org_id, week_key)`, no `delete` grant — a plan version is **born a draft**. (3)
`app.reject_assignment_in_published_plan()` is `security definer`, because a locking
`select … for share` also checks that `using` clause and an invoker read would be blinded,
disarming the trigger. Consequence — **derived** from `session_user` plus the policies and **not measured against a
pooler connection**, because pgTAP runs as `postgres`, not `postgres.<pooler-tenant>`: the
transaction pooler makes `session_user`
`postgres.<tenant>` and **breaks publishing** and cost-snapshot creation; reading survives, and
`service_role`/`postgres` bypass RLS
([`docs/runbooks/planning-publish.md`](docs/runbooks/planning-publish.md)).

**Web never talks to Supabase or bare `fetch`.** Components get an `ApiClient` plus the gateways
(`PlanningGateway`, `AuthGateway`, `CostsGateway`) from React context; the single construction
site is the composition root `app/providers.tsx` (ADR-001 §5). The selected organisation is
**not** handed to the costs gateway synchronously: `SessionProvider` reports it upward via
`onOrganisationChange`, the root stores it in a ref, and the gateway reads that ref on every call
to send `X-EasyTree-Organization-Id` — so a costs request fired from a child effect in the same
commit goes out **without** the header.
`apps/web/test/no-supabase-import.test.ts` fails if the Supabase SDK name appears under
`apps/web` — its guard string is assembled from parts, so don't inline the literal.

**One Next app, two client shells** (EYT-113, `docs/architecture/zwei-client-shells.md`): the
route group `apps/web/app/(werkbank)/` (`/`, `/anmelden`, `/planung`, `/kosten`,
`/kosten/stundensaetze`; desktop-first, 1440/1920 px, `AppShell` from `@easytree/ui`) and
`apps/web/app/feld/` (employee shell, mobile-first, 320/375 px, `FeldShell`). Same API, same
gateways, same composition root; the root layout decides no shell. `lib/sitzung-server.ts` reads
the session server-side through the runtime proxy target and yields **three** states —
`angemeldet`, `abgemeldet`, `unbekannt` — and **not knowing is not logged out**: `feld/layout.tsx`
redirects on `abgemeldet`, renders an `ErrorState` on `unbekannt`, mounts the shell only on a
verified session. `lib/feld/start-shell.ts` derives the start shell from the verified membership
roles (owner/manager → Werkbank, otherwise Feld); no client flag decides. Choosing a shell or a
route grants nothing — every request still passes application-layer authorisation and RLS.
`lib/kosten-freigabe.ts` is the one server-side read of the `costs.read` load boundary, keyed on
the organisation selected via `lib/organisations-auswahl-cookie.ts`; a broken selector cookie
falls closed. Because Turbopack ships every route-entry chunk unconditionally, a server gate keeps
cost **chunks** out of the browser only behind a client-side `next/dynamic` boundary — prove it
with the build manifest and a network capture, not with the gate's source.

**Design tokens have one source**: `packages/ui/src/basisdesign-v2.css` (Basisdesign v2.0), exported
as `@easytree/ui/basisdesign-v2.css` — the `ui` build copies it into `dist/` by hand because `tsc`
never would, and the `exports` map needs the subpath. `apps/web/app/globals.css` imports the colour
roles from there; `packages/ui/test/basisdesign-tokens.test.ts` and
`apps/web/test/basisdesign-tokens.test.ts` go red on a second palette. In the browser the minifier
shortens `#ffffff` to `#fff` and `getComputedStyle` does not normalise custom properties — compare
tokens as colours, never as strings.

**There is no `NEXT_PUBLIC_API_URL` any more** (EYT-50) — do not reintroduce it: one visible
origin needs no CORS, and a `NEXT_PUBLIC_*` value would be baked into the bundle at build time.
The browser calls **relative** paths; the Route Handlers under `apps/web/app/api/[[...pfad]]`,
`app/health` and `app/ready` forward them server-side to `EASYTREE_API_PROXY_TARGET`, read fresh
on **every request** (EYT-126 — no `rewrites()`). `lib/api-proxy-target.ts` validates that target
strictly (absolute http/https, no credentials, no query/fragment, no trailing slash) with **no
default in production**, so `instrumentation.ts` refuses the server start. The single pass-through
is `lib/proxy-durchreichen.ts`, also the one place keeping the internal address off the wire
(_Deployment_). Each gateway's URL is built in one factory, so its test calls the same function
production does — but executed is not asserted: read `apps/web/test/api-base-path.test.ts` for
which factories it names.

**The contract is generated from Zod and the generated file is checked in.**
`packages/contracts/src/**/schemas.ts` are the source, `openapi/v1.json` the build product,
regenerated with `openapi:write` and committed; `test/openapi-drift.test.ts` compares it **byte
for byte**, so never hand-edit it. The drift test cannot see strictness: `z.strictObject` and
`z.object` emit the same `additionalProperties: false`, so a schema that loses `strict` needs its
own runtime case. Gateway ports model failure **in the return type, not in
exceptions** (`GatewayResult<T>` = `{ ok: true, value }` | `{ ok: false, failure, problem }`), and
carry deliberately **no `loading` state**.

**Modules are hexagonal and their names are frozen.** Each module under
`apps/api/src/modules/<slug>/` splits into `domain/` (pure), `application/` (ports),
`infrastructure/` (adapters) and `interface/http/`. `MODULE_SLUGS` in
`src/modules/module-catalogue.ts` is the one frozen list of **eleven** slugs (`tenancy`,
`workforce`, `worksites`, `planning`, `resources`, `timekeeping`, `communications`, `weather`,
`files`, `audit`, `costs`); directory, registry entry and type parameter are one string. Only the
**five** in `SCAFFOLDED_MODULES` (`workforce`, `worksites`, `planning`, `costs`, `tenancy`) have
directories today, and for those it demands real files per layer — which keeps
`architecture.test.ts` non-vacuous; the other six are reserved names, not empty folders.
Cross-module access goes **only through the module's `index.ts`** (`module-public-api-only`), and
that includes tests: a new module file without a barrel export has no writable test.

**One connection owner, three statements per transaction.**
`src/platform/database/tenant-query-runner.ts` is the only file allowed to hold `pg` — the rule
`api-dependency-allowlist` permits the driver exclusively under `apps/api/src/platform/`, so no
module can route a query past transaction boundary, role switch and RLS. Each run is one
transaction: (1) `set_config('request.jwt.claims', …, true)`, transaction-local because the
transaction pooler survives nothing else; (2) `set local role authenticated` (`easytree_app` is
`NOINHERIT`, so without the switch a query fails "permission denied" instead of returning
everything); (3) the body. This layer sets context, it does **not** decide: authorization belongs
in the module's application layer, RLS is defense-in-depth. Repositories see only the
`TenantQuery` interface, **never a driver type**.

**The read path is proven end to end, not assembled from unit tests** (EYT-50): browser →
Route Handler → NestJS → `TenantQueryRunner` → RLS → PostgreSQL in
`scripts/read-through-harness.sh`, with only the subject resolver and access policy substituted (harness built via
`pnpm --filter @easytree/api run build:harness`). It is **one** script rather than several
workflow steps because a `trap` covers only its own process, and it waits for a **response** plus
`kill -0`, never a fixed `sleep`.
Readiness is indicator-based: `src/health/readiness.ts` defines `ReadinessIndicator` and the
`DATABASE_PING` token — production wires the real `SELECT 1`, tests override the token via DI.
`/health` = liveness, `/ready` = 503 when any indicator is down;
`CorrelationIdMiddleware` echoes or creates `x-correlation-id`, and `HttpExceptionFilter` emits
RFC-7807 JSON without stack traces or secret values.

**Multi-tenancy is enforced in the database.** Every tenant-owned table carries `org_id NOT NULL`,
and composite `unique (id, org_id)` targets make tenant-bound FKs possible, so a cross-tenant
reference fails at FK level (23503) independent of RLS. Identity comes only from the verified JWT
(`app.current_user_id()` / `app.user_org_ids()` — `security definer`, `search_path = ''`, active
memberships only; every new security-definer function needs the same), and normal runtime
credentials must never bypass
RLS.

## Non-negotiable rules

- **SQL migrations under `supabase/migrations/` are the only schema source.** Schema changes
  via the Supabase dashboard/Studio are forbidden, including "just to try it". Merged
  migrations are append-only — fix forward with a new migration, never edit or delete.
  `supabase/seed.sql` holds synthetic data with fixed UUIDs only; it is dev data, was **not**
  applied to production, and must never be applied there. Definition of done: two
  consecutive `db reset` runs plus green `supabase test db`. Filenames follow
  `<timestamp>_NNNN_<slug>.sql` (`20260723222457_0002_tenancy.sql`); `supabase migration new`
  emits only the timestamp, so **rename the new file to continue the `NNNN` sequence**. See
  [`docs/runbooks/database-workflow.md`](docs/runbooks/database-workflow.md).
- **Tests fail closed.** Tenant suites read `EASYTREE_TENANT_TESTS`: `local` (default) skips
  with a warning on an unreachable DB; `required` (CI job `db-gates`) errors on an unreachable
  DB and on _any_ skip. Each run prints a greppable `[tenant-isolation] mode=… executed=…
skipped=…` line that CI asserts. `apps/api/test/tenant-gate.fail-closed.test.ts` proves the
  gate itself. Never add a skip/fallback that can turn a mandatory check green.
- **Never claim done on local evidence alone.** Evidence hierarchy: executed CI run > local
  run > subagent report > plan; say which level you have. Before calling a ticket finished,
  check its acceptance criteria verbatim against an artifact and grep the deliverables for
  `offen|TODO|TOOL_GAP|FIXME` — a hit is a blocker. (Rules 1–5 of
  `docs/retros/2026-07-24-sprint-1-modell-retrospektive.md`.)
- **Environment files are never committed** — only `.env.example` with placeholders. The
  `secret-scan` CI job fails on tracked `.env*`/`.pem`/`.key` files and runs pinned gitleaks.
- **No destructive migrations without an approved rollback and restore evidence; no
  production deploy or change without explicit permission.**
- Out of scope unless the user explicitly opens that phase: the Post-MVP
  Planungsökonomie/Maschinenverleih module, payroll, invoicing, continuous GPS, geofencing,
  automatic weather-based work-stop decisions. Never log private origins, medical details,
  credentials, tokens, or raw audio.

## CI

`.github/workflows/ci.yml` runs on every PR. **Eleven** jobs on `master`: `format`, `lint`,
`typecheck`, `unit-tests`, `build-web`, `web-smoke`, `build-api`, `secret-scan`, `db-gates`,
`read-through`, `auth-journey`. None uses `continue-on-error`, and all eleven are required status
checks in ruleset `19718704` (`enforcement: active`, `bypass_actors: []`). Re-check read-only with
`bash scripts/verify-branch-protection.sh`, which reads GitHub's _effective_ rules; "applies to
admins too" is **inferred** from `bypass_actors: []`, not measured. A second workflow,
`release-images.yml`, runs on every push to `master` (and by hand) and pushes both container
images to `ghcr.io/<owner>/easytree-{api,web}` tagged with the commit SHA and `master` — it is not
a status check.

`auth-journey` is the only job that proves IDENTITY: real `dist/main.js`, real GoTrue signup, real
cookies. `read-through` substitutes `REQUEST_IDENTITY` and proves the data path, never the login —
do not cite it as evidence that authentication works.

`scripts/setup-branch-protection.sh` aborts if `ci.yml` has a job that isn't in the
required-checks list, and `scripts/verify-branch-protection.sh` keeps a **second, independent
copy** of that list on purpose. **A new CI job means editing both lists**: update only one and
`verify` aborts with an internal drift error instead of the real ruleset state; update neither and
the job silently becomes optional.

`db-gates` is the heavy one: real Supabase stack, a meta-gate counter-probe (a deliberately open
table the suite must go red _naming_), and the tenant gate against a direct connection **and** the
transaction pooler. Every gate asserts its own greppable
`[…] mode=required executed=… skipped=0` line
([`docs/runbooks/database-workflow.md`](docs/runbooks/database-workflow.md)). **Read the gate
LINES, not the green tick**, and read the job, not this file, for which gates exist. A red
`db-gates` names the failing step, but everything **after** it is `skipped` and unproven.

## Deployment — Container first (Entscheidung 21.08.2026)

Kanonisch ist Confluence **"EasyTree – Deployment-Entscheidung 21.08.2026: VPS + Coolify +
Docker"** (Seite 30998530): **primär eigener VPS mit Coolify und Docker/OCI, sekundär Railway,
Cloudflare Workers ist kein Zielruntime mehr.** Coolify ist Orchestrator, nicht Facharchitektur;
die Cloudflare-Artefakte (`build:cf`, `cf:dry-run`, `wrangler.jsonc`) fallen erst nach belegter
Container-Parität (EYT-149).

Beide Workloads werden aus dem Wurzelverzeichnis gebaut (`apps/api/Dockerfile`,
`apps/web/Dockerfile`, `docker-compose.yml`). Der Outbox-Worker benutzt **dasselbe** API-Image mit
`node dist/worker.js`. Nur `web` veröffentlicht einen Port. Beide Images laufen als `node`, nicht
als root, und tragen den Commit als OCI-Label `org.opencontainers.image.revision`. Das Web-Image
baut mit `EASYTREE_NEXT_OUTPUT=standalone` — `lib/next-output.ts` akzeptiert nur diesen Wert oder
leer, und `outputFileTracingRoot` ist die Workspace-Wurzel, damit die Workspace-Pakete im
Standalone-Bundle landen.

**`EASYTREE_API_PROXY_TARGET` ist LAUFZEIT-Konfiguration (EYT-126)** — der Proxy liegt in Route
Handlern, nicht in `rewrites()`. **Das Web-Image ist damit weder an ein Ziel noch an einen
Anbieter gebunden**: derselbe Digest bedient nacheinander verschiedene APIs, und es gibt kein
`--build-arg` mehr.

Fail-closed an zwei Stellen: `instrumentation.ts` prüft das Ziel beim Serverstart,
`lib/proxy-durchreichen.ts` bei jeder Anfrage. Danach antwortet Next auf **jeder** Route mit 500;
der Prozess hält den Port, der Container gilt als `unhealthy`. **Behaupte nicht, der Container
starte nicht.**

**Zwei nicht wiederholenswerte Sackgassen:** eine Next-16-`proxy.ts` (Node-Middleware) sendet
`x-middleware-rewrite: <interne Adresse>` an den Browser — nicht entfernbar, ohne die
Weiterleitung abzuschalten —, und `@opennextjs/cloudflare` bricht daran ab (`Node.js middleware is
not currently supported`), was `build-web` rot machen würde. Edge-Middleware scheidet aus, weil
dort `process.env` beim Bauen eingebacken wird.

**Gesucht wird die Adresse, nicht das Wort.** In `lib/proxy-durchreichen.ts` fällt **jeder**
Antwortkopf, dessen **Wert** die interne Adresse nennt, ersatzlos weg; ein absoluter
`location`-Kopf auf das Ziel wird relativ gemacht; externe Redirects, fremde Adressen und
mehrfache `Set-Cookie` bleiben unangetastet; ein Verbindungsfehler wird ein 502 ohne Hostnamen.
Verglichen wird über die Origin, die Autorität `host:port` nur an einer Zeichengrenze, der nackte
Hostname nur als **ganzer** Wert — ein Teilstringvergleich verschluckte bei `http://api:3001`
sonst `X-Api-Version: 1`.

`scripts/smoke-container.sh` läuft am Ende von `db-gates` (ein eigener Job wäre kein Pflichtcheck,
solange das Ruleset nicht neu angewendet wird) und meldet `[container-smoke] mode=… skipped=0`;
Die Stub-Container senden nachweislich sowohl den leckenden als auch die harmlosen Koepfe; sonst
waere weder die Abwesenheit der einen noch die Anwesenheit der anderen ein Nachweis. Pruefumfang:
[`docs/runbooks/staging-deploy.md`](docs/runbooks/staging-deploy.md).

**Staging läuft seit dem 24.08.2026 auf dem VPS** (`srv1308064.hstgr.cloud`, Coolify-Service
`easytree`/`staging`, zieht die GHCR-Digests aus `release-images.yml` statt zu bauen):
`BLOCKER_ENVIRONMENT_SEPARATION` ist dort durch eine **VPS-lokale** Supabase-CLI-Datengrenze
ohne Cloud-`project_ref` aufgelöst — owner-freigegeben, Produktionsdaten unberührt. **Für ein
cloudseitiges Staging gilt der Blocker fort:** es gibt kein zweites Supabase-Cloud-Projekt, und
die Free-Quota zählt **pro Nutzer** über alle Organisationen (ein pausiertes Projekt zählt nicht
mit, das pausierte „Bazodiac“ zu löschen hilft also nicht)
([`docs/plans/2026-08-20-sprint-6-staging-blocker.md`](docs/plans/2026-08-20-sprint-6-staging-blocker.md)).
Drei Messungen, die den ersten Deploy gekostet haben: **Staging nur über HTTPS abnehmen** — über
plain HTTP scheitert jeder Browser-Schreibvorgang still an `crypto.randomUUID` (kein Secure
Context; Lesen und Login gehen, `pageerror` im Trace lesen, nicht den Server verdächtigen), und
die Staging-Suite verweigert eine Nicht-HTTPS-`EYT_STAGING_URL`. Veröffentlichte Planversionen
sind per Trigger auch für Superuser unveränderlich — Journey-Wochen sind Verbrauchsmaterial,
„zurücksetzen“ heißt neue Woche oder voller `db reset`. Und der Rollback ist als Coolify-Stop →
`docker start` des Vorgängers → Coolify-Start **geübt**, Coolifys eigene Redeploy-Historie noch
nicht. Protokoll und Abweichungen (API im `development`-Preset, Host-Netz für API/Worker):
`docs/plans/2026-08-24-vps-staging-deploy-protokoll.md`, Evidenz
`docs/evidence/2026-08-25-eyt-142-staging/`. Der Demo-Mandant kommt aus
`scripts/ops/bootstrap-demo-tenant.mjs` (idempotent, `--verify`); Stundensätze entstehen
ausschließlich über die Oberfläche.

**Railway bleibt Sekundaerziel — und dort laeuft gerade nichts.** Gemessen 23.08.2026 antworten
`/`, `/health` und `/ready` unter `easytree-production.up.railway.app` alle mit Railways
Edge-404 `{"status":"error","code":404,"message":"Application not found"}`; das ist die
Plattform, nicht die Anwendung. Ob der Dienst im Railway-Projekt noch existiert, ist **nicht**
gemessen. Der folgende Absatz ist die Messung vom 01.08.2026 und beschreibt, wie es lief:
die API lief als Dienst `EasyTree`
(Umgebung `production`, Domain `easytree-production.up.railway.app`); Builder ist Railpack, Bau-
und Startbefehl kommen aus `RAILPACK_BUILD_CMD` / `RAILPACK_START_CMD`, `PORT` = `API_PORT` = 3001.
`/health` und `/ready` sind die Betriebsendpunkte — **der Wurzelpfad `/` ist keine
Gesundheitspruefung**: dort ist ein 404 fuer einen reinen API-Dienst in Ordnung, ein 502 nicht.
Der Worker ist bewusst **kein** Railway-Dienst, und die Web-App ist nicht gegen diese API
deployt. **Wieviele Migrationen auf der gehosteten Datenbank liegen, ist hier NICHT gemessen —
leite es nicht aus der Dateizahl ab.** Dateien zaehlen mit
`ls -1 supabase/migrations/*.sql | wc -l`; die Produktionsseite braucht ihren eigenen Blick in
`supabase_migrations.schema_migrations`.

Der direkte Supabase-DB-Host ist **IPv6-only**; dieser Mac hat keine IPv6-Route, Messungen dagegen
laufen über den VPS.

## Testing notes

- **Every test that asserts a _property_ needs a named counter-mutation that turns it red.**
  Without a concrete answer to "which deliberate mutation makes this test fail?", the test is
  execution evidence, not proof — and the mutation must be **executed**, not imagined. Prefer a
  **permanent scenario** (an open probe table, a foreign-tenant row, a stopped process) over a
  throwaway source edit: a mutation you reverted never runs again. Sprint 3 shipped nine green
  tests that measured nothing. Related traps: a Zod schema nobody `parse`s is a comment, an `as`
  cast under "validated" is erased at compile time, and `as unknown as SomeGateway` erases the
  port-completeness check, so a stub can miss a method with `typecheck` green. One gap stays open:
  a test written _after_ the code has no red phase, and nothing yet requires a substitute — this
  rule is the manual stand-in.
- **Architecture boundaries are enforced by a test, not by convention** (EYT-46).
  `apps/api/test/architecture.test.ts` runs the **eleven** rules in
  `apps/api/test/architecture/rules.ts` and extracts imports with `ts.preProcessFile`, because a
  regex would miss `export *`, dynamic `import()` and type-only forms. `domain-allowlist`,
  `ui-dependency-allowlist` (`packages/ui/src` may import react and relative paths only — a
  primitive gets its link element, formatter or data as a prop) and `feld-shell-boundary` (the
  Feld shell may reach react, next, `@easytree/ui`, `@easytree/contracts` and named `lib/`
  infrastructure, never Werkbank components) are **allowlists** — a blocklist cannot express a
  universal ban. Each rule asserts it saw ≥1 file, and the scope assertions inventory the
  directories independently, so a rename or bad glob turns the suite red instead of silently
  green. It runs inside the existing `unit-tests` job — deliberately **no new required check**, so
  the ruleset needs no admin re-apply. `architecture-red-case.test.ts` proves each rule fires,
  against a synthetic tree in `os.tmpdir()` — **never the real one**. Generated build output
  (`.open-next/`, `.wrangler/`) must stay excluded from every tree-scanning guard,
  ESLint and Prettier alike.
- **Domain invariants are covered by a registry** (EYT-61 AC1):
  `apps/api/test/domain-invariants/registry.ts` names every invariant with the positive _and_
  negative test that proves it, and the coverage test goes red on a missing, non-existent or
  renamed entry. Every rule needs **both** directions — only `konstante` may skip the negative. The
  registry lives under `apps/api/test/` and not in `packages/domain`, because that package sets
  `"types": []` by design; giving it Node types to read files would breach the very wall it is. "Negative" means a case that would **disprove** the invariant, not just one
  expecting an error.
- **Property tests use fast-check with a fixed seed**, so a red CI run reproduces locally and
  reports the shrunk counterexample plus `seed` and `path`. It is a **devDependency only** —
  `domain-allowlist` scopes to `packages/domain/src/`, so the package stays dependency-free.
  Under five parallel vitest processes those runs exceed 5000 ms and `turbo run test` stops at
  the first red package, leaving `api`/`web` unmeasured — locally use `--continue --concurrency=1`.
- **The DST-gap test is a static guard, and honestly labelled as one**
  (`apps/api/test/no-local-time-construction.test.ts`): nothing here builds an instant out of
  wall-clock parts, so the missing hour cannot arise and cannot be "covered". The moment an input
  field accepts local time it fails, and whoever adapts it must decide what "02:30 on 29 March"
  means.
- **Module table ownership is documentation, not enforcement.** At runtime there is one
  application role (`authenticated`) and RLS filters by tenant, not by module — do not report
  ADR-001's "Tabellenbesitzregeln werden in CI geprüft" as satisfied.
- Vitest per package (`test/**/*.test.ts(x)`; files without that suffix are helpers, not suites).
  `apps/api` transforms with **SWC** — NestJS needs legacy decorators and `design:paramtypes`;
  `apps/web` and `packages/ui` run in jsdom with `oxc.jsx.runtime = "automatic"`. In jsdom
  `import.meta.url` is not a `file://` URL, so build file paths from `process.cwd()` (= the
  package), and vitest swallows `console.log` unless `--disableConsoleIntercept` is set — put
  measured counts into the assertion, not into a log line. Playwright (`apps/web/e2e/`) runs
  against the production build, is not part of `pnpm test`, and starts its own server — port
  3000 must be free; a fresh worktree has no Playwright browsers (100 % red = missing binary,
  not a regression), and removing a `data-testid` breaks a journey that only CI runs — grep
  repo-wide first.
- `scripts/smoke-worker.sh` distinguishes three states (EYT-70): a listening socket belongs to the
  worker (red), the check ran and found none (green), or **the check could not run at all (red,
  not "no listener")**. `EASYTREE_SMOKE_PROBE_PID` and `EASYTREE_SMOKE_FORCE_PROBE` keep the red
  case reproducible. Probes run in order `/proc`, `lsof` (macOS/BSD), `ss`. The end-to-end smoke
  needs a reachable database, so on a machine without a Supabase stack only `db-gates` exercises
  the full path.
- Automated a11y lives in `apps/web/test/a11y.test.tsx` (jsdom + axe), the browser axe runs in
  `shell-smoke.spec.ts`, `read-through.spec.ts`, the auth journey and the staging journey.
  Items 1–6 of `docs/runbooks/a11y-checklist.md` are regression-guarded; item 7 (screenreader
  smoke) needs a human with assistive tech — no "accessibility fully verified" claim is available
  yet. Two jsdom traps: `EmptyState`/`LoadingState` carry `role="status"`, so a
  `findByRole("status")` in the same view is ambiguous — anchor on named elements; and
  `document.activeElement` is not `:focus` for date/time inputs.

## Conventions

- TypeScript is strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `module: NodeNext`. ESM packages (`config`, `ui`) need `.js` on relative
  imports.
- Commits: conventional prefix + Jira ID, e.g. `feat(ci): EYT-67 …`.
- **Three delivery checks, one command each.** (1) After a scripted text replacement, grep the
  _result_ — the exit code says nothing about whether the pattern still matched. (2) Stage named
  files, then read `git diff --cached --name-only` — a directory-wide `git add` sweeps in
  untracked noise. (3) Read the gate output before `git push`; `vitest` alone misses a type error
  in a test file. All three otherwise produce false claims in commit messages and PR bodies,
  later read as evidence.
- Docs and most code comments are German; the PRD/handoff artifacts are the exception. Match the
  surrounding language.
- `packages/shared` is forbidden (ADR-001) — share only via stable, named packages.
- Four `docs/` documents also exist as **tracked** root copies (measured 23.08.2026 — they are in
  every clone, not just this tree), so a root-level grep returns doubled hits. Three pairs are
  byte-identical; the one that **diverges** is `agent_handoff_v1.3.md` (33 lines against 171) —
  and it is the stale side, still naming `DYAI2025/Arborga.git` as the canonical repository,
  which ADR-002 replaced. Cite the `docs/` file, never a root copy. Two more untracked root dirs: `penpot/` is a separate upstream git clone (design
  tooling, **not project source**) and `_sprint2-transfer/` holds git bundles. Both **are**
  covered by `.gitignore` and therefore by Prettier — they are not the source of local format
  noise (_Commands_). **The tracked `docs/` file is authoritative** — never edit or cite one.
- `docs/context/.active-feature` is a Plumbline scope marker and is **armed** (it names a
  feature). The operator-side Plumbline hook reads it and blocks shell commands outside the
  declared scope — a stale marker silences the shell without saying why, so check it before
  suspecting the tooling. `scripts/plumbline-scope-guard.sh` is the repo-side fail-closed checker
  (exit 3 = violation, 4 = cannot run safely; `--self-test` runs its own counter-mutation).

## Compact Instructions

These survive verbatim, or the next turn works blind:

- **The open ticket IDs** (`EYT-…`) and which acceptance criteria are evidenced, which are not.
- **The exact head SHA and branch.** Merge approvals are SHA-bound: any commit after an approval
  invalidates it.
- **Which CI run was measured, by id and at which head** — and whether commits landed since,
  which would mean it no longer covers the head.
- **Which counter-mutation is still outstanding**, and for each one done: that it was executed,
  went red, and was reverted (scoped `git diff` on the mutated file).
- **The evidence level of every claim carried forward** (executed CI run > local run > subagent
  report > plan). A claim without its command is not a result.
- **Named blockers still open** (e.g. `BLOCKER_ENVIRONMENT_SEPARATION` for cloud staging) and
  what the user has and has not approved.

Drop instead: the narrative of what was tried, output already condensed into a number, and any
"looks correct" verdict — re-measure it.

## Projektgedaechtnis

`~/.claude/projects/-Users-benjaminpoersch-EasyTree/memory/MEMORY.md` indexiert die **gemessenen
Fallen und Werkzeugverhalten** dieses Projekts — was einmal Zeit gekostet hat und sonst wieder
zuschlägt (still grüne Filter, Turbo-/vitest-/pgTAP-/Supabase-/`gh`-Eigenheiten, Messfehler).
**Produktwissen gehört nicht dorthin:** Scope, Architektur, Entscheidungen und Autoritäten stehen
in `docs/` (MVP-Scope in Confluence) und werden von dort zitiert.
