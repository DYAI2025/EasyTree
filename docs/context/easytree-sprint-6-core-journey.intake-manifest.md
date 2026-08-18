# Plumbline AgileTeam Intake — EasyTree Sprint 6

> ## ⚠️ EINGEFRORENER INTAKE-STAND — NICHT DER AKTUELLE STAND
>
> **Dieses Dokument gibt den Stand vom 18.08.2026 _vor_ der Auflösung des
> Produktautoritäts-Widerspruchs wieder. Es ist Provenienz, keine Auskunft über heute.**
>
> Alles darunter — insbesondere `Readiness-Level: BLOCKED_CONTRADICTION`,
> „User confirmation: NOT YET PROVIDED" und „Contradiction handling: BLOCKED_CONTRADICTION" —
> beschreibt den Zustand **vor** der Entscheidung. Es steht damit maschinenlesbar im Widerspruch
> zu den vier bestätigten Artefakten im selben Commit. Der historische Inhalt wird deshalb
> **nicht umgeschrieben**: er belegt, worauf sich die Entscheidung bezog. Wer den aktuellen Stand
> braucht, liest ihn dort:
>
> | Frage                              | Aktueller Stand steht in                                                                                                                                                                                                                           |
> | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Ist der Widerspruch aufgelöst?     | [`../canvas/easytree-sprint-6-core-journey.canvas.md`](../canvas/easytree-sprint-6-core-journey.canvas.md), Kopfabschnitt „Auflösung `OQ-001`"                                                                                                     |
> | Liegt die Nutzerbestätigung vor?   | [`../vision/easytree-sprint-6-core-journey.vision.md`](../vision/easytree-sprint-6-core-journey.vision.md) und [`../prd/easytree-sprint-6-core-journey.prd.md`](../prd/easytree-sprint-6-core-journey.prd.md) — **beide Formeln wörtlich zitiert** |
> | Was ist zu bauen, mit welchen IDs? | [`../prd/easytree-sprint-6-core-journey.prd.md`](../prd/easytree-sprint-6-core-journey.prd.md) — `REQ-001` … `REQ-017`, `AC-001` … `AC-040`                                                                                                        |
> | Was ist belegt, was blockiert?     | [`../traceability.md`](../traceability.md), Abschnitt „Sprint 6 — Core Journey"                                                                                                                                                                    |
>
> **Kurzfassung der Auflösung (18.08.2026):** `OQ-001` ist aufgelöst — die kanonische fachliche
> Baseline ist Confluence PRD v1.4 (7766017), nicht die Repository-Kopie v1.3. Der Product Owner
> hat beide Formeln wörtlich erteilt. `OQ-002` bis `OQ-005` bleiben offen; hinzugekommen sind
> `OQ-008` bis `OQ-010` sowie die Anforderungen `REQ-016` und `REQ-017`.

Readiness-Level: BLOCKED_CONTRADICTION (**eingefroren, Stand vor der Auflösung — siehe Kopf**)
Mode: PLUMBLINE_READY_PACKAGE
Target Agent: Claude Code Opus 5
Feature Slug: `easytree-sprint-6-core-journey`
Generated: 2026-08-18, Europe/Berlin
Canonical Repository: `DYAI2025/EasyTree`

## 1. Readiness Card

### Product intent

`EXPLICIT` Sprint 6 soll erstmals eine zusammenhängende, reale Admin-Kernreise liefern:

Login → Arbeitswoche wählen → echten Einsatz anlegen → bestätigten Serverzustand nach Reload sehen → konfliktfreien Plan veröffentlichen → zu Kosten wechseln → gespeicherten EYT-109-Kosten-Snapshot laden/erzeugen → Tages-/Gesamtsummen und Einzelpositionen prüfen → in einem zweiten Browserkontext dieselben veröffentlichten IDs und denselben Snapshot sehen.

### Current Sprint

`EXPLICIT` Offener Jira-Sprint enthält genau:

- EYT-137 — Outcome-Anker
- EYT-140 — Planungswerkbank und Wochennavigation
- EYT-141 — Basisdesign-v2-Kohärenz für Planung und Kosten
- EYT-142 — primäres Cloudflare-Staging und reale E2E-Abnahme

### Current repository snapshot

`EXPLICIT` Zum Intake-Zeitpunkt:

- `origin/master`: `f3b427ddb4d030baffbaa9073eff9bc8e3f28a7c`
- Merge: PR #77 — Coding-Agent Repository Identity Gate
- offene PRs: keine

Dieser SHA ist nur ein Intake-Snapshot. Claude MUSS vor jeder Mutation `git fetch --prune` ausführen und den aktuellen `origin/master` neu bestimmen.

### Readiness blocker

`CONTRADICTION` Die aktuelle Repository-Autorität `docs/prd/CURRENT_PRD_v1.3.md` und `docs/handoff/AGENT_HANDOFF_v1.3.md` behandelt Planungsökonomie/Maschinenverleih weiterhin als separat freizugebendes Post-MVP-Modul. Der aktuelle Sprint 6 verlangt dagegen die Integration und reale Staging-Abnahme des bereits gemergten EYT-109-Personalkosten-Snapshots.

Das Intake darf diesen Konflikt nicht still auflösen. Für AgileTeam-/Claude-Ausführung braucht es eine explizite Produktentscheidung:

> Sprint 6 ist ausdrücklich autorisiert, den bereits implementierten EYT-109-Personalkosten-Snapshot in Planung → Publish → Kosten zu integrieren und auf Staging abzunehmen. Diese Freigabe erweitert NICHT den Scope auf weitere Planungsökonomie, Maschinenverleih, Payroll, Rechnungen, VAT, Buchhaltung oder andere FR-062–FR-070-Funktionen.

Bis diese Entscheidung bestätigt bzw. in der kanonischen Produkt-Autorität reconciliert ist, bleibt der Status `BLOCKED_CONTRADICTION`.

## 2. Source Map

| Source ID | Source                                       | Authority / Use                                                               | Status        |
| --------- | -------------------------------------------- | ----------------------------------------------------------------------------- | ------------- |
| SRC-001   | Jira EYT-137, live read 18.08.2026           | Sprint Outcome, Scope, Cloudflare/Railway-Entscheidung                        | EXPLICIT      |
| SRC-002   | Jira EYT-140, live read 18.08.2026           | Planungswerkbank, Wochennavigation, Assignment/Publish                        | EXPLICIT      |
| SRC-003   | Jira EYT-141, live read 18.08.2026           | Basisdesign-v2, Kosten-UI, Accessibility                                      | EXPLICIT      |
| SRC-004   | Jira EYT-142, live read 18.08.2026           | Staging, Cloudflare-Gates, E2E, Security, Rollback                            | EXPLICIT      |
| SRC-005   | Confluence: Sprint 6 Baseline, page 22577153 | ältere Sprintbaseline; Railway-Text durch aktuelle Jira-Entscheidung überholt | CONTRADICTION |
| SRC-006   | Confluence: Basisdesign v2.0, page 8814623   | verbindliche Designbaseline                                                   | EXPLICIT      |
| SRC-007   | GitHub `master` / PR #77                     | aktueller Code-/Governance-Snapshot                                           | EXPLICIT      |
| SRC-008   | `docs/handoff/AGENT_HANDOFF_v1.3.md`         | Coding-Agent-Governance und Repository Identity Gate                          | EXPLICIT      |
| SRC-009   | `docs/prd/CURRENT_PRD_v1.3.md`               | kanonische Produkt-Autorität laut Repository-Handoff                          | EXPLICIT      |
| SRC-010   | EasyTree Sprint-6 Handoff 18.08.2026         | Delivery-Kontext, WIP-Reihenfolge, Cloudflare-Risiken                         | EXPLICIT      |
| SRC-011   | Claude A1–A4 Compatibility Report            | technische Evidenzkandidaten; nicht unabhängig vollständig verifiziert        | ASSUMPTION    |

## 3. File Pack

- `docs/vision/easytree-sprint-6-core-journey.vision.md`
- `docs/canvas/easytree-sprint-6-core-journey.canvas.md`
- `docs/prd/easytree-sprint-6-core-journey.prd.md`
- `docs/traceability.md`
- ~~`CLAUDE_CODE_OPUS_5_START.md`~~ — **FEHLT im Repository.** Gemessen 18.08.2026:
  `ls CLAUDE_CODE_OPUS_5_START.md` → `No such file or directory` (Exit 1); die Datei ist auch in
  keinem Commit dieses Repositories versioniert. Sie wurde bewusst **nicht** übernommen. Der
  Eintrag bleibt als fehlend gekennzeichnet stehen und wird **nicht still gestrichen** — ein
  Paketindex, der eine nie existierende Datei stillschweigend verliert, verwischt genau die
  Frage, ob sie einmal Inhalt trug.

Die vier Plumbline-Kernartefakte bleiben getrennt. Dieses Manifest ist nur Paketindex, Source Map und Readiness-Gate.

## 4. Missing / Assumption / Blocker Ledger

| ID     | Marker        | Item                                                                                                                      | Effect                                                                    |
| ------ | ------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| OQ-001 | CONTRADICTION | CURRENT_PRD/AGENT_HANDOFF: Economics post-MVP vs. Sprint-6 EYT-109 cost journey                                           | BLOCKS AgileTeam planning/execution authority until explicitly reconciled |
| OQ-002 | BLOCKER       | Separate, echte NON-PROD-Supabase-Grenze für schreibenden Staging-E2E ist noch nicht belegt                               | Blocks full EYT-142 Phase B / end-to-end write journey                    |
| OQ-003 | MISSING       | Remote Cloudflare Workers Free CPU/startup evidence for disposable Nest worker                                            | Blocks Cloudflare API-worker acceptance                                   |
| OQ-004 | MISSING       | Explicit runtime authorization for disposable Cloudflare deploy/delete in this intake context                             | Blocks remote mutation; local/read-only investigation may continue        |
| OQ-005 | MISSING       | Developer capacity/feasibility confirmation for whole Sprint 6                                                            | Does not block intake drafting; blocks claim of team commitment           |
| OQ-006 | ASSUMPTION    | Cloudflare API Worker remains viable if current CPU/startup/TLS/RLS/request-isolation gates pass without material rewrite | Must be falsified by measurement, not preference                          |
| OQ-007 | ASSUMPTION    | Railway fallback can remain compatible without duplicating business logic or migration authority                          | Verify only if fallback becomes necessary                                 |

## 5. Traceability Summary

- Vision items: VIS-001 … VIS-008
- Canvas items: CAN-001 … CAN-014
- Requirements: REQ-001 … REQ-015 (**eingefroren**; heute REQ-001 … REQ-017)
- Acceptance criteria: AC-001 … AC-030 (**eingefroren**; heute AC-001 … AC-040)
- Trace rows: TRC-001 … TRC-015 (**eingefroren**; heute TRC-S6-001 … TRC-S6-017 plus TRC-S6-ASM-001)
- All REQ IDs appear in `docs/traceability.md`.
- Each REQ is linked to Vision, Canvas, Acceptance Criteria and expected evidence.
- Traceability completeness: PASS
- Product authority contradiction: FAIL / BLOCKED

## 6. User Confirmation Block

Do not fill this on behalf of the user.

Required confirmation after the contradiction is reconciled:

`Ich bestätige, dass Product Canvas und Product Vision meine Absicht korrekt wiedergeben und als Grundlage für AgileTeam Planning verwendet werden dürfen.`

Additional EasyTree-specific authority decision required:

`Ich bestätige ausdrücklich: Sprint 6 darf den bereits implementierten EYT-109-Personalkosten-Snapshot in die reale Planen → Publish → Kosten-Kernreise integrieren und auf Staging abnehmen. Diese Freigabe erweitert den Scope nicht auf weitere Planungsökonomie oder Maschinenverleih.`

## 7. Validation Report

- Feature slug format: PASS
- Required four core artifacts: PASS
- Stable IDs: PASS
- Given/When/Then acceptance criteria: PASS
- Every REQ linked in traceability: PASS
- Missing/Blocker ledger: PASS
- User confirmation: NOT YET PROVIDED — **eingefrorener Stand.** Beide Formeln wurden am
  18.08.2026 wörtlich erteilt und liegen zitiert in Vision und PRD; siehe Kopf.
- Contradiction handling: BLOCKED_CONTRADICTION — **eingefrorener Stand.** `OQ-001` ist am
  18.08.2026 aufgelöst; siehe Kopf.
- Repository mutation performed by this package generator: NO
- Jira mutation performed by this package generator: NO
- Runtime mutation performed by this package generator: NO
