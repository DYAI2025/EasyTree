# EYT-140 Plan-M6 Run-Ledger Closeout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Record `implementation-m6 = CLEARED` in the existing canonical run ledger so `resume-point` advances to `implementation-m7`, without touching product code, M7, M9, or any delivery gate.

**Architecture:** The canonical ledger is a tracked, append-only JSONL file. Its reader (`plumbline_run_ledger.py`) orders gates by **first occurrence** but evaluates the **latest** row per gate. Because `implementation-m6` already holds a first-seen slot ahead of m7/m9/merge, a single **appended** `CLEARED` row is sufficient and correct — it supersedes the PENDING status while preserving the append-only invariant and rewriting no history.

**Tech Stack:** `plumbline_run_ledger.py` (pure stdlib Python, invoked via `/usr/bin/python3`), git, `gh`.

---

## Verified Context (measured before this plan was written)

| Fact                            | Value                                                                                                 | How verified                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Ledger (canonical, unambiguous) | `docs/context/easytree-sprint-6-core-journey.run-ledger.jsonl`                                        | only file on the branch containing the resume sequence |
| Working copy                    | `/Users/benjaminpoersch/EasyTree-worktrees/eyt-140-planungswerkbank`                                  | `git worktree list`; clean; HEAD = PR head             |
| PR head                         | `26091574200e7e0c55130980a814fdf9af8b62cd`                                                            | `git rev-parse origin/feat/eyt-140-planungswerkbank`   |
| origin/master                   | `f3b427ddb4d030baffbaa9073eff9bc8e3f28a7c`                                                            | `git rev-parse origin/master`                          |
| PR #78                          | OPEN, isDraft=true, mergedAt=null                                                                     | `gh pr view 78 --json ...`                             |
| CI 32275026739                  | conclusion=success, headSha=PR head                                                                   | `gh run view 32275026739 --json ...`                   |
| Current resume-point            | `implementation-m6`                                                                                   | `plumbline_run_ledger.py resume-point`                 |
| Ledger baseline                 | 18 lines, sha256 `7084e28369b6956752db3be7c77b49ee22bd17e06019888f5d01721a95d0678c`, exactly 1 m6 row | `wc -l`, `shasum -a 256`, `grep -c`                    |

**Two environment traps confirmed by measurement — the plan works around both:**

1. `grep` in this shell is a **shell function** wrapping `ugrep --ignore-files`. It returned _empty_ for a file that provably contains the string. **Use `/usr/bin/grep` for every check.** Same for `sed`/`head`/`wc`.
2. The `plumbline-run-ledger` wrapper fails: the PATH `python3` shim demands `uv run`. **Call `/usr/bin/python3 <lib>/plumbline_run_ledger.py` directly.**

**Why append (not in-place edit):** `cmd_resume_point` iterates `iter_first_seen_gates(rows)` and tests `latest_status_by_gate(rows)[gate]`. Commit `20be93c` had to rewrite lines only because m6 had **no** row at all (an appended row would have sorted after `merge`). That precondition no longer holds — m6 already occupies position 13 — so appending is both effective and history-preserving.

**Artifact-hash convention (verified, not assumed):** the `implementation-m8` row's hash is byte-identical to `shasum -a 256 apps/web/components/kosten-uebergang.tsx`. The M6 analogue is `apps/web/components/planungs-werkbank.tsx` = `2439e6260b6b597bb3783d1a0b402bea68b0cf7ea7afb40798bf88567f1c231d`. Binding to it makes `revalidate --gate implementation-m6` a machine-checkable readback.

---

## Task 1: Preflight — base safety and state consistency (NO mutation)

**Files:** none (read-only)

**Step 1: Set the shared variables**

```bash
export REPO=/Users/benjaminpoersch/EasyTree-worktrees/eyt-140-planungswerkbank
export FEATURE=easytree-sprint-6-core-journey
export LEDGER="$REPO/docs/context/$FEATURE.run-ledger.jsonl"
export RL=/Users/benjaminpoersch/.claude/lib/plumbline_run_ledger.py
cd "$REPO"
```

**Step 2: Fetch and verify no drift**

```bash
git fetch --all --prune
git rev-parse origin/feat/eyt-140-planungswerkbank
git rev-parse origin/master
```

Expected, exactly:

```
26091574200e7e0c55130980a814fdf9af8b62cd
f3b427ddb4d030baffbaa9073eff9bc8e3f28a7c
```

**STOP CONDITION:** any other value → report `HEAD_DRIFT` (first) or `BASE_DRIFT` (second) and mutate nothing.

**Step 3: Verify the working tree is clean and on the PR head**

```bash
git status --porcelain
git rev-parse HEAD
```

Expected: empty output, then `26091574200e7e0c55130980a814fdf9af8b62cd`.

**STOP CONDITION:** dirty tree → stop; a ledger-only commit cannot be guaranteed.

**Step 4: Verify the ledger baseline is untouched**

```bash
/usr/bin/wc -l < "$LEDGER"
shasum -a 256 "$LEDGER"
/usr/bin/grep -c '"gate": "implementation-m6"' "$LEDGER"
```

Expected: `18`, sha256 `7084e28369b6956752db3be7c77b49ee22bd17e06019888f5d01721a95d0678c`, count `1`.

**STOP CONDITION:** mismatch → the ledger changed since this plan was written; re-derive before proceeding.

**Step 5: Confirm M6 is genuinely still pending**

```bash
/usr/bin/python3 "$RL" resume-point --repo "$REPO" --feature "$FEATURE"
/usr/bin/grep '"gate": "implementation-m6"' "$LEDGER"
```

Expected: `implementation-m6`, and the single m6 row showing `"status": "PENDING"`.

**STOP CONDITION:** if resume-point is anything else, or the m6 row is already `CLEARED`, the work is already done or the state is inconsistent with the brief → stop, report, mutate nothing.

---

## Task 2: Append the CLEARED row

**Files:**

- Modify (append one line): `docs/context/easytree-sprint-6-core-journey.run-ledger.jsonl`

**Step 1: Confirm the artifact hash still matches the M6 component**

```bash
shasum -a 256 apps/web/components/planungs-werkbank.tsx
```

Expected: `2439e6260b6b597bb3783d1a0b402bea68b0cf7ea7afb40798bf88567f1c231d`

**STOP CONDITION:** mismatch → the M6 artifact changed; do not bind a CLEAR to a stale hash.

**Step 2: Pin the event timestamp (caller-supplied, matching the newest row's format)**

```bash
export AT=$(/usr/bin/python3 -c "import datetime;print(datetime.datetime.now().astimezone().isoformat(timespec='seconds'))")
echo "$AT"
```

Expected: an ISO-8601 instant such as `2026-08-20T00:31:12+02:00`.

**Step 3: Record the gate (this is the only mutation)**

```bash
/usr/bin/python3 "$RL" record \
  --repo "$REPO" \
  --feature "$FEATURE" \
  --gate implementation-m6 \
  --status CLEARED \
  --artifact-hash 2439e6260b6b597bb3783d1a0b402bea68b0cf7ea7afb40798bf88567f1c231d \
  --at "$AT"
```

Expected: `recorded implementation-m6=CLEARED -> /Users/.../easytree-sprint-6-core-journey.run-ledger.jsonl`

---

## Task 3: Read-after-write verification

**Files:** none (read-only)

**Step 1: Verify the mutation itself landed (grep the new content before trusting any validator)**

```bash
/usr/bin/wc -l < "$LEDGER"
/usr/bin/grep -c '"gate": "implementation-m6"' "$LEDGER"
/usr/bin/tail -1 "$LEDGER"
```

Expected: `19`; count `2`; last line is the new m6 row with `"status": "CLEARED"`.

**Step 2: Prove no pre-existing line changed (the previous ledger commit's own standard)**

```bash
/usr/bin/sed -n '1,18p' "$LEDGER" | shasum -a 256
```

Expected: `7084e28369b6956752db3be7c77b49ee22bd17e06019888f5d01721a95d0678c` — byte-identical to the baseline.

**STOP CONDITION:** any other hash → an unrelated entry was altered; revert with `git checkout -- "$LEDGER"` and stop.

**Step 3: Verify the resume point advanced to M7 and no further**

```bash
/usr/bin/python3 "$RL" resume-point --repo "$REPO" --feature "$FEATURE"
```

Expected, exactly: `implementation-m7`

**STOP CONDITION:** `abschlussgate-m9`, `merge`, `deploy`, `production-verification`, or a sentinel → M7 was skipped or the run was laundered as complete; revert and stop.

**Step 4: Verify M6 revalidates and the downstream gates are still PENDING**

```bash
/usr/bin/python3 "$RL" revalidate --repo "$REPO" --feature "$FEATURE" \
  --gate implementation-m6 \
  --current-hash 2439e6260b6b597bb3783d1a0b402bea68b0cf7ea7afb40798bf88567f1c231d; echo "revalidate_exit=$?"

for g in implementation-m7 abschlussgate-m9 merge deploy production-verification; do
  printf '%s -> ' "$g"
  /usr/bin/grep "\"gate\": \"$g\"" "$LEDGER" | /usr/bin/tail -1 | /usr/bin/sed -E 's/.*"status": "([A-Z]+)".*/\1/'
done
```

Expected:

```
revalidate_exit=0
implementation-m7 -> PENDING
abschlussgate-m9 -> PENDING
merge -> PENDING
deploy -> PENDING
production-verification -> PENDING
```

**Step 5: Verify the diff touches exactly one file, one added line, zero removed**

```bash
git diff --stat
git diff --numstat
```

Expected: only `docs/context/easytree-sprint-6-core-journey.run-ledger.jsonl`, numstat `1	0	docs/context/...`.

**STOP CONDITION:** any second file, or a non-zero deletion count → stop and revert.

---

## Task 4: Commit the ledger-only change

**Files:**

- Commit: `docs/context/easytree-sprint-6-core-journey.run-ledger.jsonl` (and nothing else)

**Step 1: Stage only the ledger**

```bash
git add docs/context/easytree-sprint-6-core-journey.run-ledger.jsonl
git status --porcelain --untracked-files=no
```

Expected: exactly one line, `M  docs/context/easytree-sprint-6-core-journey.run-ledger.jsonl`.

**Step 2: Commit (no amend, no history rewrite)**

```bash
git commit -m "$(cat <<'EOF'
chore(EYT-140): Plan-M6 im Run-Ledger als CLEARED protokollieren

Reine Governance-Buchung. Kein Produktcode beruehrt, keine weitere Stufe geoeffnet.

Belegt durch:
- M6-Implementierungsstand 26091574200e7e0c55130980a814fdf9af8b62cd
  (vier Dateien: globals.css, planung/page.tsx, planungs-werkbank.tsx,
  planungs-werkbank.test.tsx)
- Exact-Head-CI 32275026739, conclusion success, 11 von 11 Jobs
- Product-Owner-Rereview: ACCEPTED (die CTA-Pruefung ueber
  .eyt-primary-action ist ausdruecklich ratifiziert, weil die bestehende
  Primaeraktion ihren stabilen data-testid-Kontrakt behalten muss)

Mechanik: eine angehaengte Zeile, gebunden an den Hash von
apps/web/components/planungs-werkbank.tsx (2439e626) - analog zur
implementation-m8-Zeile. Reines Anhaengen genuegt hier, weil
implementation-m6 seit 20be93c bereits eine First-Seen-Position vor m7,
m9 und merge besitzt; resume-point ordnet nach erstem Auftreten und
wertet den letzten Status. Damit bleibt die Append-only-Eigenschaft
gewahrt, die 20be93c auf Dateiebene brechen musste.

Gemessen:
- resume-point vorher implementation-m6, nachher implementation-m7
- die 18 vorbestehenden Zeilen byte-identisch (sha256 7084e283 unveraendert)
- revalidate --gate implementation-m6 exit 0
- m7, m9, merge, deploy, production-verification unveraendert PENDING
- git diff --numstat: 1 hinzugefuegt, 0 entfernt, genau eine Datei

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Step 3: Verify the commit contains exactly one file**

```bash
git show --stat --name-only --format="%H" HEAD | /usr/bin/tail -5
git rev-parse HEAD
```

Expected: the only filename listed is the ledger.

---

## Task 5: Push and read back the remote state

**Files:** none

**Step 1: Push to the existing branch (no force)**

```bash
git push origin feat/eyt-140-planungswerkbank
```

Expected: a normal fast-forward update from `2609157` to the new SHA.

**STOP CONDITION:** a rejected/non-fast-forward push → stop; do NOT force.

**Step 2: Confirm the remote head matches the local commit**

```bash
git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/feat/eyt-140-planungswerkbank
```

Expected: both identical.

**Step 3: Confirm PR #78 is still OPEN and DRAFT**

```bash
gh pr view 78 --json number,state,isDraft,mergedAt,headRefOid
```

Expected: `"state":"OPEN"`, `"isDraft":true`, `"mergedAt":null`, `headRefOid` = the new commit.

**STOP CONDITION:** state not OPEN, or isDraft false → report immediately; the PR must not have been readied or merged.

**Step 4: Record whether a new CI run was triggered**

```bash
sleep 20
gh run list --branch feat/eyt-140-planungswerkbank --limit 3 \
  --json databaseId,headSha,status,conclusion,event
```

Report the run for the new head verbatim, whatever its status (`queued` / `in_progress` / a conclusion). Do **not** wait for it to finish and do **not** act on it — the M6 evidence basis is the exact-head run `32275026739` on `26091574`, which is already SUCCESS. A ledger-only commit is expected to trigger a fresh run; that run is reported, not gated on.

---

## Task 6: Final evidence report

Emit exactly the requested block, filled from measured output only:

```
LEDGER:
docs/context/easytree-sprint-6-core-journey.run-ledger.jsonl
(worktree /Users/benjaminpoersch/EasyTree-worktrees/eyt-140-planungswerkbank,
 branch feat/eyt-140-planungswerkbank; mechanism: plumbline_run_ledger.py record)

BEFORE:
implementation-m6 = PENDING

AFTER:
implementation-m6 = CLEARED

NEXT:
implementation-m7 = PENDING   (resume-point output)

REMAINING:
abschlussgate-m9 = PENDING
merge = PENDING
deploy = PENDING
production-verification = PENDING

MUTATION:
changed files/state: <from git diff --numstat>
commit SHA if any: <sha>
pushed head if any: <sha>

CI:
<new run id + status, or "not triggered">

PR:
OPEN / DRAFT / not merged

FINAL VERDICT:
M6_LEDGER_CLEARED
```

**Then STOP. Do not start M7.**

---

## Out of scope (explicitly not authorized)

M7 implementation · any product-code change · PR ready-for-review · merge · deploy · Jira mutation · Confluence mutation · PR-body cleanup · re-clearing `canvas-confirm` or `traceability` · M9 · infrastructure changes · claiming `READY_FOR_AGILETEAM_PLANNING`.

**Known finding, deliberately NOT acted on:** commit `20be93c` reports that `canvas-confirm` (2d61c1aa) and `traceability` (66efc779) are bound to artifacts that have since changed, so `revalidate` reports them STALE. Both are human gates and are out of scope here. Do not re-clear them.

**Note:** this plan file is untracked and must not be committed — the ledger commit stages the ledger path explicitly and nothing else.
