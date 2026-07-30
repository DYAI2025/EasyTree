# Preflight — Sprint 5 Daily Cost Export

Stand: 2026-07-30 · Branch `feat/sprint-5-daily-cost-export` · Base `origin/master` @ `f9da445`
Feature Slug: `sprint-5-daily-cost-export`

Lesender Preflight nach PO-GO vom 30.07.2026 §5. Schließt `OQ-002` (Testdatei je Requirement),
`OQ-003` (Workflow, Job, Schritt je Evidence) und `OQ-005` (reale Auth-Grenze). Alles unten ist
**gemessen**, nicht abgeleitet; jede Messung nennt ihr Kommando.

## 1. Werkzeug- und Umgebungslage (gemessen)

| Prüfung                           | Kommando                                                      | Ergebnis                                                                  |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Docker lokal                      | `docker info`                                                 | **nicht erreichbar** → kein lokaler Supabase-Stack                        |
| Auth-Grenze im Stack konfiguriert | `supabase/config.toml`                                        | `[auth] enabled = true`, `site_url`, `jwt_expiry = 3600`, `enable_signup` |
| Wer startet den echten Stack?     | `.github/workflows/ci.yml`, `scripts/read-through-harness.sh` | `db-gates` (Z. 124) **und** `read-through` (Harness Z. 70)                |
| `web-smoke` als E2E-Ort?          | `ci.yml` Z. 71–83                                             | **nein** — dort läuft ausdrücklich **keine API**                          |
| Pflichtchecks heute               | `gh api …/rules/branches/master`                              | neun; **`read-through` fehlt**                                            |
| Verifier                          | `bash scripts/verify-branch-protection.sh`                    | `FAIL AC3 — fehlende Pflichtchecks: read-through`                         |
| Scope-Guard gegen `origin/master` | `bash scripts/plumbline-scope-guard.sh --self-test`           | 10 von 10 Proben bestanden                                                |

## 2. `OQ-005` — reale Auth-Grenze: **erreichbar, aber nur in CI**

Kein `BLOCKED_AUTH_BOUNDARY`. Begründung:

- Die Auth-Grenze **existiert bereits im CI-Lauf**. `scripts/read-through-harness.sh` Z. 70 führt
  `pnpm exec supabase start -x studio` aus; der Stack bringt GoTrue mit, weil
  `supabase/config.toml` `[auth] enabled = true` trägt. Der Job `read-through` hat die echte
  Auth-Grenze also heute schon laufen.
- Sie wird nur **umgangen**: der Harness setzt `SUPABASE_ANON_KEY="harness-anon-key"` (Z. 97) und
  reicht das Subjekt als Argument durch — `node dist-harness/test/harness/main.js "$SUBJEKT_A"`
  (Z. 100, `SUBJEKT_A="00000000-0000-4000-8000-00000000aaa1"`, Z. 32). Genau diese Injektion
  verbietet EYT-106.
- **Lokal ist der Nachweis unmöglich**, weil Docker hier nicht läuft. Das senkt keine
  Anforderung — es legt nur den Ort fest.

**Konsequenz für EYT-106:** echten GoTrue-Login gegen `http://127.0.0.1:54321/auth/v1` mit dem
realen Anon-Key aus `supabase status`, statt Subjektinjektion. Rückfallweg auf das injizierte
Subjekt bleibt ausschließlich als isoliertes Testwerkzeug erlaubt, **nie** als Endnachweis.

## 3. `OQ-002` / `OQ-003` — Testdatei, Job und Schritt je Requirement

**Kein neuer CI-Job.** Baseline S5-REQ-08 erlaubt „in vorhandene fachlich passende Gates
integrieren **oder** branch-protection-sicher ergänzen". Der erste Weg ist hier klar besser: ein
neuer Job zwingt zur synchronen Änderung von `scripts/setup-branch-protection.sh` **und**
`scripts/verify-branch-protection.sh` und zusätzlich zu einem Admin-Reapply. Beide vorhandenen
Gates passen fachlich: `db-gates` fährt den echten Stack, `read-through` fährt Stack **und**
Browser.

| REQ     | Testdatei(en) — neu, sofern nicht anders vermerkt                                                                              | Job            | Schritt                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------- |
| REQ-001 | `apps/api/test/architecture.test.ts` (**vorhanden**, erweitern), `apps/api/test/architecture-red-case.test.ts` (**vorhanden**) | `unit-tests`   | `pnpm test`                                  |
| REQ-001 | `supabase/tests/00NN_costs_tables.sql` — Tabellenbesitz und Katalogregistrierung                                               | `db-gates`     | `pnpm exec supabase test db` + Meta-Gate     |
| REQ-002 | `apps/api/test/costs-authz.integration.test.ts` — atomare Rechte, Token abgelaufen/falsch signiert, Fremdtenant                | `db-gates`     | Tenant-Gate-Schritt                          |
| REQ-002 | `supabase/tests/00NN_costs_rls.sql` — RLS lehnt Mitarbeiter unabhängig von der API ab                                          | `db-gates`     | `pnpm exec supabase test db`                 |
| REQ-002 | `apps/web/e2e/cost-journey.spec.ts` — **echter** GoTrue-Browserlogin                                                           | `read-through` | `bash scripts/read-through-harness.sh`       |
| REQ-003 | `apps/api/test/publish-plan.integration.test.ts` — Idempotenz, Stale Version, Fault Injection                                  | `db-gates`     | Planungsinvarianten-Gate                     |
| REQ-003 | `apps/api/test/publish-plan.concurrency.test.ts` — **zwei echte Verbindungen** (Muster EYT-49)                                 | `db-gates`     | Planungsinvarianten-Gate                     |
| REQ-004 | `packages/domain/test/rate-version.property.test.ts` — Effective Date, Grenzdatum, fester fast-check-Seed                      | `unit-tests`   | `pnpm test`                                  |
| REQ-004 | `supabase/tests/00NN_cost_rates_overlap.sql` — Überlappung DB-seitig, auch parallel                                            | `db-gates`     | `pnpm exec supabase test db`                 |
| REQ-005 | `packages/domain/test/daily-cost-allocation.property.test.ts` — Summenerhaltung, DST, Mitternacht                              | `unit-tests`   | `pnpm test` + Fremdzonen-Schritt (TZ-Matrix) |
| REQ-005 | `apps/api/test/cost-snapshot.integration.test.ts` — Unveränderlichkeit, Idempotenz, fehlender Satz blockiert                   | `db-gates`     | Tenant-Gate-Schritt                          |
| REQ-006 | `apps/web/test/kosten-page.test.tsx` — jsdom + axe, alle sechs Zustände unterscheidbar                                         | `unit-tests`   | `pnpm test`                                  |
| REQ-006 | `apps/web/e2e/cost-journey.spec.ts` — Netzwerknachweis, Reload, zweiter Kontext                                                | `read-through` | `bash scripts/read-through-harness.sh`       |
| REQ-007 | `apps/api/test/xlsx-export.contract.test.ts` — Snapshot-ID-only, MIME, Dateiname, leeres Ergebnis                              | `unit-tests`   | `pnpm test`                                  |
| REQ-007 | `apps/api/test/xlsx-export.security.test.ts` — Formula-Injection, manipulierte ID, Fremdtenant                                 | `unit-tests`   | `pnpm test`                                  |
| REQ-007 | `apps/web/e2e/cost-journey.spec.ts` — UI/DB/Zell-Parität                                                                       | `read-through` | `bash scripts/read-through-harness.sh`       |
| REQ-008 | `apps/web/e2e/cost-journey.spec.ts` — durchgehende Reise **plus acht Negativreisen**                                           | `read-through` | `bash scripts/read-through-harness.sh`       |

`web-smoke` kommt bewusst in keiner Zeile vor: dort läuft keine API, ein Kostennachweis wäre dort
strukturell unmöglich.

## 4. Erste rote Prüfung je Requirement (vor der Implementierung rot)

| REQ     | Erste rote Prüfung                                                                           | Gegenmutation danach                                                     |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| REQ-001 | `SCAFFOLDED_MODULES` verlangt `costs` → rot, weil weder Slug noch Verzeichnis existieren     | tiefer Querimport aus `costs/domain` in ein fremdes Modul                |
| REQ-002 | Browser meldet sich real an und ruft `/kosten` → rot, weil es keinen Auth-Pfad gibt          | API-Guard entfernen; **RLS muss weiter blockieren** (FMC-002)            |
| REQ-003 | `POST` auf den Publish-Pfad → rot mit 404, weil der Controller fehlt                         | Idempotenzschlüsselprüfung entfernen → zweite Veröffentlichung entsteht  |
| REQ-004 | Zwei überlappende Satzintervalle anlegen → rot, weil nichts sie ablehnt                      | DB-Constraint entfernen; Anwendungsprüfung muss weiter ablehnen          |
| REQ-005 | Snapshot aus einer **Entwurfs**-Planversion → muss fehlschlagen (FMC-001)                    | Published-Prüfung entfernen → Test wird rot                              |
| REQ-005 | Einsatz über Mitternacht in DST-Woche → Summenerhaltung rot, weil keine Allokation existiert | Rundung von „einmal am Ende" auf „je Tagesanteil" ändern → Summe driftet |
| REQ-006 | `/kosten` aufrufen → rot mit 404                                                             | Wert clientseitig statt aus dem Snapshot rechnen                         |
| REQ-007 | Export-Endpunkt aufrufen → rot mit 404                                                       | einen Exportbetrag absichtlich abweichen lassen → Paritätsprüfung rot    |
| REQ-008 | Vollständige Reise Login→Satz→Publish→Snapshot→UI→XLSX → rot, weil keine Stufe existiert     | eine der acht Negativreisen entfernen → Gesamtgate muss rot bleiben      |

Beide Failure-Mode-Ketten der Baseline sind darin als falsifizierende Tests verankert
(FMC-001 in REQ-005, FMC-002 in REQ-002) und bleiben damit nicht Prosa.

## 5. Offener Blocker

### `BLOCKED_CI_EVIDENCE` — die Kernevidenz läuft in einem Job, der nicht blockieren kann

Gemessen: `read-through` ist **kein Pflichtcheck**.

```
$ bash scripts/verify-branch-protection.sh
FAIL  AC3 — fehlende Pflichtchecks: read-through
$ gh api /repos/DYAI2025/EasyTree/rules/branches/master --jq '…'
build-api, build-web, db-gates, format, lint, secret-scan, typecheck, unit-tests, web-smoke
```

Sieben von siebzehn Evidence-Zeilen oben — darunter der **gesamte** sichtbare Sprintwert
(REQ-002-Browserlogin, REQ-006-Reise, REQ-007-Parität, REQ-008-Gesamtgate) — hängen an
`read-through`. Ein roter Kernnachweis würde einen Merge heute **nicht** verhindern. Die
Baseline-Aussage „die bestehenden zehn CI-Gates bleiben erforderlich" ist damit heute
faktisch falsch: es sind neun.

**Der Fix ist vorbereitet und einzeilig.** `scripts/setup-branch-protection.sh` führt
`read-through` bereits in `REQUIRED_CHECKS` (Z. 40); `DRY_RUN=true` läuft ohne Drift-Fehler und
gibt eine Payload mit allen zehn Kontexten aus. Es fehlt allein das **Anwenden**, und das ist
eine Änderung an der GitHub-Repository-Konfiguration: nach außen wirksam, betrifft jeden PR.
Deshalb nicht ohne ausdrückliche Freigabe:

```bash
DRY_RUN=true bash scripts/setup-branch-protection.sh   # erledigt, driftfrei
bash scripts/setup-branch-protection.sh                # ← braucht Freigabe
bash scripts/verify-branch-protection.sh               # muss danach AC3 PASS zeigen
```

Bis dahin darf kein `read-through`-Ergebnis als blockierendes Gate berichtet werden.

## 6. Status nach Preflight

```text
SCOPE_DEPENDENCY_CLOSURE:    PASS        (Stufen 1-2 abgeschlossen, Guard falsifiziert)
USER_JOURNEY_STATUS:         0/6
REQUIREMENT_CONTRACT_STATUS: 0/8
CI_EVIDENCE_STATUS:          0/8 geplant, 8/8 einem Job und Schritt zugeordnet
RELEASE_STATUS:              NOT_READY
OQ-002:                      geschlossen (Abschnitt 3)
OQ-003:                      geschlossen (Abschnitt 3)
OQ-005:                      geschlossen (Abschnitt 2) - CI-only, keine Anforderung gesenkt
BLOCKER:                     BLOCKED_CI_EVIDENCE (Abschnitt 5)
```
