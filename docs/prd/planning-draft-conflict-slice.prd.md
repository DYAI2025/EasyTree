# PRD: Reale Wochenplanung mit Entwurfs- und Konfliktlogik

Status: user-confirmed  
Confirmed by user: yes  
Feature Slug: `planning-draft-conflict-slice`  
Owner: Product Owner EasyTree  
User Confirmation Required: yes — **erteilt am 2026-07-28**

## Source Summary

| Source ID | Quelle                           | Autorität                            | Verwendung                                               | Source Type |
| --------- | -------------------------------- | ------------------------------------ | -------------------------------------------------------- | ----------- |
| SRC-001   | Jira EYT Sprint 4, Sprint-ID 203 | Operativer Sprint-Scope              | Sprintziel und Kandidaten                                | EXPLICIT    |
| SRC-002   | Jira EYT-50                      | Fachlicher Referenz-Slice            | Command, Persistenz, Validierung, Idempotenz             | EXPLICIT    |
| SRC-003   | Jira EYT-62                      | Qualitäts- und E2E-Nachweis          | Browser-, Datenbank- und Gegenproben                     | EXPLICIT    |
| SRC-004   | Jira EYT-79                      | Gateway-Schnitt                      | Frontend-Port und Fehlerzustände                         | EXPLICIT    |
| SRC-005   | Jira EYT-88                      | Datenintegritätsbug                  | ISO-Wochenvalidierung                                    | EXPLICIT    |
| SRC-006   | Jira EYT-91                      | Testdatenbug                         | UUID-v4-konforme Seeds                                   | EXPLICIT    |
| SRC-007   | Jira EYT-92                      | Sichtbare Nutzerreise                | Klickbare Wochenplanung                                  | EXPLICIT    |
| SRC-008   | GitHub PR #23, Head `3773ecf`    | Implementierungsstand                | Realer Read-Through vorhanden; Write-Through fehlt       | EXPLICIT    |
| SRC-009   | `docs/prd/CURRENT_PRD_v1.3.md`   | Fachlich freigegebener Produktumfang | Rollen, Planungskern, Konflikte, Sicherheit              | EXPLICIT    |
| SRC-010   | Nutzerauftrag vom 28.07.2026     | Ziel- und Vorgehensautorität         | Sprint als kleines Plumbline-Feature, Fehlerquote senken | EXPLICIT    |

## Problem Statement

Der aktuelle Codezustand kann eine reale Planungswoche vom Browser über Gateway und API aus PostgreSQL lesen. Eine Planerin kann jedoch noch keinen Einsatzentwurf über denselben realen Pfad anlegen. Damit fehlen der erste nutzbare Planungsvorgang, die schreibende Autorisierungs- und Transaktionsgrenze, serverseitige Konfliktbehandlung, Idempotenz sowie ein vollständiger Browser-E2E-Nachweis.

Sprint 4 wird deshalb als ein geschlossenes Feature umgesetzt: Eine Planerin öffnet eine reale Woche, wählt Mitarbeiter, Baustelle und Zeitraum, speichert einen gültigen Entwurf oder erhält bei einem ungültigen beziehungsweise überlappenden Entwurf eine nachvollziehbare Ablehnung.

## Target Users

| ID       | User                               | Bedarf                                                                      | Source Type | Source                    |
| -------- | ---------------------------------- | --------------------------------------------------------------------------- | ----------- | ------------------------- |
| USER-001 | Berechtigte Planerin               | Wochenplan öffnen, Einsatzentwurf anlegen und Konflikte verstehen           | EXPLICIT    | SRC-001, SRC-002, SRC-007 |
| USER-002 | Administrator                      | Dieselbe Planungsfunktion mit serverseitig geprüfter Berechtigung verwenden | EXPLICIT    | SRC-009                   |
| USER-003 | Geschäftsführung mit Planungsrecht | Planung fachlich prüfen und auf verlässlichen Serverdaten arbeiten          | EXPLICIT    | SRC-009                   |

## Goals

1. Einen realen schreibenden Browser→Gateway→API→PostgreSQL-Durchstich liefern.
2. Ein fachlich gültiges Assignment atomar und idempotent als Entwurf speichern.
3. Ungültige Wochen, IDs, Intervalle und Mitarbeiterüberlappungen deterministisch verhindern.
4. Erfolg und Ablehnung in einer nutzbaren, zugänglichen Wochenansicht sichtbar machen.
5. Durch reale Tests und Gegenproben verhindern, dass Mocks, Fallbacks oder Teilimplementierungen als fertig gelten.

## Non-Goals

- Planversion veröffentlichen
- veröffentlichte Pläne in der Mitarbeiteransicht bestätigen oder ablehnen
- produktive Authentifizierung, Einladung, Passwort-Reset oder Sessionverwaltung
- Monats- und rollierende Vier-Wochen-Planung
- Abwesenheiten, Skills, Ressourcen, Fahrzeuge, Timer, Wetter oder Benachrichtigungen
- vollständige Admin-Anwendung oder Design-System-Konsolidierung
- produktives Deployment oder Production-Readiness-Freigabe

## Assumptions

- ASSUMPTION: Der offene Read-Through-PR #23 ist die technische Basis dieses Features.
- ASSUMPTION: Der Testbetrieb darf ein ausschließlich serverseitig injiziertes, synthetisches und bereits verifiziertes Subjekt verwenden; es entsteht kein Request-gesteuerter Auth-Bypass.
- ASSUMPTION: `Europe/Berlin` bleibt die Pilotzeitzone.
- ASSUMPTION: Ein Entwurf darf sich fachlich prüfen lassen; verbindliche Überschneidungsverbote veröffentlichter Einsätze bleiben zusätzlich in der Datenbank geschützt.

## Open Questions

| ID     | Frage                                                                             | Status              | Wirkung                                                                                                                                                                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-001 | Bestätigt der Product Owner Vision und Canvas dieses Feature-Schnitts?            | RESOLVED 2026-07-28 | Bestätigt; `READY_FOR_AGILETEAM_PLANNING` erreicht                                                                                                                                                                                                                                                   |
| OQ-002 | Bestätigen die Developers die Umsetzbarkeit innerhalb des aktiven Sprintfensters? | MISSING             | Vom Nutzer ausdrücklich **nicht** vorab bestätigt. Evidenzbasiert in GATE-002. Bei Lücke: stoppen, Lücke benennen, **keine Must-Kürzung**, Verlängerung oder Neuplanung vorschlagen                                                                                                                  |
| OQ-003 | Wird PR #23 vor Beginn gemergt oder bleibt der Feature-Branch bewusst gestapelt?  | DECIDED 2026-07-28  | PR #23 bleibt ungemergt. Eigener Branch `feat/sprint-4-planning-draft-conflict-implementation`, PR gestapelt gegen `feat/eyt-50-read-through-slice`. Kein Merge von PR #23 allein zum Sprintstart. Nach dessen Merge Rebase/Retarget auf `master` mit vollständiger Neuausführung aller Pflichtgates |

## Requirements

| Requirement ID | Requirement                                                                                                                                                                                                                                        | Priority | Source Type | Source                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | ----------- | ------------------------- |
| REQ-001        | Die Anwendung muss eine angeforderte reale Planungswoche über `PlanningGateway`, API und tenantgeschütztes PostgreSQL lesen und in `/planung` anzeigen.                                                                                            |     Must | EXPLICIT    | SRC-002, SRC-007, SRC-008 |
| REQ-002        | Vertrag, Domainregel und Datenbank müssen nur tatsächlich gültige ISO-8601-Wochenschlüssel akzeptieren; die Datenbankkorrektur erfolgt über eine neue Forward-Migration.                                                                           |     Must | EXPLICIT    | SRC-005                   |
| REQ-003        | Alle für den Feature-Nachweis verwendeten Seed- und Fixture-IDs müssen den gemeinsamen UUID-v4-Vertrag erfüllen und konsistent in abhängigen Tests aktualisiert werden.                                                                            |     Must | EXPLICIT    | SRC-006                   |
| REQ-004        | Die Planerin muss Mitarbeiter, Baustelle, Datum, Start und Ende explizit auswählen; bei fehlenden oder mehrdeutigen Pflichtangaben darf keine Mutation ausgelöst werden.                                                                           |     Must | EXPLICIT    | SRC-007                   |
| REQ-005        | Ein autorisierter Create-Assignment-Command muss Mitarbeiter, Baustelle, Planungswoche und Zeitintervall serverseitig validieren und ausschließlich innerhalb des verifizierten Tenantkontexts ausführen.                                          |     Must | EXPLICIT    | SRC-002, SRC-009          |
| REQ-006        | Gleichzeitige Start-/Endwerte, invertierte Intervalle, ungültige Wochen und überlappende Einsätze desselben Mitarbeiters müssen mit stabilen Fehlercodes und verständlichen Gründen abgelehnt werden.                                              |     Must | EXPLICIT    | SRC-002, SRC-007          |
| REQ-007        | Ein erfolgreicher Command muss Assignment, Planversionsbezug und erforderliche Audit-/Outbox-Wirkungen atomar speichern; ein Fehler darf keine Teilwirkung hinterlassen.                                                                           |     Must | EXPLICIT    | SRC-002, SRC-003          |
| REQ-008        | Schreibaufrufe müssen einen validierten Idempotenzschlüssel verlangen; dieselbe fachliche Wiederholung mit demselben Schlüssel darf keine Doppelwirkung erzeugen.                                                                                  |     Must | EXPLICIT    | SRC-002, SRC-003, SRC-008 |
| REQ-009        | `PlanningGateway` muss Lesen, serverseitige Entwurfsvalidierung und Entwurfserstellung über einheitliche Transportverträge anbieten und modellierte Fehlerzustände liefern.                                                                        |     Must | EXPLICIT    | SRC-004                   |
| REQ-010        | Die Wochenansicht muss Loading, Empty, Success, Conflict, Contract Violation, Unavailable, Forbidden und Stale Version sichtbar unterscheidbar und nicht ausschließlich farbcodiert darstellen.                                                    |     Must | EXPLICIT    | SRC-004, SRC-007          |
| REQ-011        | Ein Browser-E2E-Nachweis muss belegen, dass UI, API und Datenbank dieselben IDs führen und der gespeicherte Stand nach Reload sowie in einem zweiten Browserkontext erhalten bleibt.                                                               |     Must | EXPLICIT    | SRC-003, SRC-007          |
| REQ-012        | Tests und Architekturregeln müssen direkte Mock-, LocalStorage-, Supabase- oder Datenbankabhängigkeiten der UI verhindern und mindestens eine absichtliche Gegenprobe für Serverzustand, Tenantfilter, Idempotenz oder Konfliktprüfung rot machen. |     Must | EXPLICIT    | SRC-003, SRC-004, SRC-007 |

## Acceptance Criteria

| AC ID  | Requirement ID | Given                                                                                | When                                                                                                          | Then                                                                                                                                          | Source Type |
| ------ | -------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| AC-001 | REQ-001        | eine verifizierte und leseberechtigte Planerin sowie eine existierende Planungswoche | sie `/planung?weekKey=<gültige Woche>` öffnet                                                                 | werden Woche, Zeitzone, Planversion und Assignments aus PostgreSQL angezeigt; Fremdtenant-Daten erscheinen weder in Antwort noch DOM          | EXPLICIT    |
| AC-002 | REQ-002        | Vertrags- und Datenbankvalidierung sind aktiv                                        | `W00`, `W54`, `W99` oder eine in diesem Jahr nicht existente Woche 53 verarbeitet werden                      | lehnen Vertrag und Datenbank denselben Wert ab; gültige Wochen werden akzeptiert; keine gemergte Migration wird verändert                     | EXPLICIT    |
| AC-003 | REQ-003        | ein frischer Datenbankzustand                                                        | zwei aufeinanderfolgende Resets und alle betroffenen pgTAP-/Integrationstests laufen                          | sind sämtliche referenzierten IDs gültige UUID v4 und eine geseedete `employeeId` besteht die Runtime-Vertragsprüfung                         | EXPLICIT    |
| AC-004 | REQ-004        | die Planungsansicht ist geöffnet                                                     | mindestens eines der Felder Mitarbeiter, Baustelle, Datum, Start oder Ende fehlt                              | bleibt die Mutation aus und die fehlende Angabe wird zugänglich angezeigt                                                                     | EXPLICIT    |
| AC-005 | REQ-005        | vollständige gültige Eingaben und Schreibberechtigung                                | die Planerin den Einsatzentwurf absendet                                                                      | wird genau ein Assignment für denselben Tenant und dieselbe Planungswoche serverseitig erzeugt und mit seiner serverseitigen ID zurückgegeben | EXPLICIT    |
| AC-006 | REQ-006        | eine bestehende Mitarbeiterzuweisung oder ein ungültiges Intervall                   | ein neuer Entwurf gleiche Zeiten, invertierte Zeiten, eine ungültige Woche oder eine Überlappung enthält      | wird er mit stabilem Code und verständlichem Grund abgelehnt und nicht gespeichert                                                            | EXPLICIT    |
| AC-007 | REQ-007        | ein Command hat seine Transaktion begonnen                                           | nach dem ersten geplanten Schreibschritt ein Fehler erzwungen wird                                            | existieren weder Teil-Assignment noch inkonsistente Audit-/Outbox-Wirkung                                                                     | EXPLICIT    |
| AC-008 | REQ-008        | ein erfolgreicher Create-Command mit einem gültigen Idempotenzschlüssel              | exakt derselbe Request mit demselben Schlüssel wiederholt wird                                                | bleibt genau eine fachliche Wirkung bestehen und die Antwort verweist konsistent auf dieselbe Wirkung                                         | EXPLICIT    |
| AC-009 | REQ-009        | HTTP- und Mock-Implementierung des PlanningGateway                                   | dieselben Contract-Testfälle für Lesen, Validieren, gültiges Erstellen, Ablehnung und Retry ausgeführt werden | erfüllen beide dieselben Signaturen und modellierten Zustände; die Produktkonfiguration verwendet ohne Komponentenänderung HTTP               | EXPLICIT    |
| AC-010 | REQ-010        | die Wochenansicht läuft bei 1440 px und 375 px                                       | Erfolgs-, Lade-, Leer- und Fehlerfälle eintreten                                                              | bleiben Formular und Rückmeldungen bedienbar, per Text/ARIA unterscheidbar und bestehen den Accessibility-Smoke                               | EXPLICIT    |
| AC-011 | REQ-011        | ein gültiger Entwurf wurde im Browser gespeichert                                    | die Seite neu geladen und dieselbe Woche in einem zweiten Browserkontext geöffnet wird                        | stimmen Planversions- und Assignment-ID in UI, API und Datenbank überein, ohne Mock- oder LocalStorage-Fallback                               | EXPLICIT    |
| AC-012 | REQ-012        | die vollständige Nachweissuite ist grün                                              | jeweils eine geschützte Server-, Tenant-, Retry- oder Konfliktannahme absichtlich gebrochen wird              | schlägt der zugehörige Pflichtnachweis rot fehl und kann nicht durch fehlende Testausführung grün bleiben                                     | EXPLICIT    |

## Non-Functional Requirements

| NFR ID  | Anforderung                                                                                                                         | Nachweis                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| NFR-001 | Tenant-Isolation und Autorisierung sind fail-closed und werden vor jeder Fachquery beziehungsweise Mutation geprüft.                | Negativtests und Browser-/API-Gegenprobe         |
| NFR-002 | UI-Komponenten verwenden keine direkte Datenbank-, Supabase-, Mock- oder LocalStorage-Abhängigkeit als operative Wahrheit.          | Architektur-/Boundary-Test                       |
| NFR-003 | Request- und Response-Daten werden an der Transportgrenze gegen gemeinsame Runtime-Schemata validiert.                              | Contract- und Route-Tests                        |
| NFR-004 | Schreiboperationen sind transaktional, idempotent und nebenläufigkeitssicher für den definierten Feature-Scope.                     | Integrations-, Retry- und Fehler-Injektionstests |
| NFR-005 | Migrationen sind append-only und besitzen eine Forward-fix- sowie Rückbauentscheidung.                                              | Migration Review und Reset-Gate                  |
| NFR-006 | Die Kernreise ist tastaturbedienbar, semantisch beschriftet und nicht ausschließlich farbcodiert.                                   | Accessibility-Smoke                              |
| NFR-007 | Fehler werden mit stabilen maschinenlesbaren Codes und nutzerverständlichen Meldungen dargestellt, ohne sensible Details zu leaken. | API-/UI-Negativtests                             |
| NFR-008 | Kein Ticket gilt allein aufgrund eines Commits, Builds oder grünen Mocktests als erfüllt.                                           | Traceability und Gate-Matrix                     |

## Implementation Slices

| Slice                        | Jira   | Ergebnis                                                    | Abhängigkeit                      |
| ---------------------------- | ------ | ----------------------------------------------------------- | --------------------------------- |
| S4-01 Datenintegrität Wochen | EYT-88 | Gemeinsame ISO-Wochenregel und Forward-Migration            | keine offene Feature-Abhängigkeit |
| S4-02 Vertragstreue Seeds    | EYT-91 | UUID-v4-konforme Seeds und Referenzen                       | vor realem Write-E2E              |
| S4-03 Command und Persistenz | EYT-50 | Autorisierter, atomarer und idempotenter Assignment-Command | S4-01, S4-02                      |
| S4-04 Gateway-Abschluss      | EYT-79 | HTTP-Methoden und modellierte Fehlerzustände                | S4-03                             |
| S4-05 Sichtbare Nutzerreise  | EYT-92 | Formular, Erfolg, Konflikte und responsive/a11y Zustände    | S4-04                             |
| S4-06 Systemnachweis         | EYT-62 | Browser→API→DB-E2E samt Gegenproben                         | S4-01 bis S4-05                   |

## Delivery Order and Stop Gates

1. **EYT-91 zuerst, dann EYT-88** (Council-Gate 2026-07-28, vom Nutzer übernommen). Beide müssen vor dem schreibenden E2E grün sein; die Reihenfolge untereinander ist jetzt festgelegt. Begründung: solange die Seed-IDs den Vertrag brechen, wird jede neue Schreibroute gegen Fixtures gebaut, die HTTP 500 liefern — und der v4-Workaround in `apps/web/e2e/harness/seed.sql` erstarrt zur zweiten Wahrheit. `seed.sql` ist keine gemergte Migration und darf ersetzt werden.
2. **EYT-88 ist zur Hälfte erledigt** (gemessen, siehe „Befunde"). Offen sind nur noch: Forward-Migration für `plan_versions.week_key`, EINE gemeinsame deterministische Funktion als Quelle für Vertrag und Datenbank, die Entscheidung zur jahresabhängigen 53. Woche und Negativvektoren, die für beide Seiten denselben Gültigkeitsbereich beweisen. Die Vertragsseite wird **nicht** neu gebaut.
3. Der Command wird test-first hinter einem Application-Port implementiert.
4. **Die Konfliktablehnung für Entwürfe entsteht im Command, nicht in der Datenbank.** Migration `0010` nimmt Entwürfe bewusst vom Overlap-Constraint aus (`where (published_at is not null)`, EYT-49 AK1). Daraus folgt verbindlich: (a) `conflictsWithExisting` wird im Command aufgerufen — das ist sein erster Produktionsaufrufer; (b) die Gegenprobe zu AC-012 bricht die **Anwendungsprüfung**, nicht den DB-Constraint, weil dessen Abschaltung am Entwurfsverhalten nichts ändert und die Gegenprobe wertlos wäre; (c) der Nebenläufigkeitsnachweis läuft über **zwei echte Verbindungen**, weil Lesen-dann-Schreiben in einer Transaktion nicht gegen einen parallel entstehenden zweiten Entwurf serialisiert.
5. Ohne nachgewiesene Atomarität und Idempotenz wird kein UI-Schreibpfad als abgeschlossen behandelt.
6. Die UI wird erst gegen den realen HTTP-Gateway als fertig bewertet.
7. **REQ-009 wird vollständig gebaut** — `POST /planung/einsaetze` **und** `POST /planung/entwuerfe/validierung`. Der Council-Vorschlag, auf eine Route zu kürzen, wurde vom Nutzer am 2026-07-28 abgelehnt: er hätte AC-009 für den HTTP-Pfad teilweise unbeweisbar gemacht und `validateDraft` mock-grün als Dunkelzone zurückgelassen. `POST /planung/versionen` bleibt draußen, weil Publish ohnehin Non-Goal ist.
8. EYT-62 ist das Featureabschluss-Gate; ein grüner Unit-Test-Satz allein reicht nicht.
9. Publish, Auth oder Mitarbeiterfunktionen werden bei Scope-Einschleppung gestoppt und separat geplant.
10. **Jedes AC nennt seine Gegenmutation.** Ein AC ohne konkrete Antwort auf „welche absichtliche Änderung macht diesen Nachweis rot?" gilt als nicht erfüllbar. Diese Regel adressiert den vom Critic benannten Wiederholungspfad aus Sprint 3 (neun grüne Tests ohne Aussagekraft).

## Risks

| Risk ID  | Risiko                                                               | Wahrscheinlichkeit | Wirkung | Mitigation                                                                                              |
| -------- | -------------------------------------------------------------------- | -----------------: | ------: | ------------------------------------------------------------------------------------------------------- |
| RISK-001 | Offener Basis-PR und gestapelter Feature-Branch driften auseinander. |             mittel |    hoch | PR-Reihenfolge festlegen; vor Merge gegen aktuelle Basis rebasen und vollständig neu validieren         |
| RISK-002 | Wochenvalidierung wird mehrfach unterschiedlich implementiert.       |             mittel |    hoch | eine deterministische Kernfunktion, gemeinsame Testvektoren, DB-Constraint aus derselben Regelableitung |
| RISK-003 | Seed-Austausch beschädigt Tenant-/Invarianten-Tests.                 |             mittel |    hoch | zentraler ID-Katalog, zwei Resets, komplette DB-Gates                                                   |
| RISK-004 | UI testet nur Mock-Verhalten.                                        |               hoch |    hoch | HTTP-Konfiguration im E2E erzwingen und API-Ausfall sichtbar prüfen                                     |
| RISK-005 | Idempotenzschlüssel wird bei Retry neu erzeugt.                      |             mittel |    hoch | Schlüssel pro fachlichem Vorgang erzeugen und in UI-Lebensdauer halten; Retry-Gegenprobe                |
| RISK-006 | Fehler nach Teilwrite hinterlässt inkonsistente Daten.               |             mittel |    hoch | eine Transaktion und erzwungener Fehler nach erstem Write                                               |
| RISK-007 | Feature wird durch Publish/Auth erweitert und nicht fertig.          |             mittel |    hoch | harte Non-Goals und Scope-Stop-Gate                                                                     |

## Evidence Needed

| Evidence ID | Requirement ID | Evidence Needed                                                                            | Source Type |
| ----------- | -------------- | ------------------------------------------------------------------------------------------ | ----------- |
| EV-001      | REQ-001        | Browser-, API- und DB-Abgleich für eine reale Woche sowie Cross-Tenant-Negativfall         | EXPLICIT    |
| EV-002      | REQ-002        | Gemeinsame Positiv-/Negativvektoren in Contract- und DB-Tests; neue Migration; zwei Resets | EXPLICIT    |
| EV-003      | REQ-003        | Scan aller Seed-IDs, Runtime-Parse einer geseedeten ID und grüne abhängige Suiten          | EXPLICIT    |
| EV-004      | REQ-004        | Komponenten- und Browsertest für vollständige und unvollständige Eingaben                  | EXPLICIT    |
| EV-005      | REQ-005        | Route-/Command-/Repository-Integrationstest mit verifiziertem Tenantkontext                | EXPLICIT    |
| EV-006      | REQ-006        | Negativtests für Gleichheit, Inversion, Woche und Überlappung mit stabilen Codes           | EXPLICIT    |
| EV-007      | REQ-007        | Fehler-Injektion innerhalb der Transaktion und direkte DB-Gegenprüfung                     | EXPLICIT    |
| EV-008      | REQ-008        | Retry-/Nebenläufigkeitstest mit gleichem Idempotenzschlüssel und Wirkungscount eins        | EXPLICIT    |
| EV-009      | REQ-009        | Gemeinsame Gateway-Contract-Suite und Boundary-Test                                        | EXPLICIT    |
| EV-010      | REQ-010        | Komponenten-, Responsive- und Accessibility-Smoke                                          | EXPLICIT    |
| EV-011      | REQ-011        | Playwright-E2E mit Reload, zweitem Kontext und Datenbankverifikation                       | EXPLICIT    |
| EV-012      | REQ-012        | Dokumentierte, ausgeführte rote Gegenproben und fail-closed Testreporting                  | EXPLICIT    |

## Definition of Done

Das Feature ist nur fertig, wenn:

- alle `REQ-*` durch zugeordnete `AC-*` und `EV-*` belegt sind;
- alle Must-Anforderungen erfüllt sind;
- Migrationen und zwei aufeinanderfolgende Resets grün sind;
- Typecheck, Lint, Unit-, Contract-, Architektur-, Datenbank-, Integrations- und Browser-E2E-Gates grün sind;
- mindestens eine relevante Gegenprobe je kritischer Schutzklasse ausgeführt wurde;
- keine Mock-/LocalStorage-Wahrheit im operativen Browserpfad existiert;
- der reale Nutzerfluss mit identischen IDs in UI, API und Datenbank belegt ist;
- offene Blocker, Teilimplementierungen und nicht reproduzierte Zustände nicht als Done markiert werden;
- Rollback beziehungsweise Forward-fix für Schema- und API-Änderungen dokumentiert ist.

## Rollback

- UI-Route und Feature-Komponenten können ohne Schema-Downgrade entfernt werden; der bestehende Read-Through-Pfad bleibt erhalten.
- Neue API-Command- und Gatewaymethoden werden in kleinen, reversiblen Änderungen eingeführt.
- Gemergte Migrationen werden nicht zurückgeschrieben; Fehler werden mit einer neuen Forward-Migration korrigiert.
- Bei fehlerhaftem Write-Slice wird die schreibende Route deaktiviert, ohne die lesende Wochenansicht auf Mockdaten zurückfallen zu lassen.

## Links

- Vision: `docs/vision/planning-draft-conflict-slice.vision.md`
- Canvas: `docs/canvas/planning-draft-conflict-slice.canvas.md`
- Traceability: `docs/traceability.md`
- Jira: EYT-50, EYT-62, EYT-79, EYT-88, EYT-91, EYT-92
- Technische Basis: GitHub PR #23

## User Confirmation Required

> Ich bestätige, dass Product Canvas und Product Vision meine Absicht korrekt wiedergeben und als Grundlage für AgileTeam Planning verwendet werden dürfen.

Erteilt am 2026-07-28 durch den Product Owner (Benjamin Poersch), wörtlich. Bestätigt ist der
fachliche Feature-Scope; die technische Kapazität ausdrücklich nicht (siehe OQ-002).

## Befunde aus der Bestandsmessung (2026-07-28)

Gemessen am Code, nicht aus dem Ticketstand abgeleitet. Zwei Ticketumfänge sind kleiner
beziehungsweise anders geschnitten als die Beschreibung vermuten lässt:

- **EYT-88 ist zur Hälfte erledigt.** Der Transportvertrag erzwingt bereits `01–53`
  (`packages/contracts/src/planning/schemas.ts:113`) und erfüllt damit das Akzeptanzkriterium
  „lehnt W00/W54/W99 ab". Offen bleiben die Datenbankseite
  (`supabase/migrations/20260727020300_0007_planning.sql:20` prüft weiterhin `^\d{4}-W\d{2}$`),
  die gemeinsame deterministische Funktion, die jahresabhängige 53. Woche und Negativtests, die
  für beide Seiten denselben Gültigkeitsbereich beweisen.
- **`HttpPlanningGateway` implementiert bereits alle vier Methoden** inklusive Pfad, Schema,
  Idempotenzschlüssel und Konfliktabbildung. Der Clientteil von EYT-79 ist damit weitgehend
  vorhanden; es fehlen die **Serverrouten**. Die grünen Contract-Tests für `validateDraft` und
  `createAssignment` laufen gegen den Mock und dürfen nicht als Beleg für einen funktionierenden
  Schreibpfad gelesen werden (Reality Ledger, REQ-009).
- **Der Read-Through-Nachweis ist veraltet.** Der grüne CI-Lauf wurde bei `3773ecf3` gemessen,
  der Branch steht fünf Commits weiter. REQ-001 und REQ-011 sind für den aktuellen Stand
  unbelegt, bis ein neuer Lauf grün ist.
