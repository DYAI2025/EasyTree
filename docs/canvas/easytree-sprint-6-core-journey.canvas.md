# Product Canvas — EasyTree Sprint 6 Core Journey

Feature Slug: `easytree-sprint-6-core-journey`
Status: user-confirmed
Confirmed by user: yes
Bestätigt am: 2026-08-18 durch den Product Owner (Benjamin Poersch), beide wörtlichen
Formeln erteilt (Canvas/Vision-Formel und die enge EYT-109-Kostenfreigabe).
Bestätigt ist der fachliche Feature-Scope. Technische Kapazität und Umsetzbarkeit sind
ausdrücklich **nicht** vorab bestätigt — `OQ-005` bleibt offen.

**Auflösung `OQ-001` (18.08.2026).** Der Widerspruch beruhte auf einer Prüfung, die nur das
Repository umfasste. Live gelesen am 18.08.2026: Confluence **PRD v1.4** (Seite 7766017, Stand
28.07.2026) trägt im Kopf „neue fachliche Baseline / ersetzt PRD v1.3 hinsichtlich MVP-Scope
und Phasen"; §10.1/.2: „Die gesamte Planungsökonomie ist nicht mehr pauschal Post-MVP. Interne
Kostensätze, Plan-/Ist-Kosten und Excel-Export gehören als begrenzter modularer Schnitt zum
MVP."; §7 führt interne Kosten und Aufwandstransparenz unter **Im MVP**, Maschinenverleiherlöse,
Rechnung/Steuer/Zahlung/Buchung und Payroll unter **Post-MVP**. Derselbe Befund war am 30.07.2026
bereits als `CONTRA-S5-001` = `FALSE_POSITIVE_SOURCE_SCOPE_ERROR` / `RESOLVED_NO_SCOPE_CHANGE`
protokolliert ([`docs/traceability.md`](../traceability.md), [`docs/prd/sprint-5-daily-cost-export.prd.md`](../prd/sprint-5-daily-cost-export.prd.md) §Baseline).
Der Product Owner hat die enge Freigabe am 18.08.2026 wörtlich erteilt. **Kein Scope-Zuwachs:**
weitere Planungsökonomie, Maschinenverleih, Payroll, Rechnungen, USt./Brutto, Buchhaltung und
FR-062–FR-070 bleiben ausgeschlossen. Was bleibt, ist Dokumentationsdrift im Repository
(`DOC-DRIFT-S5-001`): `docs/prd/CURRENT_PRD_v1.3.md` §6, `docs/handoff/AGENT_HANDOFF_v1.3.md`
(Post-MVP economics boundary) und `CLAUDE.md` nennen die Planungsökonomie weiterhin pauschal
Post-MVP. Kein Implementierungsblocker, aber die Quelle genau dieses Fehlalarms.

## Problem

### CAN-001

`EXPLICIT` EasyTree besitzt bereits wesentliche technische Planning-, Publish- und Kostenfähigkeiten, aber die reale Admin-Nutzerreise ist noch nicht als durchgehendes, staging-belegtes Produktincrement nachgewiesen. `/planung` verlangt noch technische Wochenadressierung, die UI ist nicht vollständig kohärent, und Application-Deployment/Staging-E2E ist nicht belegt.

## Users / Customers

### CAN-002

`EXPLICIT` Primäre Nutzer sind berechtigte Planerinnen/Administratoren und Geschäftsführung. Kosteninformationen sind zusätzlich durch `costs.read` eingeschränkt. Mitarbeiter-Mobile-Nutzer sind nicht Teil dieses Sprint-Slices.

## Value Promise

### CAN-003

`EXPLICIT` Eine berechtigte Planerin kann eine reale Woche ohne technische Parameter bedienen, einen Einsatz persistieren, den konfliktfreien Stand veröffentlichen und denselben veröffentlichten Zustand inklusive unveränderlichem Personalkosten-Snapshot nachvollziehen.

## Current Alternatives

### CAN-004

`EXPLICIT` Heute bestehen technische Durchstiche und isolierte Funktionen: manueller `weekKey`, lokale/CI-Evidenz, getrennte Planning-/Kostenflächen und kein vollständig bewiesener Staging-End-to-End-Pfad. Diese Alternativen sind für einen normalen betrieblichen Nutzer nicht ausreichend.

## Key Capabilities

### CAN-005 — Week workbench

`EXPLICIT` Heute/vorherige/nächste Woche, ISO-Woche, Datumsbereich, kein manueller `weekKey`.

### CAN-006 — Real planning mutation

`EXPLICIT` Reale Serverdaten, bestehender autorisierter Assignment-Command, nach Speicherung bestätigten Serverzustand neu lesen.

### CAN-007 — Publish

`EXPLICIT` Bestehenden Publish-Command verwenden; Entwurf und veröffentlicht klar unterscheiden; keine neue Planning-Domainregel erfinden.

### CAN-008 — Cost journey

`EXPLICIT` Nutzer mit `costs.read` wechseln zu `/kosten`; der bestehende EYT-109-Snapshot wird geladen/erzeugt und bleibt einzige Kostenwahrheit.

### CAN-009 — Cost transparency

`EXPLICIT` Gesamtsumme, Tagessummen, Positionen sowie Snapshot-ID, Planversion, Erstellungszeit, Regelversion und Währung sind nachvollziehbar.

### CAN-010 — Coherent UI

`EXPLICIT` Planung und Kosten nutzen dieselbe Admin-Shell, semantische Tokens, 8-pt-Raster, klare Hierarchie, einen primären CTA und echte Loading/Empty/Error/Forbidden/Stale-Zustände.

### CAN-011 — Accessible operation

`EXPLICIT` Status nicht nur Farbe; Tastatur, Fokus, 200-%-Zoom, Kontrast und axe/Accessibility-Smoke für implementierte Flächen.

### CAN-012 — Real staging

`EXPLICIT` Reale Staging-Reise über Web → Gateway → API → PostgreSQL/RLS mit Health/Ready, zweitem Browser, Auth-/Tenant-Negativreise, Secret-Negativprüfung, Screenshots, Runbook und Rollback.

## Non-Goals

### CAN-013

`EXPLICIT` Kein Mobile-Client, keine Wetter-/Feiertagsintegration, keine alternativen Planner-Ansichten, keine Monats-/Mehrwochen-Erweiterung, keine Mehrtagesbaustellen, keine Maschinen-/Ressourcenkosten, keine neue KI-/Optimierung, kein Excel, kein D1, keine Containers, keine Produktionsfreigabe.

## Constraints

- `EXPLICIT` Supabase Auth/PostgreSQL/RLS bleibt Identitäts- und Datengrenze.
- `EXPLICIT` Cloudflare darf keine zweite Migration Authority werden.
- `EXPLICIT` Kein `rejectUnauthorized=false`, kein No-Verify, keine privilegierte Runtime-DB-Rolle, kein BYPASSRLS.
- `EXPLICIT` Agenten schreiben nicht direkt in operative Tabellen; Domain Commands.
- `EXPLICIT` Repository identity gate vor jeder Mutation.
- `EXPLICIT` WIP=1 Implementation Theme.
- `EXPLICIT` Keine Produktion ohne explizite Freigabe.

## Risks

### RISK-001

`BLOCKER` Full staging write-E2E ohne klar getrennte NON-PROD-Supabase-Grenze könnte Produktionsdaten oder produktive Zustände gefährden.

### RISK-002

`MISSING` Cloudflare Workers Free CPU/startup bleibt remote ungemessen.

### RISK-003

`EXPLICIT` Cross-request I/O reuse ist im bisherigen A1–A4-Agentenbericht als problematisch gemeldet; unveränderter processweiter `pg.Pool` ist kein akzeptabler Workers-Pfad.

### RISK-004

`RESOLVED` (18.08.2026) Repository-PRD/Handoff behandelt Planungsökonomie als nicht aktiven Post-MVP-Scope, während Sprint 6 EYT-109-Kostenintegration verlangt. **Aufgelöst:** die kanonische Produktbaseline ist Confluence PRD v1.4, nicht die Repository-Kopie v1.3 — siehe Kopfabschnitt. Verbleibt als `DOC-DRIFT-S5-001` (kein Blocker).

### RISK-005

`ASSUMPTION` Ein zu früher Cloudflare-Commit könnte eine Hostingpräferenz statt Produktnutzen optimieren und einen material rewrite erzwingen.

## Success Signal

### CAN-014

`EXPLICIT` Ein realer berechtigter Nutzer kann auf Staging die komplette Reise Login → Woche → Assignment → Reload → Publish → Snapshot → Positionen durchlaufen; ein zweiter Browser sieht dieselben IDs; Negativ-, Accessibility-, Security- und Rollback-Gates sind belegt.

## Evidence

- Jira EYT-137/140/141/142
- GitHub exact-head + PR/CI
- Browser E2E
- Server/DB identifiers
- Staging deployment head
- Health/Ready
- Auth/RLS negative cases
- axe/accessibility smoke
- screenshots of real staging
- runbook and rollback evidence
- remote Cloudflare CPU/startup measurement before API-worker acceptance

## Allowed Scope

`EXPLICIT` Nur Arbeit, die direkt EYT-137 über EYT-140/141/142 voranbringt. Breite Enabler werden nur in dem konkret benötigten Ausschnitt erweitert.

## Unresolved Questions

- ~~OQ-001 canonical economics-scope reconciliation~~ — **AUFGELÖST 18.08.2026** (PRD v1.4 §7/§10 live gelesen + PO-Freigabe wörtlich; siehe Kopfabschnitt)
- OQ-002 non-production Supabase environment — BLOCKER
- OQ-003 Cloudflare remote CPU/startup — MISSING
- OQ-004 deployment authorization for disposable worker — MISSING
- OQ-005 developer feasibility/capacity confirmation — MISSING
