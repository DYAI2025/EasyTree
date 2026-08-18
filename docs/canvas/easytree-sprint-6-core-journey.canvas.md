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

`EXPLICIT` Kein Excel-Export in diesem Sprint — **engerer Schnitt, kein Widerspruch:** PRD v1.4
§7 führt ihn unter „Im MVP", Sprint 6 verschiebt ihn auf EYT-110 (wie schon Sprint 5). Ebenso
nicht in Sprint 6: die vollständige EYT-80-Komponentenbibliothek (EYT-137 führt EYT-80/EYT-72
als Commit-Enabler, EYT-141 schließt die Bibliothek aus; geliefert wird nur der von dieser Reise
gebrauchte Ausschnitt). Darüber hinaus: kein Mobile-Client, keine Wetter-/Feiertagsintegration, keine alternativen Planner-Ansichten, keine Monats-/Mehrwochen-Erweiterung, keine Mehrtagesbaustellen, keine Maschinen-/Ressourcenkosten, keine neue KI-/Optimierung, kein Excel, kein D1, keine Containers, keine Produktionsfreigabe.

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

### RISK-006

`BLOCKER` (neu 18.08.2026) **Primäres Stagingziel und Schreibkanal können sich gegenseitig
ausschließen.** `REQ-013` erklärt Cloudflare Workers zum primären Stagingziel; EYT-142 verbietet
dort den prozessweiten `pg.Pool`; der naheliegende Ersatz, der
Supavisor-Transaktionspooler, macht `session_user` zu `postgres.<pooler-tenant>` und lässt damit
laut [`../runbooks/planning-publish.md`](../runbooks/planning-publish.md) (Z. 236 ff./239)
Zuweisung, Publish **und** Snapshot-Erzeugung ausfallen — genau die drei Fähigkeiten, die
`REQ-004`, `REQ-005` und `REQ-007` fordern und die `REQ-012`/`AC-023` auf dem Stagingziel
verlangen. Lesen überlebt, weil die `_select`-Policies keine Kanalbedingung tragen.

`RISK-002`, `RISK-003` und `RISK-005` decken das **nicht** ab: `RISK-003` nennt nur das Symptom
(`pg.Pool` unbrauchbar), ohne dessen Konsequenz für den Schreibkanal zu benennen.

Die Pooleraussage ist eine **Ableitung** aus `session_user` plus Policy, **keine Messung an
einer Poolerverbindung** — das Runbook sagt das ab Z. 316 selbst. **Behandlung:** `REQ-016`
ersetzt die Ableitung durch eine Messung und ist Vorbedingung für Slice 3.

### RISK-007

`EXPLICIT` (neu 18.08.2026) **Org-Header-Rennfall.** Die Organisationsauswahl erreicht das
`CostsGateway` über eine Ref (`apps/web/app/providers.tsx:45,51,56-58`) und damit nicht
synchron: ein Kostenrequest aus einem Kind-Effekt derselben Commit-Phase geht ohne
`X-EasyTree-Organization-Id` raus. Das ist ein Flakiness-Kanal für `AC-010`, `AC-012`, `AC-021`
und `AC-022`; die übliche Reaktion — ein Retry — **maskiert** ihn. Zugeordnet zu `REQ-011`,
Nachweis über `AC-040`.

## Success Signal

### CAN-014 — Staging-Erfolgssignal (nur staging-verifizierbar)

`EXPLICIT` Ein realer berechtigter Nutzer kann auf Staging die komplette Reise Login → Woche → Assignment → Reload → Publish → Snapshot → Positionen durchlaufen; ein zweiter Browser sieht dieselben IDs; Negativ-, Accessibility-, Security- und Rollback-Gates sind belegt.

**Reichweite, ehrlich.** `CAN-014` ist **erst nach** `REQ-017` (NON-PROD-Grenze) und `REQ-016`
(Workers-Datenpfad) erreichbar. Solange beide offen sind, ist `CAN-014` für **jede** Anforderung
unerreichbar — und damit als alleiniges Erfolgssignal untauglich, weil es sonst den Bauvorgang
mitblockiert, den es gar nicht blockiert. Dafür gibt es `CAN-015`.

### CAN-015 — CI-Erfolgssignal (CI-verifizierbar, ohne Staging erreichbar)

`EXPLICIT` (neu 18.08.2026) Die Fähigkeit ist auf dem Sprint-6-Head durch die benannten
Pflichtjobs belegt — `unit-tests`, `web-smoke`, `read-through`, `auth-journey`, `db-gates` mit
ihren `mode=required … skipped=0`-Gate-Zeilen — und der zugehörige Falsifier ist ausgeführt
worden und war rot.

**Was `CAN-015` beweist und was nicht.** Es beweist, dass die Fähigkeit gebaut ist und gegen
eine Gegenmutation hält. Es beweist **nicht** die reale Staging-Reise; das bleibt `CAN-014`.
Der **Bauvorgang** von Slice 1 und Slice 2 ist damit **nicht** blockiert — nur ihr
**Abnahmenachweis** ist es.

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
- OQ-002 non-production Supabase environment — **BLOCKER, bleibt offen.** Der Product Owner hat
  am 18.08.2026 den **Weg** freigegeben (separates Supabase-Projekt `easytree-staging`,
  spezifiziert als `REQ-017`), **nicht die Ausführung**: das Anlegen des Projekts ist eine
  Laufzeitmutation und ist ausdrücklich noch nicht freigegeben. Nicht als erledigt führen.
- OQ-003 Cloudflare remote CPU/startup — MISSING
- OQ-004 deployment authorization for disposable worker — MISSING
- OQ-005 developer feasibility/capacity confirmation — MISSING
