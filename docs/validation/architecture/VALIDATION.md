# Validation Log – Boilerplate Architecture

Stand: 2026-07-23

## Passed

- `validate_analysis_report.py analysis_report.json` → PASS
- `check_sources_and_evidence.py analysis_report.json` → PASS
- `validate_output_order.py analysis_report.json` → PASS
- `validate_artifact_policy.py analysis_report.json` → PASS
- JSON Schema Draft 2020-12 validation against `analysis-report.schema.json` → PASS
- `validate_plan.py 2026-07-23-boilerplate-architecture.md` → PASS
  - Goal characters: 2765/3999
  - Task count: 20
- Exact Markdown heading-order check → PASS

## Known validator defect

`validate_output_order.py analysis_report.md` reports `text section order mismatch` because it uses substring search and therefore finds the required token `analysis` inside the earlier mandatory token `deep_reasoning_analysis_report`. Both tokens are mandatory, so this specific text check cannot pass as implemented. The report was instead checked with an exact-heading order validator; the canonical JSON passed the official order validator.

## Evidence status

- Repository documents inspected.
- GitHub code/manifest search returned no application code.
- Current technical claims checked against primary/official documentation.
- No runtime, deployment, load or production claim was made.
