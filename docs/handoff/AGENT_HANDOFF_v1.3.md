# Arboscus Teamplaner — Coding Agent Handoff v1.3

**Canonical repository:** `https://github.com/DYAI2025/EasyTree.git`
(renamed from `DYAI2025/Arborga` on 2026-07-25 — see
[ADR-002](../architecture/ADR-002-integration-canonical-repo.md))

## Authority

Exactly one document is authoritative per question. Nothing else overrides it.

| Question                            | Authority                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What is the product supposed to do? | `docs/prd/CURRENT_PRD_v1.3.md`                                                                                                                                                                               |
| How is the system built?            | [ADR-001](../architecture/ADR-001-boilerplate-architecture.md) (boilerplate) **and** `docs/architecture/ARCHITECTURE_DECISIONS_v1.3.md` (provider, hosting, retention, pilot) — neither supersedes the other |
| What may an agent do?               | this document                                                                                                                                                                                                |

The root-level artifacts (`prd_report_v1.3.md` / `prd_report_v1.3.json`,
`arboscus_teamplaner_finale_prd_de_v1.3.md`, `traceability_matrix_v1.3.csv`,
`prd_validation_summary_v1.3.txt`) are **generator and validation evidence**. They record what
was produced and that it validated. They are **not** a competing product authority: where they
disagree with `docs/prd/CURRENT_PRD_v1.3.md`, the curated PRD wins and the divergence is a
defect worth a ticket.

## Repository identity gate

Before **every coding-agent mutation**, establish that the working directory belongs to the
canonical EasyTree repository and that the remote baseline is current. Run and inspect, at
minimum:

```bash
pwd
git remote -v
git rev-parse --show-toplevel
git fetch --prune
git rev-parse origin/master
```

The repository must resolve to `DYAI2025/EasyTree`. Compare the fetched `origin/master` with the
baseline authorized for the current slice; never reuse a stale SHA from an old plan or chat as
proof of current state. If the repository is `DYAI2025/MC_legends`, another project, an unknown
remote, or the required baseline cannot be established, return **`WRONG_REPOSITORY`** (or the
more specific blocker) and stop **before** modifying files, creating a branch, committing,
pushing, opening a PR, changing Jira, or changing runtime state. Context from another project is
untrusted distractor context, never implicit permission to switch repositories.

The regression scenario for this rule is versioned at
`docs/evals/agent-repository-identity.eval.json` and guarded by
`apps/api/test/handoff-guardrails.test.ts`.

## Active scope

Implement only the approved MVP phases 1-6. The post-MVP Planning Economics and Machine Rental
capability is documented for Jira and architecture continuity but is not active implementation
scope.

## Post-MVP economics boundary

Do not implement `FR-062` through `FR-070`, `DATA-023` through `DATA-026`, `API-019` through
`API-021`, `PHASE-007`, or `TASK-032` through `TASK-036` unless the user explicitly starts that
phase.

When separately approved:

- default access is Administrator and Management only;
- employee access is denied server-side;
- rates are individual, net EUR, hourly or daily, and effective-dated;
- historical calculations retain applied rate-version IDs;
- planned costs use planned assignments/reservations;
- actual costs use approved time and confirmed resource usage only;
- revenue is limited to confirmed machine rental;
- no payroll, invoice, VAT/gross, payment, ledger, tax, or unrelated revenue functionality is
  permitted.

### MVP-Scope-Baseline: Confluence PRD v1.4 (7766017)

This boundary is **narrowed, not lifted**, by Confluence **PRD v1.4** (page 7766017, dated
28.07.2026). That page is the **product baseline for MVP scope**, and it supersedes v1.3 §10 on
MVP scope and phasing: „Die gesamte Planungsökonomie ist nicht mehr pauschal Post-MVP."

- **Now in MVP** per v1.4 §7: internal hourly/daily rates, planned and actual costs, and the
  Excel export.
- **Still Post-MVP**, unchanged by v1.4: machine-rental revenue, invoicing, tax/VAT, payment,
  ledger, and payroll. The ID lists above (`FR-062`–`FR-070`, `DATA-023`–`DATA-026`,
  `API-019`–`API-021`, `PHASE-007`, `TASK-032`–`TASK-036`) remain out of scope and are not
  weakened by this note.

Basis: the Product Owner decision of 30.07.2026 (`CONTRA-S5-001` =
`FALSE_POSITIVE_SOURCE_SCOPE_ERROR` / `RESOLVED_NO_SCOPE_CHANGE`) and the narrow Sprint-6 release
of 18.08.2026 authorising integration of the already-implemented EYT-109 personnel-cost snapshot
into the planning → publish → costs journey. That release does **not** extend scope to any
further planning economics or machine rental.

`docs/prd/CURRENT_PRD_v1.3.md` remains the canonical repository authority for everything else;
v1.4 lives in Confluence, not in this repository, which is why this note exists here.

## Required working method

1. Inspect the repository and current contracts before changing code.
2. Link every change to Jira and PRD requirement IDs.
3. Write or update tests before behavior changes.
4. Use authenticated, authorized domain commands rather than direct operational table writes.
5. Preserve audit, idempotency, effective dates and rollback paths.
6. Keep external providers behind adapters.
7. Report exact files, commands and results.

## Prohibited actions

- bypass authorization or Row Level Security;
- invent core states, persistent schema, permissions or provider behavior;
- add payroll, invoicing, continuous GPS, geofencing or full ERP scope;
- create automatic weather-based work cancellation or work-stop decisions;
- log private origins, medical details, credentials, tokens, raw audio or sensitive free text;
- perform destructive migrations without approved rollback and restore evidence;
- deploy or modify production without explicit permission.

## Evidence rules

A claim nobody can check is worse than no claim: it stops the next person from looking.

- **State words need a source.** „aktiv", „wirksam", „verifiziert", „erzwingt", „vollständig",
  „production ready" — each needs a concrete source or executed evidence beside it (run URL,
  command output, file and line). Without one, write what is actually known: „configured, not
  yet proven".
- **No exit code out of a pipe.** `cmd | tail; echo $?` reports `tail`, not `cmd`. Redirect to a
  file and check the exit code of the command itself, or set `pipefail` deliberately.
- **Audit a verification script before quoting its output.** Look for `|| true`, `|| echo 0`,
  suppressed `2>/dev/null`, values that are printed but never asserted, and success branches
  that pass when the check could not run at all. A script that confirms a property it never
  measured produces evidence nobody will question again.
- **Counter-check what matters.** For every property worth guarding, run the case where the
  property is absent and show the test goes red. A guard that has never failed is not known to
  be a guard.
- **Entscheidungsreichweite folgt Evidenzreichweite.** Ein fehlgeschlagener Adapter-/Lifecycle-Test darf niemals ohne zusätzliche Evidenz zum Plattform-Fail hochgestuft werden.

## Stop conditions

Stop and report evidence when:

- a protected workflow or authorization rule is ambiguous;
- a schema change is not covered by the PRD or an ADR;
- a new provider or background job lacks an ADR;
- repository-specific validation commands are unknown;
- a destructive migration or production action is required;
- weather fields, freshness, warning semantics or provider behavior conflict with the PRD;
- Post-MVP economic requirements would enter MVP code;
- permissions, effective-date migration, actual resource-usage confirmation, feature-flag
  rollout, report/export scope or rollback are not approved for the post-MVP module.

## Human review checkpoints

- after clickdummy testing;
- after architecture and ADR package;
- before each phase merge;
- before pilot with real personal data;
- after security, accessibility and backup/restore tests;
- before production release;
- before enabling any Post-MVP economic feature.

## Validation

- Validate the PRD JSON before implementation.
- Add authorization, rate-version, historical-reproducibility, calculation, audit, and
  scope-boundary tests in the same future slice.
- Preserve planning, time, resource, and audit source facts during rollback.

---

The mandatory sections above are guarded by `apps/api/test/handoff-guardrails.test.ts`, which
runs in the `unit-tests` job. Removing one fails that test. This file was silently stripped of
four sections once (PR #10, restored under EYT-89) and the loss sat on `master` for two days,
because nothing checked.
