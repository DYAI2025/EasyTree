# Arboscus Teamplaner — Coding Agent Handoff v1.3

**Source of truth:** `prd_report_v1.3.md` / `prd_report_v1.3.json`
**Canonical repository:** `https://github.com/DYAI2025/Arborga.git`

## Active scope

Implement only the approved MVP phases 1-6. The post-MVP Planning Economics and Machine Rental capability is documented for Jira and architecture continuity but is not active implementation scope.

## Post-MVP economics boundary

Do not implement `FR-062` through `FR-070`, `DATA-023` through `DATA-026`, `API-019` through `API-021`, `PHASE-007`, or `TASK-032` through `TASK-036` unless the user explicitly starts that phase.

When separately approved:

- default access is Administrator and Management only;
- employee access is denied server-side;
- rates are individual, net EUR, hourly or daily, and effective-dated;
- historical calculations retain applied rate-version IDs;
- planned costs use planned assignments/reservations;
- actual costs use approved time and confirmed resource usage only;
- revenue is limited to confirmed machine rental;
- no payroll, invoice, VAT/gross, payment, ledger, tax, or unrelated revenue functionality is permitted.

## Stop conditions

Stop before implementing the future module if permissions, effective-date migration, actual resource-usage confirmation, feature-flag rollout, report/export scope, or rollback are not approved.

## Validation

- Validate the PRD JSON before implementation.
- Add authorization, rate-version, historical-reproducibility, calculation, audit, and scope-boundary tests in the same future slice.
- Preserve planning, time, resource, and audit source facts during rollback.
