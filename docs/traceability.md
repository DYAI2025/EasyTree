# Traceability Matrix

Feature Slug: `planning-draft-conflict-slice`  
Status: ready-for-user-confirmation

## Requirement Traceability

| Trace ID | Vision Item ID | Canvas Item ID | Requirement ID | Acceptance Criteria ID | Evidence Needed | Status | Source Type |
|---|---|---|---|---|---|---|---|
| TRC-001 | VIS-002, VIS-003 | CAN-001, CAN-005 | REQ-001 | AC-001 | EV-001: Browser-, API- und DB-Abgleich für reale Woche und Tenant-Isolation | linked | EXPLICIT |
| TRC-002 | VIS-006 | CAN-005, CAN-007 | REQ-002 | AC-002 | EV-002: Contract-/DB-Testvektoren, Forward-Migration, zwei Resets | linked | EXPLICIT |
| TRC-003 | VIS-006 | CAN-005, CAN-008 | REQ-003 | AC-003 | EV-003: UUID-v4-Scan, Runtime-Parse und grüne abhängige Suiten | linked | EXPLICIT |
| TRC-004 | VIS-002 | CAN-003, CAN-005 | REQ-004 | AC-004 | EV-004: Komponenten- und Browsertest für Pflichtangaben | linked | EXPLICIT |
| TRC-005 | VIS-002, VIS-004 | CAN-003, CAN-005, CAN-007 | REQ-005 | AC-005 | EV-005: Route-/Command-/Repository-Integrationstest im Tenantkontext | linked | EXPLICIT |
| TRC-006 | VIS-002, VIS-006 | CAN-003, CAN-005 | REQ-006 | AC-006 | EV-006: Negativtests mit stabilen Codes für alle definierten Ablehnungen | linked | EXPLICIT |
| TRC-007 | VIS-005, VIS-006 | CAN-007, CAN-008 | REQ-007 | AC-007 | EV-007: Fehler-Injektion und direkte Datenbank-Gegenprüfung | linked | EXPLICIT |
| TRC-008 | VIS-005, VIS-006 | CAN-005, CAN-008 | REQ-008 | AC-008 | EV-008: Retry-/Nebenläufigkeitstest mit Wirkungscount eins | linked | EXPLICIT |
| TRC-009 | VIS-003, VIS-005 | CAN-005, CAN-007 | REQ-009 | AC-009 | EV-009: Gemeinsame Gateway-Contract-Suite und Boundary-Test | linked | EXPLICIT |
| TRC-010 | VIS-002, VIS-006 | CAN-003, CAN-005 | REQ-010 | AC-010 | EV-010: Komponenten-, Responsive- und Accessibility-Smoke | linked | EXPLICIT |
| TRC-011 | VIS-004, VIS-006 | CAN-009, CAN-010 | REQ-011 | AC-011 | EV-011: Playwright-E2E mit Reload, zweitem Kontext und DB-Verifikation | linked | EXPLICIT |
| TRC-012 | VIS-005, VIS-006 | CAN-007, CAN-008, CAN-010 | REQ-012 | AC-012 | EV-012: Ausgeführte rote Gegenproben und fail-closed Reporting | linked | EXPLICIT |

## Source-to-Requirement Map

| Source ID | Supported Requirements | Status |
|---|---|---|
| SRC-001 | REQ-001, REQ-004, REQ-005, REQ-006, REQ-010, REQ-011 | linked |
| SRC-002 | REQ-001, REQ-005, REQ-006, REQ-007, REQ-008 | linked |
| SRC-003 | REQ-007, REQ-008, REQ-011, REQ-012 | linked |
| SRC-004 | REQ-009, REQ-010, REQ-012 | linked |
| SRC-005 | REQ-002 | linked |
| SRC-006 | REQ-003 | linked |
| SRC-007 | REQ-001, REQ-004, REQ-006, REQ-010, REQ-011, REQ-012 | linked |
| SRC-008 | REQ-001, REQ-008, REQ-009, REQ-012 | linked |
| SRC-009 | REQ-005, REQ-010 | linked |
| SRC-010 | REQ-007, REQ-011, REQ-012 | linked |

## Jira-to-Feature Map

| Jira Key | Feature Role | Requirements | Completion Evidence |
|---|---|---|---|
| EYT-88 | Datenintegritätsvoraussetzung | REQ-002 | AC-002 / EV-002 |
| EYT-91 | Vertragstreue Testdaten | REQ-003 | AC-003 / EV-003 |
| EYT-50 | Fachlicher Command- und Persistenzkern | REQ-005, REQ-006, REQ-007, REQ-008 | AC-005 bis AC-008 / EV-005 bis EV-008 |
| EYT-79 | Gateway und Fehlersemantik | REQ-009 | AC-009 / EV-009 |
| EYT-92 | Sichtbare Nutzerreise | REQ-001, REQ-004, REQ-010 | AC-001, AC-004, AC-010 / EV-001, EV-004, EV-010 |
| EYT-62 | Systemweiter Abschlussnachweis | REQ-011, REQ-012 | AC-011, AC-012 / EV-011, EV-012 |

## Gate Matrix

| Gate ID | Gate | Requirements | Pass Condition | Current Status |
|---|---|---|---|---|
| GATE-001 | Product Intent | REQ-001 bis REQ-012 | Vision und Canvas vom Nutzer bestätigt | blocked-user-confirmation |
| GATE-002 | Developer Feasibility | REQ-001 bis REQ-012 | Developers bestätigen Kapazität, Reihenfolge und Umsetzbarkeit | missing |
| GATE-003 | Data Integrity | REQ-002, REQ-003 | Forward-Migration, UUID-v4-Seeds und zwei Resets grün | open |
| GATE-004 | Write Correctness | REQ-005 bis REQ-008 | Command-, Transaktions-, Konflikt- und Idempotenztests grün | open |
| GATE-005 | Boundary Integrity | REQ-009, REQ-012 | Gateway-Verträge und Architekturregeln grün | partial-read-only |
| GATE-006 | User Journey | REQ-001, REQ-004, REQ-010, REQ-011 | Realer Browserfluss speichert und liest denselben Serverstand | open |
| GATE-007 | Counterproof | REQ-012 | Schutzannahmen absichtlich gebrochen und Tests nachweislich rot | open |
| GATE-008 | Feature Done | REQ-001 bis REQ-012 | alle vorherigen Gates grün, keine Must-Lücke, Rollback dokumentiert | blocked |

## Missing / Assumption / Blocker Ledger

| Ledger ID | Marker | Gegenstand | Auswirkung | Auflösung |
|---|---|---|---|---|
| LED-001 | MISSING | Nutzerbestätigung von Vision und Canvas | Kein Status `READY_FOR_AGILETEAM_PLANNING` | Nutzer gibt die festgelegte Bestätigungsformel ab |
| LED-002 | MISSING | Developers-Gate zur Kapazität | Kein belastbares Sprint-Commitment | Entwickler bestätigen Scope und Reihenfolge |
| LED-003 | ASSUMPTION | PR #23 bleibt technische Basis | Branch-/Merge-Risiko | PR-Reihenfolge festlegen und vor Merge revalidieren |
| LED-004 | ASSUMPTION | Server-injiziertes Testsubjekt bleibt zulässig | E2E kann ohne produktives Auth laufen | Security-Grenze im Test erneut nachweisen |
| LED-005 | BLOCKER | Write-Through ist im aktuellen Code nicht implementiert | Feature ist nicht Done | REQ-005 bis REQ-011 umsetzen und belegen |
| LED-006 | BLOCKER | EYT-88 und EYT-91 sind offen | Realer Schreibpfad kann fachlich oder vertraglich fehlschlagen | Vor Command-E2E schließen |

## Traceability Summary

- Requirements total: 12
- Requirements with Vision link: 12
- Requirements with Canvas link: 12
- Requirements with Acceptance Criteria: 12
- Requirements with Evidence: 12
- Unlinked requirements: 0
- Product confirmation: pending
- Implementation status: partial; Read-Through belegt, Write-Through offen

## User Confirmation

Die Matrix ist vollständig verknüpft, aber noch nicht nutzerbestätigt.

> Ich bestätige, dass Product Canvas und Product Vision meine Absicht korrekt wiedergeben und als Grundlage für AgileTeam Planning verwendet werden dürfen.
