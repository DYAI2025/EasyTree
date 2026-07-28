# Product Canvas: Reale Wochenplanung mit Entwurfs- und Konfliktlogik

Status: ready-for-user-confirmation  
Feature Slug: `planning-draft-conflict-slice`

| Section | ID | Value | Source Type | Source |
|---|---|---|---|---|
| Problem | CAN-001 | Der bestehende Systemdurchstich kann eine Planungswoche real lesen, aber noch keinen fachlich gültigen Einsatzentwurf über UI, Gateway, API und PostgreSQL erstellen. Dadurch ist noch kein vollständiger Planungsvorgang nutzbar oder beweisbar. | EXPLICIT | Jira EYT-50, EYT-62, EYT-92; GitHub PR #23 |
| Users / Customers | CAN-002 | Planerinnen, Administratoren und berechtigte Führungskräfte der EasyTree-Pilotorganisation | EXPLICIT | PRD v1.3 Rollen; Jira Sprint 4 |
| Value Promise | CAN-003 | Eine Planerin kann eine reale Woche öffnen, einen Einsatzentwurf anlegen und unmittelbar nachvollziehen, ob dieser gespeichert oder aus einem fachlich stabilen Grund abgelehnt wurde. | EXPLICIT | Sprint-4-Ziel |
| Current Alternatives | CAN-004 | Read-only-Planungsfenster, Mock-Gateway und isolierte Domain-/Datenbanktests; kein zusammenhängender schreibender Nutzerfluss | EXPLICIT | PR #23; Jira EYT-50/EYT-79 |
| Key Capabilities | CAN-005 | Reale Wochenabfrage, ISO-Wochenvalidierung, UUID-v4-konforme Testdaten, explizite Eingabe, serverseitige Validierung, autorisierter und idempotenter Create-Command, atomare Speicherung, sichtbare Konflikte, Reload-/Zweitbrowser-Nachweis | EXPLICIT | Jira EYT-50, EYT-62, EYT-79, EYT-88, EYT-91, EYT-92 |
| Non-Goals | CAN-006 | Publish, Mitarbeiterbestätigung, produktiver Login, Monats-/Vier-Wochen-Ansicht, Ressourcen, Abwesenheit, Timer, Wetter, Benachrichtigungen und Deployment | EXPLICIT | Jira Out-of-Scope |
| Constraints | CAN-007 | Bestehende Architekturgrenzen, transport-only Contracts, serverseitige Autorisierung, RLS, append-only Forward-Migrationen, kein direkter UI-Datenbankzugriff, keine Mock-/LocalStorage-Wahrheit | EXPLICIT | ADR/PRD; Jira-Tickets; PR #23 |
| Risks | CAN-008 | Stacked-Branch-Abhängigkeit zu PR #23; inkonsistente Wochenregeln zwischen Vertrag und Datenbank; Seed-IDs brechen den Vertrag; scheinbar grüne Tests gegen Mocks; Doppeleffekt bei Retries; Teilwirkung bei Transaktionsfehlern | EXPLICIT | EYT-88, EYT-91, EYT-50, EYT-62 |
| Success Signal | CAN-009 | Ein gültiger Entwurf erscheint mit identischen IDs in UI, API und Datenbank sowie nach Reload und zweitem Browserkontext; definierte Negativfälle werden ohne Teilwirkung abgelehnt; relevante CI- und E2E-Gates sind grün. | EXPLICIT | Sprintziel; EYT-62/EYT-92 |
| Evidence | CAN-010 | Contract-, Domain-, Datenbank-, Route-, Integrations-, Nebenläufigkeits-, Browser-E2E- und Accessibility-Nachweise plus absichtliche rote Gegenproben | EXPLICIT | EYT-50/EYT-62/EYT-79/EYT-92 |
| Allowed Scope | CAN-011 | Genau ein vertikaler Feature-Slice vom Öffnen einer Woche bis zum persistenten Erstellen oder nachvollziehbaren Ablehnen eines Einsatzentwurfs | EXPLICIT | Nutzerauftrag und Sprintziel |
| Unresolved Questions | CAN-012 | Formale Entwickler-Kapazitätsbestätigung und Nutzerbestätigung von Vision/Canvas fehlen; die technische Integration des offenen PR #23 muss vor Abschluss eindeutig aufgelöst werden. | MISSING | Developer Gate; GitHub PR #23 |

## Problem Detail

Der aktuelle Stand belegt die Lesekette Browser → Gateway → API → PostgreSQL. Die zentrale fachliche Handlung des Planungskerns fehlt jedoch: einen konkreten Mitarbeitereinsatz für eine Baustelle und einen Zeitraum als Entwurf anzulegen. Solange diese Handlung nicht real durch alle Schichten läuft, bleiben UI, Command-Pfad, Transaktion, Idempotenz und Konfliktbehandlung unbewiesen.

## Users / Customers

### Primärer Nutzer

Eine berechtigte Planerin, die Mitarbeiter wochenweise auf Baustellen einteilt.

### Sekundäre Stakeholder

- Administratoren und Geschäftsführung, die Planung verantworten.
- Entwickler und Reviewer, die einen reproduzierbaren Funktionsnachweis benötigen.
- Spätere Mitarbeiteransichten, die auf verlässlichen Plan-IDs und Planständen aufbauen.

## Value Promise

Das Feature liefert einen kleinen, aber abgeschlossenen Planungsvorgang. Es erzeugt keinen weiteren technischen Baustein ohne Nutzerreise, sondern einen sichtbaren und persistenten Durchstich mit überprüfbarer Fachlogik.

## Key Capabilities

1. Reale Woche und aktuellen Entwurfsstand laden.
2. Mitarbeiter, Baustelle, Datum, Start und Ende vollständig erfassen.
3. Ungültige ISO-Wochen und vertragswidrige IDs verhindern.
4. Entwurf ohne Schreibwirkung serverseitig validieren.
5. Gültigen Einsatz über einen autorisierten Command atomar speichern.
6. Gleichzeitigkeit, invertiertes Intervall und Mitarbeiterüberlappung stabil ablehnen.
7. Wiederholungen mit demselben Idempotenzschlüssel ohne Doppelwirkung behandeln.
8. Erfolg und Fehler in der Oberfläche eindeutig und zugänglich darstellen.
9. Persistenz durch Reload, zweiten Browserkontext und Datenbankabgleich beweisen.
10. Umgehungen durch gezielte rote Gegenproben sichtbar machen.

## Constraints

- Fachregeln liegen nicht ausschließlich in der UI.
- Das LLM ist weder Policy Engine noch Autorisierungssystem.
- UI-Komponenten sprechen nur über `PlanningGateway`.
- Transportobjekte bleiben von Domainobjekten getrennt.
- Datenbankänderungen erfolgen ausschließlich vorwärtsgerichtet.
- Tenantkontext, Autorisierung und Idempotenz sind fail-closed.
- Ein Fehlschlag darf weder Assignment noch inkonsistente Audit-/Outbox-Spuren hinterlassen.

## Risks and Mitigations

| Risk ID | Risiko | Wirkung | Gegenmaßnahme | Source Type |
|---|---|---|---|---|
| RISK-001 | PR #23 ist offen und der neue Branch baut darauf auf. | Doppelter oder schwer reviewbarer Diff gegen `master` | Intake-PR als gestapelten PR gegen den Read-Through-Branch führen; Integration vor Featureabschluss bereinigen. | ASSUMPTION |
| RISK-002 | Vertrag und Datenbank akzeptieren unterschiedliche Wochen. | Persistente fachlich ungültige Planversionen | Gemeinsame deterministische Regel plus Forward-Migration und Negativtests | EXPLICIT |
| RISK-003 | Seed-IDs sind keine gültigen UUID v4. | Reale API-Antworten scheitern trotz gültiger DB-Zeilen | Seed und alle Referenzen konsistent ersetzen; Reset- und Contract-Test | EXPLICIT |
| RISK-004 | UI oder Test nutzt Mock/LocalStorage als Fallback. | Scheinbar funktionierendes Feature ohne Serverwahrheit | Boundary-Test, Ausfalltest und E2E-Abgleich mit DB | EXPLICIT |
| RISK-005 | Retry erzeugt Doppelwirkung. | Doppelte Einsätze | Pflicht-Idempotenzschlüssel, serverseitige Speicherung und Retry-Test | EXPLICIT |
| RISK-006 | Command scheitert nach Teilwrite. | Inkonsistenter Plan oder Auditbestand | Eine Transaktion, erzwungener Fehler und Nachweis ohne Teilwirkung | EXPLICIT |
| RISK-007 | Sprintumfang wächst um Publish oder Auth. | Kein abgeschlossenes Feature im Zeitfenster | Harte Non-Goals und separates Folgeslice | EXPLICIT |

## Success Signal

Das Feature gilt nur dann als erfolgreich, wenn der Nutzerfluss real ausgeführt und nicht lediglich aus Einzeltests abgeleitet wurde. Ein grüner Build ohne schreibenden Browserfluss ist kein Erfolgssignal.

## Allowed Scope

Der erlaubte Scope endet nach dem gespeicherten oder nachvollziehbar abgelehnten Einsatzentwurf. Veröffentlichung und Mitarbeiterreaktion beginnen in einem späteren Feature.

## Unresolved Questions

- MISSING: Bestätigung durch den Nutzer, dass Vision und Canvas den gewünschten Feature-Schnitt korrekt darstellen.
- MISSING: Developers-Gate zu Kapazität und Umsetzbarkeit innerhalb des aktiven Sprintfensters.
- ASSUMPTION: PR #23 wird als technische Basis übernommen und nicht parallel mit widersprüchlichen Änderungen weiterentwickelt.

## User Confirmation

> Ich bestätige, dass Product Canvas und Product Vision meine Absicht korrekt wiedergeben und als Grundlage für AgileTeam Planning verwendet werden dürfen.
