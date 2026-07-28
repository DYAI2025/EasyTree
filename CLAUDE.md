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
the PRD wins and the divergence is a defect. Architecture is split across
[ADR-001](docs/architecture/ADR-001-boilerplate-architecture.md) (boilerplate) and
`docs/architecture/ARCHITECTURE_DECISIONS_v1.3.md` (provider, hosting, retention, pilot) — neither
supersedes the other. Work is tracked as Jira `EYT-*` tickets; commits and code comments
reference those IDs.

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

### Snapshot — 27.07.2026 (verify before relying on it)

Everything in this subsection is a point-in-time record and rots. Re-measure with
`gh pr view <n>`, `git log --oneline master..HEAD` and a Jira query before acting on it.

- **Sprint 3 in progress.** Merged this sprint: EYT-86 (`c1dbf50`, org settings + workforce +
  audit outbox + catalogue meta gate), EYT-49 (`acccf3b`, planning invariants — no overlapping
  published assignments, published rows immutable), EYT-61 (`2f15770`, temporal edges + property
  tests + static no-local-time guard), EYT-50 part 1/2 (`5e07115`, `5f88703`, contract-derived
  client, branded idempotency key, tenant query runner).
- **PR #23 — `feat/eyt-50-read-through-slice`, Draft, do not merge.** Head `3773ecf3`,
  18 ahead / 0 behind `master`. Read-through slice: browser → Next rewrite → Nest → PostgreSQL,
  proven end-to-end in the `read-through` CI job against a real Supabase stack. All ten jobs
  green on run `30300223577`.
- **Open admin step (needs repository admin, cannot be done from here):**
  `DRY_RUN=true ./scripts/setup-branch-protection.sh`, then apply, then
  `./scripts/verify-branch-protection.sh` must show `enforcement=active`,
  `strict_required_status_checks_policy=true` and `read-through` among the required checks.
  Until that read-after-write exists, **do not claim `read-through` blocks a merge.**
- **EYT-91 (Bug, open) blocks closing EYT-50/EYT-62:** `supabase/seed.sql` uses IDs that
  `IdSchema` rejects as invalid UUID v4, so contract response validation returns 500 on seeded
  data. The e2e harness works around it with its own v4 fixtures
  (`apps/web/e2e/harness/seed.sql`) — that is a workaround, not the fix.
- Ticket status at the time of writing: EYT-50 _In Arbeit_; EYT-62, EYT-88, EYT-91 _Zu
  erledigen_. Sprint 3 still open besides those: EYT-75, 87, 72, 81, 11.
- Eight of the nine contract operations are still `NOT_YET_IMPLEMENTED`; only the planning-window
  read is wired. Writes and publish are EYT-88.

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

Per package (`@easytree/api`, `@easytree/web`, `@easytree/ui`, `@easytree/config`):

```bash
pnpm --filter @easytree/api test                       # whole package suite
pnpm --filter @easytree/api exec vitest run test/health.e2e.test.ts   # single file
pnpm --filter @easytree/api exec vitest run -t "returns 503"          # single case
pnpm --filter @easytree/web dev                        # Next dev server :3000
pnpm --filter @easytree/web run test:e2e               # Playwright (needs prior build)
pnpm --filter @easytree/api... build                   # package + its workspace deps
```

`typecheck`/`test` depend on `^build`, so a package consuming `@easytree/config` or
`@easytree/ui` needs those built (`pnpm --filter @easytree/config build`) before its tests
resolve `dist/`.

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
bash scripts/verify-branch-protection.sh             # reads effective GitHub ruleset (gh CLI)
```

## Architecture

```
apps/api        @easytree/api  — NestJS, ONE code package, TWO entrypoints
apps/web        @easytree/web  — Next.js 16 App Router / React 19, mobile-first PWA shell
packages/config @easytree/config — strict Zod env validation + secret redaction
packages/ui     @easytree/ui   — domain-free primitives (Button, Card, VisuallyHidden)
supabase/       config.toml, migrations (schema source of truth), seed.sql, pgTAP tests
docs/           ADRs, plans, runbooks, retros, traceability — mostly German
```

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

The canonical variable set is exactly six: `NODE_ENV`, `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `API_PORT`, `LOG_LEVEL`. Because the schema is strict _and_ the `test`
preset has no defaults, **adding or renaming one touches every site below** — miss any and the
build or a whole suite fails: `packages/config/src/schema.ts` (`ENV_VAR_META` _and_ all three
presets _and_ the `AppConfig` interface), the mapping at the end of
`packages/config/src/load.ts`, `apps/api/test/setup.ts` (sets every variable explicitly),
`.env.example`, and the `env:` blocks of the `db-gates` job in `.github/workflows/ci.yml` plus
`scripts/smoke-api.sh` / `scripts/smoke-worker.sh`. `EASYTREE_*` variables are _not_ part of
this set — they steer tests, never the app, and must never enter `ENV_VAR_META`.

**Web never talks to Supabase or bare `fetch`.** Components get an `ApiClient` from React
context (`lib/api-client-provider.tsx`); the single construction site is `app/providers.tsx`
(`NEXT_PUBLIC_API_URL`). `apps/web/test/no-supabase-import.test.ts` is a static guard that
fails if the Supabase JS SDK name appears anywhere under `apps/web` — that guard string is
assembled from parts on purpose, so don't "fix" it by inlining the literal.

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

`.github/workflows/ci.yml` runs on every PR. Jobs on `master`: `format`, `lint`, `typecheck`,
`unit-tests`, `build-web`, `web-smoke`, `build-api`, `secret-scan`, `db-gates`. Branch
`feat/eyt-50-read-through-slice` adds a tenth, `read-through` (EYT-50). None uses
`continue-on-error`.

**A green job is not a blocking job.** `read-through` passes but is _not_ a required status
check — the ruleset has not been re-applied since it was added, so it cannot block a merge.
Never report it as a gate until `scripts/verify-branch-protection.sh` says otherwise; it
currently prints `FAIL AC3 — fehlende Pflichtchecks: read-through`.

All nine `master` jobs are required status checks in repository ruleset `19718704` (`enforcement: active`,
`bypass_actors: []`, `~DEFAULT_BRANCH`), alongside `pull_request`, `non_fast_forward` and
`deletion`. That the gates actually block is measured, not assumed: negative PR #7 carried a
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
