# Sprint-4-Umsetzungsplan: Reale Wochenplanung mit Entwurfs- und Konfliktlogik

Feature Slug: `planning-draft-conflict-slice`
Erstellt: 2026-07-28
Canvas/Vision/PRD: user-confirmed (Erst- und Neubestätigung 2026-07-28)
Modus: **CORE** (keine `metrics/runs.jsonl`-Baseline vorhanden, FULL unzulässig)
Branch (beschlossen): `feat/sprint-4-planning-draft-conflict-implementation`, abgezweigt vom
aktuellen Head von `feat/eyt-50-read-through-slice`, PR gestapelt gegen denselben Branch.

## Ziel

Ein vorproduktiver, real verdrahteter Schreibpfad-Durchstich: eine Planungshandlung läuft
durch UI, Vertrag, Command, Transaktion und RLS bis PostgreSQL und zurück. Erfolg und
fachlich begründete Ablehnung sind beide sichtbar und beide belegt.

## Nicht-Ziele

Publish, Mitarbeiterbestätigung, produktive Authentifizierung, Monats-/Vierwochenansicht,
Ressourcen, Abwesenheit, Timer, Wetter, Benachrichtigungen, produktives Deployment. Kein
ausgelieferter Produktwert für eine produktiv authentifizierte Planerin — das ist mit der
Wertabgrenzung ausdrücklich bestätigt.

## Vorbedingungen und bekannte Lücken

| Zustand                                          | Beleg                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Lesepfad verdrahtet                              | `/planung` → `PlanningWindowView` → `HttpPlanningGateway` → `@Get("fenster")`; CI-Job `read-through`       |
| Lesenachweis **veraltet**                        | grüner Lauf bei `3773ecf3`, Head ist `cb56a9f` — vor jeder Done-Aussage neu ausführen                      |
| Schreibpfad fehlt vollständig                    | API hat genau eine Route; `planning-window-view.tsx` hat null Formularelemente                             |
| Gateway-Client vollständig                       | alle vier Methoden implementiert — aber `validateDraft`/`createAssignment` rufen nicht existierende Routen |
| Vertragsseite EYT-88 erledigt                    | `packages/contracts/src/planning/schemas.ts:113` erzwingt `01–53`                                          |
| Datenbankseite EYT-88 offen                      | `supabase/migrations/20260727020300_0007_planning.sql:20` prüft `^\d{4}-W\d{2}$`                           |
| Entwürfe sind vom Overlap-Constraint ausgenommen | Migration `0010`, `where (published_at is not null)`, EYT-49 AK1                                           |
| `validateDraft` ohne Produktionsaufrufer         | nur Tests referenzieren die Funktion                                                                       |

**Offene Lücken, die nicht durch Arbeit geschlossen werden können:**

- `GAP-01` — **Docker-Daemon lokal nicht erreichbar.** Der Supabase-Stack startet auf dieser
  Maschine nicht. Jede Migration und jeder pgTAP-Lauf wird **erstmals in CI ausgeführt**.
  Betrifft T-01, T-02, T-03, T-06.
- `GAP-02` — **Sprintenddatum unbekannt.** Weder `duedate` noch ein Sprint-Feld liefert ein
  Fenster. Eine Aussage „passt in den Sprint" ist ohne diese Zahl nicht belegbar, sondern
  geraten. Siehe Developers-Gate unten.
- `GAP-03` — Entscheidung zur jahresabhängigen 53. Woche steht aus (fachliche Frage, kein
  Implementierungsdetail). Siehe T-02.

## Aufgabenliste

Reihenfolge ist verbindlich: T-01 vor T-02 (Council-Beschluss), beide vor T-03.

### T-01 — Seed-IDs auf gültige UUID v4 (EYT-91)

- **REQ:** REQ-003 · **AC:** AC-003 · **EV:** EV-003
- **Betroffen:** `supabase/seed.sql`, `supabase/tests/0002_rls_isolation.sql`,
  `0004_core_domain.sql`, `0006_planning_invariants.sql`, `0007_temporal_and_idempotency.sql`,
  `apps/api/test/tenant-context.helper.ts`, `planning-conflict.test.ts`,
  `planning-invariants.integration.test.ts`, `planning-window.http.test.ts`,
  `tenant-query-runner-lifecycle.test.ts`, `tenant-subject.test.ts`,
  `apps/web/e2e/harness/seed.sql`, `verify-seed.sql`
- **Umfang gemessen:** 13 Dateien, **199 Vorkommen**. Der Council schätzte „~eine Datei" —
  das ist widerlegt.
- **Vorgehen:** zentraler ID-Katalog als einzige Quelle, danach mechanische Ersetzung.
  Ergebnis greppen, nicht Exit-Code lesen.
- **Tests:** zwei aufeinanderfolgende `db reset`; alle pgTAP-Suiten; Tenant- und
  Invariantensuiten; ein Test, der eine **geseedete** `employeeId` gegen `IdSchema` parst.
- **Gegenmutation:** eine einzelne Seed-ID auf das alte `…-0` -Nibble zurückdrehen → der
  Vertragstest muss rot werden. Ohne diesen Nachweis ist der Fix nur verschoben.
- **Nebenwirkung:** `apps/web/e2e/harness/seed.sql` verliert seinen Zweck als Umgehung und
  wird auf den echten Seed gezogen oder entfernt — sonst bleibt eine zweite Wahrheit stehen.

### T-02 — ISO-Wochenregel in der Datenbank (EYT-88, Restumfang)

- **REQ:** REQ-002 · **AC:** AC-002 · **EV:** EV-002
- **Betroffen:** neue Forward-Migration `supabase/migrations/<ts>_0011_*.sql`,
  `packages/domain/src/` (gemeinsame deterministische Funktion), `supabase/tests/`,
  **und `packages/contracts/src/planning/schemas.ts`**.
- **GAP-03 entschieden (2026-07-28): die Validierung ist jahresabhängig.** `YYYY-W53` gilt nur,
  wenn das betreffende ISO-Wochenjahr tatsächlich eine 53. Woche besitzt. Pauschale Akzeptanz
  von W01–W53 ist unzulässig.
- **Korrektur einer früheren Aussage in diesem Plan.** Ich hatte notiert, die Vertragsseite von
  EYT-88 sei fertig und werde nicht angefasst. Mit der jahresabhängigen Regel stimmt das nicht
  mehr: `schemas.ts:113` prüft `^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$` und akzeptiert `W53`
  **bedingungslos**. AC-002 verlangt aber ausdrücklich die Ablehnung einer „in diesem Jahr nicht
  existenten Woche 53". Die Vertragsseite erfüllt heute nur den Musterteil, nicht das
  Akzeptanzkriterium. EYT-88 ist damit größer als in meiner ersten Messung.
- **Umsetzungsvorgabe:** eine gemeinsame fachliche Spezifikation; eine deterministische
  TypeScript-Funktion für Vertrag und Anwendung; eine neue immutable/deterministische
  PostgreSQL-Funktion in der Forward-Migration; identische Positiv- und Negativvektoren für
  TS und SQL. Migration prüft vorhandene Zeilen vor Aktivierung der Constraint und scheitert
  fail-closed. Gemergte Migrationen werden nicht verändert.
- **Round-Trip-Pflicht:** der aus dem Schlüssel berechnete Wochenbeginn muss wieder exakt
  denselben ISO-Jahr-/Wochenschlüssel ergeben. Das ist der Test, der eine falsche
  Jahresgrenzenrechnung fängt — ein reiner Bereichstest tut das nicht.
- **Tests:** `W00`, `W54`, `W99` ungültig; `W53` gültig in einem ISO-Jahr **mit** 53. Woche;
  `W53` **ungültig** in einem Jahr ohne; zwei Resets.
- **Gegenmutation:** (a) die neue Constraint auf das alte Muster aufweiten → DB-Negativvektor
  rot; (b) die Jahresprüfung im TypeScript entfernen → der `W53`-Negativvektor im Vertrag rot.
  Beide Hälften brauchen ihre eigene Gegenmutation, sonst belegt der Test nur eine davon.

### T-03 — Autorisierter Create-Assignment-Command (EYT-50)

- **REQ:** REQ-005, REQ-006, REQ-007, REQ-008 · **AC:** AC-005 bis AC-008 · **EV:** EV-005 bis EV-008
- **Betroffen:** `apps/api/src/modules/planning/application/`,
  `infrastructure/`, `interface/http/planning.controller.ts`,
  `apps/api/test/openapi-route-conformance.test.ts` (Eintrag entfernen)
- **Kernvorgabe:** die Überlappungsablehnung entsteht **im Command** über
  `conflictsWithExisting` — die Datenbank nimmt Entwürfe bewusst aus. Damit erhält die
  Domainfunktion ihren ersten Produktionsaufrufer.
- **Eine Transaktion:** Assignment, Planversionsbezug, Audit-/Outbox-Wirkung und
  Idempotenzschlüssel im selben `TenantQueryRunner.run`.
- **Tests:** Integrationstest gegen echte Datenbank; Fehler-Injektion nach dem ersten
  Schreibschritt mit direkter DB-Gegenprüfung; Retry mit identischem Idempotenzschlüssel →
  Wirkungscount eins; **Nebenläufigkeit über zwei echte Verbindungen**.
- **Gegenmutation:** (a) den `conflictsWithExisting`-Aufruf entfernen → Überlappungstest rot;
  (b) die Idempotenzprüfung entfernen → Retrytest rot; (c) `set local role authenticated`
  entfernen → Tenanttest rot.
- **Warum zwei Verbindungen:** eine Sitzung kann eine Regel _ablehnen_ sehen, aber nicht
  _serialisieren_. Lesen-dann-Schreiben in einer Transaktion schützt nicht gegen einen
  parallel entstehenden zweiten Entwurf.

### T-04 — Route für serverseitige Entwurfsvalidierung (EYT-79)

- **REQ:** REQ-009 · **AC:** AC-009 · **EV:** EV-009
- **Betroffen:** `planning.controller.ts` (`POST /planung/entwuerfe/validierung`),
  `apps/api/src/modules/planning/application/`, Konformitätstest
- **Vorgabe:** Validierung **ohne** Schreibwirkung, kein Idempotenzschlüssel.
- **Tests:** die gemeinsame Gateway-Contract-Suite läuft gegen **HTTP**, nicht nur gegen den
  Mock. Ohne diesen Lauf bleibt `validateDraft` mock-grün — die Dunkelzone, wegen der die
  Kürzung auf eine Route abgelehnt wurde.
- **Gegenmutation:** die Route abschalten → der HTTP-Zweig der Contract-Suite muss rot werden,
  der Mock-Zweig grün bleiben. Genau diese Differenz ist der Nachweis.

### T-05 — Sichtbare Nutzerreise (EYT-92)

- **REQ:** REQ-004, REQ-010 · **AC:** AC-004, AC-010 · **EV:** EV-004, EV-010
- **Betroffen:** `apps/web/components/planning-*.tsx`, `apps/web/app/planung/`,
  `apps/web/lib/planning-*.ts*`
- **Vorgabe:** Mitarbeiter, Baustelle, Datum, Start, Ende explizit; keine Mutation bei
  unvollständiger Eingabe. Zustände Loading, Empty, Success, Conflict, Contract Violation,
  Unavailable, Forbidden, Stale Version sichtbar unterscheidbar, **nie nur farbcodiert**.
- **Tests:** Komponententests je Zustand; axe bei 1440 px und 375 px; Tastaturbedienung.
- **Gegenmutation:** einen Zustand ausschließlich über Farbe kodieren → der A11y-Test muss rot
  werden.

### T-06 — Systemnachweis Schreibpfad (EYT-62)

- **REQ:** REQ-001, REQ-011, REQ-012 · **AC:** AC-001, AC-011, AC-012 · **EV:** EV-001, EV-011, EV-012
- **Betroffen:** `apps/web/e2e/`, `scripts/read-through-harness.sh` (erweitern, nicht
  duplizieren)
- **Tests:** gültiger Entwurf im Browser → Reload → zweiter Browserkontext → direkte
  DB-Verifikation identischer IDs; alle vier Negativfälle; Retry.
- **Gegenmutationen (Pflicht, je eine pro Schutzklasse):** Tenantfilter brechen ·
  Serverzustand durch Mock ersetzen · Retryschutz entfernen · **Konfliktvalidator im Command**
  abschalten. Der letzte Punkt ist der wichtige: den DB-Constraint abzuschalten ändert am
  Entwurfsverhalten nichts und wäre eine wirkungslose Gegenprobe.
- **Zusätzlich:** der veraltete Lesenachweis (LED-009) wird in diesem Lauf miterneuert.

### T-07 — Integration nach Merge von PR #23

- **Kein REQ** — Auslieferungsschritt aus der OQ-003-Entscheidung.
- Nach Merge von PR #23: Sprint-4-PR auf `master` rebasen oder umstellen, danach **alle**
  Pflichtgates vollständig neu ausführen. Kein Merge allein wegen grüner Unit- oder Mocktests.

## Developers-Gate (GATE-002) — evidenzbasierte Bewertung

Der Nutzer hat den fachlichen Scope bestätigt und die Kapazität ausdrücklich **nicht**.
Auftrag: bei fehlender Belastbarkeit stoppen, Lücke benennen, keine Must kürzen,
Verlängerung oder Neuplanung vorschlagen.

**Verdikt (Nutzerentscheidung 2026-07-28): `PASS_WITH_CAPACITY_RISK`.**

Das Sprintfenster endet am **29.07.2026 um 06:19 Uhr Europe/Berlin** — GAP-02 ist damit
geschlossen. Auf dieser Grundlage gilt:

- Lösungsweg und Reihenfolge sind ausreichend geklärt, um die Implementierung zu **beginnen**.
- Die Fertigstellung aller Must-Anforderungen in diesem Fenster ist **nicht zugesagt**.
- Kein Must wird zur Termineinhaltung entfernt oder abgeschwächt.
- Kein unvollständiger Stand gilt als Feature Done.
- Nicht vollständig belegte Arbeit wird nach Fensterende transparent weitergeführt oder in den
  nächsten Sprint übernommen. Der Plumbline-Feature-Scope bleibt bis zur vollständigen
  Erfüllung der Definition of Done bestehen.
- Der fehlende Docker-Daemon verhindert den **Start** nicht. Er verhindert jede **Done-Aussage**
  für DB-abhängige Anforderungen, bis CI-Läufe, zwei Resets, pgTAP und Integrationsnachweise
  tatsächlich grün sind.

Die ursprüngliche Bewertung dieses Abschnitts lautete: die Frage sei mangels Sprintfenster
nicht beantwortbar. Mit dem gelieferten Datum ist sie beantwortet — und zwar mit einem
ausdrücklich getragenen Risiko statt einer Zusage.

| Befund                                     | Wirkung auf die Kapazitätsaussage                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GAP-02` Sprintenddatum unbekannt          | Ohne Fenster gibt es keinen Maßstab. Jede Aussage „passt" oder „passt nicht" wäre erfunden.                                                                                                                         |
| `GAP-01` Docker lokal nicht verfügbar      | T-01, T-02, T-03 und T-06 sind lokal **nicht** verifizierbar. Jede Korrektur an Migration, Seed oder DB-Test kostet einen vollen CI-Durchlauf. Das ist kein Aufwandszuschlag, sondern eine veränderte Arbeitsweise. |
| T-01 ist 199 Vorkommen in 13 Dateien       | Deutlich größer als die Council-Schätzung. Berührt Tenant- und Invariantensuiten gleichzeitig; ein Fehler darin erscheint als scheinbarer Tenantfehler.                                                             |
| Sechs Muss-Aufgaben mit harter Reihenfolge | T-01 → T-02 → T-03 → T-04 → T-05 → T-06. Wenig Parallelisierbarkeit, weil jede Stufe die vorige als reale Grundlage braucht.                                                                                        |

**Was ich brauche, um GATE-002 zu schließen:** das Sprintenddatum (oder die verfügbaren
Personentage). Erst damit wird aus einer Aufgabenliste eine Kapazitätsaussage.

**Was ich nicht tun werde:** eine Must-Anforderung kürzen, um ein unbekanntes Datum zu
treffen. Bei erkennbarer Enge folgt der Vorschlag Verlängerung oder Neuplanung — so
angewiesen.

## Risiken und Rollback

| Risiko                                                | Gegenmaßnahme                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Seed-Austausch beschädigt Tenant-/Invariantentests    | zentraler ID-Katalog; zwei Resets; vollständige DB-Gates; Ergebnis greppen            |
| Wochenregel doppelt und unterschiedlich implementiert | eine Regel, gemeinsame Testvektoren, DB-Constraint aus derselben Ableitung            |
| Entwurfskonflikt bleibt unbemerkt ungeprüft           | Gegenmutation zielt auf die Anwendungsprüfung, nicht auf den DB-Constraint            |
| Retry erzeugt Doppelwirkung                           | serverseitig gespeicherter Idempotenzschlüssel; Retry- und Nebenläufigkeitstest       |
| Gestapelter Branch driftet                            | T-07: Rebase und vollständige Neuausführung aller Gates vor Merge                     |
| Grüner Lauf ohne Aussagekraft                         | jedes AC nennt seine Gegenmutation; ohne konkrete Antwort gilt es als nicht erfüllbar |

**Rollback:** UI-Route und Schreibkomponenten sind ohne Schema-Downgrade entfernbar; der
Lesepfad bleibt erhalten. Gemergte Migrationen werden nie zurückgeschrieben — Fehler werden
mit einer neuen Forward-Migration korrigiert. Bei fehlerhaftem Write-Slice wird die
schreibende Route deaktiviert, **ohne** die lesende Wochenansicht auf Mockdaten zurückfallen
zu lassen.
