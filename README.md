# easyTree

TypeScript-Monorepo für easyTree (pnpm + Turborepo). Architekturentscheidungen und
Leitplanken sind in [ADR-001](docs/architecture/ADR-001-boilerplate-architecture.md)
festgehalten — bitte vor Änderungen lesen. Der ausführbare Sprintplan liegt in
[`docs/plans/2026-07-23-eyt-sprint-1-foundation.md`](docs/plans/2026-07-23-eyt-sprint-1-foundation.md).

## Toolversionen

| Tool       | Version                     |
| ---------- | --------------------------- |
| Node.js    | 22 (LTS, siehe `.nvmrc`)    |
| pnpm       | 10.28.0 (`packageManager`)  |
| Turborepo  | ^2.10.6                     |
| TypeScript | ^5.9.3                      |
| Vitest     | ^4.1.10                     |
| ESLint     | ^10.7.0 (typescript-eslint) |
| Prettier   | ^3.9.6                      |

## Installation

```bash
nvm use            # Node 22 aktivieren (oder anderweitig Node 22 bereitstellen)
corepack enable    # stellt die gepinnte pnpm-Version bereit
pnpm install       # bzw. pnpm install --frozen-lockfile für deterministische Installs
```

## Befehle (Workspace-Root)

```bash
pnpm format       # Prettier-Check (pnpm format:fix zum Schreiben)
pnpm lint         # ESLint über alle Pakete (turbo run lint)
pnpm typecheck    # tsc --noEmit über alle Pakete
pnpm test         # Vitest über alle Pakete
pnpm build        # Build aller Pakete (dist/**, .next/**)
```

Einzelne Pakete lassen sich filtern, z. B. `pnpm --filter @easytree/config test`.

## CI & Pflichtchecks

Jeder Pull Request gegen `master` durchläuft den GitHub-Actions-Workflow
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). Die Installation läuft
ausschließlich mit `pnpm install --frozen-lockfile` (Composite-Action
[`.github/actions/setup-pnpm`](.github/actions/setup-pnpm/action.yml)).

Zwei getrennte Aussagen, jede mit eigenem Beleg (EYT-67):

1. **Konfiguriert:** Alle neun Jobs sind im Repository-Ruleset `19718704`
   (`enforcement: active`, `bypass_actors: []`, Ziel `~DEFAULT_BRANCH`) als
   `required_status_checks` eingetragen, zusammen mit `pull_request`,
   `non_fast_forward` und `deletion`. Nachprüfbar read-only gegen die von GitHub
   gemeldete Ist-Wirkung: `bash scripts/verify-branch-protection.sh`.
2. **Wirksam:** Negativ-PR [#7](https://github.com/DYAI2025/EasyTree/pull/7) trug einen
   absichtlich unformatierten Commit. Ergebnis: Job `format` = `failure`,
   `mergeable_state` = `blocked`, und der Merge-Versuch wurde serverseitig abgelehnt
   (`the base branch policy prohibits the merge`). Der PR wurde ohne Merge geschlossen.

Details, Tarifgrenzen und Rollback: [`docs/runbooks/branch-protection.md`](docs/runbooks/branch-protection.md).

| Job           | Zweck                                                                     | merge-blockierend |
| ------------- | ------------------------------------------------------------------------- | ----------------- |
| `format`      | Prettier-Check über das gesamte Repo (`pnpm format`)                      | ja                |
| `lint`        | ESLint über alle Pakete (`pnpm lint`)                                     | ja                |
| `typecheck`   | `tsc --noEmit` über alle Pakete (`pnpm typecheck`)                        | ja                |
| `unit-tests`  | Vitest über alle Pakete (`pnpm test`)                                     | ja                |
| `build-web`   | Produktions-Build der Web-Shell inkl. Abhängigkeiten                      | ja                |
| `build-api`   | Produktions-Build von API/Worker inkl. Abhängigkeiten                     | ja                |
| `secret-scan` | gitleaks (gepinnt, `--redact`) + Checks auf getrackte `.env`-/Key-Dateien | ja                |
| `db-gates`    | Migrationen, pgTAP und fail-closed Tenant-Gates auf echtem Supabase-Stack | ja — verifiziert  |
| `web-smoke`   | Browser-Smoke (Playwright/Chromium) inkl. Accessibility                   | ja — verifiziert  |

„verifiziert" heißt: der Job ist implementiert **und** real grün gelaufen — alle neun Jobs
inklusive `db-gates` und `web-smoke` in Run
[`30133452629`](https://github.com/DYAI2025/EasyTree/actions/runs/30133452629) (Commit
`d497bc9`, PR #5). Kein Job ist mehr „geplant".

Hinweise: Die Tenant-Integrationstests skippen im Job `unit-tests` ohne erreichbare
Datenbank mit Warnung (Local-Mode); das verbindliche, fail-closed geprüfte Gate dafür
ist der Job `db-gates`. Keiner der Pflichtchecks verwendet `continue-on-error`.

## Struktur

```
apps/api          # @easytree/api — NestJS-Backend, ein Codepaket, zwei Entrypoints (EYT-42)
apps/web          # @easytree/web — Next.js-Web-/PWA-Shell mit A11y-Baseline (EYT-41)
packages/config   # @easytree/config — validierte Env-Konfiguration (Platzhalter, EYT-43)
packages/ui       # @easytree/ui — domänenfreie UI-Primitives (Button, Card, VisuallyHidden)
supabase/         # Lokaler Supabase-Stack: config.toml, Migrationen, Seed, pgTAP-Tests
docs/             # ADRs, Pläne, Runbooks
```

## Backend (API + Worker)

`apps/api` ist **ein** NestJS-Codepaket mit **zwei** Entrypoints (ADR-001 §2):

- `src/main.ts` — HTTP-API auf `API_PORT` (aus `@easytree/config`), mit `GET /health`
  (Liveness) und `GET /ready` (Readiness, 503 bei nicht bereiten Abhängigkeiten).
- `src/worker.ts` — Hintergrund-Worker via `NestFactory.createApplicationContext`;
  identische Module/DI/Konfiguration, aber **kein** HTTP-Listener und kein Port.

Querschnitt: `x-correlation-id` wird pro Request übernommen oder als UUID erzeugt und in
der Response gespiegelt; Fehler werden als RFC-7807-artiges JSON (`type`/`title`/`status`/
`detail`/`correlationId`) ohne Stacktraces oder Secretwerte ausgegeben; SIGTERM führt über
`enableShutdownHooks()` zu einem sauberen Shutdown.

```bash
pnpm --filter @easytree/api test          # Vitest (SWC-Transform für Nest-Decorators)
pnpm --filter @easytree/api build         # tsc → apps/api/dist
node apps/api/dist/main.js                # API starten (Env gemäß .env.example)
node apps/api/dist/worker.js              # Worker starten (öffnet keinen Port)
```

## Web (PWA-Shell)

`apps/web` ist die Next.js-Shell (App Router, Next 16, React 19) für easyTree (EYT-41,
ADR-001 §1/§5):

- **Shell & A11y-Baseline:** semantische Landmarks (`header`/`nav`/`main`/`footer`),
  Skip-Link als erstes fokussierbares Element (Ziel `#hauptinhalt`), sichtbare
  Fokusstile, `html lang="de"`, mobile-first Layout, System-Font-Stack (keine
  Google-Font-Imports — der Build funktioniert offline). Statusanzeigen sind nie nur
  über Farbe kodiert (immer Text + Symbol).
- **PWA:** `app/manifest.ts` liefert `/manifest.webmanifest` (name `easyTree`,
  `display: standalone`, Platzhalter-Icons unter `public/icons/`). Ausdrücklich
  **kein** Service Worker und **keine** Offline-Schreib-/Sync-Queue.
- **API-Zugriff nur über Injektion:** `lib/api-client.ts` (`createApiClient(baseUrl,
fetchImpl)`) + `lib/api-client-provider.tsx` (React-Context). Die einzige
  Konstruktionsstelle ist die Kompositionswurzel `app/providers.tsx`
  (`NEXT_PUBLIC_API_URL`, Default `http://localhost:3001`); Komponenten konstruieren
  nie selbst einen Client, ohne Provider wirft `useApiClient()` einen verständlichen
  Fehler. Ein statischer Guard-Test stellt sicher, dass `apps/web` nirgends das
  Supabase-JS-SDK importiert.
- **UI-Primitives:** `packages/ui` (`@easytree/ui`) liefert domänenfreie Bausteine
  (`Button`, `Card`, `VisuallyHidden`) ohne Fachlogik; das Styling gehört der App
  (`app/globals.css`).

```bash
pnpm --filter @easytree/web dev     # Dev-Server auf http://localhost:3000
pnpm --filter @easytree/web build   # next build (Turbopack)
pnpm --filter @easytree/web start   # Produktionsserver nach Build
pnpm --filter @easytree/web test    # Vitest: api-client, a11y (axe), Supabase-Guard
pnpm --filter @easytree/ui test     # Vitest: Primitives
```

Automatisierte A11y-Checks (axe: 0 Violations, Skip-Link erstes Tab-Ziel,
`main`-Landmark, `lang`) laufen in `apps/web/test/a11y.test.tsx`; die **manuelle**
Checkliste (Tastatur, Fokusreihenfolge, 200 %-Zoom, non-color Status, Kontrast,
Screenreader) liegt in
[`docs/runbooks/a11y-checklist.md`](docs/runbooks/a11y-checklist.md) — Status:
manuell noch offen.

## Datenbank

Lokaler Supabase-Stack (Postgres 17, Auth, Storage) via Docker; die Supabase CLI ist als
devDependency versioniert (`pnpm exec supabase …`). SQL-Migrationen unter
`supabase/migrations/` sind die **einzige** Schemaquelle — Schemaänderungen über das
Supabase-Dashboard sind verboten. Details, Reset-Workflow und Reviewpflicht:
[`docs/runbooks/database-workflow.md`](docs/runbooks/database-workflow.md).

```bash
pnpm exec supabase start     # Stack starten (erstmalig: Docker-Images ziehen)
pnpm exec supabase db reset  # DB aus Migrationen + supabase/seed.sql neu aufbauen
pnpm exec supabase test db   # pgTAP-Tests (supabase/tests/*.sql)
pnpm exec supabase stop      # Stack stoppen
```

Hinweise: pnpm ist der einzige zulässige Paketmanager (keine `package-lock.json`/`yarn.lock`);
Umgebungsdateien (`.env*`) werden nie committet — nur `.env.example` mit Platzhalterwerten.
