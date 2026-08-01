# Product Canvas – Sprint 5 Daily Cost Export

Status: user-confirmed
Confirmed by user: yes
Bestätigt am: 2026-07-30 durch den Product Owner (Benjamin Poersch).
Grundlage der Markierung: PO-Weisung vom 30.07.2026 — Scope-Entscheidung „voller Scope, keine
Must-Kürzung" plus die Auflage, erst nach erfolgreichem Abgleich gegen die Confluence-Baseline
zu markieren, und die Freigabe „Vision, Canvas, Feature-PRD und Traceability dürfen nach
erfolgreichem erneuten Abgleich als bestätigt markiert werden, sofern keine andere materielle
Abweichung offen ist". Bedingung geprüft und erfüllt: Abgleich gegen Confluence PRD v1.4
(7766017) und Sprint-5-Seite (8552449) am 30.07.2026, DIV-S5-001…009 abgearbeitet, keine
materielle Abweichung offen; verblieben `DOC-DRIFT-S5-001` (kein Blocker).
Nicht mitbestätigt: technische Kapazität für die Fertigstellung (nur der Start ist freigegeben),
die lokalen Zusätze REQ-G01/REQ-G02, sowie das **Vision-GO** — das ist ein eigenes Signal und
liegt weiterhin beim Product Owner.
Feature Slug: `sprint-5-daily-cost-export`

- Vision: [`docs/vision/sprint-5-daily-cost-export.vision.md`](../vision/sprint-5-daily-cost-export.vision.md)
- PRD: [`docs/prd/sprint-5-daily-cost-export.prd.md`](../prd/sprint-5-daily-cost-export.prd.md)
- Traceability: [`docs/traceability.md`](../traceability.md), Abschnitt „Sprint 5"

> **Bestätigt am 30.07.2026** auf Weisung des Product Owners (Herkunft im Kopf dieses
> Dokuments). Damit ist die PRD-Finalisierung frei und Planung erlaubt. **Coding bleibt bis zum
> ausdrücklichen Vision-GO gesperrt** — GO ist ein eigenes Signal und wird von keinem Agenten
> selbst erteilt.

## Die zehn Pflichtfelder

| Feld                       | ID      | Inhalt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Typ      | Quelle                                                  |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------- |
| Problem                    | CAN-F01 | Plan-Personalkosten müssen manuell aus veröffentlichten Einsätzen, Dauer und internen Stundensätzen zusammengeführt werden — mit falschen Satzständen, abweichenden Rechenwegen in UI und Excel, nicht reproduzierbarer Historie, unbefugtem Zugriff sowie Rundungs-/Zeitzonenfehlern.                                                                                                                                                                                                                                                                   | EXPLICIT | VIS-002; Confluence Sprint 5                            |
| Zielnutzer / Kunde         | CAN-F02 | Geschäftsführung und berechtigte Administration eines kleinen Baumpflegeunternehmens. Mitarbeitende ohne Kostenrechte sind ausdrücklich **keine** Nutzer der Kostenansicht oder des Exports.                                                                                                                                                                                                                                                                                                                                                             | EXPLICIT | VIS-001; EYT-106/108/109/110                            |
| Bisheriger Workaround      | CAN-F03 | Manuelle Tabellenkalkulation: Einsätze abschreiben, Dauer schätzen, Stundensätze aus einer separaten Liste ziehen, Summen von Hand bilden. Kein reproduzierbarer historischer Stand, keine Zugriffstrennung.                                                                                                                                                                                                                                                                                                                                             | EXPLICIT | VIS-002; EYT-109 User Story                             |
| Wertversprechen            | CAN-F04 | Ein nachvollziehbarer, reproduzierbarer und geschützter Plan-Kostenstand aus **einer** gemeinsamen serverseitigen Wahrheit. UI und Excel verwenden keinen getrennten Rechenweg.                                                                                                                                                                                                                                                                                                                                                                          | EXPLICIT | VIS-004                                                 |
| Erfolgssignal              | CAN-F05 | Reale Browserreise ohne Mock-, LocalStorage- oder Clientberechnungswahrheit: Login → Stundensatz → Publish → Snapshot → Kostenansicht → XLSX; UI, PostgreSQL und XLSX stimmen für IDs, Positionen und Summen überein.                                                                                                                                                                                                                                                                                                                                    | EXPLICIT | VIS-005; EYT-110 AC                                     |
| Kern-Use-Case              | CAN-F06 | „Was hat mich die veröffentlichte Woche auf Baustelle X pro Tag an geplantem Personal gekostet?" — beantwortet bis zur Einzelposition, exportierbar als Datei zur Weiterverarbeitung.                                                                                                                                                                                                                                                                                                                                                                    | EXPLICIT | EYT-109/EYT-110 User Stories                            |
| Nicht-Ziele                | CAN-F07 | Ist-Kosten; Arbeitszeiterfassung inkl. Arbeitszeitfreigabe und bestätigter Ressourcennutzung; Tagessätze und deren Verteilung auf mehrere Baustellen; freie Mitarbeiter, Fahrzeuge, Geräte, Maschinen; PDF/Druck, CSV-Import, DATEV, Steuer, Buchung, Rechnungen, Zahlungen; asynchrone Großexporte, E-Mail-Zustellung, BI-Integration; Microservices, Brokerwechsel, Event Sourcing, generisches Service-Framework; beliebige Rollenverwaltung; vollständiger Ausbau aller Publish-Konfliktregeln; **produktives Deployment oder Produktionsfreigabe**. | EXPLICIT | VIS-006; Out-of-Scope aller sieben Tickets              |
| Risiken / Widersprüche     | CAN-F08 | Siehe Abschnitt „Risiken und Widersprüche" — `CAN-DRIFT-00` und `CAN-RISK-01` bis `CAN-RISK-07`. **Kein offener Widerspruch**; offen sind `OQ-002`, `OQ-003` (CI-Bindung) und `OQ-005` (Ort des Auth-Nachweises).                                                                                                                                                                                                                                                                                                                                        | GEMISCHT | Intake-Ledger + Repository-Preflight                    |
| Benötigte Evidence         | CAN-F09 | Je Requirement Architektur-, Domain-, Property-, Contract-, PostgreSQL-/pgTAP-, RLS-, Nebenläufigkeits-, Cross-Tenant-, Accessibility- und Browser-E2E-Nachweise **plus** je eine benannte rote Gegenmutation; jeder Pflichttest gebunden an Workflow, Job und Schritt.                                                                                                                                                                                                                                                                                  | EXPLICIT | REQ-001…REQ-008 (Baseline S5-REQ-01…08); Sprint-4-Retro |
| Traceability-Verknüpfungen | CAN-F10 | `docs/traceability.md`, Abschnitt „Sprint 5", Tabellen A/B/C — TRC-S5-001 bis TRC-S5-010.                                                                                                                                                                                                                                                                                                                                                                                                                                                                | EXPLICIT | Intake Abschnitt 3                                      |

## CAN-001 – Vertikaler Wertpfad

| Stufe              | Ticket  | Ergebnis                                         |
| ------------------ | ------- | ------------------------------------------------ |
| Modulgrenze        | EYT-105 | Kostenmodul besitzt klare Ownership              |
| Geldvertrag        | EYT-95  | Money, Rundung und Historie sind deterministisch |
| Identität          | EYT-106 | realer berechtigter Browsernutzer                |
| Planquelle         | EYT-107 | unveränderliche veröffentlichte Planversion      |
| Satzbasis          | EYT-108 | wirksamer versionierter Stundensatz              |
| Kostenwert         | EYT-109 | täglicher Snapshot und sichtbare Kosten          |
| Weiterverarbeitung | EYT-110 | XLSX entspricht demselben Snapshot               |

## CAN-002 – Dependency DAG

```text
EYT-105 ─┐
EYT-95  ─┼──────────────┐
EYT-106 ─┤              │
EYT-107 ─┼──> EYT-109 ──┼──> EYT-110
EYT-108 ─┘              │
                        └──> sichtbares Sprintziel
```

EYT-109 darf nicht als abgeschlossen gelten, solange eine harte Vorbedingung nur simuliert wird.

## CAN-003 – Kerninvarianten

| ID      | Invariante                                                       |
| ------- | ---------------------------------------------------------------- |
| INV-001 | Kosten werden nur aus einer veröffentlichten Planversion erzeugt |
| INV-002 | Geld wird in Minor Units berechnet                               |
| INV-003 | Am Leistungsdatum gilt genau eine Satzversion                    |
| INV-004 | Fehlende oder mehrdeutige Sätze blockieren                       |
| INV-005 | Snapshot und Positionen sind unveränderlich                      |
| INV-006 | UI und XLSX verwenden dieselbe Snapshot-ID                       |
| INV-007 | Organisation und Rechte werden serverseitig aufgelöst            |
| INV-008 | Mitarbeiterzugriff wird in API und RLS abgelehnt                 |
| INV-009 | Retry erzeugt keine Doppelwirkung                                |
| INV-010 | Parallele Änderungen verletzen keine fachliche Eindeutigkeit     |

## CAN-004 – Scopeklassen mit Begründung (Preflight Stufe 1, lesend gemessen 2026-07-30)

Grundlage für `plumbline-scope-check`. Der Intake führte diese Pfade als **ASSUMPTION**;
die folgende Liste ist gegen `origin/master` @ `f9da445` **gelesen** worden. Was gemessen
wurde, ist als `gemessen` markiert; alles andere bleibt `ASSUMPTION` bis zur vollständigen
Scope Dependency Closure (CAN-005).

### Feature Scope

- `apps/api/src/modules/costs/**` — _existiert nicht_ (gemessen: `apps/api/src/modules/`
  enthält nur `planning/`, `worksites/`, `workforce/`, `module-catalogue.ts`). Wird neu angelegt.
- `apps/api/src/modules/planning/application/**` — nur **lesende** öffentliche Application-API
  bzw. expliziter Port für Planfakten (ASSUMPTION: Portname noch offen).
- `packages/contracts/src/costs/**` — neu (gemessen: `src/` hat heute `planning/`, `employee/`,
  `http/`, `openapi/`, `mock/`, `gateway.ts`, `primitives.ts`, `api-metadata.ts`).
- `packages/contracts/src/index.ts` — Re-Export.
- `packages/domain/src/**` — Money-/Rundungs-/Effective-Date-Kern aus EYT-95 (ASSUMPTION:
  Dateizuschnitt offen).
- `apps/web/app/kosten/**` — neu (gemessen: `apps/web/app/` hat heute nur `planung/`).
- `apps/web/lib/**` — Costs-Gateway-Factory und -Provider analog `planning-gateway-factory.ts`.

### Composition Wiring

- `apps/api/src/app.module.ts`
- `apps/api/src/modules/module-catalogue.ts` — **`MODULE_SLUGS` enthält `costs` heute nicht.**
  Die Liste ist als „eine eingefrorene Liste von zehn Slugs, abgeleitet aus ADR-001 Z. 60"
  dokumentiert; `costs` zu ergänzen ist deshalb eine **Architekturänderung mit ADR-Pflicht**
  (deckungsgleich mit EYT-105 AC 1). Siehe `CAN-RISK-03`.
- `apps/web/app/providers.tsx` — einziger Konstruktionsort für Gateways.
- `apps/web/next.config.ts` — nur falls ein zusätzlicher Rewrite nötig wird (ASSUMPTION).

### Dependency Wiring

- `apps/api/package.json`, `pnpm-lock.yaml` — **keine XLSX-Bibliothek im Repository**
  (gemessen: kein Treffer für `xlsx`/`exceljs` in irgendeiner `package.json`). Neue
  Laufzeitabhängigkeit ⇒ Supply-Chain-Prüfung durch `security-reviewer` ist Pflicht.

### Database Scope

- `supabase/migrations/<timestamp>_0013_*.sql` und folgende — append-only, forward-fix
  (gemessen: höchste vorhandene Nummer ist `0012_idempotency_records`).
- `supabase/tests/*.sql` — pgTAP, RLS, Grants, Nebenläufigkeit.
- `supabase/seed.sql` — nur synthetische Daten mit festen UUID-v4.
- Katalog-Meta-Gate: jede neue Tabelle muss registriert werden, sonst wird `db-gates` rot.

### Evidence Wiring

- `.github/workflows/ci.yml` — **einziger** Workflow (gemessen). Jobs heute: `format`, `lint`,
  `typecheck`, `unit-tests`, `build-web`, `web-smoke`, `build-api`, `secret-scan`, `db-gates`,
  `read-through`.
- Testorte: `apps/api/test/**`, `packages/domain/test/**`, `packages/contracts/test/**`,
  `apps/web/test/**`, `apps/web/e2e/**`.
- `scripts/setup-branch-protection.sh` **und** `scripts/verify-branch-protection.sh` — beide
  führen unabhängige Kopien der Pflichtcheck-Liste; ein **neuer CI-Job zwingt zur Änderung
  beider**, sonst bricht `verify` mit internem Drift-Fehler ab.

### Generated Artifacts

- `packages/contracts/openapi/v1.json` — **ausschließlich** über
  `pnpm --filter @easytree/contracts run openapi:write`; niemals von Hand.

### Governance Scope

- `docs/**` — ADR, Vision, Canvas, PRD, Traceability, Reality Ledger, Runbooks.

### Nachträgliche Scopeaufnahme — EYT-106, Supabase-TLS (Freigabe PO 31.07.2026)

**Freigabe:** Product Owner, 31.07.2026. **Ticket:** EYT-106.

**Anlass, gemessen:** die direkte Supabase-Verbindung erreicht über Railway-IPv6 die
Datenbank — `ENETUNREACH` ist nach Aktivierung von Outbound-IPv6 verschwunden. Der Start
scheitert seither **fail-closed** an der nicht vertrauten projektbezogenen
Zertifikatskette: `self-signed certificate in certificate chain`. Ursache ist, dass
`pg` 8.22 `sslmode=require` wie `verify-full` behandelt und Node Supabases CA nicht kennt.

**Ziel:** eine zentrale, **vollständig verifizierende** PostgreSQL-TLS-Konfiguration für
alle drei Zugriffspfade — Startgate (EYT-45), Readiness-Ping und fachliche
Tenant-Abfragen. Heute baut jede der drei Stellen ihre Verbindung selbst; drei getrennte
TLS-Implementierungen sind drei Gelegenheiten, an genau einer die Kettenprüfung zu
verlieren, ohne dass es auffällt.

**Ausdrücklich keine Abschwächung.** Weder `rejectUnauthorized: false` noch
`sslmode=no-verify` noch `uselibpqcompat=true&sslmode=require` ohne Wurzelzertifikat noch
`NODE_TLS_REJECT_UNAUTHORIZED=0`. Die Hostnamenprüfung bleibt aktiv. Ein Wechsel auf den
Session-Pooler als **Umgehung** dieses TLS-Problems ist ebenfalls ausgeschlossen.

**Diese Freigabe autorisiert genau die unten aufgeführten Pfade und keine weiteren.**

- `packages/config/src/certificate.ts` — PEM-Normalisierung an der Konfigurationsgrenze.
- `packages/config/src/schema.ts` — `DATABASE_SSL_ROOT_CERT` in `ENV_VAR_META`, allen drei
  Presets und `AppConfig`; in `production` Pflicht ohne Default.
- `packages/config/src/load.ts` — Mapping in die validierte Konfiguration.
- `packages/config/src/redact.ts` — Schwärzung, damit kein PEM in Logs oder Meldungen steht.
- `packages/config/test/**` — die roten Tests dazu.
- `apps/api/src/platform/database/pg-connection.ts` — die **eine** gemeinsame Factory.
- `apps/api/src/platform/database/role-privileges.ts` — Startgate nutzt die Factory.
- `apps/api/src/platform/database/pg-database-ping.ts` — Readiness nutzt die Factory.
- `apps/api/src/platform/database/tenant-query-runner.ts` — Tenant-Abfragen nutzen die Factory.
- `.env.example` — Platzhalter, **niemals** ein echtes Zertifikat.
- `CLAUDE.md` — Snapshotkorrektur nach Read-after-write.

`packages/config/src/index.ts` ist **nicht** aufgenommen. Es wird nur ergänzt, wenn ein
**gemessener** Consumer einen öffentlichen Export braucht — nicht vorsorglich.

### Zweite nachträgliche Scopeaufnahme — EYT-106, Composition-Wiring (Freigabe PO 31.07.2026)

**Freigabe:** Product Owner, 31.07.2026. **Ticket:** EYT-106.

**Anlass:** Weitergabe der Supabase-Root-CA von `AppConfig` an alle realen
PostgreSQL-Zugriffspfade. Die drei Dateien sind die notwendigen Composition- und
Dependency-Wiring-Punkte: sie reichen das bereits validierte `databaseSslRootCert`
aus `AppConfig` an API-Bootstrap, Worker-Bootstrap und `TenantQueryRunner` weiter.
Ein direkter Zugriff auf `process.env` innerhalb der PostgreSQL-Factory ist nicht
zulässig — die zentrale Zod-Validierung, Redaction und Dependency Injection dürfen
nicht umgangen werden.

**Keine Abschwächung:** vollständige Zertifikats- und Hostnamenprüfung bleibt
erhalten; kein `rejectUnauthorized=false`, kein `NODE_TLS_REJECT_UNAUTHORIZED=0`,
kein `sslmode=no-verify`.

**Diese Freigabe autorisiert genau drei Dateien und keine weiteren** — keine
breiteren Globs:

- `apps/api/src/main.ts` — Einspritzpunkt der Rollenprüfung erhält `databaseUrl` + `databaseSslRootCert`.
- `apps/api/src/worker.ts` — derselbe Einspritzpunkt im Worker-Bootstrap.
- `apps/api/src/platform/database/tenant-query-runner.provider.ts` — Pool-Konstruktion über die Factory.

### Dritte Scopeaufnahme — kundensichtbarer Slice Login→Tageskosten→Export (PO-Weisung 01.08.2026)

**Freigabe:** Product Owner, 01.08.2026 — Weisung „Starte unmittelbar den nächsten
kundensichtbaren vertikalen Slice" (echter Login, serverseitige Tokenprüfung,
Organisations-/Mitgliedschaftsauflösung, Rechte `costs.read`/`costs.calculate`/
`costs.export`, Tageskostenansicht, Excel-Export, deployter Web-Client).
**Ticket:** EYT-106 (Slice-Kern), berührt EYT-109/EYT-110 nur im minimal nötigen Umfang.

- `apps/api/src/platform/auth/**` — Tokenverifikation (jose, ES256-Allowlist, JWKS)
  als Plattformbaustein, dieselbe Bauart wie `platform/database`.

Nach der Repository-Inspektion (01.08.2026, fünf parallele Leser) die weiteren
tatsächlich benötigten Slice-Pfade, je mit Bauabschnitt (PO-§12: exakte Pfade,
keine Repository-Globs, kein erneuter Freigabestopp):

- `packages/contracts/src/auth/**` — Login-/Session-Verträge (Schritt 1).
- `packages/contracts/src/http/**` — HTTP-Gateways nach `planning-gateway`-Muster (Schritte 1, 3).
- `packages/contracts/src/openapi/**` — Registrierung der neuen Operationen (Schritte 1, 3).
- `packages/contracts/src/primitives.ts` — nur falls ein geteiltes Primitiv ergänzt werden muss.
- `apps/api/src/modules/tenancy/**` — Auth-Controller, Mitgliedschafts-/Organisationsauflösung (Schritte 1, 3).
- `apps/api/src/common/**` — Request-Identität ersetzt den Platzhalter-Subjektresolver (Schritt 1).
- `apps/web/app/anmelden/**` — Login-Seite (Schritt 4).
- `apps/web/app/globals.css` — Basisdesign-v2.0-Tokens (Schritt 4).
- `apps/web/app/layout.tsx` — AppShell-Einbindung, falls nötig (Schritt 4).
- `apps/web/components/**` — AppShell-Navigation mit Rechtefilter, CostSnapshotTable, Kostenansichten (Schritt 4).
- `packages/ui/src/**`, `packages/ui/test/**` — PageHeader, StatusBadge, StateBanner, PrimaryAction, EmptyState, ErrorState (Basisdesign §6; Schritt 4).
- `docs/runbooks/**` — Demoablauf für den Kunden (Schritt 7, bereits gedeckt über docs/runbooks).
- `.gitleaksignore` — einzelne geprüfte Fingerprints für den `secret-scan`-Pflichtcheck
  (CI-Fix 01.08.2026). Ausschließlich Fingerprint-Einträge; keine Pfad-, RuleID- oder
  Regex-Allowlist, keine Abschwächung der Gitleaks-Konfiguration.

## Allowed change scope

Maschinenlesbar für `plumbline-scope-check`. Inhaltlich identisch mit CAN-004 — **keine
Pfaderweiterung**, nur ein Format, das der Parser liest (er nimmt ausschließlich Listenzeilen
aus einer Sektion mit genau dieser Überschrift). Der Governance-Block ist gegenüber CAN-004
(`docs/**`) **enger** gefasst und zählt Unterpfade auf.

- apps/api/src/modules/costs/**
- apps/api/src/modules/planning/application/**
- packages/contracts/src/costs/**
- packages/contracts/src/index.ts
- packages/domain/src/**
- apps/web/app/kosten/**
- apps/web/lib/**
- apps/api/src/app.module.ts
- apps/api/src/modules/module-catalogue.ts
- apps/web/app/providers.tsx
- apps/web/next.config.ts
- apps/api/package.json
- pnpm-lock.yaml
- supabase/migrations/*.sql
- supabase/tests/**
- supabase/seed.sql
- .github/workflows/ci.yml
- apps/api/test/**
- packages/domain/test/**
- packages/contracts/test/**
- apps/web/test/**
- apps/web/e2e/**
- scripts/setup-branch-protection.sh
- scripts/verify-branch-protection.sh
- scripts/plumbline-scope-guard.sh
- packages/contracts/openapi/v1.json
- docs/canvas/**
- docs/vision/**
- docs/prd/**
- docs/plans/**
- docs/context/**
- docs/architecture/**
- docs/runbooks/**
- docs/retros/**
- docs/traceability.md
- packages/config/src/certificate.ts
- packages/config/src/schema.ts
- packages/config/src/load.ts
- packages/config/src/redact.ts
- packages/config/test/**
- apps/api/src/platform/database/pg-connection.ts
- apps/api/src/platform/database/role-privileges.ts
- apps/api/src/platform/database/pg-database-ping.ts
- apps/api/src/platform/database/tenant-query-runner.ts
- .env.example
- CLAUDE.md
- apps/api/src/main.ts
- apps/api/src/worker.ts
- apps/api/src/platform/database/tenant-query-runner.provider.ts
- apps/api/src/platform/auth/**
- packages/contracts/src/auth/**
- packages/contracts/src/http/**
- packages/contracts/src/openapi/**
- packages/contracts/src/primitives.ts
- apps/api/src/modules/tenancy/**
- apps/api/src/common/**
- apps/web/app/anmelden/**
- apps/web/app/globals.css
- apps/web/app/layout.tsx
- apps/web/components/**
- packages/ui/src/**
- packages/ui/test/**
- .gitleaksignore

### Nachtraegliche Scopeaufnahme (PO-Weisung 30.07.2026 §4)

Ein einziger Pfad wurde nach der Bestaetigung aufgenommen: `scripts/plumbline-scope-guard.sh`.
Grundlage ist die woertliche PO-Weisung zum Tooling-Stop-Gate — „Bevorzuge eine projektlokale,
reversible Konfiguration oder einen Wrapper. Veraendere nicht still die gemeinsam genutzte
Plumbline-Installation." Der Wrapper ist damit ausdruecklich angeordneter Liefergegenstand, und
die Aufnahme ist keine Agenten-Ermessensentscheidung. Kein weiterer Pfad kam hinzu.

### Bewusst nicht enthalten

`docs/design/**`. Die beiden untracked Dateien
`docs/design/EASYTREE_BASISDESIGN_v2.md` und `docs/design/easytree-basisdesign-preview.html`
(angelegt 30.07.2026 03:02, Quellen laut Kopfzeile u. a. „PRD v1.4" und „Sprint-5-Baseline")
gehören zur Enforcement-Oberfläche, sind aber nicht vom Nutzer in den Sprint-5-Scope
aufgenommen worden. Aufnahme ist eine **Scope-Entscheidung des Product Owners** und wird nicht
von einem Agenten getroffen.

## CAN-005 – Pre-Coding Scope Gate

Vor dem ersten Schreibzugriff auf eine Produktdatei muss aus dem tatsächlichen Repository
abgeleitet sein:

1. alle Featurepfade;
2. Composition-Root-Änderungen;
3. Package- und Lockfilefolgen;
4. Generator-/Output-Beziehungen;
5. Testdateien;
6. CI-Jobs und Schritte;
7. Migration und Rollbackpfade.

Das Ergebnis wird als **Scope Dependency Closure** protokolliert. Stufe 1 (Punkte 1–4, 7 grob)
liegt oben vor; **Punkte 5 und 6 sind offen** (`OQ-002`, `OQ-003`).

Ein vorhersehbarer, aber fehlender Wiring-Pfad nach Codingbeginn zählt als Intake-Fehler.

## CAN-006 – Anti-Abkürzungen

Nicht zulässig:

- Mock-Login als Evidence für den vertikalen Kostenpfad;
- serverseitig injiziertes Testsubjekt im abschließenden E2E;
- Kostenberechnung im Browser;
- zweite Berechnung im XLSX-Renderer;
- Null-Euro-Ersatz für fehlenden Satz;
- nur sequenzielle Tests für parallele Invarianten;
- Testdatei ohne CI-Ausführung;
- ein grüner fremder Test als Ersatz;
- Done nur aufgrund der sichtbaren UI-Reise.

## CAN-007 – Reihenfolge und Parallelität (Baseline §7, vom PO bestätigt)

```text
1. EYT-105  Kostenmodul + ADR            ─┐ begrenzt parallel
2. EYT-95   Money-/Rate-/Rundungsvertrag ─┤
3. EYT-106  Auth + atomare Kostenrechte  ─┘
4. EYT-107  Publish-Core
5. EYT-108  Mitarbeiter-Stundensatz
6. EYT-109  Tageskosten-Snapshot + /kosten     ← erst nach den vier harten Vorbedingungen
7. EYT-110  XLSX aus demselben Snapshot        ← erst nach stabilem Snapshot
```

Auth und Publish müssen belastbar stehen, **bevor** der sichtbare Kostenpfad beginnt.

## CAN-008 – Rollback und Migration (Baseline §9)

Nur expandierende append-only Migrationen (nächste Nummer `0013`). Route und UI sind durch
Entfernen der Komposition zurücknehmbar; die Planungsroute bleibt unberührt. Persistierte
Snapshots bleiben lesbar — **keine destruktive Down-Migration** nach echtem Datenbestand. Der
XLSX-Adapter ist hinter einem Port austauschbar. Fehlerhafte Berechnungsregeln werden über neue
Regelversion und Forward-Fix korrigiert; historische fehlerhafte Snapshots werden **markiert,
nicht still überschrieben**. Vor Release: Restore- und Forward-Fix-Nachweis.

## Risiken und Widersprüche

| ID           | Typ                          | Befund                                                                                                                                                                                                                                                                                                                                                                                                        | Status                                                                                                                                                                                                                                 |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAN-DRIFT-00 | Doku-Drift, **kein Blocker** | **`DOC-DRIFT-S5-001`** — Maßgeblich ist Confluence **PRD v1.4** (Seite 7766017, 28.07.2026), die v1.3 für MVP-Scope und Phasen ersetzt: FR-008 Interne Kostensätze, FR-009 Plan-Kosten, FR-010 Ist-Kosten, FR-011 Kostenübersicht, FR-012 Excel-Kostenexport; §7 führt sie unter **Im MVP**. Das Repository bildet das nicht ab (`docs/prd/` nur v1.3; `CLAUDE.md` nennt Planungsökonomie pauschal Post-MVP). | **sichtbar halten, später synchronisieren.** Sprint 5 ist MVP-Scope; keine Post-MVP-Phaseneröffnung nötig. Der frühere Befund `CONTRA-S5-001` war ein Quellenbereichsfehler und ist als `FALSE_POSITIVE_SOURCE_SCOPE_ERROR` aufgelöst. |
| CAN-RISK-01  | Kapazität                    | **Sprintumfang.** Sieben Tickets, sechs eigene vertikale Schnitte; Sprint 4 lieferte einen Schnitt pro Sprint.                                                                                                                                                                                                                                                                                                | **entschieden 30.07.2026:** voller Scope, keine Must-Kürzung, Start-Gate geschlossen. Bei Zeitmangel Verlängerung statt Kürzung.                                                                                                       |
| CAN-RISK-02  | Evidence / Auth              | **Reale Auth-Testumgebung (`OQ-005`).** REQ-002 verbietet die Subjektinjektion im abschließenden E2E; genau darüber lief der Sprint-4-Nachweis. Produktions-Policy ist heute `deny all`; der Supabase-Stack startet auf dieser Maschine nicht.                                                                                                                                                                | **teilentschieden:** Kürzung ausgeschlossen (PO). Offen bleibt, ob der Nachweis lokal, in CI oder beides entsteht — der Preflight misst es und legt es vor.                                                                            |
| CAN-RISK-03  | Architektur                  | **`costs` fehlt in `MODULE_SLUGS`.** Liste gilt als eingefroren und aus ADR-001 abgeleitet; `architecture.test.ts` und `architecture-red-case.test.ts` hängen daran.                                                                                                                                                                                                                                          | benannt, lösbar — neue ADR (EYT-105 AC 1), Rot-Fähigkeit erhalten.                                                                                                                                                                     |
| CAN-RISK-04  | Supply Chain                 | **Keine XLSX-Bibliothek vorhanden.** Erste neue Laufzeitabhängigkeit im Kostenpfad.                                                                                                                                                                                                                                                                                                                           | benannt — `security-reviewer` bewertet vor dem Lockfile-Eintrag.                                                                                                                                                                       |
| CAN-RISK-05  | Evidence                     | **CI-Bindung 0 von 8.** REQ-G01 verlangt sie vor Coding; REQ-008 verlangt, dass die Nachweise tatsächlich laufen.                                                                                                                                                                                                                                                                                             | offen (`OQ-002`, `OQ-003`) — schließe ich im Preflight, keine Nutzerfrage.                                                                                                                                                             |
| CAN-RISK-06  | Metadaten                    | Confluence-Kopf „Sprintkandidat, Developers-Gate offen" und §11 „Jira-Sprint-Container existiert noch nicht"; Label `sprint-5-candidate`.                                                                                                                                                                                                                                                                     | **gemessen veraltet** (DIV-S5-001/002/003) — Confluence und Labels nachziehen, kein fachlicher Widerspruch.                                                                                                                            |

## Offene Fragen (nicht durch einen Agenten zu schließen)

| ID     | Typ         | Inhalt                                              | Wirkung                                                                                                   |
| ------ | ----------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| OQ-001 | MISSING     | exakte Repository-Pfadliste                         | Stufe 1 geliefert (CAN-004), Rest offen                                                                   |
| OQ-002 | MISSING     | Testdatei je Requirement                            | Pre-Coding-Gate — Claude schließt es im Preflight                                                         |
| OQ-003 | MISSING     | Workflow, Job und Schritt je Evidence               | Pre-Coding-Gate — Claude schließt es im Preflight                                                         |
| OQ-004 | ~~MISSING~~ | bestätigte Entwicklerkapazität                      | **geschlossen 30.07.2026** durch PO-Entscheidung (Start, nicht Ende)                                      |
| OQ-005 | MISSING     | reale Auth-Testumgebung (lokal und/oder CI)         | REQ-002 — Kürzung ausgeschlossen, Ort des Nachweises offen                                                |
| OQ-006 | ~~CONTRA~~  | Confluence „Sprintkandidat" vs. aktiver Jira-Sprint | **gelöst durch Messung** — nur Etiketten nachziehen                                                       |
| OQ-007 | aufgelöst   | früher `CONTRA-S5-001`                              | **`FALSE_POSITIVE_SOURCE_SCOPE_ERROR`** (PO, 30.07.2026) → ersetzt durch `DOC-DRIFT-S5-001`; kein Blocker |
| AS-001 | ASSUMPTION  | Typed Scope reduziert spätere Freigaben             | Experiment messen                                                                                         |
| AS-002 | ASSUMPTION  | Evidence Binding reduziert False-Green              | Experiment messen                                                                                         |

## Baseline-Abgleich (PO-Auflage vom 30.07.2026)

Auflage: als bestätigt markieren erst nach Abgleich ohne materielle Abweichung.

**Abgleich abgeschlossen am 30.07.2026, zweiter Durchlauf.** Geprüft gegen die vom PO
festgelegte Autoritätsordnung — Confluence PRD v1.4 (7766017), Confluence Sprint-5-Seite
(8552449), Jira EYT-95/105–110, Repository-PRD v1.3, `CLAUDE.md`. Ergebnis:

- neun Abweichungen protokolliert, acht davon in den Artefakten korrigiert (DIV-S5-001…009);
- **keine materielle Abweichung mehr offen**;
- verblieben: `DOC-DRIFT-S5-001` (Repository bildet PRD v1.4 nicht ab) — sichtbar, kein Blocker;
- lokale Zusätze ohne Baseline-Gegenstück sind als REQ-G01/REQ-G02 abgetrennt und gelten
  ausdrücklich **nicht** als mitbestätigt.

## Bestätigungsblock

Zur Bestätigung durch den Nutzer — **nicht durch Claude, Plumbline oder einen anderen Agenten
zu simulieren**:

> Ich bestätige, dass Product Canvas und Product Vision meine Absicht korrekt wiedergeben und
> als Grundlage für AgileTeam Planning verwendet werden dürfen.

Nach Bestätigung werden die beiden Kopfzeilen dieses Dokuments auf den bestätigten Stand
gesetzt, mit Datum und Bestätiger. (Die Marker sind hier bewusst **nicht** ausgeschrieben:
`plumbline-context-check` prüft per Teilstring und würde ein Beispiel im Fließtext als echte
Bestätigung werten.)
