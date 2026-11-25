# EYT-136 — Unabhängiger Abschlussreview (PO-Freigabe-Paket) — Umsetzungsplan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** PR #56 (EYT-136) auf dem exakten Live-Head unabhängig auf Merge-Readiness prüfen, belegte In-Scope-Defekte minimal beheben und ein SHA-gebundenes Reviewpaket für den Product Owner liefern — ohne Merge, ohne Jira-Statuswechsel, ohne EYT-109/EYT-110.

**Architecture:** Read-only-Review in einem **isolierten Worktree** auf dem gepinnten PR-Head. Jede Behauptung des Auftrags gilt als *Hypothese*, die gegen genau eine von drei Evidenzstufen geprüft wird: (1) ausgeführter CI-Lauf, (2) Repository-Inhalt auf dem gepinnten SHA, (3) Jira/Confluence-Live-Abruf. Befunde landen fortlaufend in einer **Scratchpad-Notizdatei außerhalb des Repos** — es entsteht kein Commit, solange kein belegter In-Scope-Defekt gefunden wird, weil jeder Commit den bereits 11/11-grün geprüften Head entwertet.

**Tech Stack:** `git worktree`, `gh` CLI (PR/Run/Log), `rg`, Atlassian MCP (`mcp__claude_ai_Atlassian__*`), PostgreSQL/pgTAP-Lesen (keine lokale Ausführung — dieser Mac kann den Supabase-Stack nicht starten, SQL läuft ausschließlich in CI).

---

## Abweichung von der Skill-Standardregel „frequent commits"

Die writing-plans-Skill verlangt normalerweise häufige Commits. **Hier gilt das Gegenteil und zwar bewusst:** Der Auftrag verbietet Commits ohne belegten Defekt (Abschnitt 27 des Auftrags), weil jeder neue Commit den CI-Nachweis auf `728f9b4` ungültig macht. Commits gibt es deshalb nur in Task 20, und nur wenn Task 17 einen `PR_P1`/`PR_P2` belegt hat.

## Live gemessener Ausgangszustand (08.08.2026, vor Planerstellung)

Diese Werte sind **gemessen**, nicht übernommen — sie sind die Erwartung für Task 1 und müssen dort erneut bestätigt werden:

| Größe | Wert |
| --- | --- |
| `origin/master` | `aad46ddca12abf1c4862e70248f61978dcce96e7` (Merge PR #54) |
| PR #56 Head | `728f9b4fb2339d9f1d6a49b4c5d1dfe830843141` |
| PR #56 Base-Oid | `aad46ddca12abf1c4862e70248f61978dcce96e7` (= aktueller master, 0 behind) |
| PR #56 State | `OPEN`, `isDraft=true`, `mergeable=MERGEABLE` |
| PR #57 Head | `8cfebcfebb2d52241c8dce77eb1186056d9895c4`, `OPEN`, `DRAFT`, `[WEGWERF]` |
| CI-Lauf | `31242966385`, `conclusion=success`, `headSha=728f9b4…` — **11/11 required grün** |
| 12. Check | `Supabase Preview` = `skipping` (kein Required Check) |
| Gegenmutations-PRs | **#58–#68**, alle `CLOSED`, alle `merged=null` (11 Stück, Branches `gm/eyt-136-gm*`) |
| Geänderte Dateien PR #56 | **13** — exakt die im Auftrag genannten |

**Zwei Fakten, die der Auftrag nicht hatte und die den Ablauf ändern:**

1. **Der lokale Worktree `/Users/benjaminpoersch/EasyTree` steht auf `60a3ce36f026401670d16be35b7ac78fd8102d9b` — drei Commits *hinter* dem PR-Head** und trägt untracked Nutzerdateien (`docs/architecture/EasyTree – Softwaredokumentation.md`, mehrere `docs/plans/*`, `scripts/ops/`). Ein Review in diesem Baum würde den falschen Stand prüfen. Der isolierte Worktree in Task 0 ist deshalb **nicht optional**.
2. Es existieren **elf** geschlossene Gegenmutations-PRs, nicht die im Auftrag angedeutete Handvoll. Die Matrix in Task 15 muss alle elf abdecken oder erklären, warum einer nicht zählt.

## Konventionen für alle Tasks

- **`$WT`** = Pfad des isolierten Review-Worktrees (Task 0 setzt ihn).
- **`$NOTES`** = `<eigenes Scratchpad>/eyt136-review-notes.md` — Befundsammlung, **nie im Repo**.
- **`$LOGS`** = `<eigenes Scratchpad>/logs/` — heruntergeladene CI-Logs.
- **`$HEAD_SHA`** = `728f9b4fb2339d9f1d6a49b4c5d1dfe830843141`, sofern Task 1 nichts anderes misst.
- Jeder `git`-Aufruf im Review nutzt `git -C "$WT" …`, damit nie versehentlich der Nutzer-Worktree bearbeitet wird.
- **Verbot in jedem Task:** kein `git reset --hard`, kein `git clean`, kein `git stash`, kein Löschen unbekannter Dateien, kein Merge, kein Jira-Schreibzugriff.
- Ein Befund zählt nur mit **Datei:Zeile** (Repo) oder **Run-ID + Job-ID + Logzeile** (CI). „Ich habe den Kommentar gelesen" ist kein Beleg.

---

### Task 0: Isolierten Review-Worktree auf dem gepinnten Head anlegen

**Files:**
- Erzeugt: `$WT` (außerhalb des Repos, im Scratchpad)
- Erzeugt: `$NOTES`, `$LOGS`
- Verändert: **nichts** im Nutzer-Worktree

**Step 1: Nutzer-Worktree ansehen, nicht anfassen**

```bash
git -C /Users/benjaminpoersch/EasyTree status --short
git -C /Users/benjaminpoersch/EasyTree worktree list
```

Erwartet: dirty (untracked Nutzerdateien), Branch `fix/eyt-136-planning-data-api-boundary` auf `60a3ce3`.
Es können stale Worktree-Einträge früherer Sessions auftauchen (`eyt136-wt`, `eyt136-proof-wt`, `eyt136-gm-wt`, Status `prunable`).
**Nicht prunen, nicht wiederverwenden.** Sie gehören einer fremden Session; ein neuer, eigener Worktree kollidiert nicht mit ihnen.

**Step 2: Remote-Stand holen**

```bash
git -C /Users/benjaminpoersch/EasyTree fetch origin --prune
git -C /Users/benjaminpoersch/EasyTree rev-parse origin/fix/eyt-136-planning-data-api-boundary
```

Erwartet: `728f9b4fb2339d9f1d6a49b4c5d1dfe830843141`.
Bei Abweichung: **der neue Wert gilt**, `$HEAD_SHA` überall ersetzen und in `$NOTES` vermerken, dass die CI-Evidenz des Auftrags damit hinfällig ist (Task 16 prüft dann den neuen Head).

**Step 3: Worktree detached auf dem SHA anlegen**

```bash
export WT="<eigenes Scratchpad>/eyt136-review-wt"
git -C /Users/benjaminpoersch/EasyTree worktree add --detach "$WT" 728f9b4fb2339d9f1d6a49b4c5d1dfe830843141
```

`--detach` ist Absicht: kein lokaler Branch, damit nichts versehentlich gepusht wird.

**Step 4: Identität des Worktrees beweisen**

```bash
git -C "$WT" rev-parse HEAD
git -C "$WT" status --short
```

Erwartet: exakt `728f9b4…` und **leere** Statusausgabe. Ist der Status nicht leer, ist der Worktree kontaminiert — abbrechen und neu anlegen.

**Step 5: Notizdatei anlegen**

```bash
mkdir -p "<eigenes Scratchpad>/logs"
printf '# EYT-136 Review-Notizen\n\nGeprüfter Head: 728f9b4fb2339d9f1d6a49b4c5d1dfe830843141\n\n' > "<eigenes Scratchpad>/eyt136-review-notes.md"
```

**Kein Commit.**

---

### Task 1: Live-Bootstrap — alle Auftragshypothesen einzeln bestätigen

**Files:** nur lesend; Ergebnisse nach `$NOTES`

**Step 1: PR-Zustände lesen**

```bash
gh pr view 56 --json number,state,isDraft,mergeable,headRefName,headRefOid,baseRefName,baseRefOid,title,url
gh pr view 57 --json number,state,isDraft,mergeable,headRefName,headRefOid,baseRefName,title,url
gh pr list --state open --limit 100
```

Erwartet: PR #56 `OPEN/DRAFT/MERGEABLE`, Head `728f9b4…`, Base-Oid `aad46dd…`; PR #57 `OPEN/DRAFT`, Head `8cfebcf…`; **genau zwei** offene PRs.

**Step 2: Divergenz zu master messen**

```bash
git -C "$WT" rev-list --left-right --count origin/master...728f9b4fb2339d9f1d6a49b4c5d1dfe830843141
```

Erwartet: `0	<n>` — null Commits hinter master. Ist die linke Zahl > 0, ist die CI-Evidenz gegen einen veralteten Basisstand gelaufen; das ist ein eigener Befund.

**Step 3: Checks auf genau diesem Head**

```bash
gh pr checks 56
gh run view 31242966385 --json headSha,conclusion,event
```

Erwartet: elf `pass`, `Supabase Preview` = `skipping`; `headSha` des Laufs **identisch** mit dem PR-Head. Weicht der `headSha` ab, beweist der Lauf nichts über den geprüften Stand — harter Blocker für Task 16.

**Step 4: Jira live lesen (nicht aus dem Auftrag übernehmen)**

Über die Atlassian-MCP-Tools (`mcp__claude_ai_Atlassian__getJiraIssue`) Status, Priorität, Sprint und Verknüpfungen von **EYT-136, EYT-109, EYT-110** abrufen; zusätzlich **EYT-14** und **EYT-48** für die Follow-up-Routung in Task 18.
Suche nur mit `issues`-Modus, **nie** mit `count` — der Zählmodus hat in diesem Projekt schon falsch berichtet.
Sind die Tools nicht verfügbar: in `$NOTES` und im Endpaket als `INACCESSIBLE` markieren und den PO-Stand ausdrücklich als *nicht selbst verifiziert* kennzeichnen.

**Step 5: Confluence live lesen**

PRD v1.4, Sprint-5-Seite (`S5-REQ-05`, `S5-REQ-07`) und Softwaredokumentation abrufen. Nicht erreichbar → `INACCESSIBLE`.

**Step 6: Ergebnis festhalten**

Alle Werte tabellarisch in `$NOTES` unter `## 1. LIVE SOURCE STATE`. Jede Abweichung vom Auftragstext ausdrücklich als *Abweichung* markieren.

**Kein Commit.**

---

### Task 2: Repository-Instruktionen lesen und Drift notieren

**Files:**
- Lesen: `$WT/CLAUDE.md`
- Lesen: `$WT/docs/handoff/AGENT_HANDOFF_v1.3.md`

**Step 1: Beide Dateien vollständig lesen.**

**Step 2: Ruleset-Drift serverseitig messen**

```bash
cd "$WT" && bash scripts/verify-branch-protection.sh
```

Das Skript ist read-only (`GET /repos/{owner}/{repo}/rules/branches/{branch}`).
`CLAUDE.md` behauptet `FAIL AC3 — fehlende Pflichtchecks: read-through`. **Serverseitiger Live-Zustand schlägt die Dokumentation.** Was das Skript ausgibt, gilt.

**Step 3: Drift einordnen, nicht beheben**

In `$NOTES` unter `## 19. DOC DRIFT`. Prüfen: erzeugt der Drift einen *Security*-Fehler im EYT-136-Slice? Wenn nein → reine `DOC_DRIFT`-Meldung, **keine Korrektur in diesem PR** (kosmetische Änderungen entwerten den grünen Head).

**Kein Commit.**

---

### Task 3: Diff vollständig inventarisieren und Scope-Verdikt fällen

**Files:** nur lesend

**Step 1: Dateiliste gegen die Erwartung**

```bash
git -C "$WT" diff --stat aad46ddca12abf1c4862e70248f61978dcce96e7..728f9b4fb2339d9f1d6a49b4c5d1dfe830843141
```

Erwartet: **13** Dateien, exakt die im Auftrag gelisteten.

**Step 2: Jede Datei einzeln einem EYT-136-Zweck zuordnen**

Tabelle in `$NOTES`: Datei → Zweck → gehört zu EYT-136 `JA/NEIN`.
Für `.github/workflows/ci.yml` (+25/-1) besonders genau: **ein CI-Job-Zusatz muss laut CLAUDE.md sowohl `scripts/setup-branch-protection.sh` als auch `scripts/verify-branch-protection.sh` anfassen**, sonst wird der neue Job stillschweigend optional. Prüfen, ob hier überhaupt ein *Job* hinzukam oder nur Schritte innerhalb `db-gates`/`auth-journey`:

```bash
git -C "$WT" diff aad46dd..728f9b4 -- .github/workflows/ci.yml
rg -n '^  [a-z-]+:' "$WT/.github/workflows/ci.yml" | head -30
```

Kam ein neuer Job-Key hinzu, ohne dass beide Skript-Listen angepasst wurden → **`PR_P2`** (der Job kann nie blocken, und `verify-branch-protection.sh` bricht mit Drift-Fehler ab).

**Step 3: Commits des Branches lesen**

```bash
git -C "$WT" log --oneline aad46dd..728f9b4
```

Jede Commit-Message muss `EYT-136` tragen. Fremde Tickets im Branch → Scope-Befund.

**Step 4: Verdikt `PASS`/`FAIL` nach `$NOTES` unter `## 3. SCOPE VERDICT`.**

**Kein Commit.**

---

### Task 4: Migration 0017 zeilenweise gegen ihre Behauptungen prüfen

**Files:**
- Lesen: `$WT/supabase/migrations/20260807220000_0017_planning_write_channel_boundary.sql`
- Lesen (Vorzustand): `$WT/supabase/migrations/*_0010_*.sql`, `*_0015_*.sql`, `*_0016_*.sql`, `*_0002_tenancy.sql`, `*_0003_*.sql`

**Step 1: 0017 vollständig lesen** — jede Anweisung, nicht die Kommentare.

**Step 2: Vorzustand jeder angefassten Berechtigung rekonstruieren**

```bash
rg -n 'assignments|plan_versions' "$WT"/supabase/migrations/*.sql | rg -i 'grant|revoke|policy'
```

Für **jede** `grant`/`revoke`/`create policy`/`drop policy` in 0017 eine Zeile in `$NOTES`:

| Objekt | vorher (Migration + Zeile) | nachher (0017 Zeile) | legitimer Verbraucher | Begründung | Risiko | Verdikt |

**Step 3: Die vier Behauptungen einzeln nachweisen**

- `assignments`: UPDATE **und** DELETE für `authenticated` entzogen, zugehörige RLS-Policies entfernt?
- `assignments` INSERT: Spaltenliste reduziert — und zwar auf **genau die Spalten, die der Produktionscode schreibt** (Gegenprobe in Task 5).
- `assignments` INSERT-`with check`: enthält es **alle drei** Bedingungen — `app.is_runtime_channel()`, Same-Tenant, `planning.write`?
- `plan_versions` INSERT: zusätzlich `published_at is null`? Tote DELETE-Policy entfernt?

**Step 4: Fehlt eine Klausel im `using` *oder* im `with check`?**

Präzedenzfall aus `CLAUDE.md`/EYT-107: die Kanalbedingung gehört in **beide** Klauseln; ein sperrender Lesezugriff (`for share`) zieht die `using`-Klausel der UPDATE-Policy heran. Fehlt sie irgendwo, ist das ein konkreter Befund, kein Stilproblem.

**Step 5: Forward-only und Datenverlust prüfen**

```bash
rg -n -i 'drop table|drop column|truncate|delete from' "$WT/supabase/migrations/20260807220000_0017_planning_write_channel_boundary.sql"
```

Erwartet: **keine Treffer** außer `drop policy` (Policies sind kein Datenverlust).
Dateiname prüfen: `<timestamp>_0017_<slug>.sql` — Nummer setzt die Sequenz korrekt fort.

**Step 6: Keine zweite Geschäftslogik in SQL**

Prüfen, ob 0017 fachliche Regeln *dupliziert*, die bereits in `apps/api/src/modules/planning/` liegen. Grenze: RLS/Grants = Defense-in-Depth (erlaubt); Neuberechnung von Planungsregeln in SQL = Duplikat (Befund).

**Step 7: Ergebnisse nach `$NOTES` unter `## 4. MIGRATION REVIEW`.**

**Kein Commit.**

---

### Task 5: Legitime Produktionsverbraucher der entzogenen Rechte suchen

**Files:** nur lesend, `$WT/apps/api/src/`, `$WT/apps/web/`

**Step 1: Schreibzugriffe auf `assignments` im Produktionscode finden**

```bash
rg -n -i 'assignments' "$WT/apps/api/src" --type ts
rg -n -i 'update\s+.*assignments|delete\s+from\s+assignments' "$WT/apps/api/src" --type ts
```

Ein Treffer für UPDATE/DELETE auf `assignments` im Produktionspfad wäre ein **`PR_P1`**: die Migration bricht dann einen legitimen Command (Failure-Mode „zu starke Grenze").

**Step 2: INSERT-Spaltenliste gegen den echten Repository-Code**

```bash
rg -n 'insert into .*assignments' -A 12 "$WT/apps/api/src" --type ts
rg -n 'insert into .*plan_versions' -A 12 "$WT/apps/api/src" --type ts
```

Jede vom Code geschriebene Spalte **muss** im 0017-Grant stehen. Eine fehlende Spalte = Laufzeitfehler nach dem Merge. Eine überflüssige Spalte = unnötige Angriffsfläche (mindestens `OBSERVATION`).

**Step 3: Publish-Pfad gegenprüfen**

```bash
rg -n 'published_at|published_by' "$WT/apps/api/src/modules/planning" --type ts
```

`plan_versions`-INSERT verlangt jetzt `published_at is null`. Schreibt irgendein Command `published_at` bereits beim INSERT, kollidiert das → Befund.

**Step 4: Web-Seite gegenprüfen** — `apps/web` darf ohnehin nicht direkt an die DB; ein Fund hier wäre ein Architekturbruch.

**Step 5: Ergebnisse nach `$NOTES`, Spalte „legitimer Verbraucher" in Task 4 auffüllen.**

**Kein Commit.**

---

### Task 6: Migrationen 0001–0016 auf Unverändertheit prüfen

**Step 1:**

```bash
git -C "$WT" diff --name-status aad46dd..728f9b4 -- supabase/migrations/
```

Erwartet: **genau eine** Zeile, Status `A`, Datei `20260807220000_0017_planning_write_channel_boundary.sql`.
Jedes `M` oder `D` an einer gemergten Migration verletzt die Append-only-Regel → **`PR_P1`**.

**Step 2:** Ergebnis nach `$NOTES`.

**Kein Commit.**

---

### Task 7: Riegel A vorbereiten — die sechs Data-API-Angriffe im Testcode identifizieren

**Files:**
- Lesen: `$WT/supabase/tests/0012_planning_data_api_boundary.sql`
- Lesen: `$WT/apps/web/e2e/auth-journey/journey.pwtest.ts`
- Lesen: `$WT/apps/web/e2e/auth-journey/eyt136-member-an.sql`, `eyt136-member-aus.sql`

**Step 1: Die sechs Angriffe im Code lokalisieren**

Erwartet laut Auftrag: Owner-mit-`planning.write` (POST assignments, POST plan_versions) und Member (POST/PATCH/DELETE assignments, POST plan_versions).

```bash
rg -n -i 'POST|PATCH|DELETE|201|200|403|42501' "$WT/apps/web/e2e/auth-journey/journey.pwtest.ts" | rg -i 'assignment|plan_version'
```

**Step 2: Den greppbaren Logmarker aus dem Quelltext ableiten — nicht raten**

```bash
rg -n '\[.*\]' "$WT/apps/web/e2e/auth-journey/journey.pwtest.ts" | rg -i 'data-api|eyt136|attack|angriff'
rg -n 'executed=|passed=|skipped=' "$WT/apps/web/e2e/auth-journey/journey.pwtest.ts"
```

Den gefundenen Marker in `$NOTES` notieren — Task 8 grept damit die echten Logs.

**Step 3: Nicht-Vakuosität des Owner-Actors prüfen**

Der Owner **muss** `planning.write=true` haben, sonst beweist ein grüner Angriffstest nur „wer kein Recht hat, darf nichts".

```bash
rg -n -i 'planning.write|owner' "$WT/apps/web/e2e/auth-journey/eyt136-member-an.sql" "$WT/apps/web/e2e/auth-journey/eyt136-member-aus.sql"
```

Beweist der Test **vor** dem Angriff, dass der Owner das Recht wirklich trägt? Wenn nicht → `PR_P2` (Testaussage vakuös).

**Step 4: Ergebnisse nach `$NOTES` unter `## 5. DATA-API ATTACK REVIEW` (Spalten „welcher Riegel greift", „nicht-vakuös").**

**Kein Commit.**

---

### Task 8: Riegel A belegen — Baseline-Rot (PR #57) und Final-Grün (PR #56) aus echten Logs

**Files:** `$LOGS/` (Downloads), `$NOTES`

**Step 1: Baseline-Lauf von PR #57 finden**

```bash
gh pr checks 57
gh run list --branch proof/eyt-136-red-baseline --limit 10 --json databaseId,headSha,conclusion,status
```

Der Baselinelauf muss auf `8cfebcf…` liegen (oder dem live gemessenen #57-Head).

**Step 2: Baseline-Log ziehen und die sechs 201/200 belegen**

```bash
gh run view <BASELINE_RUN_ID> --json jobs -q '.jobs[] | "\(.databaseId)\t\(.name)\t\(.conclusion)"'
gh run view --job <JOB_ID> --log > "$LOGS/baseline-<job>.log"
rg -n '<Marker aus Task 7>' "$LOGS/baseline-<job>.log"
```

Erwartet: alle sechs Angriffe **erfolgreich** (201/200) — der Rotnachweis.
**Wichtig:** Brach der Baselinelauf vorher an pgTAP ab, beweist er die späteren Verhaltensfälle nicht. Prüfen, ob der Job den Angriffsschritt überhaupt erreicht hat.

**Step 3: Final-Log ziehen (Run 31242966385) und dieselben sechs als blockiert belegen**

```bash
gh run view --job 93066839148 --log > "$LOGS/final-auth-journey.log"   # auth-journey
gh run view --job 93066839173 --log > "$LOGS/final-db-gates.log"       # db-gates
rg -n '<Marker aus Task 7>' "$LOGS/final-auth-journey.log" "$LOGS/final-db-gates.log"
```

Erwartet: dieselben sechs Angriffe abgewiesen (403 bzw. SQLSTATE 42501).

**Step 4: Mehrdeutigkeit von 42501 auflösen**

`42501` bedeutet **Spaltenrecht ODER RLS-Verletzung**. Wo zwei Riegel schützen, reicht der Verhaltenstest nicht — es braucht zusätzlich eine `has_table_privilege`/`has_column_privilege`-Aussage.

```bash
rg -n 'has_table_privilege|has_column_privilege|has_any_column_privilege' "$WT/supabase/tests/0012_planning_data_api_boundary.sql"
```

Fehlt sie für die entzogenen Rechte → `PR_P2` (der Test kann nicht unterscheiden, welcher Riegel griff).

**Step 5: Für jeden der sechs Angriffe eine vollständige Zeile in `$NOTES`:**
Baseline-SHA/Run → vorheriges Ergebnis → finaler SHA/Run → finales Ergebnis → greifender Riegel → nicht-vakuös `YES/NO`.

**Kein Commit.**

---

### Task 9: Riegel B belegen — echtes Recht ohne Kanal, echter Kanal ohne Recht

**Files:**
- Lesen: `$WT/apps/api/test/planning-write.integration.test.ts` (+1092/-64 — die größte Änderung im PR)

**Step 1: Beide Riegel im Testcode getrennt lokalisieren**

- **A** (Kanal): PostgREST/`authenticated` **mit** `planning.write` → muss scheitern.
- **B** (Recht): `session_user=easytree_app`, echter Runtime-Command, **ohne** `planning.write` → muss ebenfalls scheitern.

```bash
rg -n -i 'planning\.write|is_runtime_channel|session_user' "$WT/apps/api/test/planning-write.integration.test.ts"
```

**Step 2: Prüfen, ob Riegel B mehr als einen behavioural Witness hat**

Das Grant-Inventar räumt selbst ein, dass der Rechte-Riegel nur **einen** Verhaltenszeugen hat (P2 Nr. 3 im Auftrag). Zählen, wie viele unabhängige Testfälle B tatsächlich prüfen, und das Ergebnis in Task 18 neu klassifizieren — nicht die vorhandene Bewertung übernehmen.

**Step 3: Ist einer der beiden Riegel gar nicht belegt → EYT-136 ist nicht fertig** (Auftrag Abschnitt 10). Das wäre `PR_P1`.

**Step 4: Ergebnis nach `$NOTES`.**

**Kein Commit.**

---

### Task 10: Runtime-Positivpfad im finalen CI-Log belegen

**Step 1: Die Kanalzeile im Log suchen**

```bash
rg -n 'session_user=|current_user=|runtime_channel=' "$LOGS/final-db-gates.log"
```

Erwartet: `session_user=easytree_app`, `current_user=authenticated`, `runtime_channel=true`.

**Step 2: Die Zählzeile suchen**

```bash
rg -n '\[planning-write\].*executed=' "$LOGS/final-db-gates.log"
```

Erwartet: `executed=14 passed=14 skipped=0`.
**`skipped` > 0 ist ein harter Blocker** — die Suiten fallen laut Projektregel geschlossen, jeder Skip in einem Pflichtgate ist ein Befund.

**Step 3: Prüfen, dass der legitime Command wirklich *schreibt***

Eine Grenze, die alles blockiert, ist kein Sicherheitserfolg. Im Log muss ein erfolgreicher Entwurfs-/Assignment-Schreibvorgang stehen, nicht nur abgewiesene.

**Step 4: Ergebnis nach `$NOTES` unter `## 6. RUNTIME POSITIVE PATH`.**

**Kein Commit.**

---

### Task 11: Testharness-Rollentrennung prüfen

**Files:** `$WT/apps/api/test/planning-write.integration.test.ts`

**Step 1: Die drei Verbindungen im Code identifizieren**

- Admin/Observer (`postgres`): Fixtures, Cleanup, Counts, persistente Nachprüfung.
- Runtime (`easytree_app`): echter Command, Kanalnachweis, Permission-Verhalten.
- PostgREST/Auth-Actor: Data-API-Angriffe.

```bash
rg -n 'easytree_app|postgres|createPool|new Pool|Client\(' "$WT/apps/api/test/planning-write.integration.test.ts"
```

**Step 2: Vermischung suchen — das ist der eigentliche Prüfpunkt**

Stellt der Test seinen Command auf `easytree_app` um, **müssen alle rohen Zählabfragen gleichzeitig auf die Observer-Verbindung wandern**, sonst schlägt 42501 zu. Umgekehrt darf **Security-Verhalten niemals** über die Observer-Verbindung gemessen werden — nur Fixture-DML darf privilegiert sein.

**Step 3: Nach Test-Bequemlichkeitsrechten fahnden**

```bash
rg -n -i 'grant ' "$WT/apps/api/test/planning-write.integration.test.ts" "$WT/supabase/tests/"*.sql
```

Ein `grant`, der nur existiert, damit ein Test einfacher wird, ist ein **`PR_P2`** — er weicht genau die Grenze auf, die der PR zieht.

**Step 4: Netto-Zählfalle prüfen**

INSERT+DELETE heben sich in einer Differenzzählung auf. Der Test muss den Zustand **nach jedem einzelnen Angriff** prüfen, nicht einmal am Ende.

```bash
rg -n -i 'count\(|rowCount|toBe\(0\)|toHaveLength' "$WT/apps/api/test/planning-write.integration.test.ts"
```

**Step 5: Ergebnis nach `$NOTES`.**

**Kein Commit.**

---

### Task 12: Temporäre USER_B-Membership prüfen

**Files:** `$WT/apps/api/test/planning-write.integration.test.ts`, `$WT/apps/web/e2e/auth-journey/eyt136-member-*.sql`

**Step 1: Acht Zusicherungen einzeln prüfen** (jede mit Datei:Zeile in `$NOTES`):

1. Beta-Membership bleibt unangetastet.
2. Keine neue Auth-Identität erzeugt.
3. Keine direkte `auth.users`-Zeile.
4. Keine direkte `auth.identities`-Zeile.
5. Alpha-Membership nur eng temporär.
6. Cleanup läuft **auch im Fehlerfall** (`finally`/`afterEach`, nicht am Happy-Path-Ende).
7. Cleanup wird **nachgeprüft**, nicht nur ausgeführt.
8. Vor Nutzung bewiesen: Membership aktiv, Tenant Alpha sichtbar, `planning.write` in Alpha = `false`, in Beta = `true`.

```bash
rg -n -i 'auth\.users|auth\.identities|memberships|user_b|USER_B' "$WT/apps/api/test/planning-write.integration.test.ts" "$WT/apps/web/e2e/auth-journey/"*.sql
rg -n 'finally|afterEach|afterAll' "$WT/apps/api/test/planning-write.integration.test.ts"
```

**Step 2: Punkt 8 ist der Kern** — ohne ihn kann der Test am *falschen* Riegel grün werden (er misst dann Tenant-Isolation statt Rechteprüfung). Fehlt er → `PR_P2`.

**Kein Commit.**

---

### Task 13: Aussagenerhalt in 0004 / 0006 / 0007 — Drop-Inventar

**Files:**
- `$WT/supabase/tests/0004_core_domain.sql` (+8/-0)
- `$WT/supabase/tests/0006_planning_invariants.sql` (+131/-18)
- `$WT/supabase/tests/0007_temporal_and_idempotency.sql` (+45/-3)

**Step 1: Jede entfernte/geänderte Zeile sichtbar machen**

```bash
git -C "$WT" diff aad46dd..728f9b4 -- supabase/tests/0004_core_domain.sql supabase/tests/0006_planning_invariants.sql supabase/tests/0007_temporal_and_idempotency.sql
```

**Step 2: Vollständiges Drop-Inventar erstellen** — jede der 21 entfernten Zeilen (`-18`, `-3`, `-0`) klassifizieren als `keep` / `move` / `drop`. Ein „regeneriert, aber Historie erhalten" ohne Inventar hat in diesem Projekt schon Evidenz gelöscht.

**Step 3: Für jede geänderte Aussage drei Fragen beantworten**

1. Was bewies sie vorher?
2. Warum kann sie nach 0017 nicht mehr im alten Ausführungskanal laufen?
3. Wo wird dieselbe fachliche Invariante **heute** bewiesen (Datei:Zeile)?

**Step 4: Die kritische Verschiebung suchen**

```bash
git -C "$WT" diff aad46dd..728f9b4 -- supabase/tests/ | rg -n '^[-+].*(set role|set local role|authenticated|postgres|session authorization)'
```

Ein Test, der schlicht von `authenticated` auf `postgres` umgezogen wurde, hat seine Security-Aussage **verloren** — Fixture-DML darf privilegiert sein, Security-Verhalten nicht. Das wäre `PR_P2`.
Beachte: pgTAP kann `session_user` nicht wechseln (`SET SESSION AUTHORIZATION` braucht Superuser) — Kanal-Zusicherungen sind dort nur *negativ* prüfbar. Ein positiver Kanalbeweis muss deshalb in der Integrationssuite liegen, nicht in pgTAP.

**Step 5: Tabelle nach `$NOTES` unter `## 7. EXISTING TEST PRESERVATION` (Spalte „verloren YES/NO").**

**Kein Commit.**

---

### Task 14: Security-Definer-Fall unabhängig prüfen

**Files:** `$WT/supabase/tests/0006_planning_invariants.sql`, `$WT/supabase/migrations/*_0015_*.sql`/`*_0016_*.sql`, `$WT/apps/api/test/planning-write.integration.test.ts`

**Step 1: Strukturprüfung von Verhaltensprüfung trennen**

```bash
rg -n 'prosecdef|security definer|security invoker' "$WT/supabase/tests/" "$WT/supabase/migrations/"
```

Ein `pg_proc.prosecdef`-Check ist **strukturell** und darf nicht als Verhaltensbeweis gezählt werden.

**Step 2: Die behavioural Kette auf Vollständigkeit prüfen**

Alle sechs Vorbedingungen müssen im Test hergestellt **und** vorher geprüft sein: Parent published · `planning.write` vorhanden · `planning.publish` temporär entzogen · normale SELECT-Sichtbarkeit vorhanden · `FOR SHARE` als Invoker sähe die Zeile nicht · Security Definer findet sie trotzdem → Insert scheitert mit **fachlichem Trigger-Fehler** (nicht mit 42501!).

```bash
rg -n -i 'for share|reject_assignment_in_published_plan|planning\.publish' "$WT/supabase/tests/0006_planning_invariants.sql" "$WT/apps/api/test/planning-write.integration.test.ts"
```

**Step 3: Nicht-Vakuosität** — wird vor dem Angriff bewiesen, dass die Zeile per normalem SELECT **sichtbar** ist? Ohne das könnte der Test auch bei fehlendem Parent grün sein.

**Step 4: Rechte-Restauration** — wird `planning.publish` garantiert (auch im Fehlerfall) zurückgegeben?

**Step 5: Gegenmutation zuordnen** — welcher der PRs #58–#68 hat `security definer → security invoker` mutiert, und ist der Zieltest dort **tatsächlich gelaufen** (Task 15)?

**Step 6: Ergebnis nach `$NOTES` unter `## 8. SECURITY-DEFINER REVIEW`.**

**Kein Commit.**

---

### Task 15: Gegenmutationsmatrix gegen die echten Runs — alle elf PRs

**Step 1: Alle Gegenmutations-PRs inventarisieren**

```bash
for n in 58 59 60 61 62 63 64 65 66 67 68; do
  gh pr view $n --json number,title,headRefName,headRefOid,state,mergedAt
done
```

Erwartet: alle `CLOSED`, alle `mergedAt=null`. Ein gemergter Wegwerf-PR wäre ein schwerer Befund.

**Step 2: Zu jedem PR den zugehörigen Lauf finden**

```bash
gh run list --branch gm/eyt-136-<name> --limit 5 --json databaseId,headSha,conclusion,status
```

**Step 3: Für jede Mutation den Zieltest im Log tatsächlich nachweisen**

```bash
gh run view --job <DB_GATES_JOB_ID> --log > "$LOGS/gm-<name>.log"
rg -n '<Name des Zieltests>' "$LOGS/gm-<name>.log"
```

Drei Fallen, die hier je einzeln zu prüfen sind:

- **`skipped` zählt nicht.** Ein übersprungener Test ist kein Rotnachweis.
- **Ein Job, der vorher an pgTAP abbrach, beweist keinen späteren Verhaltensfall.** Prüfen, ob der Lauf den Zieltest überhaupt *erreicht* hat.
- **Gedachte ≠ ausgeführte Gegenmutation.** Nur eingespielte, gemessene, zurückgenommene Mutationen zählen. Die `-iso`-Varianten (#65, #66, #67) existieren offenbar genau deshalb — prüfen, ob sie den Abbruch transparent lösen.

**Step 4: Matrix nach `$NOTES` unter `## 9. COUNTERMUTATION MATRIX`:**

| Mutation | SHA | Run | Zieltest wirklich ausgeführt? | Ergebnis | Aussage |

**Keine gezählte Mutation ohne ausgeführten Zieltest.** Mutationen ohne Beleg werden aus der Matrix gestrichen und der Verlust benannt.

**Step 5: Countermutation-Code darf nicht im Feature-PR stehen**

```bash
git -C "$WT" diff aad46dd..728f9b4 | rg -n -i 'GEGENMUTATION|WEGWERF|gm[0-9]|TODO|FIXME|TOOL_GAP|offen'
```

Erwartet: keine Treffer im Code. Treffer → `PR_P2`.

**Kein Commit.**

---

### Task 16: CI-Gate auf exakt dem geprüften Head

**Step 1:**

```bash
gh pr checks 56
gh run view 31242966385 --json headSha,conclusion
```

**Step 2: Tabelle mit allen elf Required Checks** (`format`, `lint`, `typecheck`, `unit-tests`, `build-api`, `build-web`, `secret-scan`, `db-gates`, `read-through`, `web-smoke`, `auth-journey`) → Status → SHA, nach `$NOTES` unter `## 10. CI`.

**Step 3: `db-gates` muss vollständig durchgelaufen sein, nicht nur bis pgTAP.** Im Log alle Gate-Zeilen mit `mode=required … skipped=0` einzeln bestätigen:

```bash
rg -n 'mode=required' "$LOGS/final-db-gates.log"
```

**Step 4: Abschlusszeile formulieren:** `11/11 REQUIRED CHECKS ON EXACT REVIEWED HEAD: YES/NO`.
`Supabase Preview` (`skipping`) ist **kein** Required Check und zählt nicht mit — aber ausdrücklich erwähnen, weil dieser Check beim Merge nach master die Migration ins Produktivprojekt einspielt.

**Kein Commit.**

---

### Task 17: Dokumentation, Secret-/Auth-Gate und Produktionswirkung

**Files:**
- `$WT/docs/reviews/2026-08-07-data-api-grant-inventar.md`
- `$WT/docs/reviews/2026-08-08-eyt-136-kanalmatrix.md`
- `$WT/docs/runbooks/planning-publish.md`

**Step 1: Jede Behauptung über Produktion/Grants/Verbraucher/CI/Gegenmutationen/Runtime-Rollen auf Beleg prüfen**

```bash
rg -n -i 'gemessen|produktion|productive|nachgewiesen|belegt' "$WT/docs/reviews/2026-08-07-data-api-grant-inventar.md" "$WT/docs/reviews/2026-08-08-eyt-136-kanalmatrix.md" "$WT/docs/runbooks/planning-publish.md"
```

Regeln: kein „gemessen", wenn nur Quelltext gelesen wurde. Kein „Produktion", wenn nur CI lief.
Zusätzlich: **Supabase-Default-Privilegien wurden in diesem Projekt nie entzogen** — Grants sind breiter als die Migrationen. Eine Inventaraussage, die nur `information_schema` gelesen hat, ist kein Beleg; nur `has_table_privilege` misst.

**Step 2: Stale SHAs in Dokumenten suchen**

```bash
rg -n '[0-9a-f]{7,40}' "$WT/docs/reviews/"*.md | rg -v '728f9b4'
```

Ein Dokument, das den *eigenen* Head-SHA nennt, wird durch den eigenen Commit zwangsläufig stale — das ist ein Befund, aber gegebenenfalls nur `OBSERVATION`.

**Step 3: Secret-/Auth-Gate belegen**

```bash
git -C "$WT" diff --name-only aad46dd..728f9b4 | rg -i '\.env|\.pem|\.key|secret'
git -C "$WT" diff aad46dd..728f9b4 | rg -n -i 'service_role|SUPABASE_SERVICE|eyJ[A-Za-z0-9_-]{20,}'
rg -n -i 'auth\.users|auth\.identities' "$WT/apps/web/e2e/auth-journey/"*.sql "$WT/supabase/migrations/20260807220000_0017"*.sql
```

Fünf Aussagen nach `$NOTES` unter `## 13. SECRET / AUTH STATUS`, jede `YES/NO` mit Beleg. Lokale synthetische Supabase-CI-Identitäten sind ausdrücklich **von** produktiven Writes zu unterscheiden — den Unterschied benennen, nicht verwischen.

**Step 4: Produktionswirkung beschreiben (`## 14. PRODUCTION EFFECT`)**

Was änderte ein späterer Merge von 0017 auf der gehosteten Kunden-DB *tatsächlich*? Beachten: die Supabase-GitHub-Integration spielt beim Merge nach master Migrationen ins Produktivprojekt ein — **Merge = Produktivmigration**. Ausdrücklich festhalten: 0017 ist bisher **nicht** produktiv angewendet.

**Step 5: Rollback/Forward-Fix (`## 15. ROLLBACK / FORWARD FIX`)**

Konkreter, datenverlustfreier Weg — ausschließlich als **neue Folgemigration** `0018`, niemals als Edit an 0017.

**Kein Commit.**

---

### Task 18: P2-Governance — die sechs Punkte unabhängig neu klassifizieren

**Step 1: Die sechs Punkte im Grant-Inventar im Original lesen** (nicht aus dem Auftragstext übernehmen):

```bash
rg -n -i 'P1|P2|P3' "$WT/docs/reviews/2026-08-07-data-api-grant-inventar.md"
```

**Step 2: Jeden Punkt genau einer Klasse zuordnen** — mit Begründung, warum er **innerhalb** oder **außerhalb** der EYT-136-Grenze liegt:

`PR_P1` (akuter Defekt der Grenze, Merge verboten) · `PR_P2` (Defekt im Scope, Merge verboten bis behoben) · `ROUTED_FOLLOW_UP` (real, aber belegt außerhalb) · `OBSERVATION` (kein Arbeitsauftrag).

Die sechs: (1) breitere Supabase-Default-Grants · (2) selbstzugeschriebene `audit_events` · (3) nur ein behavioural Witness für den Rechte-Riegel · (4) `idempotency_records`-INSERT nicht kanalgebunden · (5) `outbox_messages` nicht kanalgebunden · (6) offene SELECT-Fläche.

**Punkt 3 ist der einzige, der den Kern von EYT-136 direkt betrifft** — Riegel B ist tragende Zusicherung des Tickets. Task 9 hat gezählt; hier entscheiden. Nicht herunterstufen, um das Gate grün zu bekommen; aber auch keinen klar externen Befund künstlich in den Slice ziehen.

**Step 3: Routung belegen, nicht behaupten**

Für SELECT/Subjektmodell → EYT-14 und für Outbox/Worker → EYT-48 den **tatsächlichen Ticket-Scope live lesen** (Atlassian MCP) und prüfen, ob er den Security-Befund wirklich abdeckt. Deckt er ihn nicht ab → exakter Ticketentwurf (Titel, Beschreibung, AC) in `$NOTES`. **Jira nicht verändern.**

**Step 4: Ergebnis nach `$NOTES` unter `## 12. P2 GOVERNANCE RESOLUTION`.**

**Step 5: Governance-Konflikt offenlegen**

Jira EYT-136 verlangt „unabhängiges Code Review ohne offenen P1/P2". Bleibt nach der Neuklassifikation ein `PR_P2` stehen, ist das Ergebnis `BLOCKED` — **die beiden Dinge nicht semantisch passend machen.**

**Kein Commit.**

---

### Task 19: Gegenposition, Failure-Modes, Falsifikation

**Step 1: Gegenposition stahlmannen (`## 16. STRONGEST COUNTERPOSITION`)**

> EYT-136 baut für eine kleine Grant-/RLS-Änderung einen sehr großen Test- und Dokumentationsapparat auf und koppelt Schreibfähigkeit an `session_user = easytree_app`. Damit steigt die Gefahr, den Testharness statt die echte Architektur zu prüfen, und ein künftiger Pooler-/Runtime-Wechsel wird unnötig blockiert.

Prüfen, ob der Stand sie beantwortet: kleine eigentliche Migration (186 Zeilen gegen 2026 Zeilen Test/Doku — das Verhältnis benennen, nicht verschweigen) · echter Runtime-Positivpfad · echter PostgREST-Negativpfad · Pooler-Gates · fail-loud · dokumentierter Forward-Fix · keine duplizierte Geschäftslogik.

**Der Pooler-Punkt ist konkret prüfbar:** Der Wechsel auf den Supavisor-Transaktionspooler macht `session_user` zu `postgres.<tenant>` und bricht Publishing. Prüfen, ob 0017 diese Kopplung **verschärft** und ob das im Runbook dokumentiert ist.

**Step 2: Beide Failure-Mode-Ketten prüfen (`## 17. FAILURE-MODE CHECK`)**

- **Zu schwach:** Data-API-Bypass bleibt → veröffentlichte Planung auf falscher Basis → EYT-109 materialisiert Kosten daraus → EYT-110 exportiert einen scheinbar vertrauenswürdigen falschen Kostenstand.
- **Zu stark:** legitime Commands blockiert → Entwurf/Publish kaputt → EYT-109 ohne verlässliche Quelle → Sprint Goal blockiert.

**Step 3: Falsifikationsliste abarbeiten (`## 18. FALSIFICATION CHECK`)**

Die zehn Widerlegungskriterien aus Abschnitt 25 des Auftrags einzeln durchgehen und je notieren: geprüft `JA/NEIN` + wo. Ein nicht geprüftes Kriterium darf nicht als erfüllt gelten.

**Kein Commit.**

---

### Task 20: NUR bei belegtem `PR_P1`/`PR_P2` — kleinster reversibler Fix

> **Diese Task wird übersprungen, wenn Task 18 keinen In-Scope-Defekt belegt hat.** Ein No-Change-Review ist ein ausdrücklich valides Ergebnis. Keine Änderung, „um etwas gemacht zu haben".

**Step 1: Root Cause exakt beschreiben** — Datei:Zeile, Mechanismus, warum genau das die Grenze verletzt.

**Step 2: Kleinsten reversiblen Fix bestimmen.** Keine Scope-Ausweitung. Betrifft er die Migration → **neue Migration `0018`**, niemals ein Edit an 0017.

**Step 3: Gegenmutation *vorher* benennen** — welche konkrete Mutation macht den neuen Test rot? Die Gegenmutation muss **ausgeführt und gemessen** werden, nicht nur gedacht, und gehört auf einen Wegwerf-PR, nicht auf #56.

**Step 4: Fix im Review-Worktree umsetzen und lokal prüfen**

```bash
cd "$WT" && pnpm format:fix && pnpm lint && pnpm typecheck
```

SQL kann auf diesem Mac nicht laufen — Supabase-Stack ist hier nicht startbar. **CI ist die erste Stelle, an der die Migration je ausgeführt wird.** Das im Bericht so benennen.

**Step 5: Ergebnis der Ersetzung greppen, nicht dem Exit-Code trauen**

```bash
rg -n '<neu eingefügtes Muster>' "$WT/<geänderte Datei>"
```

**Step 6: Nur benannte Dateien stagen, dann prüfen**

```bash
git -C "$WT" add <exakte Pfade>
git -C "$WT" diff --cached --name-only
```

Erwartet: **exakt** die beabsichtigten Dateien. Kein `git add .`, kein `git add docs/`.

**Step 7: Commit + Push auf den PR-Branch**

```bash
git -C "$WT" commit -m "fix(db): EYT-136 — <präzise Beschreibung des Defekts>"
git -C "$WT" push origin HEAD:fix/eyt-136-planning-data-api-boundary
```

**Step 8: Neuen Head aufnehmen und volle CI abwarten**

```bash
git -C "$WT" rev-parse HEAD
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree <NEUER_SHA> 2400
gh pr checks 56
```

`gh-ci-wait`: Exit 0 = alle grün, 1 = Fehler, 2 = Timeout. **Keine handgebauten Poll-Schleifen.**

**Step 9: Alte Evidenz für ungültig erklären.** Der Lauf `31242966385` gilt ab jetzt **nicht** mehr als Merge-Gate. Wurde Security-Semantik geändert, sind Task 8, 9 und 15 auf dem neuen Head zu wiederholen.

---

### Task 21: Finaler Live-Check und Abschlusspaket

**Step 1: Live-Check unmittelbar vor der Ausgabe**

```bash
git -C "$WT" fetch origin --prune
git -C "$WT" status --short
git -C "$WT" rev-parse HEAD
git -C "$WT" rev-parse origin/master
gh pr view 56 --json state,isDraft,mergeable,headRefOid,baseRefOid
gh pr checks 56
```

Ohne eigenen Commit: `HEAD` **muss** dem geprüften PR-Head entsprechen. Mit Commit: nur der neue SHA zählt.
Hat sich der Head durch Fremdeinwirkung geändert, ist das gesamte Review hinfällig — das sagen, nicht überschreiben.

**Step 2: Das 21-teilige Paket aus `$NOTES` zusammenstellen**

Exakt die Gliederung aus Auftrag Abschnitt 31, Überschrift `# EYT-136 INDEPENDENT PO REVIEW`, Abschnitte 1–21. Keine Umbenennung, keine ausgelassenen Abschnitte. Nicht erreichbare Quellen als `INACCESSIBLE`.

**Step 3: Ausgabe ins Terminal — keine Reportdatei committen.** Ein Commit nur für den Bericht entwertet den grün geprüften SHA.

**Step 4: Optionaler SHA-gebundener PR-Kommentar**

Nur wenn das Review vollständig ist:

```bash
gh pr review 56 --comment --body "<Kurzfassung mit explizitem Head-SHA>"
```

Scheitert das an GitHubs Self-Review-Regel:

```bash
gh pr comment 56 --body "<dieselbe Kurzfassung>"
```

**Kein künstliches `APPROVE` unter derselben Identität erzwingen.** Der Kommentar muss den geprüften Head-SHA nennen.

**Step 5: Draft-Aufhebung — nur unter allen vier Bedingungen**

```bash
gh pr ready 56
```

Nur wenn: Review vollständig · kein offener `PR_P1`/`PR_P2` · 11/11 auf exakt dem Head grün · kein Commit ausstehend.
**Das ist keine Merge-Freigabe.**

**Step 6: Endempfehlung**

Genau eines: `READY_FOR_PO_REVIEW` (mit exaktem Head-SHA und ausdrücklichem `NO MERGE PERFORMED`) oder `BLOCKED` (mit exakten P1/P2 samt Datei/Zeile/Evidenz und kleinstem Fix).

**Step 7: STOP.**

Kein Merge. Kein Jira-Done. Kein EYT-109. Kein EYT-110. Kein neuer Branch. Kein `/kosten`, kein CostGateway, kein Excel.
Der Product Owner entscheidet anschließend anhand des exakten Head-SHA.

**Step 8: Review-Worktree aufräumen (nur der eigene)**

```bash
git -C /Users/benjaminpoersch/EasyTree worktree remove "$WT"
```

Nur den in Task 0 selbst angelegten Worktree entfernen. Fremde Einträge unangetastet lassen.

---

## Abbruchbedingungen (jederzeit, sofort melden statt weiterarbeiten)

- PR-Head ändert sich während des Reviews → Review ist hinfällig, neu ansetzen.
- Ein Required Check ist auf dem geprüften Head nicht grün → sofort `BLOCKED`.
- Eine gemergte Migration (0001–0016) ist verändert → sofort `BLOCKED`, `PR_P1`.
- Ein Wegwerf-/Gegenmutations-PR erscheint als gemergt → sofort melden.
- Der Review verlangt einen Schreibzugriff auf Produktion, `service_role` oder Jira → **nicht ausführen**, den PO fragen.
