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
- Excel EYT-110 — **bewusst engerer Schnitt, kein Widerspruch.** Confluence PRD v1.4 §7 führt
  den Excel-Export unter „Im MVP". Sprint 6 schneidet enger und verschiebt ihn auf EYT-110,
  genau wie das Sprint-5-PRD es getan hat. Der MVP-Anspruch aus v1.4 bleibt unangetastet; nur
  dieser Sprint liefert ihn nicht.
- D1 / Containers
- production release
- new business rules invented for UI convenience

## Assumptions

- `ASSUMPTION` (`ASM-001`, prüfbar — **nicht mehr nur behauptet**) Existing planning
  read/write/publish and EYT-109 snapshot path remain functional on current master.
  Diese Annahme trägt 11 der 17 Requirements und darf deshalb nicht unbelegt bleiben. Sie ist
  messbar und wird gemessen: der `db-gates`-Job muss auf dem Sprint-6-Head die Gate-Zeilen
  `[planning-write]`, `[planning-publish]`, `[planning-published-reads]`, `[cost-snapshot]` und
  `[snapshot-immutability]` je mit `mode=required … skipped=0` emittieren. Extraktion:
  `gh run view <run> --log --job <db-gates-job-id> | grep -oE '\[[a-z-]+\] mode=[a-z]+ executed=[0-9]+ passed=[0-9]+ skipped=[0-9]+' | sort -u`.
  Falsifier und Trace-Zeile: `TRC-S6-ASM-001` in [`../traceability.md`](../traceability.md).
  Fehlt eine dieser Zeilen oder ist sie `skipped>0`, ist die Annahme **nicht** bestätigt und
  jede darauf gestützte Aussage fällt.
- `ASSUMPTION` Existing cost snapshot is reused, not reimplemented.
- `ASSUMPTION` Cloudflare API remains a candidate until current remote evidence falsifies it.

## Open Questions

- ~~`OQ-001 CONTRADICTION`~~ **RESOLVED 18.08.2026** — ja, wörtlich erteilt; und die Frage war enger gestellt als nötig: PRD v1.4 §7/§10 führt interne Plan-Kosten bereits im MVP. Siehe Source Summary.
- `OQ-002 BLOCKER` Which Supabase project/environment is the verified non-production staging
  boundary for write E2E? **Der Weg ist entschieden (PO, 18.08.2026): ein separates Supabase-Projekt
  `easytree-staging`, spezifiziert als `REQ-017`. Das Anlegen des Projekts ist eine Laufzeitmutation
  und ist ausdrücklich NOCH NICHT freigegeben.** `OQ-002` bleibt deshalb `BLOCKER`, bis diese
  Freigabe vorliegt — die Entscheidung über den Weg ist keine Erledigung der Frage.
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

**Vorbedingung: `REQ-016`.** Cloudflare bleibt primär — diese Anforderung wird nicht
abgeschwächt. Sie ist aber erst erfüllbar, wenn der für Cloudflare gewählte Datenpfad
(Hyperdrive oder Direktverbindung) den bestehenden Schreibkanal nachweislich trägt. Ohne grünen
`REQ-016`-Nachweis startet die Staging-Abnahme (Slice 3) nicht. Siehe `RISK-006`.

### REQ-014 — Security, privacy and tenant isolation

`EXPLICIT`
Auth-/Rechte- und Cross-Tenant-Negativfälle dürfen keine fremden Kosten-/Mandantendaten oder Existenzinformationen lecken. Browserbundle/Logs dürfen keine Secrets, DB-Passwörter oder Sessiontokens enthalten. Kein BYPASSRLS / No-Verify / privilegierte Runtime-Rolle.

### REQ-015 — Release evidence and rollback

`EXPLICIT`
Vor Sprintabnahme müssen Health/Ready, exact deployment head, relevante CI/E2E-Evidenz, reale Staging-Screenshots, Diagnose-/Deploy-Runbook und ein reproduzierbarer Rollbackweg vorliegen.

### REQ-016 — Nachgewiesener Workers-Datenpfad (Vorbedingung für Slice 3)

`EXPLICIT` (neu 18.08.2026, PO-Entscheidung: Cloudflare bleibt primär)

Der für Cloudflare Workers gewählte Datenpfad — Hyperdrive oder Direktverbindung — muss den
**bestehenden Schreibkanal** tragen, ohne eine Sicherheitsgrenze abzuschwächen. Nachweis gegen
die reale Staging-Verbindung, nicht gegen eine lokale Nachbildung. `REQ-016` ist **Vorbedingung
für Slice 3**: ohne grünen Nachweis startet die Staging-Abnahme nicht.

**Warum diese Anforderung existiert — der Konflikt, ehrlich benannt.** `REQ-013` erklärt
Cloudflare Workers zum primären Stagingziel. EYT-142 verbietet dort den prozessweiten `pg.Pool`.
Der naheliegende Ersatz, der Supavisor-Transaktionspooler, macht `session_user` zu
`postgres.<pooler-tenant>`; `app.is_runtime_channel()` vergleicht genau diesen Wert gegen
`easytree_app`. Laut [`../runbooks/planning-publish.md`](../runbooks/planning-publish.md) (Tabelle
bei Z. 236 ff., Aussage bei Z. 239) fallen damit **Zuweisung, Publish und Snapshot-Erzeugung**
aus — genau die drei Fähigkeiten, die `REQ-004`, `REQ-005` und `REQ-007` fordern und die
`REQ-012`/`AC-023` auf dem Stagingziel verlangen. Lesen überlebt, weil die `_select`-Policies
keine Kanalbedingung tragen.

**Was daran gemessen ist und was nicht.** Die Pooleraussage im Runbook ist eine **Ableitung**
aus `session_user` plus Policy, **keine Messung an einer Poolerverbindung** — das Runbook sagt
das ab Z. 316 selbst („in pgTAP ist `session_user` `postgres`, nicht `postgres.<pooler-tenant>`
… also eine Ableitung aus `session_user` plus Policy, keine Messung"). `REQ-016` existiert genau
deshalb: **um die Ableitung durch eine Messung zu ersetzen.** Der Nachweis kann die Ableitung
bestätigen oder widerlegen; beides ist ein Ergebnis. Was er nicht darf, ist ausbleiben.

Akzeptanzkriterien: `AC-031`, `AC-032`, `AC-033`. Risiko: `RISK-006`.

### REQ-017 — Verifizierte NON-PROD-Datengrenze

`EXPLICIT` (neu 18.08.2026, PO-Entscheidung: separates Supabase-Projekt)

Schreibender Staging-E2E läuft gegen ein **separates Supabase-Projekt `easytree-staging`**, das
ausschließlich aus `supabase/migrations/*` gefüttert wird und die Rolle `easytree_app`
provisioniert hat. Die Grenze zur Produktion ist **positiv nachgewiesen**, bevor irgendein
Schreibpfad sie berührt — ein „ist bestimmt getrennt" ist kein Nachweis.

**Ausgangsmessung 18.08.2026.** `supabase/config.toml:5` trägt nur `project_id = "easytree"`
(lokaler Stackname), kein `project_ref`. Ein repo-weiter `git grep` nach `project_ref` bzw.
`easytree-staging` findet nur den Traceability-Eintrag selbst. `.github/workflows/` enthält
keinen Staging-Job. Es gibt heute also **keine** getrennte NON-PROD-Grenze, weder konfiguriert
noch dokumentiert.

**Ausdrücklich vermerkt: noch nicht freigegeben.** Das Anlegen des Projekts ist eine
Laufzeitmutation. Der Product Owner hat am 18.08.2026 **den Weg** freigegeben, **nicht die
Ausführung**. `OQ-002` bleibt bis zur ausdrücklichen Ausführungsfreigabe offen und ist nicht als
erledigt zu führen.

**Riskanteste unbenannte Position, hier benannt.** Die Supabase-GitHub-Integration spielt beim
Merge auf `master` Migrationen automatisch ins Produktivprojekt ein — Merge ist damit
Produktivmigration. Ein Staging-Projekt **darf diese Automatik nicht erben**: die Verdrahtung
des neuen Projekts muss ausdrücklich prüfen, dass kein zweiter automatischer Migrationspfad
entsteht und dass der bestehende produktive Pfad unverändert bleibt.

Akzeptanzkriterien: `AC-034`, `AC-035`, `AC-036`. Risiko: `RISK-001`.

## Schnittgrenze zu EYT-80 und EYT-72

`EXPLICIT` (ergänzt 18.08.2026 — vorher unbenannte Abhängigkeit)

EYT-137 führt **EYT-80** (Komponentenbibliothek) und **EYT-72** als Commit-Enabler, und kein
Sprint-6-Artefakt hat sie bisher erwähnt. Gleichzeitig schließt **EYT-141** die „vollständige
EYT-80-Komponentenbibliothek" ausdrücklich aus, während `REQ-009` und `REQ-010` Zustände und
Wochennavigation brauchen. Die Grenze ist damit:

- **In Sprint 6:** genau die Primitive und Zustände, die die Kernreise dieses Slices braucht —
  nicht mehr. Erweiterungen an `@easytree/ui` nur in dem konkret benötigten Ausschnitt
  (Canvas `Allowed Scope`).
- **Nicht in Sprint 6:** die vollständige EYT-80-Bibliothek, ein generisches Designsystem-Release
  und jede Komponente ohne Abnehmer in dieser Reise.
- **Gemessen 18.08.2026:** eine Komponente `DateRangeControl` existiert im Repository **nicht**
  (`grep -rn "DateRangeControl" --include='*.ts' --include='*.tsx' apps packages` → 0 Treffer).
  Die Wochennavigation aus `REQ-002` ist deshalb Neubau in diesem Slice, kein Wiederverwenden —
  und sie ist der einzige EYT-80-Zuwachs, den dieser Sprint rechtfertigt.

## FR-Namensraum — welche FR aus welchem Dokument

`EXPLICIT` (ergänzt 18.08.2026)

FR-Nummern in diesem Slice stammen aus **zwei verschiedenen Dokumenten** und sind ohne
Dokumentangabe mehrdeutig. Gemessen 18.08.2026:
`grep -n "FR-009\|FR-011\|FR-062" docs/prd/CURRENT_PRD_v1.3.md` → **kein Treffer** (Exit 1).
Keine dieser Nummern steht in der Repository-Kopie v1.3.

| FR-Nennung        | Dokument                                   | Bedeutung hier                                            |
| ----------------- | ------------------------------------------ | --------------------------------------------------------- |
| `FR-009`          | Confluence **PRD v1.4** (7766017) §7       | Plan-Kosten aus veröffentlichter Planversion              |
| `FR-010`          | Confluence **PRD v1.4** (7766017) §7       | Ist-Kosten — in Sprint 6 ausgeschlossen                   |
| `FR-011`          | Confluence **PRD v1.4** (7766017) §7       | Kostenübersicht bis zur Einzelposition                    |
| `FR-062`–`FR-070` | **PRD v1.3-Nummernkreis**, Post-MVP-Grenze | Planungsökonomie/Maschinenverleih — bleibt ausgeschlossen |

Jede weitere FR-Nennung in Sprint-6-Artefakten trägt die Dokumentangabe mit. Eine nackte
FR-Nummer ist ab hier ein Reviewbefund.

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
When er `/planung` und `/kosten` lädt  
Then **enthält die Serverantwort** — HTML-Dokument, RSC-Flight-Payload und jede API-Antwort
dieses Aufrufs — weder Kostenbeträge noch Sätze noch Positionen noch den Kostennavigationslink,
und der direkte API-Zugriff wird serverseitig verweigert.

> **Warum „nicht enthalten" und nicht „nicht sichtbar".** „Nicht sichtbar" ist keine
> Nicht-Auslieferung: Props einer Client-Komponente stehen im RSC-Flight-Payload und damit im
> ausgelieferten HTML, auch wenn der Zugangswächter sie nie rendert. Ein Test gegen
> Sichtbarkeit ist durch eine grüne Attrappe erfüllbar — `display:none` trüge den Wert
> mit. Geprüft wird deshalb der **Inhalt der Serverantwort**, und die Zusicherung richtet sich
> auf **Serverdaten**, nicht auf Werte, die der Client selbst in die URL geschrieben hat
> (deren Rückkehr im Payload beweist kein Leck). `apps/web/e2e/auth-journey/journey.pwtest.ts`
> zieht diese Grenze bereits ausdrücklich; `AC-011` übernimmt sie.

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

Given die in Sprint 6 **neu gebauten oder geänderten** Flächen und Komponenten (Wochennavigation
aus `REQ-002`, Planungswerkbank, Kostenzustände aus `REQ-010`)  
When sie gerendert werden  
Then beziehen sie Farbe, Abstand und Typografie **ausschließlich** über die semantischen
`--eyt-*`-Tokens, tragen keinen eigenen Farb- oder Abstandsliteralwert, und der Token-Wächter
aus `AC-037` weist das für jede dieser Flächen nach.

> **Warum geschärft.** In der alten Fassung („beide Sprint-6-Flächen verwenden dieselbe
> Admin-Shell und dieselben Tokens") war das Kriterium auf `origin/master` **bereits erfüllt**
> und maß deshalb nichts: gemessen 18.08.2026 umschließt `apps/web/app/layout.tsx:29` beide
> Seiten mit `<AppShell>`, `apps/web/app/planung/page.tsx` und `apps/web/app/kosten/page.tsx`
> existieren, und `apps/web/app/globals.css` trägt 79 `--eyt-*`-Deklarationen
> (`grep -c -- "--eyt-" apps/web/app/globals.css` → `79`). Ein Kriterium, das der Ausgangszustand
> erfüllt, kann den Sprint-6-Zuwachs nicht bewerten. Es misst ab hier den **Zuwachs**.

### AC-017

Given die implementierten Sprint-6-Flächen  
When sie bei 1440 px und 1920 px Viewport-Breite sowie bei 200-%-Zoom geprüft werden  
Then gilt jeweils **prüfbar**: (a) das Dokument scrollt nicht horizontal, (b) kein Text und
kein Bedienelement ist abgeschnitten oder überlappt, (c) der primäre CTA der Fläche ist ohne
horizontales Scrollen erreichbar und auslösbar, und (d) axe meldet null Verstöße.

> **Warum umformuliert.** Die alte Fassung endete auf „bedienbar und verständlich".
> „Verständlich" ist nicht falsifizierbar — es gibt keine Mutation, die es widerlegt, und
> deshalb keinen Test, der daran rot werden kann. Die vier Punkte oben sind je einzeln messbar.

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

### AC-031

Given den für Cloudflare Workers gewählten Datenpfad (Hyperdrive oder Direktverbindung) gegen
die **reale** Staging-Verbindung — nicht gegen einen lokalen Stack  
When über genau diesen Pfad `select session_user, current_user, app.is_runtime_channel();`
ausgeführt wird  
Then liefert die Abfrage `session_user` = `easytree_app` und `app.is_runtime_channel()` = `true`,
und die rohe Ausgabe ist als Evidenz abgelegt.

### AC-032

Given denselben nachgewiesenen Datenpfad  
When über ihn nacheinander (a) ein realer Assignment-Write, (b) ein Publish der Planversion und
(c) eine Snapshot-Erzeugung ausgeführt werden  
Then gelingen **alle drei** und liefern serverseitige IDs zurück; ein Fehlschlag auch nur einer
der drei falsifiziert den Pfad und `REQ-016` gilt als nicht erfüllt.

> **Ein reiner Lesepfad ist ausdrücklich KEIN Nachweis.** Die `_select`-Policies tragen keine
> Kanalbedingung — Lesen gelingt auch über einen Pooler, der jedes Schreiben abweist. Ein
> grüner Lesetest würde die Frage also beantworten, ohne sie zu stellen.

### AC-033

Given ein Cloudflare-Datenpfad, der `AC-031` oder `AC-032` nicht besteht  
When über die Sprint-6-Staging-Abnahme entschieden wird  
Then startet Slice 3 **nicht** auf diesem Pfad; die Alternativen sind ein anderer
Cloudflare-Datenpfad mit erneutem `AC-031`/`AC-032`-Nachweis oder der dokumentierte
Railway-Fallback aus `REQ-013`. Eine Abschwächung von `app.is_runtime_channel()`, der
Spaltenrechte oder der RLS-Policies ist als Lösungsweg ausgeschlossen.

### AC-034

Given das separate Supabase-Projekt `easytree-staging`  
When seine Datenbank inspiziert wird  
Then stammt ihr Schema ausschließlich aus `supabase/migrations/*` — nachgewiesen durch einen Read
von `supabase_migrations.schema_migrations`, dessen Versionsliste der Dateiliste in
`supabase/migrations/` entspricht — und die Rolle `easytree_app` existiert als
`NOSUPERUSER, NOBYPASSRLS, NOINHERIT, LOGIN`.

### AC-035

Given die Staging- und die Produktionsumgebung  
When die Datengrenze vor dem ersten Schreibpfad geprüft wird  
Then ist **positiv nachgewiesen**, dass die Staging-`DATABASE_URL` auf einen anderen
Projekt-Host als die Produktions-`DATABASE_URL` zeigt (Projekt-Ref-Vergleich, beide Werte
protokolliert, keine Secrets), und dass in Staging keine produktiven Personendaten liegen.
Ein „ist getrennt konfiguriert" ohne diesen Read zählt nicht.

### AC-036

Given die Supabase-GitHub-Integration, die beim Merge auf `master` Migrationen automatisch
ins Produktivprojekt einspielt  
When das Staging-Projekt verdrahtet wird  
Then erbt es diese Automatik **nicht**: es ist nachgewiesen, dass kein zweiter automatischer
Migrationspfad entsteht und dass der bestehende produktive Pfad unverändert bleibt.

### AC-037

Given die Sprint-6-Flächen aus `REQ-009`  
When der Token-Wächter läuft  
Then geht er rot, sobald in einer Sprint-6-Fläche ein Farb- oder Abstandsliteralwert
(Hex, `rgb(`, `hsl(`, freie `px`-Abstände außerhalb des Rasters) statt eines `--eyt-*`-Tokens
steht.

> **Der Wächter existiert heute nicht.** Gemessen 18.08.2026:
> `grep -rln token apps/web/test packages/ui/test` → kein Treffer (Exit 1). Ohne ihn kann der
> Falsifier zu `REQ-009` nichts rot machen. **Seine Erstellung ist damit Teil der Anforderung**,
> nicht deren Nachweis. Der Testname wird beim Anlegen vergeben und in
> [`../traceability.md`](../traceability.md) `TRC-S6-009` nachgetragen — er wird hier
> ausdrücklich **nicht** vorab erfunden.

### AC-038

Given jede Sprint-6-Fläche  
When ihr Layout geprüft wird  
Then liegt jeder vertikale und horizontale Abstand auf dem 8-pt-Raster (Vielfache von 8 px,
4 px nur innerhalb einer Komponente und dann als Token), und die Fläche trägt **genau einen**
als primär ausgezeichneten CTA — null oder zwei sind ein Fehlschlag.

### AC-039

Given jede datenladende Sprint-6-Fläche  
When sie sich in einem der Zustände Loading, Empty, Error, Forbidden oder Stale befindet  
Then rendert sie für diesen Zustand ein **eigenes, per `data-testid` adressierbares** Element
mit erklärendem Text — kein leeres Raster, keine stille Weiterleitung, kein Zustand, der nur
durch Abwesenheit von Inhalt erkennbar wäre. Alle fünf Zustände sind je Fläche einzeln geprüft.

### AC-040

Given eine berechtigte Nutzerin mit ausgewählter Organisation  
When die Kostenansicht ihren **ersten** Request absetzt  
Then trägt dieser Request den Header `X-EasyTree-Organization-Id` mit der ausgewählten
Organisation — auch dann, wenn der Request aus einem Kind-Effekt derselben Commit-Phase stammt,
in der die Organisation gemeldet wurde. Ein Retry darf nicht die Bedingung sein, unter der der
Header ankommt.

> **Warum das ein eigenes Kriterium braucht.** Gemessen 18.08.2026 an
> `apps/web/app/providers.tsx:45,51,56-58`: die Organisation wird über eine Ref an das
> `CostsGateway` gereicht. `SessionProvider` meldet sie per `onOrganisationChange` nach oben,
> die Kompositionswurzel legt sie in die Ref, und das Gateway liest die Ref bei **jedem**
> Aufruf. Die Übergabe ist damit **nicht synchron**: der Report läuft in einem Eltern-Effekt,
> ein Kostenrequest aus einem Kind-Effekt derselben Commit-Phase geht **ohne** Header raus.
> Das ist ein Flakiness-Kanal für `AC-010`, `AC-012`, `AC-021` und `AC-022`. Die übliche
> Reaktion — ein Retry — **maskiert** ihn: der zweite Versuch findet die Ref gefüllt und wird
> grün, während die Ursache bleibt. Siehe `RISK-007`.

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

- `RISK-001` — non-prod environment separation → adressiert durch `REQ-017`; bleibt offen, bis
  dessen Laufzeitfreigabe erteilt und `AC-034`–`AC-036` belegt sind.
- `RISK-002` — Cloudflare remote CPU/startup (`OQ-003`) — remote ungemessen.
- `RISK-003` — cross-request DB lifecycle. **Achtung:** benennt nur das Symptom
  (prozessweiter `pg.Pool` unbrauchbar), nicht dessen Konsequenz für den Schreibkanal. Die
  Konsequenz trägt `RISK-006`.
- `RISK-004` — canonical economics-scope contradiction — **aufgelöst 18.08.2026**, verbleibt als
  Dokumentationsdrift `DOC-DRIFT-S5-001` (kein Blocker; im Sprint-6-Branch angeglichen, siehe
  `CLAUDE.md` und `docs/handoff/AGENT_HANDOFF_v1.3.md`).
- `RISK-005` — hosting overengineering / forcing Cloudflare.
- `RISK-006` (neu 18.08.2026) — **Der primäre Stagingpfad und der Schreibkanal können sich
  gegenseitig ausschließen.** `REQ-013` macht Cloudflare Workers primär; EYT-142 verbietet dort
  den prozessweiten `pg.Pool`; der naheliegende Ersatz (Supavisor-Transaktionspooler) setzt
  `session_user` auf `postgres.<pooler-tenant>` und lässt damit — abgeleitet, nicht gemessen —
  Zuweisung, Publish **und** Snapshot-Erzeugung ausfallen. Das trifft `REQ-004`, `REQ-005`,
  `REQ-007` und `REQ-012`/`AC-023` gleichzeitig. Weder `RISK-002` noch `RISK-003` noch `RISK-005`
  decken das ab. **Behandlung:** `REQ-016` als Vorbedingung für Slice 3; die Ableitung wird durch
  eine Messung ersetzt, nicht durch eine Einschätzung.
- `RISK-007` (neu 18.08.2026) — **Org-Header-Rennfall als Flakiness-Kanal.** Die
  Organisationsauswahl erreicht das `CostsGateway` über eine Ref und damit nicht synchron
  (`apps/web/app/providers.tsx:45,51,56-58`); ein Kostenrequest aus einem Kind-Effekt derselben
  Commit-Phase geht ohne `X-EasyTree-Organization-Id` raus. Betroffen: `AC-010`, `AC-012`,
  `AC-021`, `AC-022`. Die naheliegende Reaktion — ein Retry — maskiert das Risiko, statt es zu
  beseitigen. **Zugeordnet zu `REQ-011`** (übergreifend wirksam auch für `REQ-006`/`REQ-007`),
  Nachweis über `AC-040`.

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
- Intake-Manifest (eingefrorener Vor-Auflösungsstand): `../context/easytree-sprint-6-core-journey.intake-manifest.md`
- Runbook Schreibkanal/Publish: `../runbooks/planning-publish.md`

## User Confirmation

Beide Bedingungen am 18.08.2026 erfüllt und geprüft. Der **Wortlaut beider Formeln** ist hier
abgelegt — nicht referenziert, sondern zitiert.

### Formel 1 — Canvas- und Vision-Bestätigung

Erteilt am **2026-08-18** durch den Product Owner **Benjamin Poersch**, wörtlich:

> Ich bestätige, dass Product Canvas und Product Vision meine Absicht korrekt wiedergeben und als Grundlage für AgileTeam Planning verwendet werden dürfen.

### Formel 2 — enge EYT-109-Kostenfreigabe

Erteilt am **2026-08-18** durch den Product Owner **Benjamin Poersch**, wörtlich:

> Ich bestätige ausdrücklich: Sprint 6 darf den bereits implementierten EYT-109-Personalkosten-Snapshot in die reale Planen → Publish → Kosten-Kernreise integrieren und auf Staging abnehmen. Diese Freigabe erweitert den Scope nicht auf weitere Planungsökonomie oder Maschinenverleih.

**Diese beiden Blöcke sind die Ablage der Bestätigung.** Vorher belegten die Artefakte die
Nutzerbestätigung nur durch Selbstauskunft und verwiesen auf ein „Sitzungsprotokoll", das kein
Repository-Artefakt ist und deshalb nichts belegen kann. Ab hier ist der Wortlaut versioniert
und diffbar; `docs/traceability.md` verweist auf diese Stellen statt auf das Protokoll.

Damit ist dieses PRD `user-confirmed`. **Nicht mitbestätigt** sind `OQ-002` bis `OQ-005`; sie
bleiben eigenständige Blocker für die von ihnen betroffenen Slices. `REQ-017` benennt den vom
Product Owner freigegebenen **Weg** zur NON-PROD-Grenze; die dafür nötige **Laufzeitmutation**
(Anlegen des Supabase-Projekts) ist damit ausdrücklich **nicht** freigegeben.
