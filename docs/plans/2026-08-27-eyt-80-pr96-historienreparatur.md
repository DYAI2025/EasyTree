# EYT-80 / PR #96 — Historienreparatur (nichtkanonischer Ausführungsplan)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **Dieser Plan wird NICHT committet.** Er liegt bewusst im Haupt-Worktree
> (`/Users/benjaminpoersch/EasyTree`, Branch `feat/eyt-126-container-staging`) und damit außerhalb
> der Ahnenreihe von `feat/eyt-80-basisdesign-tokens`. Genau das committete Gegenstück ist der zu
> behebende Defekt. Wer diesen Plan ausführt, fügt ihn **unter keinen Umständen** einem Commit hinzu.

**Goal:** PR #96 so umschreiben, dass `docs/plans/2026-08-27-eyt-80-inkrement-2-basisdesign-tokens.md`
weder im Endbaum noch in der Branch-Ahnenreihe vorkommt, während die sieben freigegebenen
Produkt-/Testdateien **bytegleich** zum alten Kopf `6df734c1` bleiben.

**Architecture:** Der Merge-Base ist bereits `origin/master` (`3f98d769`) — es ist also **kein**
Rebase auf einen neuen Basispunkt nötig, sondern nur ein Herausfiltern von Plan-Änderungen aus neun
Commits. Zwei Commits berühren ausschließlich den Plan (`7d3c84e`, `6df734c`) und entfallen ganz;
ein Commit (`a286567`) mischt Plan und Test und wird als reine Teständerung neu aufgebaut. Die
übrigen sechs Commits werden unverändert cherry-gepickt. Ergebnis: sieben Commits, dieselbe
TDD-Erzählung (rot → grün), derselbe Endbaum minus Plan.

**Tech Stack:** git (cherry-pick + `git apply --index`, kein `rebase -i` — interaktive Flags sind in
dieser Umgebung nicht verfügbar), `gh`, `~/.claude/scripts/gh-ci-wait`, Atlassian-MCP für Jira.

---

## Verifizierte Ausgangslage (gemessen 27.08.2026, vor Beginn erneut prüfen)

| Größe | Wert |
| --- | --- |
| `origin/master` | `3f98d769662b4dbbbe5dee879cc2dfdecaabb22a` |
| Alter PR-Kopf | `6df734c119495afbbec2dbe8536dad89faa5c443` |
| Branch | `feat/eyt-80-basisdesign-tokens` |
| Worktree | `/Users/benjaminpoersch/EasyTree-worktrees/eyt-80-werkbank-foundation` |
| Merge-Base | `3f98d769…` (identisch mit `origin/master` — Branch ist up to date) |
| PR #96 | OPEN, `isDraft=false`, `mergeable=MERGEABLE`, Basis `master` |
| Offene Reviewthreads | `totalCount = 0` |
| **Lokaler** `master` | `092ada2c…` — **veraltet, nie als Vergleichsbasis benutzen** |

**Commitliste `origin/master..6df734c` (alt, neun Commits, ältester zuerst):**

| # | SHA | Betreff | Dateien |
| --- | --- | --- | --- |
| 1 | `7d3c84e` | docs(EYT-80): Inkrement 2 — Plan … | **nur Plan** → entfällt |
| 2 | `1cf7b3c` | test(ui): Kontrastgate und Tokenvertrag vor der Quelle (rot) | 2 Testdateien |
| 3 | `efb93ab` | test(ui): Kontrastgate nach Review geschaerft | 2 Testdateien |
| 4 | `a286567` | docs(EYT-80): Gegenmutation auf drei Rollen erweitern … | **Plan + 1 Testdatei** → nur Test |
| 5 | `b637ce2` | feat(ui): Basisdesign-v2-Tokens als kanonische Quelle | `package.json`, `basisdesign-v2.css` |
| 6 | `ada662f` | test(web): Waechter gegen eigene Palette (rot) | `apps/web/test/…` |
| 7 | `8a425da` | refactor(web): globals.css bezieht Farbrollen aus @easytree/ui | `globals.css` |
| 8 | `87cd0ac` | test(web): Browser belegt die Tokens auf /, /planung, /kosten | `shell-smoke.spec.ts` |
| 9 | `6df734c` | docs(EYT-80): Planbefunde nachtragen | **nur Plan** → entfällt |

**Blob-Hashes der sieben freigegebenen Dateien am alten Kopf `6df734c` — das ist der
Bytegleichheits-Maßstab:**

```
7bc3a891b16b65247ee901cc2b60d3c56be79ea3  apps/web/app/globals.css
ac0b8b871dcab2c7b9cbef3b9bf432253a4859dd  apps/web/e2e/shell-smoke.spec.ts
d30b9ceafcbb75a59a2b56b6a7c7833e1e5710e2  apps/web/test/basisdesign-tokens.test.ts
cdea8325c71f01488e72bfa1d8ca2970343332b1  packages/ui/package.json
59cff53fd374516e1a22b18ae316eb01ac224f35  packages/ui/src/basisdesign-v2.css
d35245340db1813c5805bf34111f1165681080cb  packages/ui/test/basisdesign-tokens.test.ts
1c82f731638fc1aef5121bfc664fc84dbc4824db  packages/ui/test/helpers/kontrast.ts
```

**Achtung — nicht importieren:** im Worktree liegt eine untracked Datei
`docs/plans/2026-08-27-eyt-80-werkbank-ui-foundation.md`. Sie gehört **nicht** zu diesem Slice und
darf in keinen Commit geraten. Kein `git add .`, kein `git add docs/`, kein `git commit -a`.

---

## Task 0: Vorbedingungen messen — STOP-Kriterien

**Files:** keine.

**Step 1: origin/master frisch holen und vergleichen**

```bash
cd /Users/benjaminpoersch/EasyTree-worktrees/eyt-80-werkbank-foundation
git fetch origin --prune
git rev-parse origin/master
```

Erwartet, **wörtlich**: `3f98d769662b4dbbbe5dee879cc2dfdecaabb22a`

**Wenn abweichend: STOP.** Der Auftrag bindet die Reparatur an genau diesen master. Nicht
umplanen, nicht rebasen, sondern melden und auf Freigabe warten.

**Step 2: alten Kopf bestätigen**

```bash
git rev-parse HEAD
git rev-parse origin/feat/eyt-80-basisdesign-tokens
gh pr view 96 --json headRefOid --jq '.headRefOid'
```

Erwartet: dreimal `6df734c119495afbbec2dbe8536dad89faa5c443`.
**Wenn abweichend: STOP** — jemand anderes hat den Branch bewegt.

**Step 3: Arbeitsbaum ist sauber (bis auf die eine fremde untracked Datei)**

```bash
git status --porcelain
```

Erwartet: **genau eine** Zeile
`?? docs/plans/2026-08-27-eyt-80-werkbank-ui-foundation.md`

Mehr Zeilen ⇒ erst klären, nichts wegwerfen.

**Step 4: PR-Zustand bestätigen**

```bash
gh pr view 96 --json state,isDraft,mergeable,baseRefName --jq '.'
```

Erwartet: `state=OPEN`, `isDraft=false`, `mergeable=MERGEABLE`, `baseRefName=master`.

**Kein Commit in dieser Task.**

---

## Task 1: Sicherung des alten Kopfes und des Plandokuments

Grund: `git checkout --` und Branch-Reset stellen den **Commit**-Stand her, nicht den Arbeitsstand;
ein verlorener Kopf ist ohne Referenz nur über Reflog zu finden. Wir legen eine explizite Referenz an.

**Files:**
- Create: Sicherungsref `refs/eyt80/alter-kopf`
- Create: `/private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/2e67c849-0252-4f6a-a177-5da5b5be8843/scratchpad/eyt-80-plan-nichtkanonisch.md`

**Step 1: Referenz auf den alten Kopf setzen**

```bash
cd /Users/benjaminpoersch/EasyTree-worktrees/eyt-80-werkbank-foundation
git update-ref refs/eyt80/alter-kopf 6df734c119495afbbec2dbe8536dad89faa5c443
git rev-parse refs/eyt80/alter-kopf
```

Erwartet: `6df734c119495afbbec2dbe8536dad89faa5c443`

**Step 2: das nichtkanonische Plandokument aus der Historie in den Scratchpad retten**

Es verschwindet aus dem Repo — sein Inhalt (Gegenmutationsprotokoll) bleibt aber lesenswert.

```bash
SP=/private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/2e67c849-0252-4f6a-a177-5da5b5be8843/scratchpad
mkdir -p "$SP"
git show 6df734c1:docs/plans/2026-08-27-eyt-80-inkrement-2-basisdesign-tokens.md > "$SP/eyt-80-plan-nichtkanonisch.md"
wc -l < "$SP/eyt-80-plan-nichtkanonisch.md"
```

Erwartet: eine Zeilenzahl > 0. Die Datei liegt **außerhalb** des Repos — sie kann von dort nicht
versehentlich committet werden.

**Kein Commit in dieser Task.**

---

## Task 2: Historie ohne den Plan neu aufbauen

**Files:**
- Modify: Branch `feat/eyt-80-basisdesign-tokens` (lokal)

**Step 1: Branch auf origin/master zurücksetzen**

```bash
cd /Users/benjaminpoersch/EasyTree-worktrees/eyt-80-werkbank-foundation
git checkout feat/eyt-80-basisdesign-tokens
git reset --hard 3f98d769662b4dbbbe5dee879cc2dfdecaabb22a
git rev-parse HEAD
```

Erwartet: `3f98d769662b4dbbbe5dee879cc2dfdecaabb22a`

**Step 2: die beiden reinen Testcommits übernehmen**

```bash
git cherry-pick 1cf7b3caaa86493c02a34f07d8dba85a57a80501
git cherry-pick efb93abf0b88077418c577fc7b2dc882d34a5081
git log --oneline --no-decorate -2
```

Erwartet: zwei neue Commits, Betreffzeilen
`test(ui): EYT-80 Kontrastgate nach Review geschaerft` und
`test(ui): EYT-80 Kontrastgate und Tokenvertrag vor der Quelle (rot)`.
Kein Konflikt.

**Step 3: den gemischten Commit `a286567` als reine Teständerung nachbauen**

Kein `cherry-pick` — der würde am fehlenden Plandokument konfliktieren. Stattdessen wird der
Teildiff angewendet. Der Elternteil `efb93ab` ist gerade eben identisch übernommen worden, der Diff
passt daher exakt.

```bash
git diff a286567a66e343bb75b61be308b3da9a90a4f1a2^ a286567a66e343bb75b61be308b3da9a90a4f1a2 \
  -- packages/ui/test/basisdesign-tokens.test.ts | git apply --index --stat
```

Erwartet: eine Statuszeile für `packages/ui/test/basisdesign-tokens.test.ts`, sonst nichts.

Dann tatsächlich anwenden und committen:

```bash
git diff a286567a66e343bb75b61be308b3da9a90a4f1a2^ a286567a66e343bb75b61be308b3da9a90a4f1a2 \
  -- packages/ui/test/basisdesign-tokens.test.ts | git apply --index
git diff --cached --name-only
```

Erwartet: **genau eine** Zeile `packages/ui/test/basisdesign-tokens.test.ts`.
Steht dort mehr — insbesondere irgendein Pfad unter `docs/plans/` — **STOP**.

```bash
git commit -C a286567a66e343bb75b61be308b3da9a90a4f1a2
```

Der ursprüngliche Betreff nennt zwei Dinge, von denen nur eines übrig bleibt. Betreff daher
anpassen, damit die Commitnachricht keine Behauptung über ein nicht enthaltenes Dokument trägt:

```bash
git commit --amend -m "test(ui): EYT-80 Gegenmutation auf drei Rollen erweitern; Testname ehrlich benennen"
git show --name-status --format='%h %s' HEAD
```

Erwartet: `M	packages/ui/test/basisdesign-tokens.test.ts` und **keine** weitere Datei.

**Step 4: die vier restlichen Commits übernehmen**

```bash
git cherry-pick b637ce28844c0341d77d7859126c6775232453fe
git cherry-pick ada662f797c0a8cd30154011c047206abeb2a6a0
git cherry-pick 8a425da217acd78b4e183815d4a93ffab41131aa
git cherry-pick 87cd0accd293018410c3b676ddf2de7d0ccbe8a6
```

Erwartet: vier Mal Erfolg, kein Konflikt.

**Step 5: neuen Kopf festhalten**

```bash
git rev-parse HEAD | tee /tmp/eyt80-neuer-kopf.txt
git log --oneline --no-decorate origin/master..HEAD
```

Erwartet: **sieben** Zeilen, keine mit `docs(`-Präfix.

**Kein Push in dieser Task.**

---

## Task 3: Beweisführung vor dem Ersetzen des Remote-Branches

Fünf Beweise. **Jeder einzelne muss stimmen; sonst STOP.**

**Files:** keine.

**Step 1: Beweis 1 — master steht noch**

```bash
cd /Users/benjaminpoersch/EasyTree-worktrees/eyt-80-werkbank-foundation
git fetch origin --prune
git rev-parse origin/master
```

Erwartet: `3f98d769662b4dbbbe5dee879cc2dfdecaabb22a`. Abweichung ⇒ **STOP**.

**Step 2: Beweis 2 — Bytegleichheit aller sieben Dateien gegen den alten Kopf**

```bash
ALT=6df734c119495afbbec2dbe8536dad89faa5c443
ABW=0
for f in apps/web/app/globals.css \
         apps/web/e2e/shell-smoke.spec.ts \
         apps/web/test/basisdesign-tokens.test.ts \
         packages/ui/package.json \
         packages/ui/src/basisdesign-v2.css \
         packages/ui/test/basisdesign-tokens.test.ts \
         packages/ui/test/helpers/kontrast.ts; do
  A=$(git rev-parse "$ALT:$f"); N=$(git rev-parse "HEAD:$f")
  if [ "$A" = "$N" ]; then echo "GLEICH $A $f"; else echo "ABWEICHUNG alt=$A neu=$N $f"; ABW=$((ABW+1)); fi
done
echo "abweichungen=$ABW"
```

Erwartet: siebenmal `GLEICH`, die Hashes exakt wie in der Tabelle oben, und `abweichungen=0`.
**`abweichungen` ungleich 0 ⇒ STOP**, nicht stillschweigend akzeptieren.

Gegenprobe, dass die Schleife überhaupt vergleicht (sonst wäre eine leere Liste auch „0"):
Die Ausgabe muss **sieben** `GLEICH`-Zeilen enthalten — zählen:

```bash
# erneut, nur die Zählung
for f in apps/web/app/globals.css apps/web/e2e/shell-smoke.spec.ts apps/web/test/basisdesign-tokens.test.ts packages/ui/package.json packages/ui/src/basisdesign-v2.css packages/ui/test/basisdesign-tokens.test.ts packages/ui/test/helpers/kontrast.ts; do
  [ "$(git rev-parse "$ALT:$f")" = "$(git rev-parse "HEAD:$f")" ] && echo ok
done | wc -l
```

Erwartet: `7`

**Step 3: Beweis 3 — kein Commit der neuen Ahnenreihe berührt den Planpfad**

```bash
git rev-list origin/master..HEAD -- docs/plans/2026-08-27-eyt-80-inkrement-2-basisdesign-tokens.md | wc -l
```

Erwartet: `0`

Ergänzend, weil ein Pfadfilter ohne Treffer auch bei falschem Pfad `0` liefert — Gegenprobe gegen
den **alten** Kopf, wo derselbe Filter greifen **muss**:

```bash
git rev-list origin/master..refs/eyt80/alter-kopf -- docs/plans/2026-08-27-eyt-80-inkrement-2-basisdesign-tokens.md | wc -l
```

Erwartet: `3` (die Commits `7d3c84e`, `a286567`, `6df734c`). Steht dort `0`, ist der Pfad falsch
geschrieben und Beweis 3 wertlos ⇒ **STOP**.

Breiter, gegen jede Plan-Datei in der neuen Ahnenreihe:

```bash
git log --format='%h' --name-only origin/master..HEAD -- 'docs/**' | grep -c . || echo 0
```

Erwartet: `0`

**Step 4: Beweis 4 — der Pfad existiert im Endbaum nicht**

```bash
git ls-tree -r --name-only HEAD | grep -c 'docs/plans/2026-08-27-eyt-80' || echo 0
```

Erwartet: `0`

```bash
git cat-file -e HEAD:docs/plans/2026-08-27-eyt-80-inkrement-2-basisdesign-tokens.md 2>&1; echo "exit=$?"
```

Erwartet: eine Fehlermeldung und `exit=128` (Objekt existiert nicht).

**Step 5: Beweis 5 — der Diff enthält exakt die sieben Pfade**

```bash
git diff --name-only origin/master...HEAD | sort
git diff --name-only origin/master...HEAD | wc -l
```

Erwartet, **genau diese Liste** und die Zahl `7`:

```
apps/web/app/globals.css
apps/web/e2e/shell-smoke.spec.ts
apps/web/test/basisdesign-tokens.test.ts
packages/ui/package.json
packages/ui/src/basisdesign-v2.css
packages/ui/test/basisdesign-tokens.test.ts
packages/ui/test/helpers/kontrast.ts
```

**Step 6: Zusatzprüfung — der Endbaum ist gleich dem alten Endbaum minus Plan**

Stärkster Einzelbeweis: der Baumvergleich muss **genau eine** Löschung zeigen.

```bash
git diff --name-status refs/eyt80/alter-kopf HEAD
```

Erwartet: **genau eine** Zeile
`D	docs/plans/2026-08-27-eyt-80-inkrement-2-basisdesign-tokens.md`
Jede weitere Zeile ⇒ **STOP**.

**Step 7: Arbeitsbaum weiterhin sauber**

```bash
git status --porcelain
```

Erwartet: genau die eine bekannte `??`-Zeile für
`docs/plans/2026-08-27-eyt-80-werkbank-ui-foundation.md`.

**Kein Push in dieser Task.**

---

## Task 4: Remote-Branch ersetzen (`--force-with-lease` auf den exakten alten SHA)

**Files:** Remote-Ref `origin/feat/eyt-80-basisdesign-tokens`

> **Unumkehrbarer Schritt.** Erst ausführen, wenn alle fünf Beweise aus Task 3 gehalten haben.
> `master` wird **nicht** angefasst. Die Lease bindet den Push an genau `6df734c1…`: hat jemand
> anderes den Branch inzwischen bewegt, schlägt der Push fehl, statt fremde Arbeit zu überschreiben.

**Step 1: Push mit expliziter Lease**

```bash
cd /Users/benjaminpoersch/EasyTree-worktrees/eyt-80-werkbank-foundation
git push \
  --force-with-lease=feat/eyt-80-basisdesign-tokens:6df734c119495afbbec2dbe8536dad89faa5c443 \
  origin feat/eyt-80-basisdesign-tokens
```

Erwartet: `+ 6df734c...<neu> feat/eyt-80-basisdesign-tokens -> feat/eyt-80-basisdesign-tokens (forced update)`

Bei `stale info` / Ablehnung: **STOP** — der Remote-Branch wurde zwischenzeitlich verändert.

**Step 2: Remote-Stand nachlesen**

```bash
git fetch origin --prune
git rev-parse origin/feat/eyt-80-basisdesign-tokens
git rev-parse HEAD
git rev-parse origin/master
```

Erwartet: die ersten beiden identisch (neuer Kopf), der dritte weiterhin `3f98d769…`.

---

## Task 5: PR #96 zurücklesen und die Beschreibung in Ordnung bringen

**Files:**
- Modify: PR-Body #96 (über `gh pr edit --body-file`)
- Create (temporär, außerhalb des Repos): `$SP/pr96-body.md`

**Step 1: PR-Kopf und Dateiliste zurücklesen**

```bash
cd /Users/benjaminpoersch/EasyTree
gh pr view 96 --json headRefOid,baseRefName,state,isDraft,mergeable --jq '.'
gh pr diff 96 --name-only | sort
gh pr diff 96 --name-only | wc -l
```

Erwartet: `headRefOid` = neuer Kopf, `baseRefName=master`, `state=OPEN`; Dateiliste exakt die sieben
Pfade, Zahl `7`.

**Step 2: neuen Body schreiben**

Grundlage ist der bisherige Body. **Zwei** Eingriffe, sonst nichts:

1. Im Abschnitt `## Summary by Sourcery` entfällt der komplette Block

   ```
   Documentation:
   - Dokumentiere den Implementierungsplan für die zentrale Tokenquelle und das Kontrastgate.
   ```

   Das ist die einzige Stelle, die den Ausführungsplan als geliefertes Dokumentationsartefakt
   ausgibt. Sie stimmt nach der Umschreibung nicht mehr.

2. Ein neuer Abschnitt **vor** `## Kein Deploy, kein Merge`:

   ```markdown
   ## Historienreparatur 27.08.2026

   Der Branch wurde von `3f98d76` neu aufgebaut. Der Ausführungsplan
   `docs/plans/2026-08-27-eyt-80-inkrement-2-basisdesign-tokens.md` war
   abgeleitetes, nichtkanonisches Arbeitsmaterial und ist **weder im Endbaum noch in der
   Ahnenreihe** dieses Branches enthalten; ein späteres `git rm` hätte ihn über die Historie
   erreichbar gelassen.

   Die sieben Produkt- und Testdateien sind **bytegleich** zum zuvor geprüften Stand `6df734c`
   (Blobvergleich je Datei, sieben Treffer, null Abweichungen). Es wurde **kein** Produktcode
   geändert. Der Baumvergleich alt→neu zeigt genau eine Änderung: die Löschung des Plandokuments.

   Neuer Kopf: `<NEUER_SHA>` · CI-Lauf: `<RUN_ID>` (11/11 grün).

   Sourcery hat diesen Stand **nicht** freigegeben — der Dienst meldet aktuell nur sein
   Review-Budget-Limit. Der Abschnitt „Summary by Sourcery" stammt aus einem früheren Lauf.
   ```

Body zusammenbauen — außerhalb des Repos, damit nichts committet werden kann:

```bash
SP=/private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/2e67c849-0252-4f6a-a177-5da5b5be8843/scratchpad
gh pr view 96 --json body --jq '.body' > "$SP/pr96-body-alt.md"
cp "$SP/pr96-body-alt.md" "$SP/pr96-body.md"
```

Dann die beiden Eingriffe an `$SP/pr96-body.md` vornehmen (Edit-Werkzeug, keine blinde `sed`-Kette).

**Step 3: die Ersetzung am Ergebnis prüfen, nicht am Exit-Code**

```bash
grep -c 'Dokumentiere den Implementierungsplan' "$SP/pr96-body.md" || echo 0
grep -c 'Historienreparatur 27.08.2026' "$SP/pr96-body.md"
grep -c '<NEUER_SHA>\|<RUN_ID>' "$SP/pr96-body.md" || echo 0
```

Erwartet: `0`, `1`, `0` — der dritte Wert erst **nach** dem Einsetzen der echten Werte aus Task 6;
bis dahin bleibt Step 4 zurückgestellt.

**Step 4: Body setzen (erst nach Task 6, wenn Kopf und Lauf feststehen)**

```bash
gh pr edit 96 --body-file "$SP/pr96-body.md"
gh pr view 96 --json body --jq '.body' | grep -c 'Historienreparatur 27.08.2026'
```

Erwartet: `1`. Zusätzlich gegenlesen, dass der eingesetzte SHA dem tatsächlichen `headRefOid`
entspricht — die Beschreibung ist damit an den exakten Kopf gebunden.

---

## Task 6: CI auf dem neuen Kopf abwarten und auswerten

**Files:** keine.

**Step 1: warten**

```bash
NEU=$(cd /Users/benjaminpoersch/EasyTree-worktrees/eyt-80-werkbank-foundation && git rev-parse HEAD)
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$NEU" 3600; echo "waitexit=$?"
```

`waitexit=0` heißt **nicht** automatisch grün — Exit 0 kann Timeout bedeuten, Exit 1 kann
„abgebrochen" bedeuten (`ci.yml` hat `cancel-in-progress`). Der Endstand wird in Step 2 direkt
gemessen.

**Step 2: Lauf identifizieren und Jobs zählen**

```bash
gh run list --repo DYAI2025/EasyTree --commit "$NEU" --limit 5 \
  --json databaseId,name,status,conclusion,headSha --jq '.'
```

Den Lauf des Workflows `CI` nehmen, seine `databaseId` als `RUN` merken.

```bash
gh run view "$RUN" --repo DYAI2025/EasyTree --json headSha,status,conclusion --jq '.'
gh run view "$RUN" --repo DYAI2025/EasyTree --json jobs \
  --jq '.jobs[] | "\(.conclusion)\t\(.name)"' | sort
gh run view "$RUN" --repo DYAI2025/EasyTree --json jobs \
  --jq '[.jobs[] | select(.conclusion=="success")] | length'
```

Erwartet: `headSha` = `$NEU`, `status=completed`, `conclusion=success`, **11** Jobzeilen, alle
`success`, und die Zählung `11`.

**Step 3: `db-gates` auf `skipped=0` prüfen — die Gate-Zeilen lesen, nicht den Haken**

```bash
JOB=$(gh run view "$RUN" --repo DYAI2025/EasyTree --json jobs \
      --jq '.jobs[] | select(.name|test("db-gates")) | .databaseId')
gh run view "$RUN" --repo DYAI2025/EasyTree --log --job "$JOB" \
  | grep -oE '\[[a-z-]+\] mode=[a-z]+ executed=[0-9]+ passed=[0-9]+ skipped=[0-9]+' | sort -u
```

Erwartet: jede Gate-Zeile mit `mode=required` und `skipped=0`. Fehlt eine Zeile oder steht dort
`skipped` ungleich 0 ⇒ als Befund melden, **nicht** wegerklären. Ein rotes `db-gates` bricht am
ersten fehlgeschlagenen Schritt ab — alles danach ist dann `skipped` und ungeprüft.

**Step 4: PR-Checks und Reviewthreads**

```bash
gh pr checks 96 --repo DYAI2025/EasyTree
gh api graphql -f query='query{repository(owner:"DYAI2025",name:"EasyTree"){pullRequest(number:96){reviewThreads(first:50){totalCount nodes{isResolved path}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads | {total:.totalCount, offen: ([.nodes[]|select(.isResolved==false)]|length)}'
```

Erwartet: alle Checks grün; `offen: 0`.

**Step 5: jetzt Task 5 Step 4 ausführen** — Body mit `<NEUER_SHA>` = `$NEU` und `<RUN_ID>` = `$RUN`.

---

## Task 7: Jira-Nachtrag an EYT-80

**Files:** keine (Jira-Kommentar über Atlassian-MCP `addCommentToJiraIssue`).

> **Erst komponieren, dann erneut lesen, dann senden.** Entwurfsfragmente sind schon einmal in einem
> Jira-Kommentar gelandet. Der Text unten ist der vollständige Kommentar, nichts darüber hinaus.

**Step 1: Kommentar setzen**

Issue `EYT-80`, Text (Platzhalter durch die gemessenen Werte ersetzen):

```
Nachtrag zur Historienreparatur von PR #96. Dieser Kommentar loest Kommentar 14498
ausschliesslich hinsichtlich PR-Kopf und CI-Lauf ab; alle uebrigen Aussagen dort bleiben gueltig.

Neuer Kopf: <NEUER_SHA> (vorher 6df734c1). Basis unveraendert 3f98d769.
CI: Lauf <RUN_ID>, completed/success, 11/11 Jobs gruen, db-gates mode=required mit skipped=0.

Die Historie des nichtkanonischen Ausfuehrungsplans
docs/plans/2026-08-27-eyt-80-inkrement-2-basisdesign-tokens.md wurde entfernt: der Pfad kommt
weder im Endbaum noch in der Ahnenreihe des Branches vor.

Die sieben Produkt- und Testdateien sind bytegleich zum zuvor gereviewten Stand 6df734c
(Blobvergleich je Datei: 7 gleich, 0 Abweichungen). Es wurde kein Produktcode geaendert.

EYT-80 bleibt In Arbeit. Kein Deploy, kein Merge.
```

**Step 2: zurücklesen**

```
getJiraIssue EYT-80  → Status pruefen
```

Erwartet: Status weiterhin `In Arbeit`; der neue Kommentar mit seiner ID ist vorhanden. Kommentar-ID
notieren. **Keine Transition ausführen.**

---

## Task 8: Abschlussbericht

**Files:** keine.

Zusammenstellen und ausgeben:

- verifizierter Ausgangs-`master`: `3f98d769662b4dbbbe5dee879cc2dfdecaabb22a`
- alter Kopf: `6df734c119495afbbec2dbe8536dad89faa5c443`
- neuer Kopf: `<NEUER_SHA>`
- Commitliste `master..neuer-Kopf` (sieben Zeilen, `git log --oneline --no-decorate`)
- Beweis Planpfad abwesend: `rev-list … | wc -l` = 0, Gegenprobe am alten Kopf = 3,
  `git cat-file -e` = exit 128, `git diff --name-status alt neu` = genau eine `D`-Zeile
- Bytegleichheit: sieben `GLEICH`-Zeilen mit den Blob-Hashes, `abweichungen=0`
- geänderte Dateien: die sieben Pfade, `wc -l` = 7
- PR-#96-Rückgabe: `headRefOid`, `baseRefName`, `state`, `mergeable`
- CI: Lauf-ID, `headSha`, `conclusion`, 11 Jobzeilen
- `db-gates`: die Gate-Zeilen mit `mode=required … skipped=0`
- Reviewthreads: offen = 0
- Jira: Kommentar-ID, Status `In Arbeit`
- Bestätigung: kein Produktcode geändert, kein Deploy, kein Merge

**Evidenzstufe je Aussage benennen** (ausgeführter CI-Lauf > lokaler Lauf > Bericht > Plan).

**Danach STOP.**

---

## Was diese Reparatur ausdrücklich nicht tut

Keine neue UI-Arbeit, keine weiteren Tokens, keine `BottomNavigation`, keine Mitarbeiter-Shell,
kein EYT-113/EYT-81, keine Reparatur des Architektur-Scanners, keine Confluence-Änderung, kein
Deploy, kein Merge, kein Jira-Übergang, keine sonstige Aufräumarbeit, keine erneute
Sourcery-Anforderung. `BLOCKER_ENVIRONMENT_SEPARATION` bleibt unberührt.
