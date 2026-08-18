# Product Vision — EasyTree Sprint 6 Core Journey

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

## Product Vision Statement

### VIS-001 — Target group

`EXPLICIT` Für berechtigte Planerinnen, Administratoren und Geschäftsführung, die eine reale Arbeitswoche planen, veröffentlichen und wirtschaftlich nachvollziehen müssen.

### VIS-002 — User need

`EXPLICIT` Die bereits vorhandenen Auth-, Planning-, Publish- und Kostenfunktionen müssen als eine zusammenhängende, verständliche Admin-Reise bedienbar werden, statt als technische Einzeldurchstiche, URL-Parameter oder isolierte Backend-Fähigkeiten zu existieren.

### VIS-003 — Product value

`EXPLICIT` EasyTree soll in Sprint 6 erstmals sichtbaren, realen Betriebsnutzen liefern: Eine reale Woche wird mit echten Serverdaten geplant, persistent gespeichert, konfliktfrei veröffentlicht und bis zum unveränderlichen gespeicherten Plan-Personalkostenstand nachvollzogen.

### VIS-004 — Trust model

`EXPLICIT` Operative Wahrheit stammt aus Web → Gateway → API → Domain/Application → PostgreSQL/RLS. Mock, Fixture, LocalStorage, optimistische Clientwahrheit oder clientseitige Kostenberechnung dürfen die operative Wahrheit nicht ersetzen.

### VIS-005 — Experience

`EXPLICIT` Planung und Kosten sollen wie ein zusammenhängendes Produkt wirken: ruhige Werkbank-Hierarchie, klare primäre Handlung, verständliche Zustände und konsistente visuelle Sprache nach Basisdesign v2.0.

### VIS-006 — Success signal

`EXPLICIT` Erfolg ist eine reale Staging-Nutzerreise:
Login → Woche wählen → Einsatz anlegen → Reload → Publish → Kosten-Snapshot → Positionen/Summen → zweiter Browserkontext mit denselben veröffentlichten IDs.

### VIS-007 — Safety and access

`EXPLICIT` Rechte bleiben serverseitig. Nutzer ohne `costs.read` sehen keine Kosten-Navigation, Sätze oder Beträge. Tenant-Isolation, RLS, TLS und Secrets dürfen für Staging oder Cloudflare nicht abgeschwächt werden.

### VIS-008 — Delivery boundary

`EXPLICIT` Primäres Stagingziel ist Cloudflare Workers, Railway bleibt kompatibler Fallback. Cloudflare D1/Containers, Mobile, Wetter, Feiertage, alternative Planner-Ansichten, Mehrtagesbaustellen, neue KI-/Optimierungslogik, Excel und Produktionsfreigabe gehören nicht in Sprint 6.

## Target Group

- `EXPLICIT` Planerin / Administrator
- `EXPLICIT` Geschäftsführung mit passenden Rechten
- `EXPLICIT` Kostenansicht nur für Nutzer mit `costs.read`
- `EXPLICIT` Mitarbeiter-Mobile-Nutzer sind nicht Ziel dieses Sprints

## User Needs

1. `EXPLICIT` Woche aus der UI auswählen, ohne technischen `weekKey`.
2. `EXPLICIT` reale Serverdaten sehen.
3. `EXPLICIT` einen Einsatz über den bestehenden autorisierten Pfad anlegen.
4. `EXPLICIT` nach Speichern den bestätigten Serverzustand sehen.
5. `EXPLICIT` konfliktfreien Plan veröffentlichen.
6. `EXPLICIT` veröffentlichten Plan in den gespeicherten Kostenstand verfolgen.
7. `EXPLICIT` Snapshot-Metadaten, Summen und Positionen nachvollziehen.
8. `EXPLICIT` nach Reload und in zweitem Browser dieselbe persistierte Wahrheit sehen.

## Product Value

`EXPLICIT` Der Sprint maximiert sichtbaren, prüfbaren End-to-End-Nutzen und vermeidet neue fachliche Breite. Erfolg wird nicht an neuen Komponenten oder Commit-Zahl gemessen, sondern an der realen Nutzerreise.

## Business or Project Goals

- `EXPLICIT` Sprint-6-Outcome EYT-137 real erfüllen.
- `EXPLICIT` EYT-140, EYT-141 und EYT-142 als kohärente Commit-Slices liefern.
- `EXPLICIT` Vorhandenen EYT-109-Snapshot nutzen, nicht neu berechnen.
- `EXPLICIT` Staging- und E2E-Evidenz als Release-Vorstufe schaffen.
- `EXPLICIT` Hostingentscheidung evidenzgeführt halten: Cloudflare nicht erzwingen.

## Success Signals

- `EXPLICIT` Kein manueller `weekKey` in der normalen Reise.
- `EXPLICIT` Assignment wird real gespeichert und nach Reload serverseitig bestätigt.
- `EXPLICIT` Publish trennt Entwurf/veröffentlicht sichtbar.
- `EXPLICIT` Kosten-Snapshot ist persistent, unveränderlich und serverseitige Wahrheit.
- `EXPLICIT` Zweiter Browserkontext sieht denselben veröffentlichten Stand.
- `EXPLICIT` Auth-/Tenant-Negativreisen lecken keine Daten.
- `EXPLICIT` Accessibility-Smokes für Sprint-6-Flächen sind grün.
- `EXPLICIT` Staging-Head, E2E, Screenshots, Runbook und Rollback sind dokumentiert.

## Boundaries

### In

- EYT-137, EYT-140, EYT-141, EYT-142
- Planning week navigation
- existing assignment/write and publish path
- existing EYT-109 snapshot path
- Basisdesign-v2 primitives needed by this journey
- non-production staging and E2E

### Out

- Mobile employee client
- alternative planner views
- month/multiweek expansion
- persistent weekend toggle
- weather/holidays
- multi-day sites
- machine/resource costs
- new optimization/AI
- Excel EYT-110
- D1 / Containers
- production release or production personal data

## Assumptions

- `ASSUMPTION` Existing planning read/write/publish and EYT-109 snapshot capabilities remain intact on current master.
- `ASSUMPTION` Railway fallback can be preserved without creating a second application truth.
- `ASSUMPTION` Cloudflare API-worker viability is still open pending remote measurement.

## Missing Items

- ~~`BLOCKER` Explicit reconciliation of the canonical PRD/Agent-Handoff economics boundary with Sprint-6 EYT-109 integration.~~ **AUFGELÖST 18.08.2026** — siehe Kopfabschnitt; verbleibt als Dokumentationsdrift `DOC-DRIFT-S5-001`, kein Blocker.
- `BLOCKER` Verified non-production Supabase environment for write E2E.
- `MISSING` Remote Cloudflare Free CPU/startup evidence.
- `MISSING` Explicit runtime deployment authorization for disposable Cloudflare measurement.

## Confirmation Status

`user-confirmed` (18.08.2026, Product Owner Benjamin Poersch). Der economics-scope-Widerspruch ist aufgelöst (Kopfabschnitt). **Weiterhin offen und ausdrücklich nicht mitbestätigt:** `OQ-002` (verifizierte NON-PROD-Supabase-Grenze, BLOCKER für REQ-012 / Slice 3), `OQ-003`/`OQ-004` (remote Cloudflare-Messung und deren Laufzeitfreigabe) sowie `OQ-005` (Kapazität). Die Bestätigung deckt den fachlichen Scope, nicht die Machbarkeit.
