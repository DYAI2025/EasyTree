# Product Canvas: Reale Wochenplanung mit Entwurfs- und Konfliktlogik

Status: user-confirmed  
Confirmed by user: yes  
Feature Slug: `planning-draft-conflict-slice`

**Zweimal bestätigt.** Erstbestätigung 2026-07-28. Danach ergänzte das Council-Gate (Phase 0.16)
die Wertabgrenzung; das Artefakt kehrte auf `draft` zurück und wurde am 2026-07-28 vom Product
Owner (Benjamin Poersch) **neu bestätigt**, ausdrücklich einschließlich der Wertabgrenzung:
Sprint 4 liefert einen vorproduktiven, real verdrahteten Schreibpfad-Durchstich und noch keinen
ausgelieferten Produktwert für eine produktiv authentifizierte Planerin.

Der bestätigte Feature-Scope ist unverändert; insbesondere bleibt **REQ-009 vollständig
bestehen**. Es gilt weiterhin:
Bestätigt ist der **fachliche Feature-Scope**. Technische Kapazität und Umsetzbarkeit sind
ausdrücklich **nicht** mitbestätigt — sie gehören in GATE-002 (Developers-Gate) und sind dort
evidenzbasiert zu führen. Reicht das Sprintfenster für die vollständigen Must-Anforderungen
nicht, wird **keine Must-Anforderung gekürzt**; stattdessen ist eine Verlängerung oder
Neuplanung vorzuschlagen.

| Section              | ID      | Value                                                                                                                                                                                                                                             | Source Type | Source                                              |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------- |
| Problem              | CAN-001 | Der bestehende Systemdurchstich kann eine Planungswoche real lesen, aber noch keinen fachlich gültigen Einsatzentwurf über UI, Gateway, API und PostgreSQL erstellen. Dadurch ist noch kein vollständiger Planungsvorgang nutzbar oder beweisbar. | EXPLICIT    | Jira EYT-50, EYT-62, EYT-92; GitHub PR #23          |
| Users / Customers    | CAN-002 | Planerinnen, Administratoren und berechtigte Führungskräfte der EasyTree-Pilotorganisation                                                                                                                                                        | EXPLICIT    | PRD v1.3 Rollen; Jira Sprint 4                      |
| Value Promise        | CAN-003 | Eine Planerin kann eine reale Woche öffnen, einen Einsatzentwurf anlegen und unmittelbar nachvollziehen, ob dieser gespeichert oder aus einem fachlich stabilen Grund abgelehnt wurde.                                                            | EXPLICIT    | Sprint-4-Ziel                                       |
| Current Alternatives | CAN-004 | Read-only-Planungsfenster, Mock-Gateway und isolierte Domain-/Datenbanktests; kein zusammenhängender schreibender Nutzerfluss                                                                                                                     | EXPLICIT    | PR #23; Jira EYT-50/EYT-79                          |
| Key Capabilities     | CAN-005 | Reale Wochenabfrage, ISO-Wochenvalidierung, UUID-v4-konforme Testdaten, explizite Eingabe, serverseitige Validierung, autorisierter und idempotenter Create-Command, atomare Speicherung, sichtbare Konflikte, Reload-/Zweitbrowser-Nachweis      | EXPLICIT    | Jira EYT-50, EYT-62, EYT-79, EYT-88, EYT-91, EYT-92 |
| Non-Goals            | CAN-006 | Publish, Mitarbeiterbestätigung, produktiver Login, Monats-/Vier-Wochen-Ansicht, Ressourcen, Abwesenheit, Timer, Wetter, Benachrichtigungen und Deployment                                                                                        | EXPLICIT    | Jira Out-of-Scope                                   |
| Constraints          | CAN-007 | Bestehende Architekturgrenzen, transport-only Contracts, serverseitige Autorisierung, RLS, append-only Forward-Migrationen, kein direkter UI-Datenbankzugriff, keine Mock-/LocalStorage-Wahrheit                                                  | EXPLICIT    | ADR/PRD; Jira-Tickets; PR #23                       |
| Risks                | CAN-008 | Stacked-Branch-Abhängigkeit zu PR #23; inkonsistente Wochenregeln zwischen Vertrag und Datenbank; Seed-IDs brechen den Vertrag; scheinbar grüne Tests gegen Mocks; Doppeleffekt bei Retries; Teilwirkung bei Transaktionsfehlern                  | EXPLICIT    | EYT-88, EYT-91, EYT-50, EYT-62                      |
| Success Signal       | CAN-009 | Ein gültiger Entwurf erscheint mit identischen IDs in UI, API und Datenbank sowie nach Reload und zweitem Browserkontext; definierte Negativfälle werden ohne Teilwirkung abgelehnt; relevante CI- und E2E-Gates sind grün.                       | EXPLICIT    | Sprintziel; EYT-62/EYT-92                           |
| Evidence             | CAN-010 | Contract-, Domain-, Datenbank-, Route-, Integrations-, Nebenläufigkeits-, Browser-E2E- und Accessibility-Nachweise plus absichtliche rote Gegenproben                                                                                             | EXPLICIT    | EYT-50/EYT-62/EYT-79/EYT-92                         |
| Allowed Scope        | CAN-011 | Genau ein vertikaler Feature-Slice vom Öffnen einer Woche bis zum persistenten Erstellen oder nachvollziehbaren Ablehnen eines Einsatzentwurfs                                                                                                    | EXPLICIT    | Nutzerauftrag und Sprintziel                        |
| Unresolved Questions | CAN-012 | Nutzerbestätigung erteilt (2026-07-28) und PR-Strategie entschieden. OFFEN bleibt allein die formale Entwickler-Kapazitätsbestätigung — vom Nutzer ausdrücklich nicht vorab erteilt, evidenzbasiert in GATE-002 zu führen.                        | MISSING     | Developer Gate (GATE-002)                           |

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

### Wertabgrenzung (Council-Gate 2026-07-28)

„Nutzbar" heißt **nachweisbar**, nicht **ausgeliefert**. Challenger und Critic haben unabhängig
voneinander festgestellt: solange EYT-14 offen ist, ist „die Planerin" im Nachweis ein
serverseitig injiziertes synthetisches Subjekt, und ohne Deployment öffnet niemand etwas. Der
zweite Browserkontext belegt Serverpersistenz, **nicht** einen zweiten realen Nutzer. Der
Feature-Schnitt selbst wurde von beiden Rollen ausdrücklich als tragfähig bestätigt — angegriffen
war die Wertbehauptung, nicht das Vorhaben. Diese Abgrenzung ist übernommen; CAN-003 bleibt
inhaltlich gültig, weil es eine Fähigkeit beschreibt und keinen Auslieferungsgrad behauptet.

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

| Risk ID  | Risiko                                                     | Wirkung                                                | Gegenmaßnahme                                                                                                   | Source Type |
| -------- | ---------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------- |
| RISK-001 | PR #23 ist offen und der neue Branch baut darauf auf.      | Doppelter oder schwer reviewbarer Diff gegen `master`  | Intake-PR als gestapelten PR gegen den Read-Through-Branch führen; Integration vor Featureabschluss bereinigen. | ASSUMPTION  |
| RISK-002 | Vertrag und Datenbank akzeptieren unterschiedliche Wochen. | Persistente fachlich ungültige Planversionen           | Gemeinsame deterministische Regel plus Forward-Migration und Negativtests                                       | EXPLICIT    |
| RISK-003 | Seed-IDs sind keine gültigen UUID v4.                      | Reale API-Antworten scheitern trotz gültiger DB-Zeilen | Seed und alle Referenzen konsistent ersetzen; Reset- und Contract-Test                                          | EXPLICIT    |
| RISK-004 | UI oder Test nutzt Mock/LocalStorage als Fallback.         | Scheinbar funktionierendes Feature ohne Serverwahrheit | Boundary-Test, Ausfalltest und E2E-Abgleich mit DB                                                              | EXPLICIT    |
| RISK-005 | Retry erzeugt Doppelwirkung.                               | Doppelte Einsätze                                      | Pflicht-Idempotenzschlüssel, serverseitige Speicherung und Retry-Test                                           | EXPLICIT    |
| RISK-006 | Command scheitert nach Teilwrite.                          | Inkonsistenter Plan oder Auditbestand                  | Eine Transaktion, erzwungener Fehler und Nachweis ohne Teilwirkung                                              | EXPLICIT    |
| RISK-007 | Sprintumfang wächst um Publish oder Auth.                  | Kein abgeschlossenes Feature im Zeitfenster            | Harte Non-Goals und separates Folgeslice                                                                        | EXPLICIT    |

## Success Signal

Das Feature gilt nur dann als erfolgreich, wenn der Nutzerfluss real ausgeführt und nicht lediglich aus Einzeltests abgeleitet wurde. Ein grüner Build ohne schreibenden Browserfluss ist kein Erfolgssignal.

## Allowed Scope

Der erlaubte Scope endet nach dem gespeicherten oder nachvollziehbar abgelehnten Einsatzentwurf. Veröffentlichung und Mitarbeiterreaktion beginnen in einem späteren Feature.

## Allowed change scope

Abgeleitet aus CAN-011 und den sechs Sprint-4-Tickets — enger als der bestätigte Feature-Scope,
nie weiter. Jede Ausweitung ist eine Nutzerentscheidung, keine Agentenentscheidung.

Zur Form, weil sie hier funktional ist: `plumbline-scope-check` liest ausschließlich
Aufzählungspunkte dieses Abschnitts und entfernt umschließende Backticks. Die Muster stehen
deshalb in Inline-Code — ohne ihn schreibt Prettier `\*\*` und die Backslashes landen im
Glob. Genau daran ist die erste Fassung gescheitert.

Wichtig zur Reichweite: der Scope-Guard prüft Pfade, nicht Operationen.
`supabase/migrations/*.sql` steht in der Liste, weil eine neue Forward-Migration entstehen
muss — das erlaubt nicht, eine gemergte Migration zu ändern. Die Append-only-Regel wird durch
Review und `db-gates` durchgesetzt, nicht durch diese Liste.

Ausdrücklich außerhalb des erlaubten Scopes: `.github/workflows/ci.yml` als Gate-Definition
ohne Ticketbezug, Auth-/Session-Module, Publish-Pfad, Ressourcen-, Abwesenheits- und
Wetter-Module.

Zu `.gitignore` und `CLAUDE.md`: beide Änderungen hat der Product Owner am 2026-07-28
ausdrücklich autorisiert — `.gitignore` eng begrenzt auf das Nicht-mehr-Tracken von
`.claude-flow/` und `.claude/homunculus/`, `CLAUDE.md` für die Korrektur der falschen
EYT-88-/Publish-Zuordnung. Die Freigabe existierte bisher nur im Gesprächsverlauf und nicht in
dieser maschinenlesbaren Liste; der Scope-Guard hat die Lücke gemeldet, sobald die
Basisauflösung (LED-014) committete Arbeit überhaupt sichtbar machte. Auch das sind
Governance-Pfade und keine fachliche Scope-Erweiterung: sie erlauben keine Produktänderung und
keine Auth-, Publish- oder sonstige Non-Goal-Funktion.

Zu `scripts/read-through-harness.sh` (ergänzt am 2026-07-28): kein neuer Scope, sondern eine
Lücke in dieser Liste. Der Plan nennt die Datei unter T-06 ausdrücklich als betroffen
(„erweitern, nicht duplizieren"). Aufgefallen ist sie, weil T-01 das darin fest verdrahtete
Testsubjekt brach und der CI-Job `read-through` rot wurde. Eingetragen ist nur diese eine
Datei, nicht `scripts/**` — die Branch-Protection-Skripte bleiben ausdrücklich draußen.

Zwei Formregeln, beide hier schon einmal verletzt: Muster mit führendem `/` verwirft der Parser
(`plumbline_scope.py:81`), und jede Zeile, die mit `*` beginnt — etwa umbrochene Fettschrift —
wird als Listenpunkt gelesen. Prosa in diesem Abschnitt darf deshalb nie mit `*` anfangen.

Zu `docs/context/**` (freigegeben am 2026-07-28): eine **Governance-Pfadfreigabe, keine
fachliche Scope-Erweiterung**. Sie deckt Plumbline-Run-Ledger, Gate-Evidenz, Status- und
Kontextartefakte — ausdrücklich **nicht** neue Produktanforderungen, Erweiterung des
Feature-Scope, Auth-/Publish- oder andere Non-Goal-Funktionen und auch nicht beliebige
Dokumentationsänderungen außerhalb dieses Features.

Zu `.gitleaks.toml`, `.prettierignore` und den beiden Markdown-Dateien (ergänzt 2026-07-28): vom
Product Owner beauftragte Entsperrung der zwei geerbten CI-Baseline-Blocker. Wieder eine Lücke in
dieser Liste, keine Scope-Erweiterung — sie erlauben keine Produktänderung.

- `apps/api/src/modules/planning/**`
- `apps/api/src/platform/database/**`
- `apps/api/test/**`
- `apps/web/app/planung/**`
- `apps/web/components/planning-*.tsx`
- `apps/web/lib/planning-*.ts*`
- `apps/web/test/**`
- `apps/web/e2e/**`
- `packages/contracts/src/planning/**`
- `packages/contracts/src/http/planning-gateway.ts`
- `packages/contracts/src/mock/planning.ts`
- `packages/contracts/openapi/v1.json`
- `packages/contracts/test/**`
- `packages/domain/src/**`
- `packages/domain/test/**`
- `scripts/read-through-harness.sh`
- `supabase/migrations/*.sql`
- `supabase/seed.sql`
- `supabase/tests/**`
- `docs/canvas/**`
- `docs/vision/**`
- `docs/prd/**`
- `docs/plans/**`
- `docs/context/**`
- `docs/traceability.md`
- `.gitignore`
- `.gitleaks.toml`
- `.prettierignore`
- `docs/EasyTree – Softwaredokumentation.md`
- `jira_epic_post_mvp_planungsoekonomie_maschinenverleih.md`
- `CLAUDE.md`

## Unresolved Questions

- RESOLVED (2026-07-28): Nutzerbestätigung von Vision und Canvas ist erteilt.
- MISSING: Developers-Gate zu Kapazität und Umsetzbarkeit innerhalb des aktiven Sprintfensters — vom Nutzer ausdrücklich **nicht** vorab bestätigt, evidenzbasiert in GATE-002 zu führen.
- DECIDED (2026-07-28): PR #23 bleibt ungemergte technische Basis. Sprint 4 wird in einem eigenen Branch `feat/sprint-4-planning-draft-conflict-implementation` umgesetzt, PR gestapelt gegen `feat/eyt-50-read-through-slice`; nach dessen Merge Rebase/Retarget auf `master` mit vollständiger Neuausführung aller Pflichtgates.

## User Confirmation

> Ich bestätige, dass Product Canvas und Product Vision meine Absicht korrekt wiedergeben und als Grundlage für AgileTeam Planning verwendet werden dürfen.
