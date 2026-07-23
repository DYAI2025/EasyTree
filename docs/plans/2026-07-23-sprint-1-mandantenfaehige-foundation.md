# easyTree Sprint 1 – Mandantenfähige Foundation Implementation Plan

Plan path: `docs/plans/2026-07-23-sprint-1-mandantenfaehige-foundation.md`  
Status: draft / ready after Developer capacity confirmation  
Last updated: 2026-07-23  
Sprint window: 2026-07-27 to 2026-08-09  
Jira scope: EYT-13, EYT-15, EYT-40, EYT-41, EYT-42, EYT-43, EYT-44

<!-- GOAL_START -->
Goal: Mandantenfähige easyTree-Foundation für Sprint 1

Ziel. Innerhalb des zweiwöchigen Sprints entsteht eine lokal reproduzierbare technische Basis für easyTree. Ein frischer Checkout startet die mobile Web-Shell, die Backend-API, den getrennten Worker und den lokalen Supabase-Stack. Die wichtigste spätere SaaS-Voraussetzung wird früh bewiesen: Zwei synthetische Organisationen können weder über API, Datenbank noch Storage auf Daten der jeweils anderen zugreifen.

Scope. Umsetzung auf einem neuen Feature-Branch des aktuellen Default-Branches im Repository `DYAI2025/EasyTree`. Zielstruktur: `apps/web`, `apps/backend`, klar benannte `packages/*`, `supabase/migrations`, `supabase/tests` und `docs`. Der Sprint umfasst ausschließlich Boilerplate, lokale Entwicklungsfähigkeit, minimale Health-Smokes, Konfigurationsvalidierung, SQL-Migrationsgrundlage und einen reproduzierbaren Tenant-Isolation-Spike.

Bedingungen (hart).
- Keine direkten Commits auf `master`; Änderungen erfolgen in kleinen, reviewbaren Patches.
- Keine operativen Browser- oder Agentenwrites direkt nach Supabase.
- Normale API- und Workerpfade verwenden weder Service Role noch `BYPASSRLS`.
- SQL-Migrationen sind die einzige Schemaquelle.
- Keine echten Mitarbeiter-, Kunden- oder Baustellendaten in Entwicklung oder Tests.
- Kein Microservice-, Kubernetes-, Kafka-, Billing- oder Fachfeature-Ausbau in diesem Sprint.

Akzeptanzkriterien.
- Ein dokumentierter Fresh Checkout installiert Abhängigkeiten und startet Web, API, Worker und lokalen Supabase-Stack ohne manuelle Dashboardänderung.
- Root-Kommandos für Formatierung, Lint, Typprüfung, Tests und Build sind definiert und erfolgreich ausführbar.
- API-Health, API-Readiness, Worker-Start und Web-Smoke sind automatisiert prüfbar.
- Fehlerhafte oder fehlende Konfiguration verhindert den Prozessstart; Secrets erscheinen nicht in Logs oder Fehlern.
- Migrationen und Seeds erzeugen zwei synthetische Organisationen mit Memberships und privaten Testobjekten.
- Cross-Tenant-Lese-, Schreib-, IDOR-, Fremdschlüssel- und Storage-Versuche werden reproduzierbar abgelehnt.
- Der gewählte RLS- und Connection-Pooling-Ansatz ist durch Datenbank- und Integrationstests belegt oder als `BLOCKER` dokumentiert.

Explizit out-of-scope.
- OpenAPI-Client, Transactional Outbox und produktive Jobqueue.
- Planungs-, Baustellen-, Arbeitszeit-, Wetter- oder Benachrichtigungsfunktionen.
- Produktivdeployment, produktive Datenmigration und Produktionsfreigabe.
- Vollständige CI-/Supply-Chain-Härtung aus EYT-32.
- Native Apps, Offline-Schreibqueue und Kundenabrechnung.

Done-Definition. Alle sieben Sprinttickets erfüllen ihre Akzeptanzkriterien, die integrierte Fresh-Checkout-Prüfung ist dokumentiert, Tenantisolation ist durch automatisierte Negativtests belegt und ein Review bestätigt, dass keine verbotenen Architekturabkürzungen eingeführt wurden.

Reference-Doc: `docs/architecture/ADR-001-boilerplate-architecture.md`, `docs/plans/2026-07-23-boilerplate-architecture.md`
<!-- GOAL_END -->

## Evidence and source boundary

### Inspected evidence

- Jira-Sprintkandidat: EYT-13, EYT-15, EYT-40 bis EYT-44.
- Sprintziel: lokal reproduzierbare, mandantenfähige Foundation mit nachgewiesener Tenantisolation.
- Architekturentscheidung: TypeScript-Split-Monolith mit Next.js, NestJS, Supabase Postgres/Auth/Storage sowie API- und Worker-Entrypoint.
- Repository-Dokumente: `docs/architecture/ADR-001-boilerplate-architecture.md` und `docs/plans/2026-07-23-boilerplate-architecture.md`.
- Das Repository enthält vor Sprintbeginn noch keine belastbare Anwendungscodebasis.

### MISSING

- bestätigte Entwicklerkapazität und Abwesenheiten;
- verbindliche Schätzungen;
- verifizierte Node-, pnpm-, Framework- und Supabase-CLI-Versionen;
- unterstützte lokale Betriebssysteme;
- Branch-Protection- und Reviewregeln.

### BLOCKER

Wenn RLS und der gewählte Poolingmodus den Tenantkontext nicht zuverlässig isolieren, stoppt der Domainausbau. Service Role oder `BYPASSRLS` sind keine zulässige Umgehung.

## Requirements

| ID | Anforderung | Verifikation |
|---|---|---|
| REQ-F-001 | Fresh Checkout startet Web, API, Worker und Supabase | dokumentierter Fresh-Checkout-Smoke |
| REQ-F-002 | Mobile und zugängliche Web-Shell | Browser-, Tastatur-, Fokus- und Zoom-Smoke |
| REQ-F-003 | API und Worker sind getrennte Prozesse | Start-, Health- und Shutdown-Tests |
| REQ-F-004 | Supabase ist aus Repositorydateien reproduzierbar | zweifacher DB-Reset |
| REQ-F-005 | Zwei Organisationen sind vollständig isoliert | Cross-Tenant-Negativtests |
| REQ-NF-001 | Toolchain und Builds sind deterministisch | Clean Install und Root-Kommandos |
| REQ-NF-002 | Fehlerhafte Konfiguration stoppt früh | Konfigurations-Negativtests |
| REQ-A-001 | Split-Monolith-Struktur wird eingehalten | ADR- und Architekturreview |
| REQ-A-002 | Keine operativen Browserwrites | Import- und Codeprüfung |
| REQ-D-001 | SQL-Migrationen sind einzige Schemaquelle | reproduzierbarer Reset |
| REQ-D-002 | Cross-Tenant-Referenzen sind ausgeschlossen | Constraint- und FK-Tests |
| REQ-S-001 | Tenantkontext stammt aus verifizierter Membership | Auth- und Membership-Tests |
| REQ-S-002 | Keine RLS-Umgehung im Laufzeitpfad | Laufzeit- und Konfigurationsreview |
| REQ-S-003 | Keine Secrets in Repository oder Logs | Redaction- und Secret-Scan |
| REQ-O-001 | API und Worker sind diagnostizierbar | Health-, Readiness- und Shutdown-Test |

## Zielstruktur

```text
apps/
├── web/                     Next.js-Web-/PWA-Shell
└── backend/
    ├── src/api.ts           API-Entrypoint
    ├── src/worker.ts        Worker-Entrypoint
    └── src/modules/         spätere Domainmodule

packages/
├── config/                  Konfigurationsschemas
├── ui/                      zugängliche UI-Primitives
└── test-support/            synthetische Test-Fixtures

supabase/
├── config.toml
├── migrations/
├── tests/
└── seed.sql
```

## Abhängigkeiten und Reihenfolge

```text
EYT-13
  -> EYT-40
       -> EYT-43 -> EYT-42
       -> EYT-41
       -> EYT-44 -> EYT-15
EYT-42 + EYT-44 -> integrierter Tenant-Isolation-Nachweis
```

WIP-Limit: maximal zwei aktive Tickets. EYT-15 beginnt erst, wenn Backend und lokaler Supabase-Stack stabil und reproduzierbar starten.

## Tasks

### TASK-001 – Architekturvertrag finalisieren

Jira: EYT-13

1. Repository und Default-Branch prüfen.
2. ADR, Boilerplate-Plan und Jira-Akzeptanzkriterien vergleichen.
3. Modul-, Daten-, Sicherheits- und Deploymentgrenzen bestätigen.
4. Nicht verifizierte Toolversionen als `MISSING` behandeln.
5. Verbotene Architekturabkürzungen dokumentieren.

Abnahme:
- ADR, Jira und Sprintplan widersprechen sich nicht.
- Alle sieben Sprinttickets sind eindeutig zugeordnet.
- Kein zurückgestelltes Feature befindet sich im Sprintscope.

### TASK-002 – Monorepo und Root-Toolchain aufbauen

Jira: EYT-40

1. Bestehende Manifeste und Lockfiles inventarisieren.
2. Kompatible Toolversionen aus Primärquellen verifizieren.
3. Fehlgeschlagenen Workspace-Smoke schreiben.
4. pnpm-Workspace und Turborepo minimal anlegen.
5. Root-Kommandos für Formatierung, Lint, Typprüfung, Tests und Build definieren.
6. Clean Install sowie gefilterte Web- und Backend-Builds ausführen.

Abnahme:
- genau ein Package Manager und Lockfile;
- Root-Kommandos funktionieren;
- Web und Backend können separat gebaut werden.

### TASK-003 – Konfiguration und Secrets absichern

Jira: EYT-43

1. Tests für fehlende, falsch typisierte und unbekannte Variablen schreiben.
2. Tests für Secretwerte in Fehlern und Logs schreiben.
3. Typisiertes Konfigurationsschema implementieren.
4. öffentliche Webvariablen von Serversecrets trennen.
5. Web, API und Worker mit synthetischer Konfiguration starten.

Abnahme:
- ungültige Konfiguration stoppt vor Netzwerk- oder Datenbankzugriff;
- Secrets werden redigiert;
- `.env.example` enthält keine echten Zugangsdaten.

### TASK-004 – API und Worker scaffolden

Jira: EYT-42

1. Fehlgeschlagene Tests für API-Health und Readiness schreiben.
2. Fehlgeschlagenen Worker-Starttest schreiben.
3. API-Entrypoint minimal implementieren.
4. Worker-Entrypoint ohne unbeabsichtigten HTTP-Port implementieren.
5. Correlation-ID, strukturierte Fehler und Graceful Shutdown ergänzen.
6. API und Worker gemeinsam starten und kontrolliert beenden.

Abnahme:
- API-Health und Readiness sind prüfbar;
- Worker startet separat;
- beide Prozesse beenden sich ohne hängende Handles.

### TASK-005 – Mobile Web-/PWA-Shell erstellen

Jira: EYT-41

1. Fehlgeschlagenen Rendering-Smoke schreiben.
2. Responsive Next.js-Shell implementieren.
3. semantisches HTML, sichtbaren Fokus und non-color Status ergänzen.
4. minimales PWA-Manifest erstellen.
5. keine Offline-Schreibqueue implementieren.
6. Smartphonebreiten und 200-%-Zoom prüfen.

Abnahme:
- keine horizontale Scrollleiste auf bestätigten Smartphonebreiten;
- zentrale Shell ist mit Tastatur bedienbar;
- Browser schreibt nicht direkt in operative Tabellen.

### TASK-006 – Lokalen Supabase-Stack aufbauen

Jira: EYT-44

1. Fehlgeschlagenen Datenbank-Smoke schreiben.
2. lokale Supabase-Konfiguration anlegen.
3. Migrationen für Organisationen und Memberships erstellen.
4. zwei synthetische Organisationen seeden.
5. private Storage-Buckets per Migration definieren.
6. Datenbank zweimal vollständig resetten.

Abnahme:
- kein manueller Dashboard-Schritt erforderlich;
- Reset erzeugt Schema, Policies, Buckets und Seeds;
- Migrationen funktionieren in einer leeren Datenbank.

### TASK-007 – Tenant-Isolation beweisen

Jira: EYT-15

1. Negativtests schreiben: Tenant A liest, verändert oder referenziert Objekt von Tenant B.
2. Storage-Zugriff zwischen Tenants testen.
3. manipulierte Tenant-ID über Request testen.
4. JWT-Verifikation und interne Membership-Auflösung implementieren.
5. Tenantkontext ausschließlich serverseitig ableiten.
6. tenantgebundene Fremdschlüssel und RLS-Policies ergänzen.
7. normale API- und Workerrolle ohne RLS-Umgehungsrechte konfigurieren.
8. Same-Tenant-Positivtests ergänzen.
9. parallele Requests unter gewähltem Poolingmodus testen.

Abnahme:
- sämtliche Cross-Tenant-Versuche werden abgelehnt;
- Cross-Tenant-Fremdschlüssel sind unmöglich;
- manipulierte Requestparameter verändern den Tenantkontext nicht;
- normale Laufzeitpfade verwenden keine Service Role;
- parallele Requests vermischen keine Tenantkontexte.

## Integrierte Sprintabnahme

1. Repository frisch klonen.
2. Abhängigkeiten aus dem Lockfile installieren.
3. lokalen Supabase-Stack starten.
4. Migrationen und Seeds anwenden.
5. Formatierung, Lint, Typprüfung, Tests und Build ausführen.
6. Web, API und Worker gemeinsam starten.
7. API-Health und Readiness prüfen.
8. Worker-Lifecycle prüfen.
9. Web-Smoke ausführen.
10. Tenant-Isolation-Suite ausführen.
11. Prozesse kontrolliert beenden.
12. Logs auf Secrets und personenbezogene Daten prüfen.

## Empfohlener Zwei-Wochen-Ablauf

| Zeitraum | Schwerpunkt |
|---|---|
| Tage 1–2 | EYT-13 und EYT-40 |
| Tage 2–4 | EYT-43 und EYT-42 |
| Tage 3–5 | EYT-41 parallel bei bestätigter Kapazität |
| Tage 4–7 | EYT-44 |
| Tage 7–9 | EYT-15 |
| Tag 10 | Fresh Checkout, integrierte Tests und Review |

Diese Einteilung ist eine Reihenfolge, keine belastbare Aufwandsschätzung.

## De-Scope-Reihenfolge

Bei Kapazitätsengpässen zuerst reduzieren:

1. dekorative PWA-Details;
2. UI-Politur über die Accessibility-Baseline hinaus;
3. zusätzliche lokale Plattformen neben der bestätigten Entwicklerplattform;
4. optionale Workerdiagnostik, sofern Start und Shutdown prüfbar bleiben.

Nicht reduzierbar:

- reproduzierbare Workspace-Basis;
- Konfigurationsvalidierung;
- API- und Workerstart;
- lokaler Supabase-Reset;
- Tenant-Isolation;
- Verbot von Service Role und `BYPASSRLS`;
- Fresh-Checkout-Nachweis.

## Branch-, Commit- und Reviewstrategie

- Feature-Branch vom aktuellen Default-Branch erstellen.
- Keine Direktcommits auf `master`.
- Pro Jira-Ticket ein kohärenter Patch oder eine kleine Commitserie.
- Jira-Key in Branch-, Commit- oder PR-Kontext verwenden.
- Keine Mischcommits über unabhängige Tickets.
- Kein Force Push und keine Umgehung von Tests oder Hooks.
- EYT-15 erst mergen, wenn alle Negativtests nachvollziehbar bestanden sind.

## Risiken und Gegenposition

Stärkstes Gegenargument: Sieben Tickets können für zwei Wochen zu groß sein, solange Kapazität, Toolerfahrung und Schätzungen fehlen.

Antwort: Der Plan verwendet ein WIP-Limit von zwei, eine feste Abhängigkeitsreihenfolge, klare De-Scope-Regeln und Tenant-Isolation als nicht verhandelbares Risikogate.

Failure-Mode-Kette:

```text
Tenantkontext wird falsch gesetzt
-> Cross-Tenant-Datenzugriff
-> Offenlegung von Mitarbeiter- oder Baustellendaten
-> Datenschutz- und Vertrauensschaden
-> spätere SaaS-Vermarktung blockiert
```

## Readiness-Entscheidung

| Bereich | Status |
|---|---|
| Sprintziel | klar und überprüfbar |
| Tickets | vollständig zugeordnet |
| technische Reihenfolge | definiert |
| TDD-Strategie | definiert |
| Validierung | definiert |
| Rollback | definiert |
| Toolversionen | MISSING – vor Umsetzung verifizieren |
| Entwicklerkapazität | MISSING |
| Sprint-Commitment | noch nicht bestätigt |
| Planstatus | PASS_WITH_ASSUMPTIONS |
