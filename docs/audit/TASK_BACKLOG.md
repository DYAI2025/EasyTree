# Priorisierte Taskliste

## Ziel

Die beiden UX-Prototypen als kohärenten Clickdummy in die technische Foundation integrieren und anschließend in vertikalen Slices zum PRD-konformen MVP ausbauen.

## Phase A – P0: Entscheidung und integrierter Clickdummy

| ID | Task | Ergebnis / binäre Akzeptanz | Abhängigkeit | Owner |
|---|---|---|---|---|
| EYT-INT-001 | Kanonisches Repository und Produktnamen klären | ADR benennt genau ein Repo, Default Branch, Produktname und Archivstatus der Prototypen | – | Product/Architecture |
| EYT-INT-002 | Integrations-ADR „ein Monorepo, zwei Rollen-Shells“ | ADR akzeptiert; verworfene Optionen und Rückbaupfad dokumentiert | INT-001 | Architecture |
| EYT-INT-003 | Gemeinsames Domain-/Contract-Paket anlegen | `packages/domain` und `packages/contracts` bauen; keine UI importiert Mock-Typen direkt | INT-002 | Fullstack |
| EYT-INT-004 | Prototype-Gateway definieren | Mock- und HTTP-Gateway erfüllen dieselben Interfaces; UI kennt kein Supabase-SDK | INT-003 | Frontend/API |
| EYT-FIX-001 | Wochenstunden-Scoping korrigieren | Tests zeigen getrennte Summen für zwei Kalenderwochen; keine „Ganze Woche“-Drift | – | Frontend/Domain |
| EYT-FIX-002 | Zeitintervall validieren | `start == end`, ungültige Werte und unerlaubte Nachtintervalle werden explizit behandelt | – | Domain |
| EYT-FIX-003 | Ressourcen-Doppelbelegung korrigieren | zwei nicht überlappende Reservierungen am selben Tag bleiben zulässig | FIX-002 | Domain |
| EYT-FIX-004 | Koordinatenmodell und Kartenadapter | Worksite speichert Koordinaten; Clickdummy verwendet Adapter statt direkter Nominatim-Aufrufe | INT-003 | Frontend/API |
| EYT-FIX-005 | Falsche Offline-/Sync-Claims entfernen | keine UI behauptet Offline-Sync ohne Service Worker/Queue; Demo-Modus ist eindeutig beschriftet | – | Product/Frontend |
| EYT-FIX-006 | Timer-Clickdummy auf Instant-Modell umstellen | Reload berechnet Dauer aus gespeichertem ISO-Start; kein `localStorage.clear()` | INT-003 | Frontend/Domain |
| EYT-CD-001 | Gemeinsame Design-Tokens/Primitives konsolidieren | Planer- und Mobile-Shell nutzen `packages/ui`; Fokus-/Statusregeln erhalten | INT-003 | Design/Frontend |
| EYT-CD-002 | Planer-Screens in Master migrieren | Woche, Monat, 4-Wochen, Konflikte, Publish-Demo unter `/planung` navigierbar | CD-001, INT-004 | Frontend |
| EYT-CD-003 | Mitarbeiter-Screens in Master migrieren | Heute, Woche, Baustelle, Wetter, Bestätigung/Ablehnung, Abwesenheit, Timer unter `/einsatz` | CD-001, INT-004 | Frontend |
| EYT-CD-004 | Login/Passwort-Reset-Clickdummy | Login, Fehler, Reset und Rückkehrfluss sind klickbar und rollenbasiert weiterleitbar | CD-002, CD-003 | Frontend/Product |
| EYT-CD-005 | Rollen-/Berechtigungseditor-Clickdummy | Admin kann atomare Rechte ansehen/ändern; GF- und Mitarbeitergrenzen sichtbar | CD-004 | Frontend/Product |
| EYT-CD-006 | Arbeitszeitfreigabe/Korrektur-Clickdummy | Admin sieht Original, Korrektur, Pflichtgrund und Auditvorschau | CD-003 | Frontend/Product |
| EYT-CD-007 | End-to-End-Prototyp-Szenario | definierter 8-Schritt-Ablauf funktioniert mit identischen IDs/Planversionen | CD-002..006 | QA/Product |
| EYT-CD-008 | Nutzer- und Stakeholdertest | Test mit GF/Admin/Mitarbeiter; Findings priorisiert; PRD-Änderungen beschlossen | CD-007 | Product/UX |

## Phase B – P1: Fachliches MVP

| ID | Task | Ergebnis / binäre Akzeptanz | Abhängigkeit | Owner |
|---|---|---|---|---|
| EYT-DATA-001 | Fachliches PostgreSQL-Schema | Migrationen für Workforce, Worksite, Skills, Ressourcen, Planung, Abwesenheit, Zeit, Audit; RLS-Tests grün | INT-003 | Backend/DB |
| EYT-AUTH-001 | Supabase Auth, Einladung, Reset | Login/Reset/Invite gegen reale Testgrenze; Session-Fehlerfälle getestet | DATA-001 | Backend/Frontend |
| EYT-IAM-001 | Rollen, atomare Rechte, serverseitige Autorisierung | jede Command-Route prüft Tenant, Rolle und Recht; Cross-Tenant-Tests grün | AUTH-001 | Backend/Security |
| EYT-API-001 | OpenAPI und generierter Client | API-Spezifikation versioniert; Client in beiden Shells genutzt; Contract-Test grün | INT-003 | Backend/Frontend |
| EYT-PLAN-001 | Assignment Commands/Queries | Erstellen, Verschieben, Tauschen, Entfernen und Tagesmehrfachzuweisung über Domain Commands | DATA-001, IAM-001, API-001 | Backend |
| EYT-PLAN-002 | Deterministische Konfliktprüfung | Abwesenheit, Kapazität, Person-/Ressourcenüberlappung und Skills serverseitig getestet | PLAN-001 | Backend/Domain |
| EYT-PLAN-003 | Planversion und atomare Veröffentlichung | Publish erzeugt unveränderliche Version, revalidiert, auditiert und blockiert harte Konflikte | PLAN-002 | Backend |
| EYT-ACK-001 | Bestätigung/Ablehnung/Re-Confirmation | Mitarbeiterstatus ist an Planversion/Änderung gebunden; Pflichtgrund validiert | PLAN-003 | Fullstack |
| EYT-ABS-001 | Abwesenheitsworkflow | Antrag, Entscheidung, Sichtbarkeit und Planungswirkung funktionieren mit Audit | IAM-001 | Fullstack |
| EYT-SKILL-001 | Skills/Qualifikationen | atomare Skills pflegbar; fehlende Skills als Hinweis, nicht stillschweigende Ablehnung | DATA-001 | Fullstack |
| EYT-RES-001 | Geräte/Fahrzeuge/Zustandsmeldung | eindeutige Ressourcen, Reservierung, Verfügbarkeit, Zustandsstatus und sichere Uploads | DATA-001 | Fullstack |
| EYT-TIME-001 | Arbeitszeit Start/Stop | genau eine aktive Buchung pro Mitarbeiter; idempotente Commands; UTC/IANA-Zeitmodell | IAM-001, API-001 | Backend/Frontend |
| EYT-TIME-002 | Freigabe/Korrektur/Audit | Original bleibt erhalten; Korrektur braucht Grund und Berechtigung; Exportstatus sichtbar | TIME-001 | Fullstack |
| EYT-WX-001 | Wetter-/Warnungsadapter | Provider über Serveradapter, Cache, Timeout, Fehlerstatus und Provenienz; keine Browser-Direktcalls | API-001 | Backend |
| EYT-NOTIF-001 | In-App/E-Mail/Reminder-Outbox | Publish/Änderung erzeugt idempotente Events; Retry/Dead Letter/Reconciliation sichtbar | PLAN-003 | Backend/Worker |
| EYT-PWA-001 | Installierbare Online-/Read-only-PWA | Manifest/Icons/Service Worker; Lesen bei Cache möglich; Schreiben offline klar blockiert | CD-003 | Frontend |
| EYT-TEST-001 | Kritische E2E-/A11y-/Contract-Suite | Planen→Publizieren→Bestätigen→Zeit→Korrektur läuft gegen reale lokale DB/API | PLAN-003, ACK-001, TIME-002 | QA/Fullstack |

## Phase C – P2: Release- und Pilotgates

| ID | Task | Ergebnis / binäre Akzeptanz | Abhängigkeit | Owner |
|---|---|---|---|---|
| EYT-SEC-001 | Threat Model, Datenschutz, Retention, Uploadschutz | freigegebene Datenfluss-/Rechtematrix; keine offenen Extreme-Findings | P1 Kern | Security/Product |
| EYT-OPS-001 | Logs, Metriken, Traces, Alerts, Runbooks | kritische Commands korrelierbar; Alarm- und Incidentpfad getestet | P1 Kern | Platform |
| EYT-OPS-002 | Backup/Restore/Migration/Rollback-Probe | Restore und Rollback in Testumgebung erfolgreich dokumentiert | DATA-001 | Platform/DB |
| EYT-PERF-001 | Repräsentativer Last-/Konflikttest | 12 aktive Nutzer und 3 parallele Baustellen im Pilotprofil ohne definierte SLO-Verletzung | TEST-001 | QA/Platform |
| EYT-PILOT-001 | Pilot und Abnahme | GF/Admin/Mitarbeiter akzeptieren Kernreisen; Defekte und Rest-Risiken dokumentiert | SEC/OPS/PERF | Product |
| EYT-REL-001 | Produktionsfreigabe | alle PRD-, Security-, Legal-, Operations- und Rollback-Gates mit Evidenz bestanden | PILOT-001 | Accountable Owner |

## Nicht in das MVP ziehen

- automatische Tourenoptimierung;
- Voice-to-Text als Abnahmevoraussetzung;
- Planungsökonomie/Maschinenverleih;
- native iOS-/Android-App ohne belegten Feldnutzen;
- Microservices, Kafka oder Solver-Infrastruktur ohne konkreten Bedarf.
