# Sprint-2-Backlog-Traceability – 2026-07-24

## Ziel

Dieses Dokument verbindet den Sprint-1-Review mit dem vorgeschlagenen Sprint-2-Kandidatenset. Jira bleibt Source of Truth für Status und Sprintzuordnung; GitHub bleibt Source of Truth für Code, Pull Requests und CI.

## Sprintziel

Eine mergegeschützte, reproduzierbare Foundation, deren Tenant-Isolation, Laufzeit-Smokes und Accessibility-Nachweise in GitHub Actions fail-closed geprüft werden.

## Kandidaten

| Jira | Typ | Priorität | Sprint-2-Beitrag | Status bei Planung | Label |
|---|---|---:|---|---|---|
| EYT-15 | Task | Highest | realen Tenant-/Poolingnachweis vervollständigen | Zu erledigen | `sprint-2-candidate` |
| EYT-41 | Task | Highest | offene manuelle Accessibility-Baseline abschließen | Zu erledigen | `sprint-2-candidate` |
| EYT-56 | Task | Highest | PR-CI-Baseline | Zu erledigen | `sprint-2-candidate` |
| EYT-57 | Task | Highest | DB-, Migration-, RLS- und Tenant-Gates | Zu erledigen | `sprint-2-candidate` |
| EYT-58 | Task | Highest | API-, Worker-, Browser- und Accessibility-Smokes | Zu erledigen | `sprint-2-candidate` |
| EYT-66 | Bug | Highest | Pflicht-Tenant-Tests fail-closed machen | Zu erledigen | `sprint-2-candidate` |
| EYT-67 | Task | Highest | Branch Protection und Required Checks | Zu erledigen | `sprint-2-candidate` |

## Review-Korrekturen

- EYT-15 wurde wegen fehlendem echtem Supavisor-/Poolingnachweis und fehlender CI-Evidenz von `Fertig` auf `Zu erledigen` gesetzt.
- EYT-41 wurde wegen sieben offen dokumentierter manueller Accessibility-Prüfungen von `Fertig` auf `Zu erledigen` gesetzt.
- EYT-66 wurde als Sicherheitsbug angelegt.
- EYT-67 wurde als Merge-Governance-Task angelegt.
- EYT-56 bis EYT-58 waren in Sprint 1 nur gelabelt, aber nicht dem Sprintobjekt zugeordnet.

## Abhängigkeitsgraph

```text
EYT-56 ─┬─> EYT-66 ─> EYT-57 ─> EYT-15
        ├────────────> EYT-58 ─> EYT-41
        └──────────────────────────────┐
EYT-57 ────────────────────────────────┼─> EYT-67
EYT-58 ────────────────────────────────┘
```

## Nicht im Sprint-2-Kandidatenumfang

| Jira | Grund |
|---|---|
| EYT-45 | Datenzugriffsausbau erst nach erzwungenen Tenant-Gates |
| EYT-46 / EYT-59 | Architekturgrenzen wichtig, aber nach Quality Foundation |
| EYT-47 / EYT-60 | API-Vertragsausbau folgt nach stabiler CI-Basis |
| EYT-61 / EYT-62 | Fachinvarianten und E2E benötigen ersten Domain-Slice |
| EYT-63 / EYT-64 / EYT-65 | Nightly-, Release- und Supply-Chain-Ausbau später |

## Jira-Capability-Gap

Zum Planungszeitpunkt existiert kein zukünftiges Sprintobjekt. Die verfügbare Jira-Schnittstelle kann Issues lesen und bearbeiten, aber kein Sprintobjekt erstellen, abschließen, starten oder Issues über eine Sprintoperation verschieben.

Deshalb wurden die Kandidaten vorbereitet durch:

- Label `sprint-2-candidate`;
- Label `sprint-2-goal-quality`;
- vorgeschlagenes Startdatum 2026-08-07;
- vorgeschlagenes Fälligkeitsdatum 2026-08-20;
- Priorität Highest;
- überprüfte Akzeptanzkriterien und Abhängigkeiten.

## Manuelle Sprintoperation

Nach Anlage von `EYT Sprint 2` auf Board 72:

1. Ziel aus `docs/plans/2026-07-24-sprint-2-quality-gates.md` übernehmen.
2. Per JQL `project = EYT AND labels = sprint-2-candidate ORDER BY key ASC` die sieben Kandidaten anzeigen.
3. EYT-15, EYT-41, EYT-56, EYT-57, EYT-58, EYT-66 und EYT-67 in den Sprint ziehen.
4. Sprintinhalt erneut lesen und auf exakt sieben Tickets prüfen.
5. Erst nach Developer-Kapazitätsbestätigung den Sprint starten.

## Verifikationsregel

Labels sind keine Sprintzuordnung. Nach jeder manuellen Änderung muss `Sprint = <Sprint-2-ID>` erneut abgefragt und mit diesem Dokument verglichen werden.
