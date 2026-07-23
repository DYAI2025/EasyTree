# Boilerplate-to-Jira-Traceability

Stand: 23.07.2026  
Repository: `DYAI2025/EasyTree`  
Jira-Projekt: `EYT`  
Board: 72

## Zweck

Diese Matrix verbindet den Boilerplate-Implementierungsplan mit den Jira-Tickets. Sie ergänzt den ursprünglichen Jira-Erstaufschlag EYT-1 bis EYT-39 um die Boilerplate-Arbeitspakete bis EYT-55.

## Traceability-Matrix

| Boilerplate-Task | Jira | Typ | Sprint 1 |
|---|---|---|---|
| TASK-001 Architekturentscheidung und Leitplanken | EYT-13 | Task | ja |
| TASK-002 pnpm-/Turborepo-Workspace | EYT-40 | Task | ja |
| TASK-003 Next.js-Web-/PWA-Shell | EYT-41 | Task | ja |
| TASK-004 NestJS-API und Worker | EYT-42 | Task | ja |
| TASK-005 Konfiguration und Secrets | EYT-43 | Task | ja |
| TASK-006 Lokaler Supabase-Stack | EYT-44 | Task | ja |
| TASK-007 Tenant-/Identity-Schema und RLS-Spike | EYT-15 | Task | ja |
| TASK-008 Kysely und Transaktionskontext | EYT-45 | Task | nein |
| TASK-009 Domainmodule und Architekturtests | EYT-46 | Task | nein |
| TASK-010 OpenAPI und generierter Client | EYT-47 | Task | nein |
| TASK-011 Transactional Outbox und Workerqueue | EYT-48 | Task | nein |
| TASK-012 Zeit-, Revisions- und Audit-Invarianten | EYT-49 | Task | nein |
| TASK-013 Vertikaler Planungs-/Publish-Slice | EYT-50 | Story | nein |
| TASK-014 Tenant-Konfiguration und Entitlements | EYT-51 | Task | nein |
| TASK-015 Observability und Telemetrie | EYT-52 | Task | nein |
| TASK-016 CI-, Test-, Security- und Accessibility-Gates | EYT-32 | Task | nein |
| TASK-017 Container und lokale Betriebsumgebung | EYT-53 | Task | nein |
| TASK-018 Performance- und Nebenläufigkeitssmoke | EYT-54 | Task | nein |
| TASK-019 Security-, Privacy- und Beschäftigtenreview | EYT-55 | Task | nein |
| TASK-020 Runbooks und Fresh-Checkout-Abnahme | EYT-35 | Task | nein |

## Sprint-1-Zuordnung

Sprintziel: Eine lokal reproduzierbare, mandantenfähige easyTree-Entwicklungsbasis bereitstellen, auf der Web, API, Worker und Supabase gemeinsam starten und die kritische Tenantgrenze durch automatisierte Negativtests nachgewiesen ist.

Sprintkandidaten:

- EYT-13
- EYT-15
- EYT-40
- EYT-41
- EYT-42
- EYT-43
- EYT-44

## Statusgrenzen

- Diese Datei belegt die geplante Zuordnung, nicht die Implementierung.
- Ein Jira-Status `Done` benötigt erfüllte Akzeptanzkriterien, Tests und Reviewevidenz.
- Der Sprint ist erst verbindlich committed, wenn die Developers Kapazität und Umsetzbarkeit bestätigen.
- Produktion bleibt blockiert, bis Security-, Accessibility-, Migrations-, Betriebs- und Rollback-Gates belegt sind.
