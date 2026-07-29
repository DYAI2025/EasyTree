# EasyTree – Softwaredokumentation

# EasyTree – Softwaredokumentation

> **Dokumentstatus:** lebende Systemdokumentation  
> **Letzte fachliche Aktualisierung:** 27.07.2026  
> **Geltung:** Architektur- und Implementierungsstand des kanonischen Repositories `DYAI2025/EasyTree` (Default-Branch `master`)  
> **Produktstatus:** Plattformbasis ist implementiert; fachlicher MVP-Referenzfluss ist noch nicht fertiggestellt. Diese Seite ist keine Produktionsfreigabe.

## 1. Zweck und Produktkontext

EasyTree ist eine Webanwendung für die Planung und Koordination einer Baumpflege-/Außendienstorganisation. Die erste Zielorganisation hat etwa 15 Mitarbeitende, drei Führungskräfte und mehrere parallele Baustellen. Das Produkt soll insbesondere Planung, veröffentlichte Einsätze, Mitarbeiteransicht, Zeit- und Ressourcenprozesse nachvollziehbar verbinden.

Der aktuelle Sprint-3-Referenzfluss lautet:

> Ein Planer legt einen Wocheneinsatz an, erkennt und löst einen Planungskonflikt und veröffentlicht eine verbindliche Planversion. Eine minimale Mitarbeiteransicht liest anschließend dieselben Assignment- und Planversions-IDs.

Der Referenzfluss ist in [EYT-50](https://dyai2026.atlassian.net/browse/EYT-50) geplant, aber noch nicht als vollständige End-to-End-Funktion nachgewiesen.

## 2. Quellen, Gültigkeit und Lesart

| Quelle                                                                                                            | Rolle                                                           | Gültigkeit                                             |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| [ADR-001](https://github.com/DYAI2025/EasyTree/blob/master/docs/architecture/ADR-001-boilerplate-architecture.md) | verbindliche Architekturentscheidung für die Boilerplate        | akzeptiert                                             |
| [Repository-README](https://github.com/DYAI2025/EasyTree/blob/master/README.md)                                   | aktuelle Struktur, lokale Befehle, CI- und Laufzeitbeschreibung | implementierte Basis, soweit durch Repository belegbar |
| [EYT-45](https://dyai2026.atlassian.net/browse/EYT-45)                                                            | Datenzugriff und Tenant-Transaktion                             | offen                                                  |
| [EYT-49](https://dyai2026.atlassian.net/browse/EYT-49)                                                            | Datenbank-Invarianten und Nebenläufigkeit                       | offen                                                  |
| [EYT-50](https://dyai2026.atlassian.net/browse/EYT-50)                                                            | vertikaler Plan→Publish→Mitarbeiter-Leseweg                     | offen                                                  |
| [EYT-86](https://dyai2026.atlassian.net/browse/EYT-86) und [PR #18](https://github.com/DYAI2025/EasyTree/pull/18) | Fachschema, RLS-Metagates und Migrationen                       | PR offen; finale CI-/Merge-Evidenz ausstehend          |
| [Datenbank-Runbook](https://github.com/DYAI2025/EasyTree/blob/master/docs/runbooks/database-workflow.md)          | verbindlicher lokaler Migrationsworkflow                        | implementiert/dokumentiert                             |
| [Accessibility-Checkliste](https://github.com/DYAI2025/EasyTree/blob/master/docs/runbooks/a11y-checklist.md)      | A11y-Nachweis und offene manuelle Prüfung                       | automatisierte Checks belegt; Screenreader-Smoke offen |

**Begriffe:** _implementiert_ bedeutet im Repository vorhanden. _geplant_ bedeutet Jira-/ADR-Entscheidung ohne vollständigen Laufzeitnachweis. _offen_ bedeutet nicht als abgenommen oder gemerged behandeln. Alle Architekturentscheidungen sind bei ihren Revisionsbedingungen erneut zu prüfen.

## 3. Architektur auf einen Blick

EasyTree startet als **TypeScript Split-Monolith**: ein Repository, eine PostgreSQL-Datenbank und klar getrennte Web-, API-, Worker- und Datenbankgrenzen. Die Lösung vermeidet derzeit Microservices, Kubernetes, Kafka, Event Sourcing, GraphQL und eine native App, weil dafür noch keine Last-, Ownership- oder Feldnutzenevidenz vorliegt.

```text
Web/PWA (Next.js)
  │  generierter bzw. injizierter API-Client
  ▼
HTTP-API (NestJS) ─────┐
  │                   ├── PostgreSQL / Supabase
  └── Worker (NestJS) ┘      ├── Auth
                              ├── private Storage
                              └── SQL-Migrationen + pgTAP
```

### Architekturentscheidungen

| Entscheidung                                 | Begründung                                                                                        | Konsequenz / Revisionsbedingung                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Next.js-Web/PWA plus NestJS-API/Worker       | UI, fachliche Kommandos und Hintergrundarbeit bleiben getrennt, ohne verteilte Anfangskomplexität | Überdenken, wenn der API-Kern nachweislich unverhältnismäßig bremst                                         |
| Ein NestJS-Codepaket, zwei Entrypoints       | API und Worker teilen Module/DI, Worker öffnet keinen HTTP-Port                                   | getrennte Skalierung bleibt möglich                                                                         |
| PostgreSQL/Supabase als transaktionaler Kern | RLS, Constraints, FK-Integrität und lokale reproduzierbare Tests                                  | separate Datenbank/Datenresidenz erst bei belegter Anforderung                                              |
| Shared-Schema-Multitenancy                   | geringer Betriebsaufwand und einheitliche Produktbasis                                            | jeder Tenant-Datensatz braucht Organisationseinbettung; große Sondermandanten können später getrennt werden |
| SQL-Migrationen als alleinige Schemaquelle   | Änderungen sind reviewbar und reproduzierbar                                                      | Dashboard-Schemaänderungen sind verboten; Migrationen sind append-only                                      |
| Operative Writes nur über Backend-Commands   | Browser und LLM/Automatisierung dürfen nicht direkt in operative Tabellen schreiben               | API-Vertrag und serverseitige Autorisierung werden Pflicht                                                  |
| Transactional Outbox für asynchrone Arbeit   | Business-Write und Folgeauftrag können gemeinsam committen/rollbacken                             | keine Exactly-once-Garantie behaupten; Verbraucher bleiben idempotent                                       |
| Web zuerst, native Mobile später             | Planner-Ansichten gehören ins Web; native/offline braucht belegten Feldnutzen                     | Offline-Queue, Verschlüsselung und Konfliktmodell erst bei realem Bedarf                                    |

## 4. Repository- und Komponentenkarte

| Baustein       | Pfad                       | Aufgabe                                                                        | aktueller Nachweis / Grenze                                                                                                      |
| -------------- | -------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Web            | `apps/web`                 | Next.js App Router, mobile-first PWA-Shell, Planer- und Mitarbeiteroberflächen | Shell, Accessibility-Basis und API-Client-Injektion vorhanden; Fachoberflächen noch nicht vollständig integriert                 |
| API            | `apps/api`                 | NestJS HTTP-Endpunkt, Domänenkommandos, Auth-/Tenantgrenze                     | `GET /health`, `GET /ready`, Correlation-ID, strukturierte Fehler und Shutdown vorhanden; EYT-45 Business-Transaktionspfad offen |
| Worker         | `apps/api/src/worker.ts`   | Hintergrundarbeit aus demselben NestJS-Codepaket                               | kein HTTP-Listener; spätere Outbox-Verarbeitung vorgesehen                                                                       |
| UI-Paket       | `packages/ui`              | domänenfreie Primitives, z. B. Button, Card, VisuallyHidden                    | Fachlogik verbleibt in Apps                                                                                                      |
| Konfiguration  | `packages/config`          | validierte Umgebungsvariablen und Secret-Redaktion                             | keine echten Secrets im Repository                                                                                               |
| Datenbank      | `supabase/`                | lokaler Supabase-Stack, Migrationen, Seed, pgTAP                               | SQL ist Schema-Source-of-Truth                                                                                                   |
| Dokumentation  | `docs/`                    | ADRs, Pläne und Runbooks                                                       | diese Confluence-Seite ergänzt, ersetzt aber nicht die versionierten technischen Quellen                                         |
| Qualitätsgates | `.github/workflows/ci.yml` | format, lint, typecheck, unit, build, Secret-Scan, DB- und Web-Gates           | Pflichtchecks laut README aktiv; PR-spezifische Ergebnisse separat bewerten                                                      |

## 5. Laufzeitverhalten und Schnittstellen

### 5.1 Web

Die Webanwendung nutzt eine injizierte Clientgrenze (`createApiClient` und Provider). Komponenten erzeugen keinen eigenen operativen Datenzugriff; das Web importiert kein Supabase-JS-SDK als direkte Schreibgrenze. Die PWA liefert derzeit ein Manifest, aber **keinen** Service Worker, keine Offline-Schreibqueue und keine Synchronisationslogik.

Die Accessibility-Basis umfasst semantische Landmarks, Skip-Link, sichtbaren Fokus, `lang="de"`, mobile-first Layout und Statusanzeigen mit Text plus Symbol. Automatisierte Browserchecks sind dokumentiert. Ein menschlicher Screenreader-Smoke bleibt offen und blockiert die vollständige Abnahme von EYT-41.

### 5.2 API und Worker

Die HTTP-API besitzt Liveness (`/health`) und Readiness (`/ready`). Sie übernimmt oder erzeugt `x-correlation-id`; Fehler folgen einem RFC-7807-artigen JSON-Format ohne Stacktraces oder Secrets.

Die fachliche Regel ist: Eingabe → autorisierter Command → Transaktion → Datenbank → optional Outbox-Nachricht. Ein Worker verarbeitet asynchrone, idempotente Folgearbeit. Der konkrete EYT-45-Pfad „Runtime-Rolle → Tenantkontext → Business-Query“ ist noch nicht abschließend belegt und darf nicht als fertig dokumentiert werden.

### 5.3 API-Vertrag

REST/OpenAPI mit generiertem Webclient ist die gewählte Vertragsrichtung. Der konkrete vollständige OpenAPI-Vertrag und die Publish-Endpunkte entstehen im Referenzslice EYT-50. Bis dahin sind Mock-/LocalStorage-Daten keine operative Wahrheit.

## 6. Datenmodell, Mandantentrennung und Veröffentlichung

### 6.1 Grundregeln

- Jede tenant-owned Zeile verwendet eine nicht-leere Organisationszuordnung.
- Tenant-sichere Composite-FKs sollen Cross-Tenant-Referenzen verhindern.
- Serverseitige Autorisierung ist primär; PostgreSQL RLS ist eine zusätzliche Schutzschicht.
- Runtime-Credentials dürfen RLS nicht umgehen; Service-Role-Nutzung ist auf Migration/Admin begrenzt.
- Audit-, Outbox-, Cache- und Idempotenzdaten sind ebenfalls tenantgebunden.
- Zeiten werden als UTC-Instants gespeichert; eine IANA-Zeitzone trägt den lokalen Geschäftskontext.

### 6.2 EYT-86: eng geschnittenes Kerndatenmodell

Bereits vorhanden bzw. als Grundlage behandelt werden `organizations`, `users` und `memberships`. EYT-86 ergänzt für den Sprint-3-Referenzfluss:

| Entität           | Verantwortung                                          | Status       |
| ----------------- | ------------------------------------------------------ | ------------ |
| `employees`       | Mitarbeiterstamm und spätere Benutzerzuordnung         | PR #18 offen |
| `worksites`       | Baustellen-/Einsatzorte                                | PR #18 offen |
| `plan_versions`   | revisionsfähige Planversionen                          | PR #18 offen |
| `assignments`     | Mitarbeiterzuordnung mit Zeitintervall und Planversion | PR #18 offen |
| `audit_events`    | append-only Auditereignisse                            | PR #18 offen |
| `outbox_messages` | transaktional erzeugte Folgeaufträge                   | PR #18 offen |
| IANA-Zeitzone     | Organisation oder gleichwertiger Fachträger            | PR #18 offen |

Bewusst **nicht** Bestandteil von EYT-86: `time_entries`, Korrekturen, `absence_requests`, Skills/Zertifikate, Fahrzeuge/Equipment, Ressourcenreservierung, Wetter, Notifications, Realtime-Publication, persistierte Konfliktresultate und die endgültige Rollen-/Self-Service-Autorisierung. `app.current_employee_id()` wird erst mit EYT-14 entschieden.

### 6.3 Publish-Vertrag

`plan_versions.published_at` ist die autoritative Veröffentlichungszeit. `assignments.published_at` ist ein nullable, lokal prüfbarer Spiegel.

- Entwurf: `assignments.published_at IS NULL`.
- Publish: EYT-49 soll beide Marker atomar setzen.
- Intervallinvariante: EYT-49 soll veröffentlichte Mitarbeiterintervalle mit einem PostgreSQL-EXCLUDE-Constraint schützen, gefiltert auf `published_at IS NOT NULL`.
- EYT-86 stellt nur die nötigen Spalten, Zeitbereiche und Extension-Vorbereitung bereit; es implementiert keine Publish-Trigger, Exclusion-Constraints oder Nebenläufigkeitsverträge.

Diese Trennung verhindert die zirkuläre Abnahmebedingung „EYT-86 erfüllt EYT-49-Invarianten, obwohl EYT-49 die Constraints erst erzeugt“.

### 6.4 Sicherheits- und Migrationsgates

EYT-86 fordert einen katalogweiten RLS-/Grant-Metagateway: Jede anwendungseigene `public`-Tabelle muss RLS/Force-RLS, Policies, Tenant-Schlüssel und erlaubte Grants nachweisen. Eine absichtlich offene Testtabelle muss das Gate rot machen. Direkte DML-Rechte für `easytree_app`, `anon` oder `PUBLIC` sind nicht vorgesehen; benötigte DML-Rechte liegen bei `authenticated`.

Die erwartete Laufzeitprobe ist noch offen: Vor dem Rollenwechsel muss ein Business-Zugriff über `easytree_app` mit SQLSTATE `42501` scheitern; nach `SET LOCAL ROLE authenticated` muss er nur im eigenen Tenant funktionieren. Dieser Vertrag ist ebenfalls über `postgres → authenticated` zu testen. PR #18 dokumentiert ausdrücklich, dass dies ohne fertige Query-Schicht noch nicht bewiesen ist.

## 7. Qualitäts-, Sicherheits- und Betriebsmodell

### CI-Gates

| Gate                                | Zweck                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| format, lint, typecheck, unit-tests | Codeformatierung, statische Regeln, Typen und Unit-Tests                        |
| build-web, build-api                | Produktionsbuilds von Web sowie API/Worker                                      |
| secret-scan                         | keine Secrets, Keys oder .env-Dateien im Repository                             |
| db-gates                            | Migrationen, Reset, pgTAP und fail-closed Tenant-/RLS-Prüfungen                 |
| web-smoke                           | Chromium-/Playwright-Smoke einschließlich automatisierter Accessibility-Prüfung |

Für jede Schemaänderung gelten: PR-Review, mindestens zwei aufeinanderfolgende lokale Resets, pgTAP, ausschließlich synthetische Seeds und append-only Forward-Fixes. Destruktive Rollbacks sind nach produktiver Dateneinführung ohne belegten Restore verboten.

### Betrieb und Observability

- Correlation IDs verbinden Request, Fehler und spätere Telemetrie.
- Readiness meldet nicht bereite Abhängigkeiten als 503.
- API-/Worker-Shutdown ist explizit.
- Wiederanläufe und Outbox-Verbrauch müssen idempotent bleiben.
- Backup/Restore, Last, produktive Observability, SLOs und Deployment/Recovery sind **noch kein nachgewiesener Production-Readiness-Stand**.

## 8. Fachliche Modulgrenzen und spätere Ausbauspuren

Die Zielmodule lauten: Tenancy/Identity, Workforce, Sites/Work, Planning, Resources, Timekeeping, Communications, Weather/Routing, Files sowie Audit/Integration. Ein Modul besitzt seine Tabellen; modulübergreifende Nutzung erfolgt über öffentliche Application-APIs oder langlebige Ereignisse. Ein generisches `packages/shared` ist untersagt.

Planungslogik wird später in harte Constraints und Optimierungsziele getrennt. Deterministische Services bzw. Solver prüfen Machbarkeit; ein LLM darf erklären, strukturieren und orchestrieren, aber weder Autorisierung noch Constraint-Engine oder direkten Tabellenschreibzugriff ersetzen. CP-SAT, Routing mit Zeitfenstern oder Baustellen-Commitment-Methoden sind Optionen nach belegtem Nutzen, nicht heutiger Standardumfang.

## 9. Nachverfolgbarkeit: Entscheidung → Umsetzung → offene Arbeit

| Entscheidung / Regel                        | Umsetzung bzw. Ticket                         | Abnahmestatus                          |
| ------------------------------------------- | --------------------------------------------- | -------------------------------------- |
| Split-Monolith                              | ADR-001; `apps/web`, `apps/api`, `packages/*` | Basis implementiert                    |
| API und Worker trennen                      | EYT-42, `main.ts` / `worker.ts`               | Basis implementiert                    |
| Web ohne direkten Supabase-Schreibzugriff   | EYT-41, injizierter API-Client                | Basis implementiert                    |
| SQL-only Schema + lokale Reproduzierbarkeit | EYT-44, Datenbank-Runbook                     | implementiert/dokumentiert             |
| RLS/Tenant-Gate                             | EYT-15 / EYT-45 / EYT-86                      | teilweise; Query-Laufzeitvertrag offen |
| Kerndomänenschema                           | EYT-86, PR #18                                | offen, nicht gemerged                  |
| Publish-/Intervallinvarianten               | EYT-49                                        | offen                                  |
| Integrierter Referenzfluss                  | EYT-50                                        | offen                                  |
| Rollen und Self-Service                     | EYT-14                                        | offen                                  |
| Login/Einladung/Reset                       | EYT-87                                        | offen                                  |
| UI-Tokens, Assets, Layoutprimitives         | EYT-80                                        | offen                                  |

## 10. Offene Risiken und Revisionspunkte

1. **Sicherheitsnachweis:** Die Organisationsisolation des Schemas ersetzt nicht die EYT-45-Laufzeitprobe mit realer Runtime-Rolle und Business-Query.
2. **EYT-86:** PR #18 ist offen. Bis Merge und erfolgreichem CI-Nachweis ist das Schema kein belastbarer Basisstand.
3. **Autorisierung:** Mitarbeitende und Assignments sind personenbezogen; bis EYT-14 existiert kein vollständiger Self-Service-/Rollenbeweis.
4. **Accessibility:** Ein menschlicher Screenreader-Smoke ist noch offen.
5. **Offline/Mobile:** Keine Offline-Schreibqueue implementiert. Es wäre falsch, aus dem PWA-Manifest Offlinefähigkeit abzuleiten.
6. **Production Readiness:** Kein dokumentierter Nachweis für produktives Deployment, Monitoring, Restore, Last oder Rollback. Daher: **nicht production ready**.
7. **Architekturrevision:** ADR-001 erneut bewerten bei unverhältnismäßigem API-Aufwand, unsicher reproduzierbarer RLS-/Pooling-Semantik, echter Modulautonomie, separater Datenresidenz oder bestätigtem nativen Feld-/Offlinebedarf.

## 11. Pflegeprozess

- Architekturentscheidungen werden zuerst als ADR im Repository getroffen und hier mit Link, Status und Folgen nachgeführt.
- Jedes Jira-Ticket mit relevanter Architekturwirkung verlinkt diese Seite oder die konkrete ADR.
- Nach Merge eines Architektur-PRs: Implementierungsstatus, Nachweislink, Migrationsversion und offene Annahmen aktualisieren.
- Kein Statuswechsel auf „implementiert“ ohne Pull-Request-/CI- oder Laufzeitnachweis.
- Diese Seite dokumentiert den aktuellen Stand; die versionierten Repository-Dateien bleiben die technische Detailquelle.

**Entscheidung dieser Dokumentationsversion:** `PASS_WITH_ASSUMPTIONS` als Architektur- und Nachverfolgbarkeitsdokument. `BLOCKED_RELEASE` für eine Produktionsfreigabe, bis die unter Abschnitt 10 genannten Nachweise vorliegen.
