# Product Vision: Reale Wochenplanung mit Entwurfs- und Konfliktlogik

Status: user-confirmed  
Confirmed by user: yes  
Feature Slug: `planning-draft-conflict-slice`  
Confirmation Status: re-confirmed 2026-07-28 (nach Council-Änderung)

Canvas: [`docs/canvas/planning-draft-conflict-slice.canvas.md`](../canvas/planning-draft-conflict-slice.canvas.md)

**Zweimal bestätigt.** Erstbestätigung 2026-07-28 durch den Product Owner (Benjamin Poersch) mit
der wörtlichen Formel. Danach schärfte das Council-Gate (Phase 0.16) die Wertbehauptung; das
Artefakt kehrte auf `draft` zurück und wurde am 2026-07-28 **neu bestätigt** — ausdrücklich
einschließlich der Wertabgrenzung. Geändert waren ausschließlich Vision Statement, VIS-004 und
„Product Value"; der Feature-Schnitt blieb unverändert, insbesondere bleibt REQ-009 vollständig
bestehen.

Auch nach der Neubestätigung gilt: bestätigt ist der fachliche Feature-Scope, **nicht** die
technische Kapazität (GATE-002), und die Bestätigung ist **keine Coding-Freigabe**.

## Product Vision Statement

Für Planerinnen und Administratoren einer kleinen Baumpflegeorganisation, die wöchentlich Mitarbeiter auf mehrere Baustellen verteilen, liefert dieses Feature den **ersten durchgehenden Schreibpfad-Durchstich**: eine Planungshandlung läuft real durch UI, Vertrag, Command, Transaktion und RLS bis PostgreSQL. Eine berechtigte Planerin kann eine Planungswoche aus PostgreSQL öffnen, Mitarbeiter, Baustelle und Zeitraum auswählen, einen gültigen Einsatzentwurf speichern und fachlich ungültige oder überlappende Entwürfe mit einem verständlichen Grund abgelehnt sehen. Anders als der bisherige Read-only-Durchstich beweist das Feature eine vollständige, persistente Browser-zu-Datenbank-Nutzerreise ohne Mock- oder LocalStorage-Wahrheit.

**Wertabgrenzung (Council-Gate 2026-07-28, vom Nutzer übernommen).** „Nutzbar" heißt hier
**nachweisbar**, nicht **ausgeliefert**. Solange EYT-14 offen ist, ist „die Planerin" im
Nachweis ein serverseitig injiziertes, synthetisches und bereits verifiziertes Subjekt; ein
produktiver Login und ein Deployment sind ausdrückliche Non-Goals dieses Schnitts. Zwei
unabhängige Council-Rollen haben die frühere Formulierung („erstmals eine reale, klickbare
Wochenplanung", „vollständig funktionierendes, nutzbares Feature") als Überbehauptung
markiert. Der **Feature-Schnitt bleibt unverändert** — nur die Wertbehauptung hört auf, mehr
zu versprechen, als der Nachweis hergibt. Der zweite Browserkontext belegt Serverpersistenz,
**nicht** einen zweiten realen Nutzer.

## Product Vision Board

| Area                      | ID      | Value                                                                                                                                                                                                                                                                                         | Source Type | Source                                                | User Decision Needed |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------- | -------------------- |
| Target Group              | VIS-001 | Planerinnen, Administratoren und berechtigte Führungskräfte der EasyTree-Pilotorganisation                                                                                                                                                                                                    | EXPLICIT    | PRD v1.3 Rollen; Jira EYT-50/EYT-92                   | no                   |
| User Needs                | VIS-002 | Eine reale Planungswoche sehen und einen Einsatzentwurf sicher anlegen können, ohne Doppelbelegung oder ungültige Zeitdaten zu erzeugen                                                                                                                                                       | EXPLICIT    | Sprint-4-Ziel; EYT-50; EYT-92                         | no                   |
| Product / Feature         | VIS-003 | Klickbare Wochenplanung mit persistentem Einsatzentwurf und serverseitiger Konfliktprüfung                                                                                                                                                                                                    | EXPLICIT    | Nutzerauftrag; Jira Sprint 4                          | no                   |
| Product Value             | VIS-004 | Der erste durchgehende Schreibpfad-Durchstich: eine Planungshandlung läuft real durch UI, Vertrag, Command, Transaktion und RLS bis PostgreSQL. Nutzbar im Sinne von nachweisbar — noch NICHT im Sinne von ausgeliefert: produktiver Login (EYT-14) und Deployment sind ausdrücklich Non-Goal | EXPLICIT    | Nutzerauftrag; EYT-50/EYT-62; Council-Gate 2026-07-28 | no                   |
| Business or Project Goals | VIS-005 | Fehlerquote agentischer Implementierung senken und nur Code akzeptieren, dessen Funktion durch Verträge, Datenbank-, Integrations- und Browsertests nachgewiesen ist                                                                                                                          | EXPLICIT    | Nutzerauftrag für Claude + Plumbline                  | no                   |
| Success Signals           | VIS-006 | Gültiger Entwurf bleibt nach Reload und in zweitem Browserkontext sichtbar; ungültige Woche, Gleichzeitigkeit, invertiertes Intervall und Überlappung werden deterministisch abgelehnt; CI und E2E sind grün                                                                                  | EXPLICIT    | Sprintziel; EYT-50/EYT-62/EYT-92                      | no                   |
| Boundary                  | VIS-007 | Kein Publish, keine Mitarbeiterbestätigung, kein produktiver Login, keine Monats- oder Vier-Wochen-Ansicht                                                                                                                                                                                    | EXPLICIT    | Jira Out-of-Scope                                     | no                   |

## User Needs

1. Eine Planerin muss erkennen, welche reale Woche und Planversion sie bearbeitet.
2. Sie muss Mitarbeiter, Baustelle, Datum, Start und Ende explizit auswählen.
3. Sie darf keine Mutation auslösen, solange Pflichtangaben fehlen.
4. Ein gültiger Entwurf muss atomar und idempotent gespeichert werden.
5. Fachliche Ablehnungen müssen mit stabilem Code und verständlichem Grund sichtbar sein.
6. Der angezeigte Zustand muss aus PostgreSQL stammen und nach einem Reload identisch bleiben.

## Product Value

Das Feature schafft den ersten belastbaren Planungs**nachweis** des Produkts: nicht nur Daten lesen, sondern einen fachlich gültigen Planungsvorgang durchführen — schreibend, transaktional, mandantengebunden. Damit entsteht eine tragfähige Grundlage für spätere Veröffentlichung, Mitarbeiteransicht und Bestätigung. Der ausgelieferte Produktwert für eine reale Planerin entsteht erst mit EYT-14 (Identität) und einem Deployment; beides ist hier ausdrücklich nicht enthalten.

## Business or Project Goals

- Einen vollständigen vertikalen Slice statt weiterer isolierter Grundlagen liefern.
- Claude über Plumbline an nachweisbare Anforderungen, Gegenproben und Stop-Gates binden.
- Architektur-, Vertrags- und Datenbankgrenzen erhalten.
- Keine Funktion als fertig bewerten, die nur kompiliert oder gegen Mocks funktioniert.

## Success Signals

- Die Route `/planung` zeigt reale Mitarbeiter-, Baustellen-, Planversions- und Zuweisungsdaten.
- Ein gültiger Einsatzentwurf wird genau einmal gespeichert.
- Derselbe Idempotenzschlüssel erzeugt bei Wiederholung keine Doppelwirkung.
- Konflikte und ungültige Eingaben werden ohne Teilwirkung abgelehnt.
- UI, API und Datenbank zeigen dieselben IDs.
- Reload und zweiter Browserkontext zeigen denselben Stand.
- Eine Gegenprobe macht den Nachweis rot, sobald Serverzustand, Tenantfilter, Idempotenz oder Konfliktprüfung umgangen werden.

## Boundaries

### In Scope

- ISO-Wochenvalidierung in Vertrag und Datenbank
- UUID-v4-konforme Seed-Daten
- autorisierter Create-Assignment-Command
- serverseitige Entwurfsvalidierung
- Idempotenz und atomare Persistenz
- PlanningGateway für Lesen, Validieren und Erstellen
- klickbare Planungsoberfläche
- Browser-E2E und Accessibility-Smoke

### Out of Scope

- Veröffentlichung einer Planversion
- unveränderliche Publish-Historie als Nutzerreise
- Mitarbeiteransicht und Bestätigung
- Authentifizierung, Einladung und Sessionverwaltung
- Monats- und Vier-Wochen-Projektion
- Timer, Abwesenheiten, Ressourcen, Wetter und Benachrichtigungen
- produktives Deployment

## Assumptions

- ASSUMPTION: Der bestehende Draft-PR #23 bleibt technische Ausgangsbasis und wird vor Featureabschluss entweder integriert oder sauber in den Feature-Branch übernommen.
- ASSUMPTION: Für den E2E-Nachweis darf weiterhin ein serverseitig injiziertes, synthetisches und bereits verifiziertes Testsubjekt verwendet werden.
- ASSUMPTION: Die Pilotzeitzone bleibt `Europe/Berlin`.

## Missing Items

- RESOLVED (2026-07-28): Explizite Nutzerbestätigung dieses Vision-/Canvas-Schnitts ist erteilt.
- MISSING: Formale Entwickler-Kapazitätsbestätigung für den aktiven Sprint. Der Nutzer hat diese ausdrücklich **nicht** vorab erteilt. Ergibt das Developers-Gate, dass die vollständigen Must-Anforderungen im Sprintfenster nicht belastbar erfüllbar sind, gilt: vor dem Coding beziehungsweise am nächsten sicheren Gate stoppen, die konkrete Kapazitäts- oder Abhängigkeitslücke benennen, **keine Must-Anforderung kürzen**, stattdessen Verlängerung oder Neuplanung vorschlagen. Ein zeitlich passender, aber nur teilweise funktionierender Durchstich ist nicht akzeptiert.

## Confirmation

Erforderliche Bestätigung:

> Ich bestätige, dass Product Canvas und Product Vision meine Absicht korrekt wiedergeben und als Grundlage für AgileTeam Planning verwendet werden dürfen.
