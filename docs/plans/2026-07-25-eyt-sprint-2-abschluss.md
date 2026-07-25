# Plan: Sprint 2 vollständig abschließen (EYT-67, EYT-56, EYT-69)

Stand: 25.07.2026 · Repository: `DYAI2025/EasyTree` · Board 72 · Default-Branch: `master`
Verifikationsstufe dieses Plans: **live gegen GitHub und Jira geprüft** (nicht aus Dokumenten
abgeleitet). Jede Ist-Aussage unten trägt ihre Quelle.

## Ziel

Die beiden offenen Sprint-2-Tickets erreichen einen belegten `Fertig`-Zustand, und die
Dokumentation auf `master` widerspricht dem verifizierten Stand nicht mehr:

- **EYT-67** — Branch Protection: AC 1–7 sind bereits wirksam, AC 8 (Negativnachweis) fehlt,
  und die Deliverables (`scripts/`, Runbook) liegen noch unmerged auf einem Feature-Branch.
- **EYT-56** — PR-CI-Baseline: einziges offenes AC ist „ein fehlgeschlagener Pflichtjob darf
  nicht umgangen werden"; das ist eine Aussage über EYT-67, nicht über den Workflow.
- **EYT-69** — Doku-Widersprüche, die durch den Sprint-2-Fortschritt selbst entstanden sind.

## Non-Goals

- Kein produktives Deployment, keine Hosting-Entscheidung (offener Freigabepunkt, `docs/README.md`).
- Keine Erhöhung von `required_approving_review_count` auf 1 — PO-Entscheidung ist 0, begründet
  im Runbook §3.1 (ein Committer wäre sonst technisch merge-unfähig).
- **EYT-68** (Jira-Sprintgovernance) wird nicht mitgeliefert: kein Sprint-2-Ticket, keine
  Laufzeitwirkung, Empfehlung Sprint 3. Siehe Entscheidungspunkt D2.
- Kein Screenreader-Smoke (a11y-Checkliste Punkt 7) — erfordert einen Menschen mit AT.

## Preconditions (live verifiziert)

| Fakt                                   | Ist-Stand                                                                                                                           | Quelle                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Repo-Admin verfügbar                   | `permissions.admin = true`, Account `DYAI2025`                                                                                      | `gh api repos/DYAI2025/EasyTree`            |
| `gh` Token-Scopes                      | `gist, read:org, repo, workflow`                                                                                                    | `gh auth status`                            |
| Ruleset auf `master`                   | ID `19718704`, `enforcement: active`, `bypass_actors: []`, `include: ["~DEFAULT_BRANCH"]`, erstellt 25.07. 04:22                    | `gh api repos/.../rulesets/19718704`        |
| Wirksame Regeln                        | `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks` (9 Kontexte), `strict_required_status_checks_policy: true` | `gh api repos/.../rules/branches/master`    |
| AC 1–7 EYT-67                          | **alle PASS**, AC 8 `SKIP` (kein `NEGATIVE_PR`)                                                                                     | `bash scripts/verify-branch-protection.sh`  |
| Branch `feat/eyt-67-branch-protection` | gepusht, Commit `fde0e2f`, 1 Commit vor `master`, **kein offener PR**                                                               | `git log origin/master..HEAD`, `gh pr list` |
| CI-Referenzlauf                        | Run `30133452629`, sha `d497bc9`, Branch `feat/sprint-2-quality-gates`, **alle 9 Jobs `success`** (inkl. `db-gates`, `web-smoke`)   | `gh run view 30133452629`                   |

## Known gaps

- **G1** — AC 8 EYT-67 unbelegt: kein Negativ-PR existiert, `mergeable_state=blocked` nie gemessen.
- **G2** — EYT-67-Deliverables nicht auf `master`: `scripts/setup-branch-protection.sh`,
  `scripts/verify-branch-protection.sh`, `docs/runbooks/branch-protection.md` liegen nur auf
  `feat/eyt-67-branch-protection`. Ein Reviewer auf `master` findet die Belege nicht.
- **G3** — `README.md:44` behauptet „Branch Protection erzwingt sie technisch (EYT-67)". Das war
  zum Schreibzeitpunkt falsch und ist jetzt zufällig wahr, aber unbelegt formuliert — genau der
  Fehlertyp, den EYT-69 adressiert.
- **G4** — `README.md:57-58` markieren `db-gates` und `web-smoke` als „ja — folgt in EYT-57/EYT-58",
  obwohl beide in Run `30133452629` grün liefen.
- **G5** — `docs/architecture/tenant-isolation-report.md:196`: „**Evidenzstufe:** CI-Lauf ausstehend"
  trotz grünem `db-gates`. Zusätzlich steht der `TOOL_GAP Live-Pooler-Test` (Zeilen 151–156) noch
  als offen im Dokument, obwohl der direkt folgende Abschnitt ihn schließt.
- **G6** — Derselbe Report nennt als Default `postgresql://postgres:postgres@127.0.0.1:54329/postgres`.
  Der Code verwendet `postgresql://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres?sslmode=disable`
  (`apps/api/test/tenant-pooling.integration.test.ts:40-41`), und CI leitet Tenant und Port dynamisch
  aus dem laufenden Container ab (`ci.yml`, Step „Resolve pooler URL + pre-flight"). Der dokumentierte
  Vertrag funktioniert so nicht.
- **G7** — `CLAUDE.md` (heute erstellt) übernimmt die Behauptung aus G3 wörtlich („a GitHub ruleset
  blocks the merge") und formuliert den a11y-Status unscharf. Muss mit EYT-69 mitgezogen werden.

## Reihenfolge-Begründung

Der Negativnachweis (T1) läuft **vor** der Doku-Korrektur (T2), damit die Doku den belegten
Zustand samt PR-Nummer nennen kann statt einer Absichtserklärung. Die Doku-Korrektur läuft vor
dem Merge-PR (T3), damit `master` in einem Schritt konsistent wird.

---

## T1 — AC 8: Negativ-PR beweist die Merge-Blockade

**REQ:** EYT-67 AC 8 · schließt G1 · Voraussetzung für EYT-56
**Betroffen:** neuer Branch `test/eyt-67-negative-merge-block`, temporäre Datei `ci-negative-test.json`
(nie auf `master`)

Verfahren exakt wie `docs/runbooks/branch-protection.md` §5:

```bash
git fetch origin
git checkout -b test/eyt-67-negative-merge-block origin/master
printf '{"eyt67":"negative-test",   "formatted":false,\n    "note":"Diese Datei verletzt Prettier absichtlich."}\n' \
  > ci-negative-test.json
git add ci-negative-test.json
git commit -m "test(ci): EYT-67 negative proof - deliberately unformatted file"
git push -u origin test/eyt-67-negative-merge-block
gh pr create --base master \
  --title "EYT-67 Negativtest: roter Pflichtcheck blockiert Merge" \
  --body "Absichtlich fehlschlagender format-Check. NICHT mergen. Nach Nachweis schliessen."
```

`format` wird gewählt, weil es der schnellste Pflichtjob ist; auf die übrigen Jobs muss der
Nachweis nicht warten.

**Tests / Messung:**

1. `gh run watch` bis `format` = `failure`.
2. `NEGATIVE_PR=<nr> bash scripts/verify-branch-protection.sh` — Exitcode separat prüfen
   (`echo "EXIT=$?"` **ohne** Pipe dahinter, sonst misst man den Exit der Pipe).
3. Gegenprobe, dass die Sperre real ist und nicht nur gemeldet: `gh pr merge <nr> --merge`
   **muss scheitern**. Fehlermeldung wörtlich protokollieren.

**Akzeptanz-Evidenz:** `state=open mergeable_state=blocked`, rote Checks enthalten `format`,
Verify-Zeile `PASS AC8 …`, plus die Fehlermeldung des abgelehnten Merge-Versuchs.

**Abschluss:** PR schließen (`gh pr close <nr>`), Remote-Branch löschen
(`git push origin --delete test/eyt-67-negative-merge-block`), lokalen Branch löschen. Die Datei
darf `master` nie erreichen.

---

## T2 — EYT-69: Doku auf den verifizierten Stand bringen

**REQ:** EYT-69 AC 1–5 · schließt G3–G7
**Betroffen:** `README.md`, `docs/architecture/tenant-isolation-report.md`,
`docs/runbooks/a11y-checklist.md` (nur Statuspräzisierung), `CLAUDE.md`

| #    | Datei / Stelle                       | Änderung                                                                                                                                                                                                                                                                                                                                               |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T2.1 | `README.md:42-46`                    | Zwei Aussagen trennen: (a) die 9 Jobs sind Pflichtchecks im Ruleset `19718704`, `enforcement: active`, `bypass_actors: []`; (b) belegt durch Negativ-PR #\<T1\> (`mergeable_state=blocked`). Keine Behauptung ohne genannten Beleg.                                                                                                                    |
| T2.2 | `README.md:57-58`                    | Spalte „merge-blockierend" für `db-gates` und `web-smoke` von „ja — folgt in EYT-57/58" auf „ja — verifiziert in Run `30133452629`" ändern.                                                                                                                                                                                                            |
| T2.3 | `tenant-isolation-report.md:151-156` | `TOOL_GAP Live-Pooler-Test` als **geschlossen** markieren, mit Verweis auf den direkt folgenden Abschnitt „Pooling-Evidenz (Sprint 2, real)". Der Gap-Block bleibt als Historie stehen, wird aber nicht mehr als offen gelesen.                                                                                                                        |
| T2.4 | `tenant-isolation-report.md:196-197` | „CI-Lauf ausstehend" ersetzen durch Run `30133452629` (`db-gates` = `success`, sha `d497bc9`) als Evidenzstufe „CI-Lauf".                                                                                                                                                                                                                              |
| T2.5 | `tenant-isolation-report.md:170-173` | Default-Pooler-URL korrigieren: tatsächlicher Code-Default ist `postgresql://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres?sslmode=disable`; in CI werden Tenant-ID **und** Port dynamisch aus dem laufenden Supavisor-Container abgeleitet. Die alte `postgres:postgres@…:54329`-Form ausdrücklich als **nicht funktionierend** kennzeichnen. |
| T2.6 | `a11y-checklist.md:9-11`             | Status bleibt inhaltlich korrekt (1–6 bestanden, 7 offen); nur die Kopfzeile so schärfen, dass „Checkliste offen" nicht als „nichts geprüft" missverstanden wird.                                                                                                                                                                                      |
| T2.7 | `CLAUDE.md`                          | Behauptung „a GitHub ruleset blocks the merge" durch belegte Formulierung ersetzen (Ruleset-ID + Negativ-PR). a11y-Satz auf „nur Punkt 7 (Screenreader) offen" präzisieren.                                                                                                                                                                            |

**Tests:** `pnpm format` (Prettier-Konformität der geänderten Markdown-Dateien) und
`grep -rn "ausstehend\|folgt in EYT" README.md docs/` — Treffer müssen erklärt oder weg sein.

**Akzeptanz-Evidenz:** Diff der vier Dateien; `pnpm format` grün; Grep-Ausgabe ohne
unerklärte Treffer.

---

## T3 — Merge-PR: EYT-67-Deliverables + EYT-69-Doku nach `master`

**REQ:** EYT-67 (Deliverables auf `master`), EYT-69 · schließt G2 · positiver Nachweis für EYT-56
**Betroffen:** Branch `feat/eyt-67-branch-protection` (Commit `fde0e2f` + neuer T2-Commit)

Ein PR mit zwei sauber getrennten Commits — dieselbe Praxis wie PR #5, der EYT-56/57/58/66/15/41
gemeinsam trug.

```bash
git checkout feat/eyt-67-branch-protection
# T2-Änderungen committen, dann:
git push
gh pr create --base master --title "EYT-67 Branch Protection als Code + EYT-69 Doku-Korrektur" --body <Evidenzblock>
```

**Tests:** alle 9 Pflichtchecks müssen grün sein. `db-gates` startet einen echten Supabase-Stack
(zwei Resets, pgTAP zweimal, Stack-Restart, Tenant-Gates direkt **und** über Supavisor, API-/Worker-Smokes)
— mit mehreren Minuten Laufzeit rechnen. Vor dem Merge lokal `pnpm format lint typecheck test`
laufen lassen, damit ein trivialer Fehlschlag nicht einen vollen `db-gates`-Lauf verbrennt.

**Akzeptanz-Evidenz:** Run-URL mit 9× `success`; Merge-Commit-SHA. `strict_required_status_checks_policy: true`
verlangt einen aktuellen Branch — bei Bedarf `git rebase origin/master` vor dem Merge.

**Achtung:** Dieser Merge ist selbst der positive Wirknachweis (PR-Pflicht + grüne Gates).
Kein Umweg über direkten Push — der wäre serverseitig ohnehin abgelehnt.

---

## T4 — Nachverifikation gegen `master`

**REQ:** EYT-67 AC 1–8 gesamt, EYT-56 letztes AC

```bash
git checkout master && git pull
NEGATIVE_PR=<T1-Nr> bash scripts/verify-branch-protection.sh
echo "EXIT=$?"
```

**Akzeptanz-Evidenz:** „Ergebnis: 0 offen, 0 übersprungen", Exitcode `0`, ausgeführt vom
gemergten Skript auf `master` (nicht vom Feature-Branch). Diese Ausgabe ist der Jira-Evidenzblock.

---

## T5 — Vollständiges Code Review des Sprint-2-Deltas

**REQ:** Sprint-2-Abschlussqualität · Gate vor den Jira-Transitions

**Umfang:** Delta `master@f34b690..HEAD` plus die in Sprint 2 entstandenen Artefakte:
`.github/workflows/ci.yml`, `.github/actions/setup-pnpm/`, `scripts/*.sh`,
`apps/api/test/tenant-*.ts`, `apps/api/src/health/`, `apps/web/e2e/`, `supabase/migrations/`,
`docs/runbooks/`.

**Review-Achsen:**

1. **Fail-closed-Integrität** — kann irgendein Pflichtpfad still grün werden? Skips, `|| true`,
   `continue-on-error`, Grep-Gates ohne `set -o pipefail`-Wirkung.
2. **Shell-Robustheit** — die CI-Steps und `scripts/*.sh` sind sicherheitsrelevant; `set -Eeuo pipefail`,
   Exitcode-durch-Pipe-Fallen, bash-3.2-Kompatibilität (macOS-Systembash).
3. **Tenant-Grenze** — RLS-Policies, tenantgebundene FKs, `security definer` + `search_path`,
   Grants gegen `anon`.
4. **Secret-Hygiene** — Redaction-Vertrag in `@easytree/config`, keine Werte in Fehlermeldungen/Logs.
5. **Architekturgrenzen (ADR-001)** — kein Supabase-SDK in `apps/web`, keine Fachlogik in `packages/ui`,
   Domain ohne Framework-Import.
6. **Test-Substanz** — beweisen die Tests das AC oder nur sich selbst (`testing-anti-patterns`).

**Akzeptanz-Evidenz:** Findings-Liste, nach Severity sortiert, jedes mit `datei:zeile` und
konkretem Fehlerszenario. Findings der Severity „blockierend" verhindern T6 für das betroffene Ticket.

---

## T6 — Jira: Evidenz und Transitions

**REQ:** EYT-56, EYT-67, EYT-69 · Regeln aus `docs/retros/2026-07-24-sprint-1-modell-retrospektive.md`

Pro Ticket **erst** Evidenzkommentar, **dann** Transition — und nur, wenn jedes AC wörtlich
gegen ein Artefakt geprüft ist (AC-Deckel, Mikro-Regel 1). Vorher Grep-Gate (Mikro-Regel 5):
`grep -riE "offen|TODO|TOOL_GAP|FIXME"` über die Deliverables des Tickets.

| Ticket | Von          | Nach   | Bedingung                                                                |
| ------ | ------------ | ------ | ------------------------------------------------------------------------ |
| EYT-67 | Zu erledigen | Fertig | T4 meldet 0 offen / 0 übersprungen **und** T5 ohne blockierendes Finding |
| EYT-56 | In Arbeit    | Fertig | T1 belegt die Nicht-Umgehbarkeit **und** EYT-67 ist Fertig               |
| EYT-69 | Zu erledigen | Fertig | T2 gemergt (T3), Grep-Gate leer                                          |

Evidenzstufe in jedem Kommentar benennen (Mikro-Regel 3): hier durchgehend **ausgeführter
CI-Lauf** — die stärkste Stufe.

**Nicht transitionieren:** EYT-68 (nicht im Sprint, siehe D2). EYT-15/41 stehen bereits auf
`Fertig`; T5 prüft nur, ob das Review dieser Bewertung widerspricht — falls ja, wird das
berichtet statt still korrigiert.

---

## Entscheidungspunkte

- **D1 — EYT-69 in Sprint 2 ziehen?** Das Ticket trägt `sprint-2-followup` und liegt im Backlog,
  ist aber eine direkte Folge der Sprint-2-Arbeit. Ohne Fix widerspricht `master` dem verifizierten
  Stand. Empfehlung: in Sprint 2 ziehen und mitschließen.
- **D2 — EYT-68 (Sprintgovernance):** Empfehlung Sprint 3. Reine Prozessarbeit, keine
  Laufzeitwirkung; würde den Sprint-2-Abschluss nur verzögern.
- **D3 — a11y Punkt 7 (Screenreader):** bleibt offen, braucht einen Menschen mit VoiceOver/NVDA
  (≈ 5 Min). Betrifft EYT-41, das bereits auf `Fertig` steht — als Restpunkt sichtbar halten, nicht
  stillschweigend als erledigt behandeln.

## Risiken und Rollback

| Risiko                                                          | Wirkung                                                                | Gegenmaßnahme / Rollback                                                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Negativ-Datei gelangt versehentlich nach `master`               | `format` bricht auf `master` dauerhaft                                 | PR nie mergen, direkt nach Nachweis schließen + Branch löschen (T1-Abschluss). Falls doch: Revert-PR.                                                              |
| `db-gates` ist auf dem PR flaky (Supavisor-Tenant-Auflösung)    | T3 blockiert                                                           | Genau dafür existieren die Fallbacks aus `d497bc9`/`9713ae8`. Bei Fehlschlag: Step-Summary-Diagnose lesen, **nicht** den Check als optional umkonfigurieren.       |
| Ruleset sperrt den eigenen Merge aus                            | Sprint nicht abschließbar                                              | `bypass_actors: []` ist Absicht. Notfall-Rollback: `gh api -X DELETE repos/DYAI2025/EasyTree/rulesets/19718704` — nur mit PO-Freigabe, dokumentiert im Runbook §6. |
| Review findet blockierendes Problem in bereits `Fertig`-Tickets | EYT-15/41 müssten zurück                                               | Berichten statt still zurückdrehen; Statusentscheidung pro Ticket beim PO (Mikro-Regel 4).                                                                         |
| `gh`-Token ohne Ruleset-Schreibrecht                            | T1/T4 lesen nur — kein Problem; nur ein Rollback bräuchte Schreibrecht | Scopes sind `repo` + Admin-Rechte; Lesepfad live bestätigt.                                                                                                        |
