# Runbook: Branch Protection und Pflichtchecks (EYT-67)

Stand: 27.07.2026 (read-through ergaenzt, EYT-50) · Repository: `DYAI2025/EasyTree` · Default-Branch: `master`

Dieses Runbook ist die kanonische Quelle dafür, welche GitHub-Checks als Merge-Gate
verbindlich sind, wie die Regeln gesetzt werden und wie ihre Wirksamkeit nachgewiesen
wird. Es erfüllt EYT-67 (Dokumentationskriterium) und schließt die Merge-Gate-Doku
aus EYT-56.

## 1. Warum

In Sprint 1 wurde PR #3 mit 82 Dateien und 8.648 neuen Zeilen ohne dokumentiertes
Review, ohne Statuschecks und ohne GitHub-Actions-Lauf nach `master` gemergt. Solange
keine technische Merge-Sperre existiert, sind alle in EYT-56, EYT-57 und EYT-58
gebauten Gates unverbindlich: sie können bestehen, rot sein und trotzdem umgangen
werden. Branch Protection macht aus einem Vorschlag eine Zusage.

## 2. Verbindliche Pflichtchecks

Alle Jobs stammen aus `.github/workflows/ci.yml`. Da dort kein job-level `name:`
gesetzt ist, entspricht der Check-Name exakt der Job-ID.

| Check          | Deckt ab                                                                                                                                                            | Belegt                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `format`       | Prettier-Konformität des gesamten Repositories                                                                                                                      | EYT-56                         |
| `lint`         | ESLint über alle Workspaces                                                                                                                                         | EYT-56                         |
| `typecheck`    | TypeScript-Typprüfung über alle Workspaces                                                                                                                          | EYT-56                         |
| `unit-tests`   | Unit-Smoke über alle Workspaces                                                                                                                                     | EYT-56                         |
| `build-web`    | Produktionsbuild der Web-/PWA-Shell                                                                                                                                 | EYT-56, EYT-41                 |
| `web-smoke`    | Playwright-Smoke in echtem Chromium inkl. axe, Fokus, Viewports                                                                                                     | EYT-58, EYT-41                 |
| `build-api`    | Produktionsbuild von API und Worker                                                                                                                                 | EYT-56                         |
| `secret-scan`  | Getrackte `.env`-/Schlüsseldateien und gitleaks (gepinnt 8.24.3)                                                                                                    | EYT-56                         |
| `db-gates`     | Supabase-Migrationen, doppelter Reset, pgTAP, Tenant-Isolation fail-closed (direkt und über Supavisor), API-/Worker-Smokes                                          | EYT-57, EYT-66, EYT-15, EYT-58 |
| `read-through` | Integrierter Lesepfad: Browser → Same-Origin-Rewrite → NestJS → RLS → PostgreSQL, mit Fremdtenant-Nichtsichtbarkeit, Reload, zweitem Browserkontext und API-Ausfall | EYT-50                         |

`scripts/setup-branch-protection.sh` bricht ab, wenn `ci.yml` einen Job enthält, der
nicht in dieser Liste steht. Ein neuer CI-Job wird dadurch nicht stillschweigend zum
optionalen Check.

## 3. Konfiguration

Umgesetzt als **Repository-Ruleset** (nicht als klassische Branch Protection).
Rulesets sind versionierbar, über `bypass_actors` explizit auditierbar und liefern
mit `GET /repos/{owner}/{repo}/rules/branches/{branch}` eine effektive Ist-Sicht,
die sich unabhängig von der Wunschkonfiguration prüfen lässt.

| Regel                                  | Wert                 | Kriterium |
| -------------------------------------- | -------------------- | --------- |
| `enforcement`                          | `active`             | AC 1      |
| `bypass_actors`                        | leer                 | AC 1      |
| `conditions.ref_name.include`          | `~DEFAULT_BRANCH`    | AC 1      |
| `pull_request`                         | vorhanden            | AC 2      |
| `required_approving_review_count`      | `0`                  | siehe 3.1 |
| `dismiss_stale_reviews_on_push`        | `true`               | AC 4      |
| `required_review_thread_resolution`    | `true`               | AC 5      |
| `required_status_checks`               | die 10 Checks aus 2. | AC 3      |
| `strict_required_status_checks_policy` | `true`               | AC 3      |
| `non_fast_forward`                     | vorhanden            | AC 6      |
| `deletion`                             | vorhanden            | AC 6      |

### 3.1 Bewusste Abweichung: keine Approval-Pflicht

`required_approving_review_count` steht auf `0`. GitHub lässt niemanden den eigenen
Pull Request freigeben. Bei einem Wert von `1` wäre das Team in seiner aktuellen
Besetzung (ein Committer) technisch merge-unfähig — der einzige Ausweg wäre eine
Bypass-Rolle, die die gesamte Sperre wieder entwertet.

Gewählt wurde daher: PR-Pflicht und grüne Pflichtchecks ohne Ausnahme, aber kein
Fremd-Approval. Die Review-Mechanik (`dismiss_stale_reviews_on_push`,
`required_review_thread_resolution`) ist konfiguriert und greift ab dem Moment, in
dem ein zweiter Reviewer im Repository aktiv ist.

**Offen und bewusst getragen:** die Vier-Augen-Prüfung des Sprint-1-Vorfalls ist
damit organisatorisch, nicht technisch abgesichert. Sobald ein zweiter Mensch
Schreibzugriff hat, ist `required_approving_review_count` auf `1` zu setzen.

### 3.2 Plan- und Tarifgrenzen (AC 7)

- Das Repository ist **öffentlich**. Für öffentliche Repositories sind Rulesets und
  klassische Branch Protection auf allen GitHub-Tarifen einschließlich Free
  verfügbar; es gibt für diese Konfiguration keine tarifliche Einschränkung.
- `required_reviewers` und Code-Owner-Reviews über Rulesets sind an Organisationen
  mit entsprechendem Tarif gebunden und werden hier nicht genutzt.
- Organisationsweite Rulesets werden nicht genutzt; die Regel liegt auf
  Repository-Ebene und ist damit im Repository-Kontext auditierbar.
- Nachzuprüfen bei einem Wechsel auf ein privates Repository: klassische Branch
  Protection auf privaten Repositories erfordert einen kostenpflichtigen Tarif.
  `scripts/verify-branch-protection.sh` gibt Sichtbarkeit und Owner-Typ mit aus,
  damit diese Grenze bei jeder Verifikation sichtbar bleibt.

## 4. Anwenden

Erfordert einen GitHub-Account mit Admin-Rechten auf dem Repository. Cloud-Agenten
und CI-Runner haben diese Rechte nicht und sollen sie auch nicht bekommen.

```bash
gh auth login                          # einmalig, Scope admin:repo_hook nicht nötig
DRY_RUN=true ./scripts/setup-branch-protection.sh   # Payload prüfen
./scripts/setup-branch-protection.sh                # anwenden (idempotent)
./scripts/verify-branch-protection.sh               # Ist-Zustand prüfen
```

Das Setup-Skript legt das Ruleset an oder aktualisiert ein gleichnamiges bestehendes.
Ein zweiter Lauf ist folgenlos.

## 5. Nachweis der Wirksamkeit (AC 8)

Konfiguration allein ist kein Beweis. Der negative Test-Pull-Request belegt, dass ein
roter Pflichtcheck den Merge technisch verhindert:

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

Erwartet: der Job `format` schlägt fehl, der Merge-Button ist gesperrt, und

```bash
NEGATIVE_PR=<nr> ./scripts/verify-branch-protection.sh
```

meldet `mergeable_state=blocked`. Danach den PR schließen und den Branch löschen —
er darf nie nach `master` gelangen.

Gewählt wurde `format` (Prettier), weil es der schnellste Pflichtjob ist: er wird
typischerweise innerhalb einer Minute rot, und `mergeable_state` steht ab diesem
Moment auf `blocked`. Die übrigen Jobs des PR laufen weiter, sind für den Nachweis
aber ohne Belang — auf ihr Ende muss niemand warten.

### 5.1 Repository-Name

Kanonisch ist **`DYAI2025/EasyTree`**. `DYAI2025/Arborga` ist ein früherer Name
desselben Repositories: `git ls-remote` liefert für beide identische Refs und
PR-Referenzen, und `github.com/DYAI2025/Arborga` leitet auf `EasyTree` weiter.

Der Aliasname funktioniert weiterhin — auch in der REST-API —, taucht aber noch in
alten Klonen als `origin`-URL auf. Wer das aufräumen will:

```bash
git remote set-url origin https://github.com/DYAI2025/EasyTree.git
```

Beide Skripte lösen den kanonischen `full_name` über die API auf und melden es,
falls sie über einen Alias angesprochen wurden — das Ruleset wird also nie gegen
einen Aliasnamen geprüft.

## 6. Rollback und Notfall

```bash
gh api "repos/DYAI2025/EasyTree/rulesets" --jq '.[] | "\(.id)\t\(.name)"'
gh api --method DELETE "repos/DYAI2025/EasyTree/rulesets/<id>"
```

Alternativ in der Oberfläche unter _Settings → Rules → Rulesets_ das Ruleset auf
`Disabled` setzen. Beides erfordert Repo-Admin.

**Bekannte Betriebsfolge:** Da kein Bypass konfiguriert ist, blockiert ein dauerhaft
kaputter Pflichtcheck jeden Merge nach `master`. Das ist beabsichtigt. Der korrekte
Weg ist, den Check zu reparieren — nicht, das Gate zu öffnen. Wird das Ruleset
ausnahmsweise deaktiviert, ist das im betroffenen Jira-Vorgang zu vermerken.

## 6.1 Fail-closed-Härtungen der Skripte (Review-Nachtrag, EYT-67)

Ein Skript, das eine Sicherheitsaussage **falsch** bestätigt, ist schlechter als
keines: es erzeugt Evidenz, die niemand mehr nachprüft. Der PR-Review von EYT-67
fand fünf Stellen dieser Art, plus eine im Nachgang. Alle sind behoben; die
Begründungen stehen als Kommentar direkt am Code.

`scripts/setup-branch-protection.sh`:

1. **Drift-Prüfung in beide Richtungen.** Vorher wurde nur „Job in `ci.yml`, aber
   nicht in `REQUIRED_CHECKS`" erkannt. Der umgekehrte Fall ist der gefährlichere:
   wird ein Job umbenannt oder gelöscht, ohne die Liste zu pflegen, bleibt der alte
   Kontext `required`, GitHub wartet dauerhaft darauf, und **jeder** künftige PR ist
   permanent unmergebar. Beide Richtungen brechen jetzt ab.
2. **Fehlende Workflow-Datei ist ein Abbruch**, keine übersprungene Prüfung. Ohne
   `ci.yml` ist die Pflichtcheck-Liste unbelegbar, und ein Blind-Write könnte genau
   die Dauerblockade aus Punkt 1 erzeugen. Ebenso Abbruch, wenn der Parser keinen
   einzigen Job findet.
3. **Ruleset-Lookup ohne `|| true`.** Ein transienter API-/Rate-Limit-/Rechte-Fehler
   wurde vorher als „kein Ruleset vorhanden" gelesen und führte in den Create-Pfad —
   Ergebnis: ein **zweites** aktives Ruleset. Nur eine nachweislich erfolgreiche
   Abfrage ohne Treffer darf noch anlegen.

`scripts/verify-branch-protection.sh`:

4. **Nicht lesbares Ruleset ⇒ FAIL statt PASS.** Vorher machte
   `… | jq '.bypass_actors | length' || echo 0` aus einem fehlgeschlagenen Request
   eine Null und damit ein PASS auf die sicherheitsrelevanteste Aussage des Skripts
   („gilt auch für Repo-Admins") — ohne sie geprüft zu haben. Unlesbare Rulesets
   werden jetzt namentlich gemeldet und schlagen fehl.
5. **`strict_required_status_checks_policy` wird geprüft, nicht nur gedruckt.** Der
   Wert ist Teil von AC 3 (Abschnitt 3). Ohne `strict` darf ein veralteter Branch mit
   alten grünen Checks gemergt werden. Wer `STRICT_UP_TO_DATE=false` setzt, lässt
   diese Verifikation bewusst rot werden.
6. **AC 8 verlangt einen roten PFLICHTcheck.** Vorher genügte ein beliebiger roter
   Check zusammen mit `mergeable_state=blocked`. Das ist zu schwach, denn
   `mergeable_state` ist ein **Aggregat**: ein PR ist auch bei pendendem Pflichtcheck,
   veraltetem Branch oder ungelöstem Review-Thread `blocked`. Ein roter optionaler
   Doku-Check hätte so als Beweis durchgehen können. Die roten Checks werden jetzt
   gegen `REQUIRED_CHECKS` geschnitten.
7. **Offener und geschlossener Negativ-PR werden unterschieden.** Abschnitt 5 verlangt,
   den PR nach dem Nachweis zu schließen — bei einem geschlossenen PR friert GitHub
   `mergeable_state` aber ein. Eine späte Re-Verifikation meldet deshalb
   `AC8 (historisch)` und sagt ausdrücklich, dass daraus **keine** aktuelle Sperre
   folgt. Für einen Live-Nachweis ist ein neuer Negativ-PR nötig.

Nicht behoben, weil nicht messbar ohne Risiko: dass die Sperre auch für
Repo-Admins gilt, ist aus `bypass_actors: []` **abgeleitet**, nicht gemessen. Ein
Gegentest (`gh pr merge --admin`) würde bei falscher Annahme den kaputten Commit auf
`master` legen. Wer den Nachweis führen will, tut das auf einem Wegwerf-Repository.

## 7. Verwandte Dokumente

- `docs/architecture/tenant-isolation-report.md` — CI-Evidenz der Tenant-Gates
- `docs/plans/2026-07-24-sprint-2-quality-gates.md` — Sprint-2-Umsetzungsplan
- `docs/plans/2026-07-25-eyt-sprint-2-abschluss.md` — Abschlussplan Sprint 2
- `docs/retros/2026-07-24-sprint-1-modell-retrospektive.md` — Herkunft des Vorfalls
