# Arboscus Boilerplate Architecture Implementation Plan

Plan path: `docs/plans/2026-07-23-boilerplate-architecture.md`  
Status: ready-for-execution  
Owner/Executor: coding agent + engineering review  
Last updated: 2026-07-23

<!-- GOAL_START -->

Goal: Mandantenfähige Arboscus-Boilerplate aufbauen

Ziel. Eine ausführbare Greenfield-Boilerplate für den Arboscus Teamplaner schaffen, die den ersten MVP schnell trägt und weitere Firmen ohne Kundenforks aufnehmen kann. Kritische Planungs-, Tenant-, Audit- und Zeitinvarianten werden von Beginn an testbar und serverseitig erzwungen. Das Ergebnis ist kein fertiges Produkt, sondern ein belastbarer, lauffähiger Architekturrahmen mit einem ersten vertikalen Referenz-Slice.

Scope. Neuer Feature-Branch vom aktuellen Default-Branch. TypeScript-Monorepo mit `apps/web`, `apps/backend`, benannten `packages/*`, `supabase/`, `openapi/`, `infra/`, Architekturtests und CI. Supabase Postgres/Auth/Storage bleibt Plattformbasis; operative Kommandos laufen über den NestJS-Anwendungskern. Der Backend-Build liefert API- und Worker-Entrypoints.

Bedingungen (hart).

- Shared-schema-Multitenancy mit `organization_id`, tenant-sicheren Fremdschlüsseln, Application Authorization und getesteter RLS.
- SQL-Migrationen sind die einzige Schemaquelle; keine parallele ORM-Migrationsquelle.
- Domainlogik bleibt frei von Next.js-, NestJS-, Kysely-, HTTP- und Providerabhängigkeiten.
- Veröffentlichte Planungen, Zeitkorrekturen und Jobs sind versioniert, idempotent, auditiert und transaktional geschützt.
- Kein direkter Browser- oder Agentenschreibzugriff auf operative Tabellen.

Akzeptanzkriterien.

- Ein frischer Checkout startet Web, API, Worker und lokalen Supabase-Stack anhand dokumentierter Befehle.
- CI prüft Formatierung, Lint, Typen, Unit-/Property-Tests, pgTAP, API-Integration, OpenAPI-Drift, Architekturgrenzen, E2E und Build.
- Zwei synthetische Organisationen können nicht auf Daten der jeweils anderen Organisation zugreifen.
- Ein Referenzfluss authentifiziert einen Planer, legt Mitarbeiter und Baustelle an, erzeugt einen Entwurf, verhindert einen Konflikt, veröffentlicht eine Revision und zeigt Audit sowie Worker-Job.
- Nebenläufige Publish-Versuche erzeugen weder Doppelbelegung noch doppelte Benachrichtigung.
- Dokumentierte Rollback-, Migrations- und Provider-Austauschpfade liegen vor.

Explizit out-of-scope.

- Fachliche Vollimplementierung aller EYT-Tickets.
- Native iOS-/Android-App, Solver, KI-Planung oder MCP.
- Microservices, Kubernetes, Kafka, Event Sourcing oder GraphQL.
- Billing, Payroll, Rechnungen und Post-MVP-Wirtschaftsauswertungen.
- Produktivdeployment oder Migration echter Beschäftigtendaten.

Done-Definition. Gemergter, geprüfter Boilerplate-Branch mit grünem CI, lokal reproduzierbarem Referenz-Slice, versioniertem OpenAPI-Vertrag, SQL-Migrationen, RLS-/Constraint-Nachweisen, Architekturtests, ADRs und Runbook; Produktion bleibt gesondert gesperrt.

Reference-Doc: `docs/architecture/ADR-001-boilerplate-architecture.md`
<!-- GOAL_END -->

## Evidence and source boundary

- Provided evidence: PRD v1.3, MVP Scope v1.3, Architekturentscheidungen v1.2, Clickdummy-Inputs und Jira-Backlog EYT-1 bis EYT-39.
- Inspected evidence: kanonische Repository-Dokumente und aktuelle Primärdokumentation für Next.js, NestJS, Supabase und PostgreSQL.
- Not inspected / unavailable: Anwendungscode, Zielhosting, reale Lastmessungen, rechtlich freigegebene Retention und Produktionszugänge.
- Evidence class: Architekturplan auf Design- und Primärquellenbasis; keine Runtime- oder Produktionsevidenz.

## Assumptions, missing information, open questions, blockers

### ASSUMPTION

- Ein kleines Kernteam verantwortet Web und Backend gemeinsam.
- Ein gemeinsames EU-Postgres reicht für Pilot und erste weitere Firmen.
- PWA deckt den frühen Feldnutzen ab; native App wird durch Feldtests entschieden.
- REST/JSON erfüllt Web-, Mobile- und Partnerintegrationen.

### MISSING

- Exakte Runtime- und Frameworkversionen.
- Finaler Hosting-, E-Mail-, Wetter-, Ozon- und Routingprovider.
- Verbindliche SLOs, Mandantenzahlen, Peak-Concurrency und Kostenbudget.
- Rechtlich freigegebene Datenaufbewahrung.

### OPEN QUESTION

- Direct Connection, Session Pooler oder Transaction Pooler für API und Worker.
- Datenisolationsoptionen für spätere Großkunden.
- Browser-Push im erweiterten Release.

### BLOCKER

- Kein Blocker für lokale Boilerplate und Referenz-Slice.
- Produktion bleibt blockiert, bis Hosting, Security, Retention, Backup/Restore, SLOs und Release-Gates belegt sind.

## Requirements

| ID         | Type           | Statement                                                                            | Verification                      |
| ---------- | -------------- | ------------------------------------------------------------------------------------ | --------------------------------- |
| REQ-F-001  | Functional     | Web, API, Worker und lokaler Supabase-Stack sind reproduzierbar startbar.            | Fresh-checkout smoke              |
| REQ-F-002  | Functional     | Erster vertikaler Planungs-/Publish-Slice ist ausführbar.                            | Playwright + API integration      |
| REQ-F-003  | Functional     | Benachrichtigungsjobs sind transaktional und idempotent.                             | Retry-/duplicate integration test |
| REQ-F-004  | Functional     | OpenAPI erzeugt typisierten Webclient.                                               | Generated diff clean              |
| REQ-NF-001 | Non-functional | Domainmodule sind unabhängig testbar und Grenzen erzwungen.                          | Architecture tests                |
| REQ-NF-002 | Non-functional | Pilotdichte 12 Nutzer/3 Baustellen bleibt nutzbar.                                   | Synthetic E2E/load smoke          |
| REQ-D-001  | Data           | SQL-Migrationen sind einzige Schemaquelle.                                           | `supabase db reset`               |
| REQ-D-002  | Data           | Tenant-owned Zeilen und FKs sind organisationsgebunden.                              | pgTAP negative tests              |
| REQ-D-003  | Data           | Veröffentlichte Mitarbeiter-/Ressourcenintervalle überlappen nicht.                  | PostgreSQL exclusion tests        |
| REQ-D-004  | Data           | Höchstens ein aktiver Timer pro Mitarbeiter.                                         | Partial unique index test         |
| REQ-A-001  | Architecture   | Web enthält UI/PWA; Backend enthält operative Domainlogik.                           | Import/route review               |
| REQ-A-002  | Architecture   | Module folgen Domain/Application/Infrastructure/Interface.                           | Dependency tests                  |
| REQ-A-003  | Architecture   | Externe Provider sind Ports/Adapter.                                                 | Contract tests                    |
| REQ-S-001  | Security       | Backend verifiziert Supabase JWT und Membership.                                     | Auth integration tests            |
| REQ-S-002  | Security       | RLS und least-privilege Runtime-Rolle sind getestet.                                 | pgTAP/runtime tests               |
| REQ-S-003  | Security       | Cross-Tenant-, IDOR-, Export-, Cache-, Job- und Dateizugriffe sind negativ getestet. | Security suite                    |
| REQ-O-001  | Operations     | API/Worker besitzen Health, Readiness und Korrelation.                               | Smoke/telemetry assertions        |
| REQ-O-002  | Operations     | Migrationen sind expand/verify/contract-fähig.                                       | Migration checklist               |
| REQ-O-003  | Operations     | Worker besitzt Retry, Dead-Letter, Queue-Lag und Reconciliation.                     | Failure injection tests           |

## Architecture and file boundaries

### Current architecture facts

- Greenfield-Repository ohne nachgewiesene App-Boilerplate.
- Supabase, TypeScript-first, modularer Monolith und Provideradapter sind beschlossen.
- Produktion ist nicht freigegeben.

### Target architecture constraints

- Ein Repository und eine transaktionale PostgreSQL-Datenbank.
- Deployables: `web`, `backend-api`, `backend-worker`; API und Worker aus demselben Backend-Artefakt.
- Shared-schema Multitenancy ab Tag eins.
- OpenAPI als externe Vertragsgrenze.
- Keine Domainlogik in React-Komponenten, Next Route Handlers, SQL-Triggern oder Queue-Handlern duplizieren.

### Files and modules

```text
apps/
  web/
  backend/
packages/
  api-client/
  ui/
  config/
  observability/
  test-support/
supabase/
  migrations/
  tests/
openapi/
infra/
tools/
docs/
```

Backendmodule: `tenancy`, `identity`, `workforce`, `sites`, `planning`, `resources`, `timekeeping`, `communications`, `weather-routing`, `files`, `audit-integration`.

### Prohibited changes

- Kein `packages/shared` als Sammelablage.
- Keine direkte Browsermutation operativer Tabellen.
- Keine Service-Role als normale Runtime-Identität.
- Keine zweite Migrationsquelle.
- Keine Microservices, Broker oder Kubernetes ohne neue Evidenz und ADR.

## Implementation phases

### Phase 1: Discovery and test baseline

Workspace, Toolchain, lokale Supabase-Umgebung, Architekturtests und CI-Verträge aufsetzen.

### Phase 2: Core change

Tenantmodell, Auth-Kontext, SQL-Invarianten, Domainmodule und erste Application Commands implementieren.

### Phase 3: Integration and edge cases

OpenAPI, Webclient, Outbox/Worker, Providerports, Cross-Tenant-, Nebenläufigkeits- und E2E-Tests ergänzen.

### Phase 4: Documentation and handoff

Container, Fresh-checkout-Verifikation, Threat Model, Runbooks, Rollback und Architekturstand abschließen.

## Tasks

### TASK-001: Workspace und Toolchain anlegen

Objective: Reproduzierbares pnpm-/Turborepo-Grundgerüst.  
Requirement links: REQ-F-001, REQ-NF-001  
Files/modules: root manifests, `apps/*`, `packages/*`, `tools/*`.  
Steps: failing smoke; Workspace anlegen; zentrale TS-/Lint-/Testkonfiguration; Root-Commands; Fresh install.  
Acceptance: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` sind definiert und grün.  
Validation: Zielbefehl `pnpm verify`.  
Rollback: gesamter Task als isolierter Commit revertierbar.

### TASK-002: Next.js-Web/PWA-Shell aufbauen

Objective: Mobile-first Webshell ohne operative Direktwrites.  
Requirement links: REQ-A-001, REQ-NF-003  
Files/modules: `apps/web`.  
Steps: failing component/a11y tests; App Router; Auth-Shell; API client boundary; responsive layout; PWA manifest; no direct Supabase writes.  
Acceptance: mobile shell, keyboard/focus/zoom checks und API-only mutation path.  
Validation: `pnpm --filter web test && pnpm --filter web build`.  
Rollback: Webshell unabhängig revertierbar.

### TASK-003: NestJS API- und Worker-Bootstrap schaffen

Objective: Ein Backendartefakt mit zwei Entrypoints.  
Requirement links: REQ-F-001, REQ-O-001  
Files/modules: `apps/backend/src/bootstrap`, `platform`.  
Steps: failing boot tests; API/worker bootstrap; config validation; health/readiness; graceful shutdown; correlation IDs.  
Acceptance: API und Worker starten getrennt aus demselben Build.  
Validation: `pnpm --filter backend test && pnpm --filter backend build`.  
Rollback: Entrypoints getrennt committen.

### TASK-004: Modulgrenzen automatisiert erzwingen

Objective: Scheinkapselung verhindern.  
Requirement links: REQ-NF-001, REQ-A-002  
Files/modules: architecture test config.  
Steps: bewusst verbotenen Import testen; Regeln für Domain/Application/Infrastructure/Interface; Public APIs; CI-Gate.  
Acceptance: verbotene Imports schlagen deterministisch fehl.  
Validation: `pnpm test:architecture`.  
Rollback: Regeländerungen nur mit ADR.

### TASK-005: Lokalen Supabase-Stack und SQL-Migrationsworkflow aufsetzen

Objective: Reproduzierbares Schema und lokale Integration.  
Requirement links: REQ-D-001, REQ-S-002  
Files/modules: `supabase/config.toml`, `migrations`, `tests`.  
Steps: failing reset smoke; CLI init; Basismigration; Runtime-/Migrationrollen; Seeds; pgTAP.  
Acceptance: `supabase db reset` baut konsistent auf.  
Validation: `pnpm db:reset && pnpm test:db`.  
Rollback: Migrationen vor Remote-Nutzung korrigierbar; danach nur additive Änderungen.

### TASK-006: Shared-schema-Tenantmodell implementieren

Objective: Cross-Tenant-Referenzen strukturell verhindern.  
Requirement links: REQ-D-002, REQ-S-002, REQ-S-003  
Files/modules: Tenancy/Identity migration and tests.  
Steps: zwei Organisationen als Negativtest; `organization_id`; Composite-FKs; Membership; RLS; least-privilege tests.  
Acceptance: Cross-Tenant-Reads/Writes/References scheitern.  
Validation: `pnpm test:db -- tenancy`.  
Rollback: Feature-Branch reset; nach Remote-Nutzung expand/contract.

### TASK-007: Supabase-JWT und Autorisierungskontext anbinden

Objective: Authentifizierten Benutzer sicher auf Organisation und Rechte abbilden.  
Requirement links: REQ-S-001, REQ-S-003  
Files/modules: backend auth platform and tenancy application.  
Steps: invalid/expired/wrong-audience tests; JWKS verification; Membership lookup; request context; guards/policies; delayed job reauthorization.  
Acceptance: kein Tenant wird aus Clientpayload vertraut.  
Validation: `pnpm test:integration -- auth`.  
Rollback: Authadapter austauschbar halten.

### TASK-008: Kysely-Datenzugriff und Transaktionsgrenze einrichten

Objective: Typisierte Queries ohne zweite Schemaquelle.  
Requirement links: REQ-D-001, REQ-A-002  
Files/modules: backend database platform and module repositories.  
Steps: repository tests; Kysely+pg; generated DB types from schema; transaction/unit-of-work; parameterized PostgreSQL SQL.  
Acceptance: keine ORM-Migrationen; jede Command-Transaktion atomar.  
Validation: `pnpm test:integration -- repositories`.  
Rollback: Repositoryadapter hinter Ports.

### TASK-009: PostgreSQL-Invarianten definieren

Objective: Konflikte auch unter Nebenläufigkeit verhindern.  
Requirement links: REQ-D-003, REQ-D-004  
Files/modules: planning/timekeeping migrations and pgTAP.  
Steps: failing overlap/race tests; range columns; exclusion constraints; partial unique timer index; version constraints; readable error mapping.  
Acceptance: parallele Konflikte werden in DB verhindert.  
Validation: `pnpm test:db -- invariants`.  
Rollback: Constraintänderungen nur nach Datenprüfung.

### TASK-010: Domainmodule und öffentliche APIs scaffolden

Objective: Fachliche Ownership sichtbar und erweiterbar machen.  
Requirement links: REQ-A-002, REQ-A-003  
Files/modules: backend `modules/*`.  
Steps: Domain ohne Framework; Use Cases/Ports; Infrastructure; HTTP mapping; `index.ts`; table ownership registry.  
Acceptance: Module kompilieren isoliert; keine fremden Repositorywrites.  
Validation: `pnpm test:architecture && pnpm typecheck`.  
Rollback: Module einzeln entfernbar.

### TASK-011: Ersten vertikalen Planungs-/Publish-Slice TDD-first bauen

Objective: Architektur an echtem Wertstrom beweisen.  
Requirement links: REQ-F-002, REQ-D-003, REQ-S-001  
Files/modules: tenancy, workforce, sites, planning, audit.  
Steps: failing E2E; Planner auth; Worker/Site create; draft assignment; deterministic conflict check; publish revision; audit; UI display.  
Acceptance: kompletter Referenzfluss und Cross-Tenant-Negativfall grün.  
Validation: `pnpm test:e2e -- planning-reference-slice`.  
Rollback: Slice über Featureflag deaktivierbar.

### TASK-012: OpenAPI und generierten TypeScript-Client etablieren

Objective: Stabiler Vertrag für Web, spätere Mobile-App und Integrationen.  
Requirement links: REQ-F-004, REQ-A-001  
Files/modules: backend HTTP, `openapi`, `packages/api-client`.  
Steps: contract tests; DTO validation; spec generation; client generation; breaking-change check; web integration.  
Acceptance: kein manueller API-Typenfork.  
Validation: `pnpm openapi:check`.  
Rollback: Spec und Client gemeinsam versionieren.

### TASK-013: Transactional Outbox und pg-boss-Worker implementieren

Objective: Zustandsänderung und externe Nebenwirkung entkoppeln, ohne Broker.  
Requirement links: REQ-F-003, REQ-O-003  
Files/modules: audit/integration, communications, queue platform.  
Steps: failing duplicate/retry tests; outbox in Domaintransaktion; stable event/job IDs; polling/enqueue; idempotent handler; retry/DLQ/reconciliation; lag metrics.  
Acceptance: Commit ohne Jobverlust; Wiederholung ohne Doppelwirkung.  
Validation: `pnpm test:integration -- outbox-worker`.  
Rollback: Worker kill switch; Outboxdaten erhalten.

### TASK-014: Providerports und Fakeadapter definieren

Objective: E-Mail, Wetter, DWD, Routing, Storage und Transkription austauschbar halten.  
Requirement links: REQ-A-003, REQ-S-004  
Files/modules: communications, weather-routing, files.  
Steps: Port contracts; deterministic fakes; timeout/retry budgets; redacted telemetry; no provider SDK in domain/application.  
Acceptance: Providerwechsel erfordert nur Adapter-/Configänderung.  
Validation: `pnpm test:contract -- providers`.  
Rollback: Adapter einzeln deaktivierbar.

### TASK-015: Observability und Datenschutzkonventionen einbauen

Objective: Fehler sichtbar machen, ohne Beschäftigtendaten zu leaken.  
Requirement links: REQ-S-004, REQ-O-001, REQ-O-003  
Files/modules: observability package/platform.  
Steps: redaction tests; traces/metrics/logs; stable IDs; auth denial classes; outbox/job/provider metrics; no payload logging.  
Acceptance: End-to-End-Korrelation ohne PII.  
Validation: `pnpm test:observability`.  
Rollback: Exporter austauschbar; lokale No-op-Option.

### TASK-016: CI-Gates und Supply-Chain-Prüfungen definieren

Objective: Pflichtprüfungen vor Merge erzwingen.  
Requirement links: alle Qualitätsanforderungen.  
Files/modules: `.github/workflows`, root scripts.  
Steps: format/lint/type/unit/property/architecture/db/integration/OpenAPI/E2E/build; secret/dependency scan; cache; artifacts.  
Acceptance: Pflichtfehler blockieren Merge.  
Validation: alle Root-Checks Exit 0.  
Rollback: Checks nicht umgehen; Flakiness ursächlich beheben.

### TASK-017: Container- und lokale Betriebsumgebung definieren

Objective: Web, API und Worker reproduzierbar bauen/starten.  
Requirement links: REQ-F-001, REQ-O-001  
Files/modules: Dockerfiles, `.dockerignore`, local orchestration.  
Steps: failing smokes; multi-stage non-root images; API/worker mode; Supabase integration; health/shutdown.  
Acceptance: drei Prozesse starten und bestehen Smokes.  
Validation: `pnpm containers:build && pnpm containers:smoke`.  
Rollback: providerneutral, kein produktives Infra-Setup.

### TASK-018: Performance- und Nebenläufigkeitssmoke erstellen

Objective: Pilotfähigkeit messen, ohne SLOs zu erfinden.  
Requirement links: REQ-NF-002, REQ-D-003  
Files/modules: synthetic generator/load scenarios.  
Steps: 12 Nutzer/3 Baustellen; mehrere Organisationen; Querypläne; Publish race; retry storm; Baselinebericht.  
Acceptance: keine Invariantenverletzung; Messbericht mit Kontext.  
Validation: `pnpm test:performance:smoke`.  
Rollback: getrennt vom normalen CI ausführbar.

### TASK-019: Security-, Privacy- und Worker-Impact-Review abschließen

Objective: Risikoreichste Daten- und Autorisierungsfehler prüfen.  
Requirement links: REQ-S-001 bis REQ-S-004  
Files/modules: threat model, authorization matrix, data classification, security tests.  
Steps: Trust boundaries; decision rights; IDOR/tenant/export/cache/job/file tests; human oversight/correction paths; offene Legal Reviews markieren.  
Acceptance: kein kritischer Cross-Tenant-/Service-Role-Pfad ungeprüft.  
Validation: `pnpm test:security`.  
Rollback: unsichere Funktion deaktivieren.

### TASK-020: Runbooks und Fresh-checkout-Abnahme liefern

Objective: Betrieb und Erweiterung ohne verborgenes Wissen.  
Requirement links: alle.  
Files/modules: README, architecture, runbooks, release gates.  
Steps: failing fresh-checkout script; Setup/DB/API/Worker/Container docs; ownership/extraction gates; migration/recovery; alle Checks; secret/scope review.  
Acceptance: Fresh checkout reproduziert Stack und Slice; Produktion bleibt gesperrt.  
Validation: `pnpm verify:fresh-checkout`.  
Rollback: normale Revert-/Forward-fix-Strategie.

## Validation strategy

### Focused tests

- Domain unit/property tests ohne Framework.
- Application use-case tests mit Ports/Fakes.
- pgTAP für RLS, Grants, Composite-FKs, Exclusion Constraints, Timerindex, Audit und Outbox.
- Repositorytests gegen lokalen Postgres.
- JWT/Membership/Auth-Negativtests.
- Queue Duplicate/Retry/Dead-Letter/Recovery.
- OpenAPI-Generation und Breaking-Change-Erkennung.

### Broader regression checks

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:architecture
pnpm test:db
pnpm test:integration
pnpm openapi:check
pnpm test:e2e
pnpm build
pnpm containers:smoke
```

Diese Befehle sind Zielverträge des Boilerplates und werden erst durch die Tasks geschaffen.

### Manual review checklist

- Kleine Viewports, 200-%-Zoom, Outdoor-Kontrast, Keyboard und Fokus.
- Kein direkter Browserwrite auf operative Tabellen.
- Kein normaler Runtimepfad mit Service-Role/BYPASSRLS.
- Tenant-ID in Cache-, Job-, Datei-, Audit- und Idempotency-Pfaden.
- Published revisions und corrections nicht still überschreibbar.
- Keine Namen, E-Mails, Adressen, Token, Notizen, Fotos oder Audio in Telemetrie.
- Providerausfall führt zu kontrollierter Degradation statt Datenkorruption.

## Rollback and safety

- Feature-Branch; kein direkter Commit auf Default-Branch.
- Vor erster Remote-Datenbank darf lokale Migrationshistorie bereinigt werden; danach nur kompatible Migrationen.
- Destruktive Migrationen benötigen Backup-, Restore- und Reconciliation-Beleg.
- Outbox/Worker und optionale Module erhalten Kill Switches.
- RLS-, Tenant- oder Auth-Fehler sind Stop-Bedingungen.
- Nach drei unterschiedlichen erfolglosen Reparaturhypothesen: Stop mit Evidenz und BLOCKER.
- Keine echten Mitarbeiterdaten oder Produktionscredentials in Tests.

## Execution handoff

- Start with: TASK-001, danach zwingend TASK-006 und TASK-007 vor umfangreicher Domainimplementierung.
- Allowed: `apps/`, `packages/`, `supabase/`, `openapi/`, `infra/`, `tools/`, `.github/`, zugehörige Dokumentation.
- Do not touch: freigegebene PRD-/MVP-Aussagen ohne ADR; keine Post-MVP-Wirtschaftsfeatures.
- Stop and ask if: RLS/Pooler nicht reproduzierbar, Service-Role für normalen Betrieb nötig, Migration Daten löschen würde, Hosting den Vertrag ändert oder Cross-Tenant-Test fehlschlägt.
- Commit strategy: kleine kohärente Commits; Migration, Test und Implementierung gemeinsam; keine Gate-Bypasses.
- Expected artifacts: Workspace, SQL-Migrationen, OpenAPI/client, Referenz-Slice, Architektur-/Securitytests, CI, Container, Runbooks, Validierungslog.

## Plausibility and truth self-check

- Goal length: unter 4000 Zeichen und validiert.
- Unsupported claims removed or labeled: Hosting, Versionen, SLOs, Kosten, Last und Rechtswerte bleiben MISSING/OPEN QUESTION.
- Strongest counterargument: Next-only wäre schneller und billiger; der separate Domainkern muss seinen Nutzen am ersten Slice beweisen.
- Failure-mode chain: falscher Tenantkontext → Cross-Tenant-Leak → Datenschutz-/Vertrauensschaden → SaaS-Vertrieb gefährdet.
- Confirmation bias: TypeScript-/Supabase-Präferenz wurde gegen Next-only und Microservices geprüft.
- Tool bias: Turborepo, NestJS, Kysely und pg-boss sind ersetzbar; Modulgrenzen und SQL-Verträge sind entscheidend.
- Sunk-cost bias: Supabase bleibt nur, solange RLS-/Pooling-Spike die Sicherheitsannahme bestätigt.
- Overengineering check: keine Microservices, kein Broker, kein Kubernetes, keine native App, kein Event Sourcing.
- Falsifier: erster Slice zeigt unverhältnismäßigen API-Overhead ohne Qualitätsgewinn; RLS/Pooling nicht sicher; reale Last/Ownership verlangt andere Grenzen.
- Final readiness: **PASS_WITH_ASSUMPTIONS – ready-for-execution für lokale Boilerplate; BLOCKED für Produktion.**
