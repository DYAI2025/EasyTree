# EYT-158 — Baustellentag worksite-first: Evidenzpaket

> **Stand:** 06.09.2026, Europe/Berlin
> **Basis:** `origin/master` = `f8e96e4ceb4f00ae5f5ac777c6eb47aa8f766d6f`
> **Branch:** `feat/eyt-147-dispositionswerkbank-slice-1` (PR #101, `DO_NOT_MERGE`), Ausgangs-Head `c3994d1c7a8372114d6989856299c2ccda58c42a`
> **Evidenzstufe dieses Pakets:** lokale Läufe auf dem Entwicklungsrechner (colima, M-Serie).
> Der ausgeführte CI-Lauf am neuen PR-Head ist die höhere Stufe und wird nach dem Push nachgetragen.
> **Ausführender:** Claude Code als temporärer Executor (Übernahme des Codex-Arbeitsstands, Handoff-Sicherung `/tmp/easytree-eyt158-codex-handoff*.patch`).

## Was der Slice liefert (Jira EYT-158)

`Planung öffnen → „Baustellentag anlegen" → Baustelle → lokaler Tag → Arbeitszeit (Vorgabe 08:00–18:00,
editierbar) → drei interne Mitarbeitende als EIN Einsatzteam → EIN Command (`POST /planung/baustellentage`)
→ bestätigter Server-Readback → GENAU EINE Baustellentag-Karte mit dem Team darunter → Reload und
zweiter Browserkontext zeigen dieselben Server-Ids.`

Keine Migration, kein Vertragsbruch (`worksiteDays` war in `PlanningWindowSchema` bereits optional
vorgesehen, EYT-151), keine neue Fachregel. `packages/ui/**` unberührt.

## Bilder (realer Lauf der Auth-Reise, echte GoTrue-Identität, echte API, PostgreSQL)

| Datei                                                 | Zeigt                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `12-werkbank-inspector-1440.png`                      | Inspector worksite-first: Baustelle zuerst (fokussiert), Vorgabe 08:00–18:00, Mehrfachauswahl |
| `13-werkbank-baustellentag-serverbestaetigt-1440.png` | Genau eine Karte am Di 18.08. mit drei Personen darunter; Erfolgsmeldung erst nach Readback   |
| `13-werkbank-baustellentag-serverbestaetigt-1920.png` | Dieselbe Planung bei 1920 px                                                                  |

Human-PO-Visual-Gate („Würden wir genau diese Planung Arboscus heute zeigen?") ist **nicht** durch
dieses Paket beantwortet — das kann nur der Product Owner. Sichtbare Punkte für diese Entscheidung:
das Datum in der Karte ist jetzt deutsch formatiert („Di., 18.08.2026"); der Chromium-Testbrowser
zeigt time-Inputs in `en-US` (AM/PM) — ein Browser-Locale-Effekt, kein Produktverhalten.

## Lokale Läufe (Befehle und gemessene Ergebnisse)

| Gate                           | Befehl                                                                                                                                          | Ergebnis                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint + Typen                   | `pnpm exec turbo run lint typecheck --force`                                                                                                    | `16 successful, 16 total`, `Cached: 0`                                                                                                                                                                                                                                                              |
| Unit-Gate                      | `EASYTREE_TEST_DB_URL=<unerreichbar> … pnpm exec turbo run test --force --continue --concurrency=1 --env-mode=loose`                            | `10 successful, 10 total`, `Cached: 0` — Web 42 Dateien / 499 Tests, API 79 Dateien / 829 bestanden, 99 `mode=local`-Skips (siehe DB-Gates)                                                                                                                                                         |
| DB-Gates (CI-Reihenfolge)      | `supabase db reset`, dann je Suite EIN `vitest run` mit den `db-gates`-Umgebungen aus `ci.yml`                                                  | alle 12 Zeilen `mode=required … skipped=0`: tenant-isolation 7, planning-invariants 6, **planning-write 21/21**, planning-publish 15, cost-access 6, rate-timestamp 2, rate-http 4, rate-succession 8, **planning-published-reads 9/9**, cost-snapshot 11, snapshot-http 7, snapshot-immutability 3 |
| Build                          | `env -u EASYTREE_API_PROXY_TARGET pnpm exec turbo run build --force`                                                                            | `6 successful`, `Cached: 0`                                                                                                                                                                                                                                                                         |
| Format                         | `git ls-files -z \| xargs -0 pnpm exec prettier --ignore-unknown --check` (+ dieselbe Prüfung über die neuen Dateien)                           | „All matched files use Prettier code style!" (beide)                                                                                                                                                                                                                                                |
| `git diff --check`             |                                                                                                                                                 | exit 0                                                                                                                                                                                                                                                                                              |
| auth-journey (echte Identität) | `pnpm exec playwright test -c e2e/auth-journey/config.ts` nach `supabase db reset` (siehe Abschnitt _Journeys_)                                 | siehe _Journeys_                                                                                                                                                                                                                                                                                    |
| read-through (lokal emuliert)  | Phasen aus `scripts/read-through-harness.sh`; Abweichungen: `supabase start` übersprungen (Stack lief), `playwright install` ohne `--with-deps` | siehe _Journeys_                                                                                                                                                                                                                                                                                    |

Zwei Messfallen dieses Tages, damit sie niemand als Regression liest: (1) Mehrere DB-Suiten in EINEM
`vitest run` laufen in parallelen Workern gegen dieselbe Datenbank und färben die Concurrency-Fälle
rot (`0 Gewinner`); CI fährt je Suite einen Schritt. (2) Veröffentlichte Wochen sind unlöschbar —
wiederholte `planning-write`-Läufe ohne `db reset` lassen die vier EYT-92/107-Publish-Fixtures an
`assignments_no_published_overlap` scheitern. Beides verschwand mit frischem Reset.

## Journeys (Abschlusslauf auf dem endgültigen Code, 06.09.2026 03:11 Europe/Berlin)

| Reise                                                      | Ergebnis                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| auth-journey (echte GoTrue-Identität, `dist/main.js`)      | **5 passed** (Kernreise 23,4 s; Schritt 9c1b: Baustellentag worksite-first mit drei Personen, Karte, Erfolgsmeldung erst nach Readback, `pruefeBarrierefreiheit` bei 1440/1920/720 px inkl. Tastatur ohne Falle und sichtbarem Fokus, Reload, zweiter Browserkontext mit eigener Anmeldung); `globalTeardown` und zweimaliger Teardown `restzeilen=0 … trigger=3`                    |
| read-through (Browser → Route Handler → NestJS → RLS → PG) | Phase 12c **2 passed** · 12d `Fixture OK: 3 Alpha-Zuweisungen, 3 Alpha-Mitarbeitende, 1 Beta` · Phase 13 **7 passed** (inkl. Responsive/axe/Fokusreihenfolge bei 1440 und 375 px) · 13b Schreibpfad **7 passed** (Drei-Personen-Tag, Duplikat-409, Personenkonflikt-409 atomar, ungültiges Intervall, Reload + zweiter Kontext) · 15 **1 passed**; `Read-Through-Harness OK`, exit 0 |

Ein früherer Abschlusslauf der auth-journey scheiterte nach 2 ms an einem fehlenden
Playwright-Browser (`chrome-headless-shell` Revision 1228 aus dem Cache verschwunden — Umgebung,
zwei Playwright-Versionen im Workspace: Root 1.52.0/1169, Web 1.61.1/1228); nach
`playwright install chromium` derselbe Build, 5 passed. Kein Produktsignal.

## Gegenmutationen (ausgeführt, gemessen, zurückgenommen — Datei-Hash vor/nach identisch)

| #   | Mutation                                                                                                  | Gemessen rot                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **employee-first**: Team-Block im Formular VOR den Baustellen-Block gezogen                               | 2 rot — „beginnt mit Baustelle, Datum, editierbarer Arbeitszeit …", „setzt beim Oeffnen den Fokus in das erste Bedienelement"            |
| 2   | **card-per-assignment**: `WorksiteDayCard` je Teammitglied statt je Tag                                   | 2 rot — „rendert genau eine primäre Baustellentag-Karte …", „erhält Legacy-Einplanungen getrennt …"                                      |
| 3   | **success-without-readback**: in `speichern` vor dem Readback mit `{ ok: true }` zurückkehren             | 7 rot — u. a. „bestätigt Erfolg erst nach serverseitigem Read-through", alle drei Readback-Abweichungsfälle, „fehlgeschlagener Readback" |
| 4   | **zwei Statements statt einem Snapshot** (RED-Phase des neuen Wächters `planning-window-single-snapshot`) | 1 rot — „expected […(2)] to have a length of 1"                                                                                          |
| 5   | **Wochenwechsel während des Readbacks** (RED-Phase vor dem Riegel `aktuelleWoche`)                        | 1 rot — fremde Karte im Baum der neuen Woche                                                                                             |
| 6   | **h2 → h4 in der Rückfallliste** (RED-Phase vor der Überschriftenebene)                                   | 1 rot — axe `heading-order: 1`                                                                                                           |
| 7   | **Folgedraft über `createAssignment`** (RED-Phase vor der gemeinsamen Baseline-Kopie)                     | 1 rot — „expected [] to have a length of 1" (`worksiteDays` des Folgedrafts leer)                                                        |

## Adversariales Review (Workflow, 5 Linsen, je Befund zwei Widerleger) — Adjudikation

| Befund                                                                                                                                     | Einordnung                  | Maßnahme                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| e2e-Reisen fuhren noch den alten Einzel-Einsatz-Pfad (read-through, auth-journey, staging)                                                 | CONFIRMED_BLOCKER           | alle drei Specs auf worksite-first umgestellt; Harness-Seed +2, Reise-Fixture +1 Mitarbeitende; Teardown um `worksite_days` erweitert        |
| Zwei READ-COMMITTED-Statements für Zuweisungen und Tage → Vertragsverletzung → 500                                                         | CONFIRMED_IMPORTANT         | ein Statement (`planstandOf`, FULL OUTER JOIN), statischer Wächter                                                                           |
| Folgedraft-Kopie nur im `planWorksiteDay`-Pfad                                                                                             | CONFIRMED_IMPORTANT         | Baseline-Kopie (Konfigurationen + Zuweisungen mit Umhängung) für beide Pfade geteilt; Integrationstest                                       |
| Readback der alten Woche überschreibt die neue nach Wochenwechsel                                                                          | CONFIRMED_IMPORTANT         | Riegel `aktuelleWoche` in `speichern`; Unit-Test                                                                                             |
| Readback-Abweichung nie geprüft (Mocks identisch)                                                                                          | CONFIRMED_IMPORTANT         | drei Abweichungsfälle (Revision, Team, lockVersion) als Tests                                                                                |
| Rückfallliste springt h2 → h4                                                                                                              | CONFIRMED_MINOR             | Überschriftenebene als Prop (`h3` in der Rückfallliste); axe-Test                                                                            |
| Hilfetext nur Maus-Modifier; Team-Liste doppelt benannt; leere Team-Liste; ISO-Datum; gleichnamige Regionen je Tag; Leerzustand ohne Namen | CONFIRMED_MINOR             | Text mit Tastaturfolge, `aria-labelledby`, „Noch kein Einsatzteam", deutsches Datum, Region-Label entfernt, `aria-labelledby` am Leerzustand |
| Legacy-Zeilen ohne CSS                                                                                                                     | CONFIRMED_MINOR             | `.legacy-einplanung`, `.wochenraster__legacy`, `.einsatzkarte__team` gestylt                                                                 |
| Kein a11y-Wächter rendert die Karte                                                                                                        | CONFIRMED_MINOR             | `planung-a11y.test.tsx`: Karte + Legacy-Zeile + offener Inspector, axe best-practice                                                         |
| Mitarbeiter-Fixture ohne `on conflict`                                                                                                     | CONFIRMED_MINOR             | idempotenter Insert                                                                                                                          |
| Idempotenzschlüssel bleibt nach STALE_VERSION                                                                                              | CONFIRMED_MINOR             | keine Änderung — Meldung verweist auf Neuladen; ein Wegwerfen erzeugte beim Retry ein Duplikat, das der Server ohnehin ablehnt               |
| Mandantenzusicherung auf `worksiteDays` „kann nicht rot werden"                                                                            | CONFIRMED_MINOR             | keine Änderung — der explizite `org_id`-Filter ist Hosenträger zur RLS; eine Mutation daran bleibt durch RLS unsichtbar                      |
| Exclusion-Constraint macht Folgedraft mit kopierten Intervallen unveröffentlichbar                                                         | PRE_EXISTING / OUT_OF_SCOPE | seit EYT-92/109 (Kopie im Einzel-Einsatz-Pfad); Publish-Semantik eines Folgedrafts ist eine PO-Frage → `HUMAN_INPUT_REQUIRED` gemeldet       |
| Lock-Reihenfolge `planWorksiteDay` vs `createAssignment` (Deadlock → 40P01/500)                                                            | PRE_EXISTING / OUT_OF_SCOPE | Reihenfolge stammt aus EYT-152 (`c3994d1`); kanonische Sperrreihenfolge ist eine Concurrency-Entscheidung → gemeldet                         |
| „keine erfundene Karte" vakuos                                                                                                             | REFUTED (2 Widerleger)      | —                                                                                                                                            |

## Nicht in diesem Paket

- Die **Staging-Reise** (`e2e/staging/journey.pwtest.ts`) ist auf den neuen Pfad umgestellt, aber **nicht
  ausgeführt**: Staging fährt noch das alte Image, ein Deploy ist nicht autorisiert.
- Der **Transaction-Pooler-Gate** (`tenant-pooling`) lief lokal nur `mode=local` (3 Fälle); die
  `required`-Messung liefert `db-gates`.
