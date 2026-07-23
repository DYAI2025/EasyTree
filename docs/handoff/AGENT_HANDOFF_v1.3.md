# Arboscus Teamplaner – Coding Agent Handoff v1.3

**Source of truth:** `docs/prd/CURRENT_PRD_v1.3.md` and the validated PRD artifacts  
**Canonical repository:** `DYAI2025/Arborga`

## Active scope

Implement only the approved MVP phases 1–6. The Post-MVP Planungsökonomie und Maschinenverleih capability is documented for Jira and architecture continuity but is not active implementation scope.

## Post-MVP boundary

Do not implement the future economic module unless the user explicitly starts that phase.

When separately approved:

- default access is Administrator and Management only;
- employee access is denied server-side;
- rates are individual, net EUR, hourly or daily, and effective-dated;
- historical calculations retain applied rate-version IDs;
- planned values use planned assignments and reservations;
- confirmed values use approved time and confirmed resource usage only;
- revenue is limited to confirmed machine rental;
- no payroll, invoice, VAT/gross, payment, ledger, tax, or unrelated revenue functionality is permitted.

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

## Stop conditions

Stop and report evidence when:

- a protected workflow or authorization rule is ambiguous;
- a schema change is not covered by the PRD or an ADR;
- a new provider or background job lacks an ADR;
- repository-specific validation commands are unknown;
- a destructive migration or production action is required;
- weather fields, freshness, warning semantics or provider behavior conflict with the PRD;
- Post-MVP economic requirements would enter MVP code.

## Human review checkpoints

- after clickdummy testing;
- after architecture and ADR package;
- before each phase merge;
- before pilot with real personal data;
- after security, accessibility and backup/restore tests;
- before production release;
- before enabling any Post-MVP economic feature.
