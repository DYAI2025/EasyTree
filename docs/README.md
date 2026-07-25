# EasyTree Teamplaner – aktueller Projektstand

Stand: 23.07.2026

Dieses Verzeichnis bündelt den aktuellen Planungs- und Anforderungsstand. Fachliche Quelle der Wahrheit ist das PRD v1.3. Der MVP bleibt auf die operative Planung und Kommunikation begrenzt; Planungsökonomie und Maschinenverleih sind ausdrücklich Post-MVP.

## Aktuelle Quellen

- `prd/CURRENT_PRD_v1.3.md` – konsolidierter fachlicher Stand und verbindliche Entscheidungen
- `mvp/MVP_SCOPE_v1.3.md` – MVP-Abgrenzung und Erfolgskriterien
- `architecture/ARCHITECTURE_DECISIONS_v1.2.md` – Supabase-, Wetter-, Hosting-, Retention- und Pilotentscheidungen
- `architecture/ADR-001-boilerplate-architecture.md` – akzeptierte Boilerplate- und Plattformarchitektur
- `plans/2026-07-23-boilerplate-architecture.md` – vollständiger Boilerplate-Implementierungsplan
- `plans/2026-07-23-sprint-1-mandantenfaehige-foundation.md` – Sprint-1-Umsetzungsplan
- `ux/CLICKDUMMY_INPUTS.md` – Clickdummy-Fragen, Status und Mobile-Wireframe
- `traceability/JIRA_BACKLOG_BOOTSTRAP_2026-07-23.md` – Jira-Erstaufschlag EYT-1 bis EYT-39; Boilerplate-Erweiterung bis EYT-55 ist in Jira gepflegt
- `runbooks/branch-protection.md` – verbindliche Pflichtchecks, Ruleset-Konfiguration und Merge-Gate-Nachweis (EYT-67)
- `handoff/AGENT_HANDOFF_v1.3.md` – Coding-Agent-Grenzen und Stop-Bedingungen
- `validation/PRD_VALIDATION_v1.3.md` – Validierungsstatus

## Kanonische Systeme

- Repository: `DYAI2025/EasyTree`
- Jira-Projekt: `EYT` – EasyTree
- Jira-Board: Board 72
- Datenbankplattform: Supabase

## Freigabestatus

- Fachliches PRD: freigegeben
- Clickdummy: bereit
- Boilerplate-Architektur: akzeptiert
- Sprint-1-Implementierungsplanung: vorbereitet; Developer-Kapazitätsbestätigung ausstehend
- Produktion: nicht freigegeben

## Offene Freigabepunkte

- Hosting-Ziel und produktive Betriebsarchitektur
- E-Mail-Provider
- Wetterprovider-Bestätigung für Prognose/Ozon sowie DWD-Warnungen
- rechtliche Prüfung der Aufbewahrungs- und Löschfristen
- verbindliche Pilot-Baselines und Zielwerte
- Developer-Kapazitäts- und Größenbestätigung für Sprint 1
