# EasyTree – Drei-Repository-Audit

## Executive Summary

Die drei Repositories sind keine drei gleichwertigen Produktteile:

- **EasyTree-master** ist die technische Foundation und enthält PRD, MVP, Architektur- und Qualitätsleitplanken.
- **EasyTree-UIUX** ist der Planer-/Management-Clickdummy.
- **EasyTree-App-UI** ist der mobile Mitarbeiter-Clickdummy.

Der beste Übergangspunkt ist ein gemeinsamer Domain-/API-Vertrag im Master-Monorepo. Die Vite-Prototypen sollten nicht eigenständig mit dem Backend verbunden werden. Ihre Komponenten und UX-Flows werden selektiv in zwei rollenbasierte Bereiche der Next.js-App migriert.

## Scope

**In scope:** statische Analyse, Repo-Inventar, Clickdummy-Abdeckung, Architekturübergang, MVP-/PRD-Gaps, priorisiertes Backlog.

**Out of scope:** Deployment, produktive Daten, Live-Auth, reale Provider, rechtliche Freigabe, Performancebeleg, Git-Historie.

## Evidenzstatus

- Quelltext, Dokumente, Manifeste und Tests: `source-inspected`.
- Build/Test/Browser/Deployment in dieser Sitzung: `unverified`.
- Prototyp-Funktionalität: überwiegend `fake-only`.
- App-UI-Aussage „Offline PWA / automatische Synchronisation“: `contradicted`.

## Top Findings

| ID | Domain | Severity | Claim | Evidence class | Business impact | Remediation |
|---|---|---|---|---|---|---|
| FIND-001 | Architektur | High | Drei unabhängige Runtime-Repositories würden Domain- und Statuslogik duplizieren. | source-inspected | hohe Drift, dreifache Fehlerbehebung | Master als kanonisches Monorepo; UIs über Contracts integrieren |
| FIND-002 | Governance | High | Produkt-/Repository-Namen und kanonisches GitHub-Ziel sind inkonsistent. | source-inspected | falsche Commits, Jira-/CI-Verknüpfung unklar | ADR und Repo-Metadaten vereinheitlichen |
| FIND-003 | Planung | High | Planer-Clickdummy aggregiert Wochenstunden nicht verlässlich pro Woche. | source-inspected | falsche Blocker und Kapazitätsanzeigen | Zeitfenster explizit übergeben; Regressionstests |
| FIND-004 | Planung | High | Gleiches Start-/Ende wird als 24h interpretiert; Zeitvalidierung fehlt. | source-inspected | falsche Arbeits- und Kapazitätswerte | striktes Intervall-Value-Object |
| FIND-005 | Ressourcen | Elevated | Tagesbasierte Reservierungszählung kann sequenzielle Nutzung als Doppelbelegung markieren. | source-inspected | unnötige Veröffentlichungsblocker | echte Intervallüberschneidung prüfen |
| FIND-006 | Mobile Zeit | Extreme | Timer basiert auf Browser-Ticks und Anzeigezeit statt kanonischem Instant. | source-inspected | falsche Arbeitszeit nach Hintergrund/Neustart | Server-Command mit UTC-Start/Stop und einer aktiven Buchung |
| FIND-007 | Offline/PWA | High | Mobile UI behauptet Sync/Offline-PWA ohne technische Implementierung. | contradicted | falsche Stakeholdererwartung und Abnahme | Claim entfernen oder echte begrenzte Offline-Architektur bauen |
| FIND-008 | Auth/AuthZ | Extreme | Beide Clickdummies haben keine reale Authentifizierung/Berechtigung. | source-inspected | ungeschützte Beschäftigten-/Planungsdaten | Supabase Auth + serverseitige Commands + RLS |
| FIND-009 | Veröffentlichung | Extreme | Publish/Benachrichtigung ist nur Simulation. | fake-only | kein konsistenter Planstand für Mitarbeitende | atomare Planversion, Audit und Outbox |
| FIND-010 | Provider | High | Geocoding und Kartenassets werden direkt aus dem Browser geladen. | source-inspected | Datenschutz, Rate Limit, Verfügbarkeit, CORS | serverseitiger Adapter/Proxy und Providerentscheidung |
| FIND-011 | MVP | Extreme | Fachliche APIs und Domänenschema fehlen weitgehend. | source-inspected | Produktkern nicht implementiert | vertikale MVP-Slices gemäß Backlog |
| FIND-012 | Release | Extreme | Produktionsfreigabe ist nicht belegt. | unverified | Daten-/Betriebs-/Sicherheitsrisiko | Security, Pilot, Ops, Restore, Rollback und Laufzeitevidenz |

## Entscheidung

**PASS_WITH_ASSUMPTIONS** für die vorgeschlagene Clickdummy-Integration.

**BLOCKED_SOURCE_NEEDED** für eine MVP- oder Production-Ready-Aussage, bis Implementierung und reale Validierung vorliegen.

## Nächster Value Slice

Ein integrierter End-to-End-Clickdummy im Master:

1. Planer öffnet Wochenansicht.
2. Zuweisung erzeugt einen Konflikt.
3. Konflikt wird gelöst und Planversion veröffentlicht.
4. Mitarbeiter sieht dieselbe Version und bestätigt.
5. Mitarbeiter startet/stoppt Zeit und meldet Ressourcenschaden.
6. Admin prüft/korrigiert Zeit und sieht Zustandsmeldung.

Dieser Slice validiert Produktlogik und Rollenübergang, bevor Datenbank- und API-Breite gebaut wird.

## Unsicherheiten

- Builds und Tests wurden in dieser Sitzung nicht erneut ausgeführt.
- Keine Git-Historie oder Branch-Metadaten in den ZIPs.
- Keine Live-Provider, Auth-, Datenbank- oder Deployment-Grenze geprüft.
- Rechtliche Retention, Betriebsrat/Mitbestimmung und konkrete Datenschutzfreigabe fehlen.
