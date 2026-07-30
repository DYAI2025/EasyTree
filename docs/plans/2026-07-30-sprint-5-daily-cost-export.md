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

| REQ                      | Testdatei(en) — neu, sofern nicht anders vermerkt                                                                                                                                                                                      | Job            | Schritt                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------- |
| REQ-001                  | `apps/api/test/architecture.test.ts` (**vorhanden**, erweitern), `apps/api/test/architecture-red-case.test.ts` (**vorhanden**)                                                                                                         | `unit-tests`   | `pnpm test`                                  |
| REQ-001                  | `supabase/tests/00NN_costs_tables.sql` — Tabellenbesitz und Katalogregistrierung                                                                                                                                                       | `db-gates`     | `pnpm exec supabase test db` + Meta-Gate     |
| REQ-002                  | `apps/api/test/costs-authz.integration.test.ts` — atomare Rechte, Token abgelaufen/falsch signiert, Fremdtenant                                                                                                                        | `db-gates`     | Tenant-Gate-Schritt                          |
| REQ-002                  | `supabase/tests/00NN_costs_rls.sql` — RLS lehnt Mitarbeiter unabhängig von der API ab                                                                                                                                                  | `db-gates`     | `pnpm exec supabase test db`                 |
| REQ-002                  | `apps/web/e2e/cost-journey.spec.ts` — **echter** GoTrue-Browserlogin                                                                                                                                                                   | `read-through` | `bash scripts/read-through-harness.sh`       |
| REQ-003                  | `apps/api/test/publish-plan.integration.test.ts` — Idempotenz, Stale Version, Fault Injection                                                                                                                                          | `db-gates`     | Planungsinvarianten-Gate                     |
| REQ-003                  | `apps/api/test/publish-plan.concurrency.test.ts` — **zwei echte Verbindungen** (Muster EYT-49)                                                                                                                                         | `db-gates`     | Planungsinvarianten-Gate                     |
| REQ-004/REQ-005 (EYT-95) | `packages/domain/test/rate-version.property.test.ts` — Money, Rate, Duration, zentrale Rundung, Satzversionsauswahl an Intervallgrenzen, fester fast-check-Seed                                                                        | `unit-tests`   | `pnpm test`                                  |
| REQ-004                  | `supabase/tests/00NN_cost_rates_overlap.sql` — Überlappung DB-seitig, auch parallel                                                                                                                                                    | `db-gates`     | `pnpm exec supabase test db`                 |
| REQ-005 (EYT-109)        | `packages/domain/test/daily-cost-allocation.property.test.ts` — Summenerhaltung, DST, Mitternacht. **PO-Korrektur 30.07.2026: gehört zu EYT-109, nicht zu EYT-95** — als vorbereiteter, noch nicht auszuführender Akzeptanztest führen | `unit-tests`   | `pnpm test` + Fremdzonen-Schritt (TZ-Matrix) |
| REQ-005                  | `apps/api/test/cost-snapshot.integration.test.ts` — Unveränderlichkeit, Idempotenz, fehlender Satz blockiert                                                                                                                           | `db-gates`     | Tenant-Gate-Schritt                          |
| REQ-006                  | `apps/web/test/kosten-page.test.tsx` — jsdom + axe, alle sechs Zustände unterscheidbar                                                                                                                                                 | `unit-tests`   | `pnpm test`                                  |
| REQ-006                  | `apps/web/e2e/cost-journey.spec.ts` — Netzwerknachweis, Reload, zweiter Kontext                                                                                                                                                        | `read-through` | `bash scripts/read-through-harness.sh`       |
| REQ-007                  | `apps/api/test/xlsx-export.contract.test.ts` — Snapshot-ID-only, MIME, Dateiname, leeres Ergebnis                                                                                                                                      | `unit-tests`   | `pnpm test`                                  |
| REQ-007                  | `apps/api/test/xlsx-export.security.test.ts` — Formula-Injection, manipulierte ID, Fremdtenant                                                                                                                                         | `unit-tests`   | `pnpm test`                                  |
| REQ-007                  | `apps/web/e2e/cost-journey.spec.ts` — UI/DB/Zell-Parität                                                                                                                                                                               | `read-through` | `bash scripts/read-through-harness.sh`       |
| REQ-008                  | `apps/web/e2e/cost-journey.spec.ts` — durchgehende Reise **plus acht Negativreisen**                                                                                                                                                   | `read-through` | `bash scripts/read-through-harness.sh`       |

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

## 5. `BLOCKED_CI_EVIDENCE` — aufgeloest am 30.07.2026

Der Befund war: `read-through` war **kein** Pflichtcheck, obwohl sieben der siebzehn
Evidence-Zeilen und damit der gesamte sichtbare Sprintwert dort haengen. Ein roter
Kernnachweis haette keinen Merge verhindert.

**Behoben.** Nach ausdruecklicher PO-Freigabe wurde `scripts/setup-branch-protection.sh`
angewendet. Vorher wurde der vollstaendige Ruleset-Zustand gesichert (Ruleset-Liste,
Volljson je Ruleset, wirksame Regeln, Default-Branch).

| Attribut              | vorher                                           | nachher                                                       |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| Ruleset               | `19718704` „EasyTree master protection (EYT-67)" | **dasselbe** `19718704`, aktualisiert — kein zweites angelegt |
| Pflichtchecks         | 9                                                | **10**                                                        |
| Diff                  | —                                                | genau eine Zeile: `+ read-through`                            |
| `enforcement`         | `active`                                         | `active`                                                      |
| `bypass_actors`       | `[]`                                             | `[]`                                                          |
| `conditions.ref_name` | `~DEFAULT_BRANCH`                                | `~DEFAULT_BRANCH`                                             |
| `strict_..._policy`   | `true`                                           | `true`                                                        |

Wirksame Pflichtchecks, unabhaengig aus der API gelesen
(`gh api /repos/DYAI2025/EasyTree/rules/branches/master`):

```text
build-api, build-web, db-gates, format, lint, read-through,
secret-scan, typecheck, unit-tests, web-smoke        (10)
```

`bash scripts/verify-branch-protection.sh`:

```text
PASS  AC1/AC2 — pull_request-Regel ist auf master wirksam; direkte Pushes serverseitig abgelehnt.
PASS  AC1 — kein Bypass-Akteur in allen 1 gelesenen Ruleset(s); die Sperre gilt auch fuer Repo-Admins.
PASS  AC3 — alle 10 Pflichtchecks sind als required_status_checks gesetzt.
PASS  AC3 — strict_required_status_checks_policy=true; der Branch muss vor dem Merge aktuell sein.
PASS  AC4 — dismiss_stale_reviews_on_push=true; Freigaben verfallen bei neuen Commits.
PASS  AC5 — required_review_thread_resolution=true; ungeloeste Kommentare blockieren den Merge.
PASS  AC6 — non_fast_forward-Regel wirksam; Force Push auf master ist gesperrt.
PASS  AC6 — deletion-Regel wirksam; master kann nicht geloescht werden.
PASS  AC7 — Runbook vorhanden: docs/runbooks/branch-protection.md
SKIP  AC8 — kein NEGATIVE_PR gesetzt.

=== Ergebnis: 0 offen, 1 uebersprungen ===
```

**Offener Nachweis: `BRANCH_PROTECTION_NEGATIVE_EXECUTION`.** AC8 bleibt uebersprungen. Dass die
Sperre einen Merge _tatsaechlich_ serverseitig ablehnt, ist fuer den Stand vom 27.07.2026 mit
PR #7 belegt (`format` rot, `mergeable_state=blocked`, Merge serverseitig zurueckgewiesen), fuer
den neu ergaenzten Check `read-through` aber noch **nicht** einzeln gemessen. Gelesene
Konfiguration ist kein ausgefuehrter Negativfall.

```text
BRANCH_PROTECTION_CONFIGURATION:     PASS
BRANCH_PROTECTION_NEGATIVE_EXECUTION: OPEN
```

**Kein Blocker fuer Schreiben und Testen auf dem Feature-Branch. Verbindlich vor dem Merge des
ersten Sprint-5-PR** (PO-Weisung 30.07.2026 §1). Sechs Schritte:

1. Sprint-5-PR ist geoeffnet.
2. `read-through` wird kontrolliert rot gestellt **oder** laeuft aufgrund eines echten Fehlers rot.
3. GitHub weist den PR wegen genau dieses Pflichtchecks als nicht mergebar aus.
4. Fehler beheben bzw. den kontrollierten Gegenfall vollstaendig zuruecknehmen.
5. `read-through` laeuft gruen.
6. Mergefaehigkeit erneut pruefen.

**Kein kuenstlicher Fehler gelangt nach `master`.** Ein temporaerer Gegenfall auf dem
Feature-Branch ist zulaessig, sofern er vor dem Merge vollstaendig zurueckgenommen und
dokumentiert wird.

Rollback des Rulesets, falls je noetig:

```bash
gh api --method PUT repos/DYAI2025/EasyTree/rulesets/19718704 \
  --input <gesicherte ruleset-19718704.json>
```

## 6. Status nach Preflight

```text
SCOPE_DEPENDENCY_CLOSURE:    PASS        (Stufen 1-2 abgeschlossen, Guard falsifiziert)
PREFLIGHT:                   PASS        READY_FOR_IMPLEMENTATION
USER_JOURNEY_STATUS:         0/6
REQUIREMENT_CONTRACT_STATUS: 0/8
CI_EVIDENCE_STATUS:          0/8 erfuellt; 8/8 einem Job und Schritt zugeordnet;
                                         8/8 in einem BLOCKIERENDEN Job
RELEASE_STATUS:              NOT_READY
OQ-002:                      geschlossen (Abschnitt 3)
OQ-003:                      geschlossen (Abschnitt 3)
OQ-005:                      geschlossen (Abschnitt 2) - CI-only, keine Anforderung gesenkt
BLOCKED_CI_EVIDENCE:         aufgeloest (Abschnitt 5)
BRANCH_PROTECTION_CONFIGURATION:      PASS
BRANCH_PROTECTION_NEGATIVE_EXECUTION: OPEN  - verbindlich vor dem ersten Merge, kein Startblocker
OFFENE BLOCKER:              keine fuer Iteration 1
```
