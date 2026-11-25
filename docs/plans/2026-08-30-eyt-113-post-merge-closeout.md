# EYT-113 Post-Merge Closeout — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **DIESER PLAN WIRD NICHT COMMITTET.** `DIRECT_EXECUTION`-Regel: ein committeter
> Ausführungsplan im Slice ist ein eigener Reviewbefund. Er liegt bewusst untracked in
> `docs/plans/` des Haupt-Worktrees.

**Goal:** Atomarer Post-Merge-Closeout für EYT-113: PR #100 live nachlesen, Post-Merge-CI
auf dem exakten Merge-SHA beweisen, finale AC-Matrix gegen den Merge-SHA, Jira-Done mit
Evidenzkommentar, Confluence-Delivery-Reconciliation fortschreiben, Sprint-579-WIP-Gate.
**Keine EYT-147-Implementierung in dieser Session.**

**Architecture:** Reine Lese-/Nachweisarbeit plus zwei externe Mutationen (Jira, Confluence).
Kein Code, kein Commit, kein Branchwechsel. Alle Repo-Nachweise laufen über
`git show`/`git grep <SHA>` gegen den Merge-SHA — der Haupt-Worktree steht auf
`feat/eyt-126-container-staging` mit uncommitteten Änderungen und wird NICHT umgeschaltet.

**Tech Stack:** `gh` CLI, `git` (read-only), Atlassian-MCP (`mcp__claude_ai_Atlassian_Rovo__*`,
Cloud-ID `4504291c-8bc0-48f8-ab9e-9ad5d376ca04`), `~/.claude/scripts/gh-ci-wait`.

---

## Start Truth (aus Auftrag — Erwartungswerte, IMMER live nachmessen)

| Fakt | Erwartungswert (NICHT blind vertrauen) |
| --- | --- |
| PR | #100, Repo `DYAI2025/EasyTree` |
| Reviewed Head | `71ee35b31907050b2551536240ca12b379a4474c` |
| Reviewed Base | `088368219a25c756a5800b660cb22a87fc9e7db3` |
| Pre-Merge-CI | Lauf #376, 11/11 success auf Reviewed Head |
| Jira | EYT-113, Sprint 579; Status vor Closeout vermutlich `In Arbeit` |
| Confluence | 31948801 (Delivery-Reconciliation), 38993921 (Sprint-7 Produktpriorisierung) |
| Pflichtjobs (11) | format, lint, typecheck, unit-tests, build-web, web-smoke, build-api, secret-scan, db-gates, read-through, auth-journey |

**Platzhalterkonvention:** `<MERGE_SHA>` = tatsächlicher Merge-Commit von PR #100 (Task 1),
`<RUN_ID>` = Post-Merge-CI-Lauf auf `<MERGE_SHA>` (Task 3). Beide werden gemessen, nie geraten.

## Verdikt- und Abbruchregeln (verbindlich)

Genau EIN Schlussverdikt, wörtlich:

- `EYT-113 CLOSED — EYT-147 READY AS NEXT WIP` — nur wenn ALLE Gates grün.
- `MERGED — CLOSEOUT BLOCKED — <reason>` — bei jedem roten Gate NACH bestätigtem Merge.
- `BLOCKED — PR #100 NOT MERGED` — wenn Task 1 keinen Merge findet. Dann sofort STOP.

STOP heißt: keine Jira-Mutation, keine Confluence-Mutation, Report mit dem Blocker-Verdikt.
Reihenfolge ist hart: Jira-Done (Task 5) und Confluence (Task 6) erst nach grünen Tasks 1–4.
`release-images` (falls vorhanden) wird nur PROTOKOLLIERT — es ist KEIN Deploy-Beweis, und
`BLOCKER_ENVIRONMENT_SEPARATION` bleibt offen; kein Runtime-/Deploy-Claim irgendwo.

## Bekannte Fallen (Projektgedächtnis — vor Ausführung verinnerlichen)

- `gh-ci-wait` Exit 1 kann „cancelled" heißen (cancel-in-progress), Exit 0 kann Timeout
  heißen → Endstand IMMER mit `gh run view` gegenprüfen.
- zsh frisst `$SHA:pfad` (`:a`/`:r` = Modifier) → Revision+Pfad nur als einfach gequotetes Literal.
- Atlassian-„count"-Suchmodus ist unzuverlässig → WIP-Gate nur mit `issues`-Modus.
- Atlassian-Markdown zieht Satzzeichen hinter nackten URLs in den Link → keine nackte URL
  direkt vor Komma/Punkt; gerenderten Kommentar nachlesen.
- Externe Mutationen: compose → re-read → send (Entwurf als Datei im Scratchpad, nochmal
  lesen, dann senden).
- Gegen `origin/master` messen, nie lokalen `master` (lag schon 25 Commits zurück).
- Employee Heute/Woche-Fachflächen = EYT-81, NIE als EYT-113-Defekt werten.

---

## Task 1: PR-#100-Readback

**Files:** keine — nur Messung.

**Step 1: PR-Zustand live lesen**

```bash
cd /Users/benjaminpoersch/EasyTree
gh pr view 100 --repo DYAI2025/EasyTree \
  --json state,mergedAt,mergeCommit,headRefOid,baseRefName,title,url
```

Erwartet: `"state": "MERGED"`, `mergedAt` gesetzt, `mergeCommit.oid` = `<MERGE_SHA>`.

- `state` ≠ `MERGED` → **`BLOCKED — PR #100 NOT MERGED`**, STOP.
- `headRefOid` ≠ `71ee35b31907050b2551536240ca12b379a4474c` → Head wurde nach dem Review
  bewegt (Merge-Approval ist SHA-gebunden) → **`MERGED — CLOSEOUT BLOCKED — head changed
  after review`**, STOP.

**Step 2: Merge-Commit-Eltern prüfen (Kopfsicherungs-Beweis)**

```bash
git fetch origin
git show -s --format='%H %P' '<MERGE_SHA>'
```

Erwartet: zwei Eltern; **zweiter Elternteil = `71ee35b31907050b2551536240ca12b379a4474c`**
(das ist der eigentliche Beweis, dass genau der reviewte Head gemerged wurde — nicht der
Exit-Code irgendeines Merge-Befehls). Erster Elternteil = master-Stand vor dem Merge;
notieren, ob er `0883682…` ist (Base unverändert) oder neuer (dann in Task 2 bewerten).

**Step 3: Werte festhalten**

`<MERGE_SHA>`, beide Eltern, `mergedAt` in die Notizen für den Schlussreport.

## Task 2: Master-Readback

**Step 1: origin/master messen und Enthaltensein beweisen**

```bash
git rev-parse origin/master
git merge-base --is-ancestor '<MERGE_SHA>' origin/master && echo CONTAINED || echo NOT_CONTAINED
git log --oneline '<MERGE_SHA>..origin/master'
```

Erwartet: `CONTAINED`; drittes Kommando leer (dann ist `<MERGE_SHA>` = `origin/master`).

- `NOT_CONTAINED` → **`MERGED — CLOSEOUT BLOCKED — merge not on origin/master`**, STOP.
- Log NICHT leer: dazwischenliegende Commits einzeln lesen (`git show --stat <sha>`); nur
  wenn sie EYT-113-Flächen berühren (apps/web Shell/Journey, packages/ui, architecture-Tests,
  docs-Grenzdoku) → **`MERGED — CLOSEOUT BLOCKED — intervening change invalidates
  acceptance`**. Sonst protokollieren und weiter; AC-Matrix (Task 4) läuft trotzdem gegen
  `<MERGE_SHA>`, nicht gegen den neueren master.

## Task 3: Post-Merge-CI auf `<MERGE_SHA>`

**Step 1: Lauf finden (Push-Event auf master, exakter SHA)**

```bash
gh run list --repo DYAI2025/EasyTree --branch master --limit 15 \
  --json databaseId,headSha,status,conclusion,workflowName,event,createdAt
```

Den CI-Lauf mit `headSha == <MERGE_SHA>` und `event == "push"` wählen → `<RUN_ID>`.
Pre-Merge-Lauf #376 (PR-Head) zählt NICHT als Ersatz.

- Kein Lauf auf `<MERGE_SHA>` → **`MERGED — CLOSEOUT BLOCKED — no post-merge CI on merge SHA`**, STOP.
- Lauf `in_progress`/`queued` → warten:

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree '<MERGE_SHA>' 3600
```

Danach UNABHÄNGIG vom Exit-Code den Endstand direkt lesen (Exit 0 kann Timeout, Exit 1
kann cancelled sein).

**Step 2: Alle Pflichtjobs einzeln lesen**

```bash
gh run view '<RUN_ID>' --repo DYAI2025/EasyTree \
  --json status,conclusion,jobs \
  --jq '.conclusion, (.jobs[] | [.name, .conclusion] | @tsv)'
```

Erwartet: `success` als Gesamtergebnis UND jede der 11 Pflichtjob-Zeilen
(format, lint, typecheck, unit-tests, build-web, web-smoke, build-api, secret-scan,
db-gates, read-through, auth-journey) mit `success`. Jobnamen, die es zusätzlich gibt
(z. B. release-images), separat notieren.

Irgendein Pflichtjob nicht `success` (auch `cancelled`/`skipped`) →
**`MERGED — CLOSEOUT BLOCKED — post-merge CI not fully green`**, STOP.

**Step 3: db-gates-Gate-Zeilen lesen (nicht den grünen Haken)**

```bash
DB_JOB=$(gh run view '<RUN_ID>' --repo DYAI2025/EasyTree --json jobs \
  --jq '.jobs[] | select(.name=="db-gates") | .databaseId')
gh run view '<RUN_ID>' --repo DYAI2025/EasyTree --log --job "$DB_JOB" \
  | grep -oE '\[[a-z-]+\] mode=[a-z]+ executed=[0-9]+ passed=[0-9]+ skipped=[0-9]+' \
  | sort -u
```

Erwartet: jede Gate-Zeile vorhanden, alle `mode=required` mit `skipped=0`
(mindestens tenant-isolation und container-smoke). Fehlende Zeile oder `skipped>0` →
**`MERGED — CLOSEOUT BLOCKED — db-gates gate line missing/skipped`**, STOP.

## Task 4: Finale EYT-113-AC-Matrix auf `<MERGE_SHA>`

**Step 1: Ticket live lesen**

`mcp__claude_ai_Atlassian_Rovo__getJiraIssue` mit cloudId
`4504291c-8bc0-48f8-ab9e-9ad5d376ca04`, issueIdOrKey `EYT-113`.
Die AKTUELLE AC-Liste aus der Beschreibung ist maßgeblich — die Vorbefund-Matrix unten
ist nur Startpunkt; weicht das Ticket ab, gewinnt das Ticket.

**Step 2: PR-#100-Lieferumfang enumerieren**

```bash
git diff --name-only '<MERGE_SHA>^1..<MERGE_SHA>'
```

Darin die drei Increment-Lieferungen identifizieren: (a) Werkbank-1440/1920-Evidenz-Steps
in `apps/web/e2e/auth-journey/journey.pwtest.ts`, (b) `eyt113-*`-Screenshot-Namen,
(c) das Shell-Grenzen-Architekturdokument unter `docs/`.

**Step 3: Jeden Anker am Merge-SHA verifizieren**

Muster (Revision+Pfad IMMER einfach gequotet, zsh-Falle):

```bash
git grep -n 'viewport' '<MERGE_SHA>' -- 'apps/web/e2e/auth-journey/journey.pwtest.ts' | grep -E '1440|1920|320|375'
git grep -n 'feld-shell-boundary\|ui-dependency-allowlist\|kosten-server-gate' '<MERGE_SHA>' -- 'apps/api/test/architecture/rules.ts'
git grep -ln 'EYT-113' '<MERGE_SHA>' -- 'docs/'
```

Vorbefund-Matrix (Stand Finalisierungsplan 30.08.; Anker jeweils live gegenprüfen):

| Auftrags-Kriterium | Anker (auf `<MERGE_SHA>`) |
| --- | --- |
| Getrennte Werkbank/Feld-Shell-Grenzen | `apps/web/app/(werkbank)/layout.tsx` vs `apps/web/app/feld/layout.tsx`; `apps/web/test/feld-shell.test.tsx` |
| Werkbank 1440/1920 | PR-#100-Journey-Steps (Step 2a) — Viewport 1440×900 + 1920×1080, axe/Overflow |
| Feld 320/375 | Journey Test 3 (`journey.pwtest.ts`, 320/375, axe, Reflow, 40 px) |
| Versionierte API/Contracts/Client | `packages/contracts/openapi/v1.json`; `apps/web/test/api-base-path.test.ts`; eine Composition Root `app/providers.tsx` |
| `packages/ui` domänenfrei | Regel `ui-dependency-allowlist` + Red-Case `architecture-red-case.test.ts` |
| Feld-Import-/Bundle-Grenze + ausführbare Gegenprobe | Regel `feld-shell-boundary` (`rules.ts`), Red-Case `architecture-red-case.test.ts` (läuft in jedem CI-Lauf) |
| Cross-Shell-Negativrechte | Journey Test 3 (`planung-forbidden`, API-403), Server-Gates `app/feld/layout.tsx` |
| Selected-Org `costs.read`, kein Any-Org-Fallback | `lib/kosten-freigabe.ts` + `kosten-freigabe.test.ts`; Regel `kosten-server-gate`; Journey 3b/9g2/Test 5 |
| Server-abgeleitete Session/Start-Shell | `lib/sitzung-server.ts`, `lib/feld/start-shell.ts`, Journey Test 4 |
| Gemeinsame Loading/Empty/Forbidden/Unauthenticated/Stale-Verträge | `packages/ui` (Loading/Empty/Error/StateBanner); `kosten-grenze.tsx`, `feld-start.tsx`; Stale = `STALE_VERSION` |
| Offline-read-only | **NOT_APPLICABLE_BY_CONTRACT** — bewusst nicht implementiert (`app/manifest.ts`, `next.config.ts`, `start-inhalt.tsx`); muss im Grenzdokument so benannt sein |
| Dokumentierte Bundle-/Import-/Routen-Grenzen | Shell-Grenzen-Dokument aus PR #100 (Step 2c) |
| Realer Admin Entry / realer Employee Entry | Journey Test 1 (Admin) / Test 3 (Employee), Pflichtjob `auth-journey` |
| Negative Cross-Shell-Journey | Journey Test 2 + Test 3 |
| Kriterien künftiger physischer/nativer Split | im Grenzdokument (gespiegelt aus Confluence 8486960 §2) |
| Kein zweites Backend / keine doppelte Domänenwahrheit | ADR-001; ein `apps/api`, eine Composition Root |

Regeln: Employee Heute/Woche = **EYT-81, kein EYT-113-Defekt** (Feld-Shell zeigt ehrlichen
`feld-keine-ansichten`-Zustand). Jede Zeile bekommt PASS / NOT_APPLICABLE_BY_CONTRACT /
FAIL mit konkretem Anker (Datei + Fundzeile aus `git grep`).

**Step 4: Gate**

Irgendeine Zeile FAIL oder ein Anker am Merge-SHA nicht auffindbar →
**`MERGED — CLOSEOUT BLOCKED — AC <name> without evidence on merge SHA`**, STOP (kein Jira-Done).

## Task 5: Jira-Closeout (nur wenn Tasks 1–4 grün)

**Step 1: Transitionen UNMITTELBAR vor Mutation lesen**

`mcp__claude_ai_Atlassian_Rovo__getTransitionsForJiraIssue` (cloudId wie oben, EYT-113).
Ziel: die Transition, deren Zielstatus `statusCategory.key == "done"` hat (Projektstatus
heißt vermutlich `Fertig` — den echten Namen aus der Antwort nehmen). **Keine IDs erfinden.**

**Step 2: Evidenzkommentar komponieren (compose → re-read → send)**

Entwurf nach `/private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/782525bc-d89b-49da-98a6-eb7bb61e24cf/scratchpad/eyt113-jira-kommentar.md`
schreiben, mit frischem Blick nochmals lesen (keine Selbstkorrektur-Fragmente, keine nackte
URL direkt vor Satzzeichen), dann `mcp__claude_ai_Atlassian_Rovo__addCommentToJiraIssue`.

Pflichtinhalt (kurz, faktisch):
- PR #100 gemerged; reviewter Head `71ee35b3…474c`; Merge-SHA `<MERGE_SHA>`
- Post-Merge-CI `<RUN_ID>`: 11/11 Pflichtjobs success, db-gates-Gate-Zeilen `skipped=0`
- AC-Matrix: alle Kriterien PASS bzw. Offline-read-only `NOT_APPLICABLE_BY_CONTRACT`
- Employee-Fachflächen (Heute/Woche) bleiben EYT-81
- **Kein Runtime-/Deploy-Nachweis; `BLOCKER_ENVIRONMENT_SEPARATION` unverändert offen**

**Step 3: Transition ausführen**

`mcp__claude_ai_Atlassian_Rovo__transitionJiraIssue` mit der in Step 1 GELESENEN ID.

**Step 4: Readback**

`getJiraIssue` EYT-113 erneut: Status = Done-Kategorie, Resolution gesetzt; Kommentar in
gerenderter Form gegenlesen (URL-/Satzzeichen-Falle). Abweichung → im Report als
`MERGED — CLOSEOUT BLOCKED — jira transition not verifiable` führen.

## Task 6: Confluence-Delivery-Reconciliation (Seite 31948801)

**Step 1: Seite lesen und sichern**

`mcp__claude_ai_Atlassian_Rovo__getConfluencePage` pageId `31948801`. Body ins Scratchpad
sichern (`eyt113-confluence-vorher.md`) — das ist die Vergleichsbasis für „Historie unverändert".

**Step 2: Abschnitt ANHÄNGEN (nichts umschreiben)**

Neuer Abschnitt am Ende, Titel z. B. `EYT-113 Closeout (30.08.2026)`, Inhalt:
PR #100 gemerged (Merge-SHA `<MERGE_SHA>`); Post-Merge-CI `<RUN_ID>` 11/11;
EYT-113 geschlossen; Employee-Fachflächen bleiben EYT-81; Produktions-/Runtime-Zustand
NICHT abgeleitet (`BLOCKER_ENVIRONMENT_SEPARATION` offen); nächste WIP-Lane EYT-147
Dispositionswerkbank; PO-Designentscheidung bleibt „Die Woche ist das Produkt."

`mcp__claude_ai_Atlassian_Rovo__updateConfluencePage` mit Body = alter Body + neuer
Abschnitt. Historische Abschnitte byte-gleich lassen.

**Step 3: Readback**

Seite erneut lesen: neuer Abschnitt vorhanden UND der alte Inhalt gegen die
Scratchpad-Sicherung geprüft (alle vorherigen Überschriften noch da, nichts gekürzt).

## Task 7: Sprint-579-WIP-Gate

**Step 1: WIP live lesen (issues-Modus, NIE count)**

`mcp__claude_ai_Atlassian_Rovo__searchJiraIssuesUsingJql`, JQL:
`project = EYT AND sprint = 579 AND statusCategory = "In Progress"` — Felder key, status, summary.

Erwartet: EYT-113 NICHT in der Ergebnisliste. Taucht es noch auf → Task-5-Readback
widerlegt → `MERGED — CLOSEOUT BLOCKED — EYT-113 still In Progress`.
EYT-147 wird NICHT gestartet, nicht transitioniert, nicht implementiert — nur als
nächste Lane benannt.

## Task 8: Schlussreport

Struktur exakt:

```
# CLOSEOUT EVIDENCE
- PR merged state/head/merge SHA: …
- master SHA: …
- post-merge CI (<RUN_ID>) + 11 Jobzeilen + db-gates-Gate-Zeilen: …
- finale EYT-113-AC-Matrix (jede Zeile mit Anker): …
- Jira: Kommentar-ID, Transition, Readback-Status/Resolution: …
- Confluence: Version vorher/nachher, Readback-Befund: …
- Sprint-579-WIP: …
- release-images (falls vorhanden): protokolliert, KEIN Deploy-Beweis
```

Danach genau EIN Verdikt (wörtlich):
`EYT-113 CLOSED — EYT-147 READY AS NEXT WIP` **oder**
`MERGED — CLOSEOUT BLOCKED — <reason>` **oder**
`BLOCKED — PR #100 NOT MERGED`.

Jede Behauptung im Report trägt ihre Evidenzstufe (CI-Lauf > lokaler Lauf > Report > Plan).
