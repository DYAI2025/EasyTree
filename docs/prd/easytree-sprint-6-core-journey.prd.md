# PRD — EasyTree Sprint 6 Core Journey

Feature Slug: `easytree-sprint-6-core-journey`
Status: user-confirmed
Confirmed by user: yes
Bestätigt am: 2026-08-18 durch den Product Owner (Benjamin Poersch), beide wörtlichen
Formeln erteilt (Canvas/Vision-Formel und die enge EYT-109-Kostenfreigabe).
Bestätigt ist der fachliche Feature-Scope. Technische Kapazität und Umsetzbarkeit sind
ausdrücklich **nicht** vorab bestätigt — `OQ-005` bleibt offen.
Owner: Product Owner / EasyTree
Target Delivery Agent: Claude Code Opus 5

## Source Summary

`EXPLICIT` Sprint truth comes from live Jira EYT-137/140/141/142.
`EXPLICIT` Design truth comes from Confluence Basisdesign v2.0.
`EXPLICIT` Code/CI truth comes from GitHub `DYAI2025/EasyTree`.
`EXPLICIT` Agent mutation governance comes from `docs/handoff/AGENT_HANDOFF_v1.3.md`.
`RESOLVED` (18.08.2026) `CURRENT_PRD_v1.3` still classifies planning economics as separately approved post-MVP scope, while Sprint 6 integrates the already implemented EYT-109 cost snapshot. Die kanonische fachliche Baseline ist **Confluence PRD v1.4** (7766017), die v1.3 in genau diesem Punkt ersetzt.

**Auflösung `OQ-001` (18.08.2026).** Der Widerspruch beruhte auf einer Prüfung, die nur das
Repository umfasste. Live gelesen am 18.08.2026: Confluence **PRD v1.4** (Seite 7766017, Stand
28.07.2026) trägt im Kopf „neue fachliche Baseline / ersetzt PRD v1.3 hinsichtlich MVP-Scope
und Phasen"; §10.1/.2: „Die gesamte Planungsökonomie ist nicht mehr pauschal Post-MVP. Interne
Kostensätze, Plan-/Ist-Kosten und Excel-Export gehören als begrenzter modularer Schnitt zum
MVP."; §7 führt interne Kosten und Aufwandstransparenz unter **Im MVP**, Maschinenverleiherlöse,
Rechnung/Steuer/Zahlung/Buchung und Payroll unter **Post-MVP**. Derselbe Befund war am 30.07.2026
bereits als `CONTRA-S5-001` = `FALSE_POSITIVE_SOURCE_SCOPE_ERROR` / `RESOLVED_NO_SCOPE_CHANGE`
protokolliert ([`docs/traceability.md`](../traceability.md), [`docs/prd/sprint-5-daily-cost-export.prd.md`](sprint-5-daily-cost-export.prd.md) §Baseline).
Der Product Owner hat die enge Freigabe am 18.08.2026 wörtlich erteilt. **Kein Scope-Zuwachs:**
weitere Planungsökonomie, Maschinenverleih, Payroll, Rechnungen, USt./Brutto, Buchhaltung und
FR-062–FR-070 bleiben ausgeschlossen. Was bleibt, ist Dokumentationsdrift im Repository
(`DOC-DRIFT-S5-001`): `docs/prd/CURRENT_PRD_v1.3.md` §6, `docs/handoff/AGENT_HANDOFF_v1.3.md`
(Post-MVP economics boundary) und `CLAUDE.md` nennen die Planungsökonomie weiterhin pauschal
Post-MVP. Kein Implementierungsblocker, aber die Quelle genau dieses Fehlalarms.

## Problem Statement

`EXPLICIT` EasyTree has real planning, publish and cost-snapshot capabilities, but Sprint 6 must convert them into one persistent, authorized, visually coherent, staging-proven admin journey. Technical URL knowledge, client-created truth, isolated screens or local-only success are not sufficient.

## Target Users

- `EXPLICIT` Administrator / Planerin
- `EXPLICIT` Geschäftsführung where authorized
- `EXPLICIT` Cost visibility only with `costs.read`

## Goals

1. `EXPLICIT` Real week navigation and workbench.
2. `EXPLICIT` Real assignment write and server-confirmed reload.
3. `EXPLICIT` Real publish.
4. `EXPLICIT` Real EYT-109 snapshot journey.
5. `EXPLICIT` Coherent Basisdesign-v2 UI and accessibility.
6. `EXPLICIT` Real non-production staging E2E.
7. `EXPLICIT` Evidence-first Cloudflare decision with Railway fallback.

## Non-Goals

- Mobile employee client
- alternative planner views
- month/multiweek expansion
- persistent weekend toggle
- weather/holidays
- multi-day sites
- machine/resource cost expansion
- new AI/optimization
- Excel EYT-110
- D1 / Containers
- production release
- new business rules invented for UI convenience

## Assumptions

- `ASSUMPTION` Existing planning read/write/publish and EYT-109 snapshot path remain functional on current master.
- `ASSUMPTION` Existing cost snapshot is reused, not reimplemented.
- `ASSUMPTION` Cloudflare API remains a candidate until current remote evidence falsifies it.

## Open Questions

- ~~`OQ-001 CONTRADICTION`~~ **RESOLVED 18.08.2026** — ja, wörtlich erteilt; und die Frage war enger gestellt als nötig: PRD v1.4 §7/§10 führt interne Plan-Kosten bereits im MVP. Siehe Source Summary.
- `OQ-002 BLOCKER` Which Supabase project/environment is the verified non-production staging boundary for write E2E?
- `OQ-003 MISSING` Does a disposable remote Cloudflare API worker pass current Free CPU/startup gates?
- `OQ-004 MISSING` Is remote Cloudflare deploy/delete explicitly authorized for the measurement slice?
- `OQ-005 MISSING` Has developer feasibility/capacity for the whole Sprint been confirmed?

## Requirements

### REQ-001 — Real authenticated admin entry

`EXPLICIT`
A berechtigter Nutzer muss sich über die reale Supabase-Session anmelden und in einer autorisierten Admin-Shell landen. Sichtbare Navigation verleiht kein Recht.

### REQ-002 — User-facing week navigation

`EXPLICIT`
`/planung` muss aktuelle, vorherige und nächste Woche sowie „Heute“, ISO-Woche und Datumsbereich anbieten. Die normale Nutzerreise darf keinen manuellen `weekKey` benötigen.

### REQ-003 — Real planning read

`EXPLICIT`
Die Planungswerkbank zeigt echte Serverdaten. Mock-, Fixture-, LocalStorage- oder clientseitig erfundene Zustände dürfen nicht operative Wahrheit werden.

### REQ-004 — Authorized assignment write with server confirmation

`EXPLICIT`
Mindestens ein realer Einsatz muss über den bestehenden autorisierten Domain-/Application-Pfad angelegt werden. Nach Speicherung wird der bestätigte Serverzustand neu gelesen.

### REQ-005 — Publish real conflict-free plan

`EXPLICIT`
Der bestehende Publish-Command muss einen konfliktfreien Plan veröffentlichen; Entwurf und veröffentlichter Stand müssen textuell/visuell unterscheidbar sein.

### REQ-006 — Cost access boundary

`EXPLICIT`
Nur Nutzer mit `costs.read` erhalten einen verständlichen Übergang zu `/kosten`. Ohne Recht bleiben Kosten-Navigation, Sätze und Beträge unsichtbar; Serverautorisierung bleibt maßgeblich.

### REQ-007 — Existing EYT-109 snapshot as sole cost truth

`EXPLICIT` (war `CONTRADICTION`, aufgelöst 18.08.2026)
Nach erfolgreichem Publish soll `/kosten` den bestehenden unveränderlichen EYT-109-Snapshot der veröffentlichten Planversion erzeugen oder laden. Keine Clientberechnung oder clientseitige Organisations-ID ist Autorität.
Baseline: PRD v1.4 FR-009 (Plan-Kosten aus veröffentlichter Planversion) und FR-011 (Kostenübersicht bis zur Einzelposition). Sprint 6 schneidet enger als die FR — nur der gespeicherte Plan-Personalkosten-Snapshot, keine Ist-Kosten (FR-010), keine Ressourcenkosten.

### REQ-008 — Cost explainability

`EXPLICIT`
Die Kostenansicht zeigt mindestens Snapshot-ID, Planversion, Erstellungszeit, Regelversion, Währung, Tages-/Gesamtsumme und Positionen mit Baustelle, Tag, Person, Dauer, Satzversion und Betrag.

### REQ-009 — Shared Basisdesign-v2 workbench

`EXPLICIT`
Planung und Kosten verwenden dieselbe Admin-Shell, semantische Tokens und ruhige Werkbank-Hierarchie mit 8-pt-Raster, dezenter Flächen-/Hairline-Struktur und einem primären CTA je Bildschirm.

### REQ-010 — Explicit product states and accessibility

`EXPLICIT`
Loading, Empty, Error, Forbidden und Stale müssen als echte Zustände existieren. Kosten zusätzlich: Satz fehlt, Satz mehrdeutig, Snapshot wird erstellt/verfügbar. Status nie nur Farbe; Tastatur, Fokus, Kontrast, 200-%-Zoom und axe-Smoke sind zu prüfen.

### REQ-011 — Persistent cross-browser truth

`EXPLICIT`
Reload und ein zweiter Browserkontext müssen dieselbe veröffentlichte Planversion und denselben gespeicherten Snapshot mit denselben IDs zeigen.

### REQ-012 — Real non-production staging path

`EXPLICIT`
Der Sprint-6-Head muss auf dem gewählten non-production Stagingziel eindeutig identifizierbar sein und real Web → Gateway → API → PostgreSQL/RLS durchlaufen. Kein Mock ersetzt einen operativen Request.

### REQ-013 — Cloudflare-primary evidence gate with Railway fallback

`EXPLICIT`
Cloudflare Workers ist primäres Stagingziel, Railway bleibt dokumentierter kompatibler Fallback. Cloudflare wird nur akzeptiert, wenn aktuelle Bundle-, CPU-/Startup-, TLS/RLS- und Request-Isolation-Gates ohne Sicherheitsabschwächung bestehen. D1/Containers bleiben out of scope.

### REQ-014 — Security, privacy and tenant isolation

`EXPLICIT`
Auth-/Rechte- und Cross-Tenant-Negativfälle dürfen keine fremden Kosten-/Mandantendaten oder Existenzinformationen lecken. Browserbundle/Logs dürfen keine Secrets, DB-Passwörter oder Sessiontokens enthalten. Kein BYPASSRLS / No-Verify / privilegierte Runtime-Rolle.

### REQ-015 — Release evidence and rollback

`EXPLICIT`
Vor Sprintabnahme müssen Health/Ready, exact deployment head, relevante CI/E2E-Evidenz, reale Staging-Screenshots, Diagnose-/Deploy-Runbook und ein reproduzierbarer Rollbackweg vorliegen.

## Acceptance Criteria

### AC-001

Given ein berechtigter Nutzer mit realer Supabase-Session  
When er EasyTree öffnet  
Then landet er in der autorisierten Admin-Shell und geschützte API-Aufrufe werden serverseitig autorisiert.

### AC-002

Given ein Nutzer ohne erforderliches Recht  
When er eine geschützte Admin-/Kostenoperation direkt aufruft  
Then wird sie serverseitig verweigert, unabhängig von sichtbarer Clientnavigation.

### AC-003

Given `/planung` ohne technischen Query-Parameter  
When die Planerin die Seite öffnet  
Then sind aktuelle Woche, ISO-Woche und vollständiger Datumsbereich sichtbar.

### AC-004

Given die Planungswerkbank  
When die Planerin „vorherige Woche“, „nächste Woche“ oder „Heute“ benutzt  
Then wird die korrekte Woche ohne manuelle `weekKey`-Eingabe geladen.

### AC-005

Given eine geladene Woche  
When Daten angezeigt werden  
Then stammen die operativen Planungsdaten aus dem realen Serverpfad und nicht aus Mock/Fixture/LocalStorage.

### AC-006

Given eine berechtigte Planerin und gültige Eingabedaten  
When sie einen Einsatz anlegt  
Then wird der bestehende autorisierte Assignment-Pfad benutzt und eine serverseitige ID erzeugt.

### AC-007

Given ein erfolgreich gespeicherter Einsatz  
When die Ansicht neu lädt  
Then zeigt sie den bestätigten Serverzustand mit derselben serverseitigen ID.

### AC-008

Given ein konfliktfreier Entwurf  
When die Planerin den realen Publish-Command ausführt  
Then wird eine veröffentlichte Planversion erzeugt und der Status sichtbar als „veröffentlicht“ dargestellt.

### AC-009

Given ein nicht veröffentlichbarer Konflikt  
When Publish versucht wird  
Then wird fail-closed abgebrochen und kein scheinbar veröffentlichter Zustand angezeigt.

### AC-010

Given ein veröffentlichter Plan und `costs.read`  
When der Nutzer den Kostenübergang verwendet  
Then wird `/kosten` erreichbar und der reale Snapshotpfad verwendet.

### AC-011

Given ein Nutzer ohne `costs.read`  
When er Planung oder Navigation sieht  
Then sind Kostenlink, Sätze und Beträge nicht sichtbar; direkter API-Zugriff bleibt verweigert.

### AC-012

Given eine veröffentlichte Planversion  
When `/kosten` den EYT-109-Pfad aufruft  
Then wird der persistierte Snapshot erzeugt oder der bereits vorhandene Snapshot geladen, ohne Clientberechnung.

### AC-013

Given ein gespeicherter Snapshot  
When spätere UI-Reads erfolgen  
Then bleiben Snapshot-ID und gespeicherte Positionen unverändert und referenzieren die veröffentlichte Planversion.

### AC-014

Given ein geladener Snapshot  
When der Nutzer die Kostenansicht liest  
Then sind Tages-/Gesamtsummen sowie Positionen mit Baustelle, Tag, Person, Dauer, Satzversion und Betrag nachvollziehbar.

### AC-015

Given ein geladener Snapshot  
When Metadaten angezeigt werden  
Then sind Snapshot-ID, Planversion, Erstellungszeit, Regelversion und Währung sichtbar, aber visuell nachgeordnet.

### AC-016

Given Planung und Kosten  
When beide Sprint-6-Flächen gerendert werden  
Then verwenden sie dieselbe Admin-Shell und dieselben verbindlichen semantischen Tokens.

### AC-017

Given die implementierten Sprint-6-Flächen  
When sie bei 1440/1920 px und 200-%-Zoom geprüft werden  
Then bleiben Hierarchie, Inhalte und primäre Aktionen bedienbar und verständlich.

### AC-018

Given Status, Warnung oder Fehler  
When er dargestellt wird  
Then ist er durch Text/Form/Symbol und nicht nur Farbe unterscheidbar.

### AC-019

Given Tastaturbedienung  
When der Nutzer durch die Kernreise navigiert  
Then sind Fokus und zentrale Aktionen erreichbar und sichtbar.

### AC-020

Given Kosten-Sonderzustände  
When Satz fehlt, Satz mehrdeutig oder Snapshot noch erstellt wird  
Then wird der Zustand explizit/fail-closed gezeigt und niemals als `0,00 €` oder Erfolg maskiert.

### AC-021

Given eine veröffentlichte Planversion und Snapshot  
When die Seite neu geladen wird  
Then bleiben veröffentlichte Plan-ID und Snapshot-ID identisch.

### AC-022

Given ein zweiter unabhängiger Browserkontext derselben berechtigten Identität  
When dieselbe Woche/Kostenansicht geladen wird  
Then erscheinen dieselben veröffentlichten IDs und derselbe Snapshot.

### AC-023

Given ein verifizierter non-production Staging-Head  
When die reale Kernreise läuft  
Then durchläuft sie Web → Gateway → API → PostgreSQL/RLS ohne Mock-Ersatz.

### AC-024

Given die Staging-Umgebung  
When `/health` und `/ready` vor der Abnahme geprüft werden  
Then sind beide grün; ein Pflicht-Smoke-Fehler blockiert die Abnahme.

### AC-025

Given Cloudflare als primäres Ziel  
When der API-Worker akzeptiert werden soll  
Then liegen aktuelle remote CPU-/Startup- und relevante Runtime-Evidenzen vor; lokale workerd-Zahlen allein reichen nicht.

### AC-026

Given ein Cloudflare-Runtime-Pfad  
When TLS/RLS oder Request-Isolation nur durch Sicherheitsabschwächung funktionieren würde  
Then wird Cloudflare für diesen Pfad nicht akzeptiert und Railway-Fallback wird bewertet.

### AC-027

Given ein fremder Tenant oder fehlendes Recht  
When geschützte Plan-/Kostenpfade aufgerufen werden  
Then werden keine fremden Daten und keine verwertbaren Existenzinformationen zurückgegeben.

### AC-028

Given Build, Browserbundle und Runtime-Logs  
When Secret-Negativprüfungen laufen  
Then sind Service-Role-Keys, DB-Passwörter, Sessiontokens und andere Credentials nicht enthalten.

### AC-029

Given ein Sprint-6-Abnahmekandidat  
When die Release-Evidenz zusammengestellt wird  
Then enthält sie exact head, relevante CI/E2E-Läufe, reale Staging-Screenshots und die getestete Nutzerreise.

### AC-030

Given ein fehlerhafter Staging-Deploy  
When Rollback ausgelöst wird  
Then kann der vorherige erfolgreiche Staging-Stand reaktiviert werden; destruktiver Schema-Rollback wird nicht improvisiert.

## Non-Functional Requirements

### Security

- Server-side authorization for every protected object/command.
- RLS preserved.
- Least privilege.
- No production mutation without explicit approval.
- No secrets in logs, browser bundle or artifacts.

### Accessibility

- status not color-only
- visible focus
- keyboard access
- 200% zoom
- axe/accessibility smoke
- Basisdesign contrast constraints

### Reliability

- confirmed server state after write
- immutable snapshot semantics
- fail-closed on missing/ambiguous rate
- health/readiness
- rollback path

### Evidence / Governance

Before every coding-agent mutation:

```bash
pwd
git remote -v
git rev-parse --show-toplevel
git fetch --prune
git rev-parse origin/master
```

Repository must resolve to `DYAI2025/EasyTree`; otherwise return `WRONG_REPOSITORY` and stop before mutation.

Do not infer current `origin/master` from this document. Re-read it.

## Risks

- RISK-001 — non-prod environment separation
- RISK-002 — Cloudflare remote CPU/startup
- RISK-003 — cross-request DB lifecycle
- RISK-004 — canonical economics-scope contradiction
- RISK-005 — hosting overengineering / forcing Cloudflare

## Evidence Needed

- exact current `origin/master`
- no unintended open PR/WIP
- test-first evidence for changed behavior
- CI on exact PR head
- browser E2E
- server IDs across reload/second browser
- staging head/health/ready
- RLS/auth negative tests
- accessibility/axe results
- real screenshots
- Cloudflare remote CPU/startup if Cloudflare API is pursued
- runbook and rollback evidence

## Links

- Vision: `../vision/easytree-sprint-6-core-journey.vision.md`
- Canvas: `../canvas/easytree-sprint-6-core-journey.canvas.md`
- Traceability: `../traceability.md`

## User Confirmation

Beide Bedingungen am 18.08.2026 erfüllt und geprüft:

1. **Product Vision und Canvas ausdrücklich bestätigt** — wörtliche Formel erteilt, Product Owner Benjamin Poersch.
2. **Der EYT-109-economics-scope-Widerspruch ist ausdrücklich reconciliert** — wörtliche enge Freigabe erteilt, gestützt auf Confluence PRD v1.4 §7/§10 (live gelesen 18.08.2026) und den PO-Beschluss vom 30.07.2026. Kein Scope-Zuwachs.

Damit ist dieses PRD `user-confirmed`. **Nicht mitbestätigt** sind `OQ-002` bis `OQ-005`; sie bleiben eigenständige Blocker für die von ihnen betroffenen Slices.
