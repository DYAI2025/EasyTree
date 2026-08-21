# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

easyTree (product name "Arboscus Teamplaner") — a multi-tenant crew/site planner for the
tree-care industry. TypeScript pnpm + Turborepo monorepo implementing the **split monolith**
from [`docs/architecture/ADR-001-boilerplate-architecture.md`](docs/architecture/ADR-001-boilerplate-architecture.md).
Read ADR-001 before any structural change — it is the binding architecture contract.

**Every versioned document in this repo is v1.3.** Older revisions (v1.0/v1.1/v1.2) were removed
on 2026-07-26 — if you find a reference to one, it is stale, and the v1.3 file is authoritative.

Two layers of documents, deliberately not the same thing:

- **Repo root** — raw generator artifacts, large and unedited: `prd_report_v1.3.{md,json}`,
  `arboscus_teamplaner_finale_prd_de_v1.3.md`, `traceability_matrix_v1.3.csv`,
  `prd_validation_summary_v1.3.txt`.
- **`docs/`** — curated, human-maintained condensations of the same material. These are what you
  read and cite: `docs/prd/CURRENT_PRD_v1.3.md`, `docs/traceability/REQUIREMENT_TO_JIRA_v1.3.csv`,
  `docs/validation/PRD_VALIDATION_v1.3.md`.

Product source of truth is `docs/prd/CURRENT_PRD_v1.3.md`. The root artifacts above are generator
and validation evidence, not a competing authority — where they disagree with the curated PRD,
the PRD wins and the divergence is a defect. Architecture is split across three documents,
none of which supersedes another: [ADR-001](docs/architecture/ADR-001-boilerplate-architecture.md)
(boilerplate — the binding contract), `docs/architecture/ARCHITECTURE_DECISIONS_v1.3.md`
(provider, hosting, retention, pilot) and
[ADR-002](docs/architecture/ADR-002-integration-canonical-repo.md) (EYT-78 — this repo is the
one canonical product repository; "Arborga" is its **former name**, not a second repo, and
"Arboscus Teamplaner" is the product name while `easytree`/`@easytree/*` is the technical
namespace). Work is tracked as Jira `EYT-*` tickets; commits and code comments reference
those IDs.

**Für den MVP-Scope gilt zusätzlich Confluence PRD v1.4 (Seite 7766017, Stand 28.07.2026).**
Diese Seite ist die **fachliche Produktbaseline** und ersetzt v1.3 in §10 hinsichtlich MVP-Scope
und Phasen: „Die gesamte Planungsökonomie ist nicht mehr pauschal Post-MVP." Konkret führt v1.4
§7 **interne Kostensätze, Plan-/Ist-Kosten und den Excel-Export unter „Im MVP"**. Weiterhin
**Post-MVP** bleiben Maschinenverleiherlöse, Rechnung/Steuer/Zahlung/Buchung und Payroll — die
Grenze wird also enger gezogen, nicht aufgehoben. Grundlage: PO-Beschluss vom 30.07.2026
(`CONTRA-S5-001` = `FALSE_POSITIVE_SOURCE_SCOPE_ERROR` / `RESOLVED_NO_SCOPE_CHANGE`) und die enge
Sprint-6-Freigabe vom 18.08.2026 für den bereits implementierten EYT-109-Personalkosten-Snapshot.
v1.3 bleibt für alles Übrige die kanonische Repository-Autorität; v1.4 liegt in Confluence und
nicht in diesem Repository, weshalb diese Notiz existiert.

[`docs/handoff/AGENT_HANDOFF_v1.3.md`](docs/handoff/AGENT_HANDOFF_v1.3.md) holds the agent
guardrails: required working method, prohibited actions, evidence rules, stop conditions and the
human review checkpoints. **Read it before changing code** — the rules below are a summary of the
parts that bite most often, not a replacement. Its mandatory sections are guarded by
`apps/api/test/handoff-guardrails.test.ts`, because they were once removed without anyone
noticing (EYT-89).

## Where the work is tracked

Jira project `EYT`, board 72 — https://dyai2026.atlassian.net/jira/software/c/projects/EYT/boards/72
Reach it with the `claude_ai_Atlassian` MCP tools (`searchJiraIssuesUsingJql`, `getJiraIssue`,
`transitionJiraIssue`). The `/jira-automation` skill documents Rube MCP, which is **not**
connected here — use the native Atlassian tools instead. Do not trust the search `count` mode;
it has reported "8 not done" for a sprint in which all 8 were done. Query with `issues` mode
and read the statuses.

### Snapshot — 28.07.2026 (verify before relying on it)

Everything in this subsection is a point-in-time record and rots. Re-measure with
`gh pr view <n>`, `git rev-list --left-right --count origin/master...HEAD` and a Jira query
before acting on it. Do **not** use local `master` as the reference — compare against
`origin/master`.

- **`origin/master` tip is `205fb41`** (merge of PR #24, Sprint-2 retro hardening: EYT-89,
  EYT-70, EYT-71, EYT-90). Master has **nine** CI jobs; `read-through` exists only on the
  branch below.
- **Sprint 3 merged to master:** EYT-86 (`c1dbf50`, org settings + workforce + audit outbox +
  catalogue meta gate), EYT-49 (`acccf3b`, planning invariants — no overlapping published
  assignments, published rows immutable), EYT-61 (`2f15770`, temporal edges + property tests +
  static no-local-time guard), EYT-50 part 1/2 (`5e07115`, `5f88703`, contract-derived client,
  branded idempotency key, tenant query runner).
- **PR #23 — `feat/eyt-50-read-through-slice`, still OPEN and Draft.** Head `a559df2`,
  **24 ahead / 0 behind `origin/master`**. Read-through slice: browser → Next rewrite → Nest →
  PostgreSQL, proven end-to-end in the `read-through` CI job against a real Supabase stack (ten
  jobs green on run `30300223577`, measured at head `3773ecf3` — **four commits have landed
  since, so that run no longer covers the current head**).
- **PR #25 was merged into PR #23's branch, not into master** (base `feat/eyt-50-read-through-slice`,
  merged 2026-07-28T00:45Z). It opens Sprint 4 as a Plumbline feature (planning draft +
  conflict slice) and adds `docs/vision/`, `docs/canvas/`,
  `docs/prd/planning-draft-conflict-slice.prd.md` and `docs/traceability.md`. Those last two sit
  beside the existing authorities `docs/prd/CURRENT_PRD_v1.3.md` and
  `docs/traceability/REQUIREMENT_TO_JIRA_v1.3.csv` — **which one wins is not yet decided; ask
  before citing either as source of truth.**
- **Commit `a559df2` ("WE") committed the working tree wholesale.** It tracked `.claude-flow/`,
  `.claude/homunculus/observations.jsonl` (~3000 lines of agent state), the whole of `docs/ux/`,
  the PDF, and the four root duplicate documents that the Conventions section below still
  describes as untracked. That section is therefore stale on that one point, and the duplicate-file
  warning matters more now, not less: the root copies are tracked but still not authoritative.
- **Open admin step (needs repository admin, cannot be done from here):**
  `DRY_RUN=true ./scripts/setup-branch-protection.sh`, then apply, then
  `./scripts/verify-branch-protection.sh` must show `enforcement=active`,
  `strict_required_status_checks_policy=true` and `read-through` among the required checks.
  Until that read-after-write exists, **do not claim `read-through` blocks a merge.** Measured
  27.07.2026, the verifier printed `FAIL AC3 — fehlende Pflichtchecks: read-through`.
- **EYT-91 (Bug, open) blocks closing EYT-50/EYT-62:** `supabase/seed.sql` uses IDs that
  `IdSchema` rejects as invalid UUID v4, so contract response validation returns 500 on seeded
  data. The e2e harness works around it with its own v4 fixtures
  (`apps/web/e2e/harness/seed.sql`) — that is a workaround, not the fix.
- **Sprint 4 is the open sprint** (measured against Jira 28.07.2026, `sprint in openSprints()`),
  and it holds exactly six issues: EYT-50 _In Arbeit_ (Story, vertical slice up to draft +
  conflict check), EYT-62 _In Arbeit_ (E2E proof), EYT-79 _In Arbeit_ (PlanningGateway),
  EYT-88 _Zu erledigen_ (Bug), EYT-91 _Zu erledigen_ (Bug), EYT-92 _Zu erledigen_ (Story,
  clickable week view). EYT-75/87/72/81/11 are **not** in the open sprint.
- **Correction (03.08.2026, measured on `origin/master` + EYT-107):** an earlier revision said
  "eight of the nine contract operations are still unimplemented". That count is stale. Measured
  now, `NOT_YET_IMPLEMENTED` holds **five** entries, all under `/einsatz/`, **four** of them
  waiting on the subject model from EYT-14 — `GET /einsatz/plan` gives its own reason (the
  employee read view, without which AK9 cannot be evidenced) and does not name EYT-14.
  Implemented are the planning window read, the draft validation, the
  assignment write and, since EYT-107, `POST /planung/versionen` (publish).
  **Correction (14.08.2026, measured on `feat/eyt-109-daily-plan-cost-snapshot`):** the contract
  now carries **19** operations, not nine. `NOT_YET_IMPLEMENTED` still holds exactly the same
  **five**, all under `/einsatz/`; the other **14** have routes — three under `/auth/`, four
  under `/planung/` and **seven under `/kosten/`** (`GET /kosten/mitarbeiter`,
  `/kosten/planversionen`, `/kosten/planversionen/{planVersionId}/baustellen`,
  `/kosten/snapshots/{snapshotId}`, `/kosten/stundensaetze/{employeeId}`, `POST /kosten/snapshots`,
  `POST /kosten/stundensaetze`). Count them from the artifact, never from this file. The list is
  not documentation — it is the
  `NOT_YET_IMPLEMENTED` map inside `apps/api/test/openapi-route-conformance.test.ts`, each entry
  carrying its reason, and the test fails both ways: a contract operation with neither a route
  nor an entry, **and** an entry for an operation that has since been implemented. Writes and
  the draft/conflict path are **EYT-50** (Story); three of the five additionally wait on the
  subject model from EYT-14. **Correction (28.07.2026, measured against Jira):** an earlier
  revision of this file said "writes and publish are EYT-88". That is false. **EYT-88 is the
  Bug "Planungswochen-Schlüssel erlaubt ungültige ISO-Wochen in Vertrag und Datenbank"** — the
  `^\d{4}-W\d{2}$` pattern accepts `W00`/`W54`/`W99`, to be fixed by a new forward migration
  plus one shared deterministic validator. **EYT-91** is the seed-UUID bug. Publish itself is
  explicitly deferred out of Sprint 4 ("Bewusst später" in EYT-50).

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
print `Cached: 10 cached, 10 total >>> FULL TURBO`, show a complete green summary — "1061
passed" — and have executed **not one package** (measured 08.08.2026). It bites hardest right
after a counter-mutation: reverting the file restores the pre-mutation cache key, so the very
run that is supposed to prove the test went red replays the green one. **Any number that is
meant to serve as evidence needs `pnpm exec turbo run <task> --force`** (or the direct package
call), **and a look at the `Cached:` line** — `0 cached` is the only value that proves the work
happened. Two further traps in the same family: the cache is shared across git worktrees, so a
"cache hit" can be a replay from a worktree where the task never ran at all; and a `vitest` path
filter that matches nothing exits 0 without having checked anything.

`pnpm build` at the repository root **used to fail and no longer does** (EYT-126). The old
reason was real: `apps/web` resolved `EASYTREE_API_PROXY_TARGET` inside `next.config.ts`
`rewrites()` at build time, Turbo's strict env mode stripped the variable, and the build
refused. Since the proxy moved into Route Handlers the build does not read that variable at
all. Measured 22.08.2026 with the variable explicitly unset:
`env -u EASYTREE_API_PROXY_TARGET pnpm build` → exit 0, `Tasks: 6 successful, 6 total`,
`Cached: 0 cached, 6 total` (so it really ran, it was not a replay). These two are green as
well, and neither needs the variable any more:

```bash
pnpm --filter @easytree/web... build
pnpm --filter @easytree/api... build
```

Two more local-only red herrings: `pnpm format` reports untracked working files that CI never
sees (scope it with `pnpm exec prettier --check apps packages docs`), and `.nvmrc` pins Node 22
while `engines.node` only says `>=22` — a local Node 24 therefore runs silently on a different
major version than every CI proof.

Six workspace packages — `@easytree/api`, `@easytree/web`, `@easytree/contracts`,
`@easytree/domain`, `@easytree/ui`, `@easytree/config`:

```bash
pnpm --filter @easytree/api test                       # whole package suite
pnpm --filter @easytree/api exec vitest run test/health.e2e.test.ts   # single file
pnpm --filter @easytree/api exec vitest run -t "returns 503"          # single case
pnpm --filter @easytree/web dev                        # Next dev server :3000
pnpm --filter @easytree/web run test:e2e               # Playwright (needs prior build)
pnpm --filter @easytree/api... build                   # package + its workspace deps
pnpm --filter @easytree/contracts run openapi:write    # regenerate openapi/v1.json
```

`typecheck`/`test` depend on `^build`, so a package consuming `@easytree/config`,
`@easytree/contracts`, `@easytree/domain` or `@easytree/ui` needs those built
(`pnpm --filter @easytree/config build`) before its tests resolve `dist/`.

Database (Docker required; Supabase CLI is a devDependency, always `pnpm exec supabase`):

```bash
pnpm exec supabase start                # local stack (API 54321, PG 54322, pooler 54329)
pnpm exec supabase migration new <name>
pnpm exec supabase db reset             # rebuild from migrations + seed.sql
pnpm exec supabase test db              # pgTAP (supabase/tests/*.sql)
pnpm exec supabase status               # local URLs/keys
```

Tenant suites take their connection from their own variables, not from `DATABASE_URL`:
`EASYTREE_TEST_DB_URL` (default `postgresql://postgres:postgres@127.0.0.1:54322/postgres`) and
`EASYTREE_TEST_POOLER_URL` (Supavisor; CI derives it from the running container, so locally you
must build it yourself — user `postgres.<pooler-tenant-id>`, port 54329). Against a running
stack, the **direct-connection half** of the CI gate is:

```bash
pnpm --filter @easytree/config build      # exec bypasses turbo's ^build; dist/ must exist
EASYTREE_TENANT_TESTS=required \
  pnpm --filter @easytree/api exec vitest run test/tenant-isolation.integration.test.ts
```

That is **not** the whole gate: `db-gates` also runs `test/tenant-pooling.integration.test.ts`
against the transaction pooler with `EASYTREE_TEST_POOLER_URL` set, and asserts a
`[tenant-pooling] mode=required executed=… skipped=0` line. Only the CI run covers both.

Runtime smokes and branch protection:

```bash
NODE_ENV=test API_PORT=3001 EXPECT_READY=200 DATABASE_URL=... SUPABASE_URL=... \
  SUPABASE_ANON_KEY=... bash scripts/smoke-api.sh    # boots dist, /health, /ready, SIGTERM
bash scripts/smoke-worker.sh                         # worker opens no port, shuts down clean
                                                     # (same strict test-preset env as above)
bash scripts/smoke-api-role-gate.sh                  # API must NOT start when the DB role cannot be
                                                     # verified as RLS-bound (EYT-45, fail-closed)
bash scripts/read-through-harness.sh                 # whole EYT-50 read path, Docker + browser (CI job)
bash scripts/verify-branch-protection.sh             # reads effective GitHub ruleset (gh CLI)
```

## Architecture

```
apps/api           @easytree/api       — NestJS, ONE code package, TWO entrypoints
apps/web           @easytree/web       — Next.js 16 App Router / React 19, mobile-first PWA shell
packages/contracts @easytree/contracts — transport contract: Zod schemas, gateway ports,
                                         generated openapi/v1.json  (EYT-47, EYT-79)
packages/domain    @easytree/domain    — framework-free core: types, invariants, state models
                                         (EYT-46, EYT-61)
packages/config    @easytree/config    — strict Zod env validation + secret redaction
packages/ui        @easytree/ui        — domain-free primitives (Button, Card, VisuallyHidden)
supabase/          config.toml, migrations (schema source of truth), seed.sql, pgTAP tests
docs/              ADRs, plans, runbooks, retros, traceability — mostly German
```

Declared workspace dependencies (`package.json`, verifiable): `api` → `config` + `contracts` +
`domain`; `web` → `contracts` + `ui`. **`contracts` and `domain` depend on no workspace package
at all** — `contracts` has only `zod`, `domain` has no runtime dependency whatsoever.

That `contracts` does not import `domain` is deliberate, not an oversight (see the file header
of `packages/contracts/src/planning/schemas.ts`): `domain` models `TimeInterval` as a **class
with private fields**, which cannot travel over the wire. `contracts` therefore carries its own
transport types and `apps/api` maps between the two. Do not "simplify" this by making the
contract reuse a domain class.

**Two entrypoints, one module graph** (ADR-001 §2): `apps/api/src/main.ts` boots `AppModule`
via `NestFactory.create` and listens on `API_PORT`; `src/worker.ts` boots the _same_
`AppModule` via `createApplicationContext` — identical DI and config, **no HTTP listener, no
port**. Anything added to `AppModule` lands in both processes. Both call
`enableShutdownHooks()`; the worker holds the event loop open with a `setInterval` so SIGTERM
can close it gracefully.

**Config is validated once, at bootstrap, and injected.** `packages/config` exports
`loadConfig(env)` with a `z.strictObject` per `NODE_ENV` — unknown variables are rejected so
typos fail loudly. `ConfigModule` (`apps/api/src/config/config.module.ts`) narrows
`process.env` to the keys in `ENV_VAR_META` before validating, then provides `AppConfig`
under the `APP_CONFIG` token. Presets differ deliberately: `development` has localhost
defaults, `test` has **no** connection defaults, `production` has no defaults _and_ rejects
localhost URLs. `ConfigValidationError` names variables only, never values — do not attach
the ZodError or log raw config; use `redact()`.

The canonical variable set is exactly seven: `NODE_ENV`, `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `API_PORT`, `LOG_LEVEL`, and since EYT-106 `DATABASE_SSL_ROOT_CERT`
(secret; **required in `production`**, optional in `development`/`test`; accepts raw PEM,
PEM with literal `\n`, or base64 — normalized once in `packages/config/src/certificate.ts`).
Because the schema is strict _and_ the `test` preset has no defaults, **adding or renaming
one touches every site below** — miss any and the build or a whole suite fails:
`packages/config/src/schema.ts` (`ENV_VAR_META` _and_ all three presets _and_ the
`AppConfig` interface), the mapping at the end of `packages/config/src/load.ts`,
`apps/api/test/setup.ts` (sets every mandatory variable explicitly), `.env.example`, and
the `env:` blocks of the `db-gates` job in `.github/workflows/ci.yml` plus
`scripts/smoke-api.sh` / `scripts/smoke-worker.sh`. A secret variable additionally needs its
camelCase key in `SECRET_CONFIG_KEYS` (`redact.ts`) — `redact.test.ts` couples that list to
`ENV_VAR_META` and goes red if you forget. `EASYTREE_*` variables are _not_ part of this
set — they steer tests, never the app, and must never enter `ENV_VAR_META`.

**PostgreSQL connections are built in exactly one place** (EYT-106, fix(deploy)):
`apps/api/src/platform/database/pg-connection.ts`. With a root certificate the factory
returns `ssl: { ca, rejectUnauthorized: true }` and strips the **entire query** from
`DATABASE_URL` — measured 31.07.2026: pg 8.22 merges the parsed connection string OVER the
explicit `ssl` object (`Object.assign`), so `?ssl=no-verify`, percent-encoded names and
`?sslnegotiation=direct` defeat any parameter denylist. Never reintroduce SSL parameters in
`DATABASE_URL`, never build a `pg` config outside the factory — static guards in
`apps/api/test/pg-connection.test.ts` (including one asserting the EFFECTIVE pg config)
go red if you try.

**The login role is part of the security boundary** (EYT-107, migrations `0015`/`0016`).
Publishing a plan version is a domain command, not an ordinary table UPDATE — and the
database enforces that itself, because `supabase/config.toml` exposes schema `public` as a
PostgREST **Data API**. Three rules, all on `public.plan_versions`:

- `app.is_runtime_channel()` compares `session_user` against `easytree_app` and sits in
  **both** `using` and `with check` of the update policy. API and worker log in as that role
  and then `set local role authenticated`; `session_user` never changes. PostgREST logs in as
  `authenticator` and is not a member of `easytree_app` (measured 04.08.2026). Measured, not
  assumed: with the condition only in `with check` the attack is still refused — loudly
  instead of silently — so the two clauses are independent bolts, not a copy.
- Column grants, the same shape `assignments` got in `0010`: `update` reaches only
  `published_at`/`published_by`, `insert` only `(id, org_id, week_key)`, and there is no
  `delete` grant at all. A plan version is therefore **born a draft**.
- `app.reject_assignment_in_published_plan()` is `security definer` — a `select … for share`
  additionally checks the UPDATE policy's `using` clause, so an invoker read would have gone
  blind outside the runtime channel and silently disarmed the trigger.

Consequences worth knowing before you touch any of this: moving the app onto the Supavisor
transaction pooler makes `session_user` `postgres.<tenant>` and is **expected to break
publishing** — loudly, via the zero-rows exception in `planning-write.repository.ts` — and,
since migration `0018`, to break **creating cost snapshots** too, there via a typed
`WRITE_CHANNEL_REJECTED` return rather than a throw. Reading snapshots survives: the `_select`
policies carry no channel condition. All three statements are **derived** from `session_user`
plus the policies and are **not measured against a pooler connection** — pgTAP runs as
`postgres`, not `postgres.<pooler-tenant>`. And `service_role`/`postgres`
carry `BYPASSRLS`, so none of it constrains them. See
[`docs/runbooks/planning-publish.md`](docs/runbooks/planning-publish.md).

**Web never talks to Supabase or bare `fetch`.** Components get an `ApiClient` and — measured
14.08.2026 on `providers.tsx` — **three** gateways from React context: `PlanningGateway`,
`AuthGateway` and, since EYT-109, `CostsGateway` (`lib/api-client-provider.tsx`,
`lib/planning-gateway-provider.tsx`, `lib/auth-gateway-provider.tsx`,
`lib/costs-gateway-provider.tsx`), wrapped by `SessionProvider`. That provider does **not** hand
the selected organisation to the costs gateway itself: it _reports_ it upward via
`onOrganisationChange`, the composition root stores it in a ref (`providers.tsx:45,56-58`), and
the gateway reads that ref on **every** call to send `X-EasyTree-Organization-Id`. The handover
is therefore not synchronous — the report runs in a parent effect, so a costs request fired from
a child effect in the same commit goes out **without** the header. The single construction site
for all of them is the composition root `app/providers.tsx` (ADR-001 §5). `apps/web/test/no-supabase-import.test.ts` is a static
guard that fails if the Supabase JS SDK name appears anywhere under `apps/web` — that guard
string is assembled from parts on purpose, so don't "fix" it by inlining the literal.

**There is no `NEXT_PUBLIC_API_URL` any more** (removed in EYT-50) — do not reintroduce it.
The browser calls **relative** paths and `providers.tsx` passes the empty origin; the Route
Handlers under `apps/web/app/api/[[...pfad]]`, `app/health` and `app/ready` forward them
server-side to `EASYTREE_API_PROXY_TARGET`, read fresh on **every request** (EYT-126 —
`next.config.ts` no longer carries a `rewrites()` block). Two reasons, both deliberate: one
visible origin means the API needs no CORS and no extra public surface, and a `NEXT_PUBLIC_*`
value would be baked into the browser bundle at build time. `lib/api-proxy-target.ts` validates
that target strictly (absolute http/https, no credentials, no query/fragment, no trailing slash)
and has **no default in production** — `apps/web/instrumentation.ts` therefore refuses the
server start instead of silently proxying to localhost, which would look like an empty week in
the browser rather than an error. The single pass-through is `lib/proxy-durchreichen.ts`; it is
also the one place that keeps the internal address off the wire — no `x-middleware-rewrite`
exists, an absolute `location` header pointing at the configured target is rewritten to a
relative path (an external redirect is left alone), and a connection failure becomes a 502 that
names no host. Each gateway's URL is assembled in exactly one place — its own
factory — because the test that checks it must call the same function production does; an
earlier version built its own gateway and would have stayed green whatever `providers.tsx` did.
There are **three** such factories (`lib/planning-gateway-factory.ts`,
`lib/auth-gateway-factory.ts`, `lib/costs-gateway-factory.ts`), and measured 14.08.2026 only the
planning one is **asserted** by that test (`apps/web/test/api-base-path.test.ts`). Mind the
distinction: `buildCostsApiBaseUrl` and `buildAuthApiBaseUrl` are **executed** on every page
load — `app/layout.tsx` renders `<Providers>`, so every browser e2e run goes through them — but
**no test names them or says anything about the URLs they build**. Executed is not asserted; the
guarantee this paragraph describes does **not** hold for those two yet (EYT-109 Task 16, open).

**The contract is generated from Zod, and the generated file is checked in.**
`packages/contracts/src/**/schemas.ts` are the source; `packages/contracts/openapi/v1.json` is
the build product, regenerated with `pnpm --filter @easytree/contracts run openapi:write` and
committed so reviewers can read the diff. `test/openapi-drift.test.ts` compares the serialized
document **byte for byte** against the committed file — change a schema without regenerating and
it goes red (EYT-47 AC 4). `apps/api/test/openapi-route-conformance.test.ts` checks the Nest
routes against the same document. Never hand-edit `v1.json`.

**Gateway ports model failure in the return type, not in exceptions.**
`packages/contracts/src/gateway.ts` returns `GatewayResult<T>` — `{ ok: true, value }` or
`{ ok: false, failure, problem }` with `failure` one of `UNAVAILABLE`, `CONTRACT_VIOLATION`,
`UNAUTHENTICATED`, `FORBIDDEN`, `STALE_VERSION`, `REJECTED`. Bare `Promise<T>` was rejected on
purpose: it would push error, empty and stale-version handling back into every component. There
is deliberately **no `loading` state** on the port — waiting on the promise _is_ the loading
state, so a `{ state: "loading" }` variant would never be observable; that belongs to the
component holding the promise.

**Modules are hexagonal and their names are frozen.** Each module under
`apps/api/src/modules/<slug>/` splits into `domain/` (pure), `application/` (ports), `infrastructure/`
(adapters) and `interface/http/` (controllers). `MODULE_SLUGS` in `src/modules/module-catalogue.ts`
is the one frozen list of **eleven** slugs (`tenancy`, `workforce`, `worksites`, `planning`,
`resources`, `timekeeping`, `communications`, `weather`, `files`, `audit`, `costs`) — the first ten
derived from ADR-001 Z. 60, `costs` added by ADR-003 (EYT-105). Measured 03.08.2026; an earlier
revision of this file said "ten slugs" and was stale. The
directory name, the registry entry and every type parameter are the same string. That list is
what stops `architecture.test.ts` from running vacuously: `SCAFFOLDED_MODULES` demands real files
per named module instead of counting whatever files a glob happens to find.

**One connection owner, three statements per transaction.**
`src/platform/database/tenant-query-runner.ts` is the only file allowed to hold `pg` — the rule
`api-dependency-allowlist` permits the driver exclusively under `apps/api/src/platform/`, so no
module can route a query past transaction boundary, role switch and RLS. Each run is one
transaction and sets, in this order: (1) `set_config('request.jwt.claims', …, true)` —
transaction-local, which is what `app.current_user_id()` / `app.user_org_ids()` read;
(2) `set local role authenticated` — `easytree_app` is `NOINHERIT` (migration `0003`), so without
the switch a query fails with "permission denied" rather than silently returning everything;
(3) the body. Transaction-local because the transaction-mode pooler survives nothing else —
proven in CI against a real Supavisor (`[tenant-pooling] …`). This layer sets context, it does
**not** decide: server-side authorization belongs in the module's application layer, RLS is
defense-in-depth. Repositories see only the `TenantQuery` interface, never a driver type.

**The read path is proven end to end, not assembled from unit tests** (EYT-50). Browser →
same-origin Next Route Handler (`lib/proxy-durchreichen.ts`; it was a `rewrites()` entry until
EYT-126) → NestJS → `TenantQueryRunner` → RLS → PostgreSQL, exercised by
`scripts/read-through-harness.sh` (CI job `read-through`) with `apps/web/e2e/read-through.spec.ts`.
Only the subject resolver and the access policy are substituted (`apps/api/test/harness/server.ts`,
built via `pnpm --filter @easytree/api run build:harness`); repository, runner, pool and controller
are the real ones. It is **one** script rather than several workflow steps because a `trap` only
covers its own process — split across steps, a failure in the last one would leave the API, the web
server and Docker running. It waits for a **response** plus `kill -0`, never a fixed `sleep`, so a
process that died at startup is reported as crashed instead of being polled until timeout.

**Readiness is indicator-based.** `src/health/readiness.ts` defines `ReadinessIndicator` and
the `DATABASE_PING` token; production wires `PgDatabasePing` (real `SELECT 1`), tests override
the token via DI. `GET /health` = liveness, `GET /ready` = 503 when any indicator is down.
Cross-cutting: `CorrelationIdMiddleware` echoes/creates `x-correlation-id`;
`HttpExceptionFilter` emits RFC-7807-shaped JSON with no stack traces or secret values.

**Multi-tenancy is enforced in the database.** Every tenant-owned table carries
`org_id NOT NULL`; composite `unique (id, org_id)` targets make tenant-bound FKs possible, so
a cross-tenant reference fails at FK level (23503) independent of RLS. Identity comes only
from the verified JWT via `app.current_user_id()` / `app.user_org_ids()` (security definer,
`search_path = ''`, active memberships only). Server-side authorization is primary, RLS is
defense-in-depth; normal runtime credentials must never bypass RLS. See
`supabase/migrations/20260723222457_0002_tenancy.sql` and
`docs/architecture/tenant-isolation-report.md`.

## Non-negotiable rules

- **SQL migrations under `supabase/migrations/` are the only schema source.** Schema changes
  via the Supabase dashboard/Studio are forbidden, including "just to try it". Merged
  migrations are append-only — fix forward with a new migration, never edit or delete.
  `supabase/seed.sql` holds synthetic data with fixed UUIDs only. Definition of done: two
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
`read-through`, `auth-journey` (job ids counted 03.08.2026 on `d9b9607`; an earlier revision said
"ten" and omitted `auth-journey`, which landed with EYT-106/EYT-134). None uses
`continue-on-error`.

`auth-journey` is the only job that proves IDENTITY: it starts the real `apps/api/dist/main.js`,
logs in through the real GoTrue signup and real HttpOnly cookies, and drives a second browser
context. `read-through` substitutes `REQUEST_IDENTITY` in its harness and therefore proves the
data path, never the login. Do not cite `read-through` as evidence that authentication works.

**A green job is not automatically a blocking job — but as of 14.08.2026 every one of them is.**
An earlier revision of this file said `read-through` "passes but is _not_ a required status
check" and that the verifier "currently prints `FAIL AC3 — fehlende Pflichtchecks:
read-through`". **Both statements are stale.** Measured 14.08.2026 with
`bash scripts/verify-branch-protection.sh` (read-only, reads GitHub's _effective_ rules):

```
PASS  AC3 — alle 11 Pflichtchecks sind als required_status_checks gesetzt.
PASS  AC3 — strict_required_status_checks_policy=true; der Branch muss vor dem Merge aktuell sein.
PASS  AC1 — kein Bypass-Akteur in allen 1 gelesenen Ruleset(s); die Sperre gilt auch fuer Repo-Admins.
=== Ergebnis: 0 offen, 1 uebersprungen ===
```

The ruleset was re-applied at some point after the note above was written; nobody recorded when.
So **all eleven** `ci.yml` jobs — `read-through` and `auth-journey` included — are required
status checks in ruleset `19718704` (`enforcement: active`, `bypass_actors: []`,
`~DEFAULT_BRANCH`), alongside `pull_request`, `non_fast_forward` and `deletion`.

That the gates actually block is measured, not assumed: negative PR #7 carried a
deliberately unformatted file → `format` failed, `mergeable_state` went to `blocked`, and the
merge attempt was rejected server-side with `the base branch policy prohibits the merge`
(EYT-67 AC 8; PR closed without merging). Re-check any time, read-only, with
`bash scripts/verify-branch-protection.sh` — it reads GitHub's _effective_ rules
(`GET /repos/{owner}/{repo}/rules/branches/{branch}`), not the intended config. Caveat: the
"applies to admins too" claim is inferred from `bypass_actors: []`, not measured — nobody has
attempted an `--admin` override merge, and doing so would land the bad commit on `master` if
the inference were wrong.

`scripts/setup-branch-protection.sh` aborts if `ci.yml` contains a job that isn't in the
required-checks list — **adding a CI job means updating that script and the runbook**, or the
new job silently becomes optional. `scripts/verify-branch-protection.sh` keeps a **second,
independent copy** of that list on purpose (a verifier reading the setter's list would confirm
the very drift it exists to catch), and guards it the same way. So a new job means editing
**both** lists: update only one and `verify` aborts with an internal drift error instead of
reporting the real ruleset state — which is exactly what happened when `read-through` was
added (fixed 27.07.2026).

`db-gates` is the heavy one: starts the real Supabase stack, resets twice, runs pgTAP twice,
proves the catalogue meta gate is not vacuous (creates a deliberately open table and requires
the suite to go red _naming that table_), resets again, drops and re-creates `easytree_app` to
prove the `create` branch of migration `0003`, restarts the stack to re-provision the Supavisor
tenant, then runs the tenant gate against both a direct connection and the transaction-mode
pooler (tenant id and port are derived from the running container, not hardcoded), then the
planning-invariants gate (EYT-49 — two real connections, because one session can show a
constraint _rejecting_ but not _serialising_), then the API/worker process smokes. Every gate
asserts its own greppable `[…] mode=required executed=… skipped=0` line.

That sentence names the first gates, not all of them. Measured 14.08.2026 the job has **32
steps** (30 with a `name:`, plus `actions/checkout` and `setup-pnpm`) and emits **13 gate
lines** — count the lines, not the steps, because one step can emit two (the EYT-108 step runs
both `rate-timestamp` and `rate-http-contract`, and the tenant gate appears twice: direct
connection and transaction pooler). On run `31759500751` (head `4e409fb`) they were:

```
[cost-access] [cost-snapshot] [planning-invariants] [planning-publish]
[planning-published-reads] [planning-write] [rate-http-contract] [rate-succession]
[rate-timestamp] [snapshot-http] [snapshot-immutability] [tenant-isolation] [tenant-pooling]
```

each `mode=required`, `passed=executed`, `skipped=0`. Read the job, not this paragraph, before
claiming what `db-gates` covers — and read the gate LINES, not the job's green tick. What a red
`db-gates` does and does not tell you, measured on two real red runs: the step list **does** name
the failing step (`23 failure — Kosten-Snapshot … EYT-138`), and `Tenant report -> step summary`
still runs because it carries `if: always()`. What is lost is everything **after** the red step —
those gates are `skipped`, so a red run says nothing about whether they would have held. Extract
the lines with:

```bash
gh run view <run> --log --job <db-gates-job-id> \
  | grep -oE '\[[a-z-]+\] mode=[a-z]+ executed=[0-9]+ passed=[0-9]+ skipped=[0-9]+' | sort -u
```

## Deployment — Container first (Entscheidung 21.08.2026)

Kanonisch ist Confluence **"EasyTree – Deployment-Entscheidung 21.08.2026: VPS + Coolify +
Docker"** (Seite 30998530): **primär eigener VPS mit Coolify und Docker/OCI, sekundär Railway,
Cloudflare Workers ist kein Zielruntime mehr.** Coolify ist Orchestrator, nicht Teil der
Facharchitektur. Die Cloudflare-Artefakte (`apps/*/wrangler.jsonc`, `apps/web/open-next.config.ts`,
die Schritte in `build-web`/`build-api`) bleiben vorerst stehen und werden erst nach belegter
Container-Parität entfernt — das ist EYT-149, nicht dieser Slice.

Beide Workloads werden aus dem Wurzelverzeichnis gebaut (`apps/api/Dockerfile`,
`apps/web/Dockerfile`, Topologie in `docker-compose.yml`), mit `pnpm install --frozen-lockfile`
und `corepack`. Der Outbox-Worker benutzt **dasselbe** API-Image und überschreibt nur das
Kommando mit `node dist/worker.js`. Nur `web` veröffentlicht einen Port; die API hängt am
internen Netz. Beide Images laufen als `node`, nicht als root, und tragen den Commit als
OCI-Label `org.opencontainers.image.revision`.

**`EASYTREE_API_PROXY_TARGET` ist LAUFZEIT-Konfiguration — gemessen 22.08.2026 auf Next 16.2.11
(EYT-126).** Der Same-Origin-Proxy liegt seit EYT-126 in Route Handlern
(`apps/web/app/api/[[...pfad]]`, `app/health`, `app/ready`), nicht mehr in
`next.config.ts`-`rewrites()`. Gemessen im Container-Smoke: **ein** Web-Image wurde einmal
gebaut, sein Digest festgehalten, und derselbe Digest zweimal gegen verschiedene APIs gestartet —
`ziel=http://easytree-stub-a:3001 -> {"stub":"easytree-stub-a"}`,
`ziel=http://easytree-stub-b:3001 -> {"stub":"easytree-stub-b"}`, und
`vorher=<digest> nachher=<digest>` identisch. **Das Web-Image ist damit weder an ein Ziel noch
an einen Anbieter gebunden** — dieselbe Datei und derselbe Startpfad bauen es für Coolify wie
für Railway, und es gibt kein `--build-arg` mehr, das sich unterscheiden könnte.

Eine früher hier stehende Messung (Build mit `http://buildtime-marker.invalid:9999`, Start mit
einem anderen Wert, HTTP 500 mit `ENOTFOUND`) **war korrekt** — sie galt dem `rewrites()`-Weg,
den es nicht mehr gibt.

Fail-closed bleibt es an zwei Stellen: `apps/web/instrumentation.ts` prüft das Ziel beim
Serverstart, und danach beantwortet Next **jede** Route mit 500 — auch `/` und `/anmelden`
(gemessen 22.08.2026, Container und `next start`). Der Prozess hält dabei den Port; er bedient
aber keinen normalen Anwendungsverkehr, und der Compose-Healthcheck auf `/` schlägt fehl, der
Container gilt als `unhealthy`. **Behaupte nicht, der Container starte nicht.**
`lib/proxy-durchreichen.ts` prüft zusätzlich bei jeder Anfrage.

**Zwei nicht wiederholenswerte Sackgassen, beide gemessen 21.08.2026:** eine Next-16-`proxy.ts`
(Node-Middleware) funktioniert zwar zur Laufzeit, sendet aber
`x-middleware-rewrite: <interne Adresse>` an den Browser — der Kopf lässt sich nicht entfernen,
ohne die Weiterleitung abzuschalten —, und `@opennextjs/cloudflare` bricht mit `Node.js
middleware is not currently supported` ab, was den Pflichtjob `build-web` rot machen würde.
Edge-Middleware scheidet aus, weil dort `process.env` beim Bauen eingebacken wird.

`scripts/smoke-container.sh` ist der Container-Smoke; er läuft am Ende von `db-gates` (kein
eigener Job — der wäre kein Pflichtcheck, bis jemand das Ruleset neu anwendet) und meldet
`[container-smoke] mode=required executed=… passed=… skipped=0`. Er prüft OCI-Label gegen den
Head, Nicht-root, `/health`, `/ready` mit echter Datenbank, den Weg Web→API über den
Dienstnamen, dass der Dienstname von aussen NICHT auflösbar ist, dass weder das ausgelieferte
HTML noch ein Client-Chunk noch ein Antwortkopf noch ein `location`-Kopf die interne Adresse
nennt, geheimnisfreie Protokolle, das Verweigern des Starts im Produktionsprofil ohne
`DATABASE_SSL_ROOT_CERT`, **ein Image gegen zwei Ziele bei unverändertem Digest**, das
Fail-closed-Verhalten bei fehlendem und bei ungültigem Proxyziel, und geordnetes Herunterfahren.
Lokal gemessen 22.08.2026: `[container-smoke] mode=local executed=24 passed=24 skipped=0`.
Runbook:
[`docs/runbooks/staging-deploy.md`](docs/runbooks/staging-deploy.md).

**Ein Deploy ist trotzdem gesperrt.** `BLOCKER_ENVIRONMENT_SEPARATION`: es existiert keine
EasyTree-Datengrenze, deren `project_ref` von `inypnrvpawvhgiyagxbd` verschieden ist
(nachgemessen 21.08.2026 über `list_projects` und `list_branches`). Der **kostenlose** Weg dorthin
ist zusätzlich versperrt: ein `create_project`-Versuch für `easytree-staging` (Kosten gemessen
0 $/Monat) wurde mit einem Quota-Fehler abgelehnt — die Free-Projekt-Quota zählt **pro Nutzer**
über alle Organisationen hinweg, in denen er Owner oder Admin ist, und `DYAI2025` hat sie mit zwei
aktiven Free-Projekten ausgeschöpft; das zweite ist über diesen Zugang nicht sichtbar. Ein
pausiertes Projekt zählt laut Supabase-Doku nicht mit, das pausierte „Bazodiac" zu löschen hilft
also nicht. Siehe
[`docs/plans/2026-08-20-sprint-6-staging-blocker.md`](docs/plans/2026-08-20-sprint-6-staging-blocker.md).

## Deployment (Railway) — measured 01.08.2026

- The API runs as Railway service `EasyTree` (project `EasyTree`, environment `production`),
  public domain `easytree-production.up.railway.app`. `/health` and `/ready` are the
  operational endpoints; the root path `/` is **not** a health check — a 404 there is fine
  for a pure API service, a 502 is not. The worker is deliberately **not** a Railway service
  yet, and the web app is not deployed against this API yet.
- Builder is Railpack; build and start commands come from the service variables
  `RAILPACK_BUILD_CMD` / `RAILPACK_START_CMD`. `PORT` = `API_PORT` = 3001.
- The direct Supabase DB host is **IPv6-only** (AAAA record, no A record). The service needs
  outbound IPv6 enabled, otherwise connections die with `ENETUNREACH`. This Mac has no IPv6
  route — measurements against that host run via the DYAI VPS.
- TLS chain verification runs against `DATABASE_SSL_ROOT_CERT` (Supabase Root 2021 CA,
  cryptographically verified against the live chain before use). See the config section
  above for why the factory strips the whole URL query.
- The hosted customer DB carried **twelve** migrations as of 01.08.2026 (`supabase db push
--db-url`, verified by reading `supabase_migrations.schema_migrations` — count 12) and the
  role `easytree_app` (NOSUPERUSER, NOBYPASSRLS, NOINHERIT, LOGIN; password provisioned out
  of band, stored nowhere but the Railway variable). On the hosted EasyTree customer
  project, measured on 01.08.2026, `postgres` was not a superuser but carried
  **BYPASSRLS** — the EYT-45 start gate refuses it by design, so `DATABASE_URL` must
  connect as `easytree_app`. `seed.sql` is synthetic dev data and was **not** applied
  to production.
- **That "twelve" is a dated measurement, not a current one, and the repository has moved past
  it.** Measured 14.08.2026: `origin/master` carries **17** migrations, and
  `feat/eyt-109-daily-plan-cost-snapshot` adds `0018_cost_snapshots` for **18**. How many of
  them are applied to the hosted DB is **not measured here** — do not infer it from the file
  count. Count the files with `ls -1 supabase/migrations/*.sql | wc -l`; the production side
  needs its own read of `supabase_migrations.schema_migrations`.
- Evidence for "it runs" (01.08.2026): single Nest boot, role gate passed, `/health` and
  `/ready` HTTP 200 with `database: true`, 11/11 probes over 5m20s Online, zero restarts,
  zero `self-signed` and zero pg SSL warnings in the deployment log.

## Testing notes

- **Every test that asserts a _property_ needs a named counter-mutation that turns it red.**
  Without a concrete answer to "which deliberate mutation makes this test fail?", the test is
  execution evidence, not proof. Prefer a **permanent scenario** in the suite (a deliberately
  open probe table, a foreign-tenant row, a stopped process) over a throwaway edit to source —
  a mutation you reverted never runs again. This rule exists because Sprint 3 shipped nine
  green tests that measured nothing (a conformance test that checked its own re-implementation;
  an idempotency test that asserted a constant stub; a base-path test that compared a constant
  to itself; a seed check that printed "KAPUTT" and exited 0). Seven were caught by review, not
  by the suite. Worked examples of the rule applied: `architecture-red-case.test.ts` and the
  meta-gate probe inside `db-gates`. Related traps: a Zod schema nobody `parse`s is a comment,
  and an `as` cast under the word "validated" is erased at compile time.
- Vitest per package; `test/**/*.test.ts(x)`. Files under `test/` without a `.test.ts` suffix
  (e.g. `tenant-context.helper.ts`, `test/architecture/{scan,rules}.ts`) are shared helpers,
  not suites.
- **Architecture boundaries are enforced by a test, not by convention** (EYT-46).
  `apps/api/test/architecture.test.ts` scans every `.ts(x)` under `apps/` and `packages/`,
  extracts imports with `ts.preProcessFile` (regex would miss `export *`, dynamic `import()`
  and type-only forms) and applies the rules in `test/architecture/rules.ts`. It runs inside
  the existing `unit-tests` job — deliberately no new required check, so the ruleset needs no
  admin re-apply. `domain-allowlist` is an **allowlist**: domain code may import only relative
  paths inside its own `domain/` layer plus `@easytree/domain`. A blocklist cannot express
  ADR-001's universal ban — `http`, `pg-pool`, `kysely/dist/esm/index.js`, `rxjs` and `typeorm`
  all slip past the obvious patterns. Scope is registry-driven via `SCAFFOLDED_MODULES`
  (`apps/api/src/modules/module-catalogue.ts`), and each rule asserts it saw ≥1 file, so a
  rename or a bad glob turns the suite red instead of silently green. `architecture-red-case.test.ts`
  proves each rule fires, against a synthetic tree in `os.tmpdir()` — never the real one.
- **Domain invariants are covered by a registry, not by a list of green tests** (EYT-61 AC1).
  `apps/api/test/domain-invariants/registry.ts` names every invariant and the positive _and_
  negative test that proves it; `domain-invariant-coverage.test.ts` measures four things: every
  value export of `@easytree/domain` appears in the registry, no entry names a non-existent
  export, every rule has both directions (only `konstante` may skip the negative), and each
  named test title occurs verbatim in the named file — so a rename or a deleted test goes red
  instead of silently green. A "negative test" here means a case that would **disprove** the
  invariant if it did not hold, not merely a test expecting an error. It lives under
  `apps/api/test/` rather than in `packages/domain` because that package sets `"types": []` and
  has no dependencies by design; giving it Node types to read files would breach the very wall
  the package is.
- **Property tests use fast-check with a fixed seed** (`packages/domain/test/*.property.test.ts`,
  EYT-61 AC7). Deterministic sweeps stay, but they never leave their own grid — the existing
  `time-interval` sweep never left August and said nothing about DST, year boundaries or
  millisecond edges. fast-check is a **devDependency only**: `domain-allowlist` scopes to
  `packages/domain/src/`, not `test/`, so the shipped package stays dependency-free. The fixed
  seed is the point — a red run in CI reproduces locally with no extra argument; when one fails,
  fast-check reports the shrunk counterexample plus `seed` and `path`.
- **The DST-gap test is a static guard, and honestly labelled as one**
  (`apps/api/test/no-local-time-construction.test.ts`, EYT-61 AC6a). The missing hour can only
  arise if something builds an instant out of wall-clock parts; nothing in the repo does — time
  enters as a UTC instant and is converted to a zone only for display (`Intl` with an explicit
  `timeZone`). So a test that "covers" the gap is not possible today; what is possible is
  ensuring the property is not lost unnoticed. The moment an input field accepts local time, that
  test fails, and whoever adapts it must decide what "02:30 on 29 March" means.
- **Module table ownership is documentation, not enforcement.** `TABLE_OWNERSHIP` records
  intent; at runtime there is exactly one application role (`authenticated`) and RLS filters by
  tenant, not by module, so any module's code can write any table inside its tenant. Do not
  report ADR-001's "Tabellenbesitzregeln werden in CI geprüft" as satisfied.
- `apps/api` transforms with **SWC**, not esbuild/oxc — NestJS needs legacy decorators plus
  `design:paramtypes` metadata (`apps/api/vitest.config.ts`).
- `apps/web` and `packages/ui` run in jsdom; web sets `oxc.jsx.runtime = "automatic"` because
  Next's tsconfig uses `jsx: "preserve"`.
- Playwright (`apps/web/e2e/`) runs against the production build (`next start` on 3000) with
  axe; it is not part of `pnpm test`. It starts that server itself
  (`reuseExistingServer: false`), so port 3000 must be free.
- `scripts/smoke-worker.sh` distinguishes three states (EYT-70): a listening socket belongs to
  the worker (red), the check ran and found none (green), or **the check could not run at all
  (red, not "no listener")**. Probes in order: `/proc` (authoritative for a process we started),
  `lsof` (macOS/BSD), `ss` (fallback). It no longer passes vacuously on macOS — `lsof` gives a
  real answer there, and a probe that errors or returns nothing fails the smoke. Two test hooks
  make the red case reproducible: `EASYTREE_SMOKE_PROBE_PID` checks one pid without starting a
  worker, `EASYTREE_SMOKE_FORCE_PROBE=proc|lsof|ss|none` forces a method. Caveat: the
  end-to-end smoke still needs a reachable database, because the worker refuses to boot without
  one — so on a machine with no Supabase stack, only `db-gates` exercises the full path.
- Automated a11y lives in `apps/web/test/a11y.test.tsx` (jsdom + axe) and, since Sprint 2, in
  `apps/web/e2e/shell-smoke.spec.ts` (real Chromium, CI job `web-smoke`). In
  `docs/runbooks/a11y-checklist.md`, items 1–6 are passed and regression-guarded; only item 7
  (screenreader smoke with VoiceOver/NVDA) is open — it needs a human with assistive tech, so
  no "accessibility fully verified" claim is available yet.

## Operator-side agent tooling (not part of this repo)

Two global Claude Code skills were re-triggered on 27.07.2026 after the Sprint 3 review found
that both already covered the failures but never fired — the gap was discovery, not content.
They live in `~/.claude/skills/` on Benjamin's machine, so a fresh clone elsewhere will not
have them; the rules they carry are duplicated above in _Testing notes_ and _Conventions_,
which is where this repo's copy of record is.

- `testing-anti-patterns` — now triggers when **writing** tests, not only when reviewing them.
- `verification-before-completion` — now triggers before **any push, commit or PR**, not only
  before a completion claim. (Its description was also truncated mid-word in the source file
  and has been repaired.)

Both were left content-unchanged. The one real gap remains open: a test written _after_ the
code has no red phase, and nothing yet requires a substitute for it — see the counter-mutation
rule under _Testing notes_, which is the manual stand-in.

## Conventions

- TypeScript is strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `module: NodeNext` (`tsconfig.base.json`). ESM packages
  (`config`, `ui`) need `.js` extensions on relative imports.
- Commits: conventional prefix + Jira ID, e.g. `feat(ci): EYT-67 …`, `test(web): … (EYT-41)`.
- **Three delivery checks, one command each — each of these failed twice in Sprint 3.**
  (1) After a scripted text replacement, grep the _result_; the script's exit code says nothing
  about whether the pattern still matched (Prettier had reformatted the target, the replacement
  silently did nothing, and the commit message claimed it anyway). (2) Stage named files, then
  read `git diff --cached --name-only` — a directory-wide `git add` twice swept in dozens of
  untracked `docs/ux/` files. (3) Read the gate output before `git push`; `vitest` alone is not
  enough, a type error in a test file only surfaces under `tsc`. All three produce false claims
  in commit messages and PR bodies, which are later read as evidence.
- Docs and most code comments are German; the PRD/handoff artifacts are the exception.
  Match the surrounding language of the file you're editing.
- `packages/shared` is forbidden (ADR-001) — share only via stable, named packages.
- Untracked working dirs at the repo root: `penpot/` is a separate upstream git clone (design
  tooling, not project source) and `_sprint2-transfer/` holds git bundles. Neither is
  prettier-ignored, so `pnpm format` locally may report files CI never sees — scope with
  `pnpm exec prettier --check apps packages docs` when that gets noisy.
- The working tree also carries **untracked root copies** of four documents that now live in
  `docs/`: `ADR-001-boilerplate-architecture.md`, `VALIDATION.md`, `agent_handoff_v1.3.md`
  (byte-identical to their `docs/` counterparts) and
  `jira_epic_post_mvp_planungsoekonomie_maschinenverleih.md` (**diverged** from
  `docs/backlog/post-mvp/jira_epic_planungsoekonomie_maschinenverleih.md`). A root-level grep
  therefore returns doubled hits; the tracked `docs/` file is authoritative in every case.
  Never edit or cite the root copies.
