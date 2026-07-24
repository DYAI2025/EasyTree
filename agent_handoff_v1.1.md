# Arboscus Teamplaner - Coding Agent Handoff v1.1

**Source of truth:** `prd_report.md` / `prd_report.json`

## Objective

Implement the Arboscus Teamplaner in the approved phases, preserving product scope, authorization, traceability, and release gates.

## Allowed scope

- MISSING: repository not supplied. During TASK-003 define allowed modules per phase.
- docs/prd/**
- docs/adr/**
- tests/** and implementation modules explicitly assigned to the active phase.

## Prohibited files

- Unrelated repositories or modules
- Production secrets or credential files
- Historical data outside approved migrations

## Prohibited actions

- Do not bypass authorization.
- Do not invent core statuses, data schema, permissions, or provider behavior.
- Do not add payroll, invoicing, continuous GPS, geofencing, or full ERP scope.
- Do not perform destructive migrations without approved rollback.
- Do not log private origins, medical details, credentials, or sensitive free text.
- Do not create automatic weather-based work cancellation, planning blocks, or safety decisions without explicit approved requirements.

## Validation

- python /home/oai/skills/ai-native-prd-architect/scripts/validate_prd_output.py prd_report.json
- MISSING: repository-specific lint command
- MISSING: repository-specific type-check command
- MISSING: repository-specific unit/integration/e2e commands

## Stop conditions

- Repository or stack is not selected.
- A requirement conflicts with existing architecture.
- A persistent schema change is not covered by this PRD or an ADR.
- A protected workflow or authorization rule is ambiguous.
- A new external provider or background job is proposed without ADR.
- A destructive migration or production data action is required.
- Weather fields, refresh policy, warning channels, or safety semantics are required but remain undecided.

## Human review checkpoints

- After clickdummy testing
- After ADR and architecture package
- Before each phase merge
- Before real personal data pilot
- After backup restore and security test
- Before production release
