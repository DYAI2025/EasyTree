# EYT Sprint 3 — Umsetzungsplan „durchgängige Einsatzplanung bis zur Mitarbeiteransicht"

- **Sprint:** `EYT Sprint 3` (Board 72, Sprint-ID 170, `state: active`)
- **Sprintfenster laut Jira:** 2026-07-26T19:43:55Z → 2026-07-27T00:07:00Z (≈ 4 h 23 min)
- **Vorgänge im Sprint:** 18 — EYT-11, 45, 46, 47, 49, 50, 61, 62, 72, 73, 74, 75, 78, 79, 80, 81, 86, 87
- **Erstellt:** 2026-07-26 · **Revision 2** nach kritischer Prüfung (Abschnitt 3.1)

## 1. Ziel und Nicht-Ziele

### Sprintziel (Jira, wörtlich)

> Bis zum Sprintende kann ein Planer einen Wocheneinsatz anlegen, Planungskonflikte
> erkennen und lösen sowie eine verbindliche Planversion veröffentlichen. Mitarbeitende
> sehen anschließend dieselbe veröffentlichte Planung in ihrer mobilen Ansicht. Frontend,
> Backend, Datenbank und gemeinsame Designbausteine sind dafür erstmals durchgängig
> integriert.

### Nicht-Ziele

- kein produktives Deployment, keine produktiven Provider, keine echten Personendaten;
- keine zweite Vite-Produktanwendung — Prototypen werden eingefroren und dienen als Designreferenz;
- kein Wetterprovider, kein Offline-Schreiben, keine Sync-Queue, kein nativer Client;
- kein Post-MVP-Modul Planungsökonomie/Maschinenverleih (`FR-062`–`FR-070`, `TASK-032`–`TASK-036`,
  siehe `docs/handoff/AGENT_HANDOFF_v1.3.md`);
- keine Solveroptimierung, keine vollständige Produktabdeckung in E2E.

## 2. Verifizierte Ausgangslage

Jede Zeile wurde in dieser Sitzung am Artefakt geprüft, nicht aus Tickets übernommen.

| Fakt                                                                                                       | Beleg                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/api` enthält nur Shell (AppModule, ConfigModule, Health/Readiness, Correlation-ID, Exception-Filter) | `git ls-files apps/api/src` — 9 Dateien, keine Domainmodule                  |
| Kein Kysely, kein OpenAPI, kein Auth im Backend                                                            | `apps/api/package.json` — nest, `pg`, rxjs, `@easytree/config`               |
| `apps/web` hat nur `/` — keine `/planung`, keine `/einsatz`                                                | `git ls-files apps/web/app`                                                  |
| Schema: `organizations`, `users`, `memberships`, `items`, `item_notes` + RLS + Storage-Policies            | `supabase/migrations/20260723*_000{1,2}_*.sql`                               |
| `items`/`item_notes` sind synthetische RLS-Beweistabellen, keine Fachtabellen                              | Tabellenkommentare in `0002_tenancy.sql`                                     |
| ADR-001 legt Kysely + `pg`, Transactional Outbox + pg-boss, Modulschnitt fest                              | `docs/architecture/ADR-001-boilerplate-architecture.md` Z. 51, 54, 60–78     |
| Fertig: EYT-41, 42, 43, 57, 66, 67                                                                         | Jira-Status `Fertig`                                                         |
| Offen **außerhalb** Sprint 3: EYT-12, 14, 16, 17, 18, 60, 82, 85                                           | Jira-Status `Zu erledigen`, nicht in Sprint 170                              |
| Kein Repository `DYAI2025/Arborga` existiert                                                               | `gh repo list DYAI2025 --limit 100`                                          |
| Evidenzpaket der Drei-Repo-Analyse existiert, aber **außerhalb der Versionskontrolle**                     | `~/Downloads/easytree-three-repo-audit/` — 8 Dateien, 509 Zeilen, 26.07.2026 |

**Nicht nachgeprüft in dieser Sitzung** (Übernahme aus Dokumentation, kein eigener Beleg):
Wirksamkeit der neun Pflichtchecks (`scripts/verify-branch-protection.sh` wurde **nicht**
ausgeführt); Verfügbarkeit von Docker/Supabase-Stack auf dieser Maschine.

## 3. Bekannte Lücken, Widersprüche und Blocker

### 3.1 Korrekturen an Revision 1 dieses Plans

Die kritische Prüfung hat eigene Fehler gefunden. Sie werden hier offengelegt statt still
korrigiert.

**K-1 (falsche Behauptung, korrigiert).** Revision 1 behauptete, die sechs zitierten
Evidenzdokumente (`AUDIT_REPORT`, `CLICKDUMMY_SCOPE_MATRIX`, `MVP_PRD_GAP_ANALYSIS`,
`REPOSITORY_PROFILES`, `INTEGRATION_ARCHITECTURE`, `TASK_BACKLOG`) existierten nicht. **Das war
falsch.** Sie liegen vollständig in `~/Downloads/easytree-three-repo-audit/` (Stand 26.07.2026,
13:45). Der Fehler entstand, weil nur die drei Repositories und Confluence durchsucht wurden.
**Die belastbare Aussage lautet:** Das Evidenzpaket ist in **keinem** Repository und **nicht**
in Confluence versioniert. Damit ist es weder für andere prüfbar noch gegen Verlust gesichert,
obwohl neun Sprintvorgänge ihre Akzeptanzkriterien darauf stützen. → Aufgabe S3-01 committet es
nach `docs/audit/`.

**K-2 (Reihenfolge invertiert).** Revision 1 plante Backend-first
(Schema → Invarianten → Verträge → UI). Die Analyse empfiehlt ausdrücklich das Gegenteil:

> „Der nächste sinnvolle Schritt ist **nicht sofort Backend-Vollausbau**, sondern eine
> integrierte Clickdummy-Version, die alle 14 PRD-Ansichten in einem kohärenten Rollen- und
> Datenmodell demonstriert … über Mock-Gateways dieselben Contracts verwenden, die später das
> Backend bedient." (`MVP_PRD_GAP_ANALYSIS.md`, „Clickdummy vor MVP")

Reihenfolge in Abschnitt 5 entsprechend umgestellt: `packages/domain` + `packages/contracts` +
Gateway-Ports **vor** dem Datenbankausbau. Der Vertrag ist derselbe, nur der Adapter wechselt —
das Sprintziel (echte Integration) bleibt erreichbar, aber der Wert entsteht früher.

**K-3 (falsche Abhängigkeit).** Revision 1 hängte EYT-73 und EYT-74 hinter Schema und
SQL-Invarianten. Beide sind **reine Domainlogik** (Zeitintervall-Value-Object, Wochenkapazität)
und brauchen keine Datenbank. Sie sind die billigsten und höchstwertigen Fixes im Sprint und
werden vorgezogen.

**K-4 (Zahl als Messung getarnt).** „45–55 Entwicklertage" war eine ungeprüfte Schätzung. Sie
gilt weiter als **grobe Schätzung** auf Basis der 18 Vorgänge und ihrer Akzeptanzkriterien —
sie ist **keine** gemessene Größe und ersetzt kein Developer-Sizing (siehe L-6).

### 3.2 Befunde an den Sprintartefakten

**L-1 — Sprintfenster ist unplausibel.** 4 h 23 min für einen Sprintinhalt, der nach
Aufgabenschnitt grob 45–55 Entwicklertage umfasst (Schätzung, siehe K-4). Entweder ist das
Datum ein Konfigurationsfehler oder das Sprintziel ist im Fenster nicht erreichbar. **Folge:**
Dieser Plan liefert keine Sammelaussage „Sprint fertig", sondern pro Aufgabe eine eigene
Abnahmeevidenz.

**L-2 — Evidenzpaket ist unversioniert.** Siehe K-1. Neun Vorgänge (EYT-11, 78, 79, 80, 81, 82,
85, 86, 87) zitieren `GAP-*`, `FIND-*` und `EVID-*` aus diesem Paket. Solange es nur in
`~/Downloads/` liegt, ist keines dieser Akzeptanzkriterien reproduzierbar prüfbar.

**L-3 — EYT-78 ist berechtigt, seine Teilprämisse aber überholt.** Die Namensinkonsistenz ist
real und als `FIND-002` / `GAP-001` (High) belegt. Überholt ist nur die Formulierung, die
`DYAI2025/Arborga` als _konkurrierendes kanonisches Ziel_ darstellt:

- `docs/runbooks/branch-protection.md:139-141` — „Kanonisch ist **`DYAI2025/EasyTree`**.
  `DYAI2025/Arborga` ist ein früherer Name … leitet auf `EasyTree` weiter."
- `docs/architecture/ARCHITECTURE_DECISIONS_v1.3.md:14` — Umbenennung am 25.07.2026.
- `gh repo list DYAI2025` enthält kein `Arborga`.
- `INTEGRATION_ARCHITECTURE.md` — „**EasyTree-master wird das einzige kanonische
  Produkt-Repository.**"

Veraltete Verweise bestehen weiterhin in `docs/prd/CURRENT_PRD_v1.3.md:135`,
`docs/handoff/AGENT_HANDOFF_v1.3.md:4`, `docs/plans/2026-07-24-eyt-sprint-2-implementation.md`
(Z. 709/734/744) und den Generatorartefakten `prd_report_v1.3.{md,json}`.

**L-4 — Produktname widersprüchlich, nicht blockierend.** PRD v1.3 und MVP-Scope titeln
„Arboscus Teamplaner"; Repository, Jira-Projekt, Paketnamensraum `@easytree/*` und PWA-Manifest
sagen „easyTree". **Vorschlag für ADR-002 (bestätigungspflichtig):** Produktname „Arboscus
Teamplaner", technischer Namensraum `easytree`. Vor dem Setzen nutzersichtbarer Strings vom
Product Owner zu bestätigen.

**L-5 — Zirkuläre Abhängigkeit EYT-86 ↔ EYT-49.** EYT-86 nennt EYT-49 als Vorgänger; EYT-49
setzt die Tabellen aus EYT-86 voraus. **Auflösung:** 86 legt Tabellen inkl. Range-Spalten an,
49 ergänzt Constraints/Trigger/pgTAP. Reihenfolge 86 → 49.

**L-6 — „Priorisiertes Set" ist unvollständig und unbestätigt.** Der Sprintziel-Kommentar an
EYT-50 nennt EYT-45, 46, 47, 49, 50, 62, 73, 74, 78, 79, 80 — **ohne EYT-86**. EYT-50 verlangt
aber „Mitarbeiter und Baustelle werden über Domain Commands angelegt", was ohne fachliches
Schema unmöglich ist. Derselbe Kommentar hält fest: „Kapazität, Größen, Reihenfolge und
Betriebsreserve sind noch durch die Developers zu bestätigen … kein behauptetes Commitment."

**L-7 — Vier Sprintvorgänge hängen an Tickets außerhalb des Sprints.**

| Vorgang | hängt an (offen, nicht im Sprint) | Folge                                                 |
| ------- | --------------------------------- | ----------------------------------------------------- |
| EYT-72  | EYT-14, 16, 17, 18, 60            | Vollansicht nicht vollständig abnehmbar               |
| EYT-11  | EYT-82, EYT-85                    | End-to-End-Clickdummy nicht vollständig durchspielbar |
| EYT-80  | EYT-12 (Outdoor-/A11y-Regeln)     | Tokenentscheidungen ohne verbindliche Regelbasis      |
| EYT-75  | EYT-17                            | UI-Teil erst mit Zuweisungsfluss vollständig prüfbar  |

**L-8 — Quellenverweise in EYT-46/47/49 sind verschoben.** Abgleich gegen
`docs/plans/2026-07-23-boilerplate-architecture.md`:

| Vorgang | zitiert  | tatsächlicher Inhalt dieser TASK | korrekt wäre |
| ------- | -------- | -------------------------------- | ------------ |
| EYT-45  | TASK-008 | Kysely-Datenzugriff              | ✅ korrekt   |
| EYT-46  | TASK-009 | PostgreSQL-Invarianten           | TASK-010     |
| EYT-47  | TASK-010 | Domainmodule                     | TASK-012     |
| EYT-49  | TASK-012 | OpenAPI/Client                   | TASK-009     |

Dieser Plan verwendet die **korrigierten** Verweise und markiert sie als Korrektur.

**L-9 — Paketbenennung: zwei Dokumente widersprechen sich.** `TASK-012` des Boilerplate-Plans
nennt `packages/api-client`; `INTEGRATION_ARCHITECTURE.md` (jünger, 26.07.2026) nennt
`packages/domain` und `packages/contracts`. **Entscheidung dieses Plans:** der jüngeren,
spezifischeren Quelle folgen → `packages/domain` (reine Typen/Invarianten) und
`packages/contracts` (OpenAPI/DTO/generierter Client). Beide sind stabile, benannte Pakete und
damit ADR-001-konform (`packages/shared` bleibt verboten). In ADR-002 festzuhalten.

**L-10 — ADR-001 beschreibt eine Struktur, die so nicht gebaut wurde.** ADR-001 Z. 46/47 nennt
`apps/backend` mit Entrypoints `api.ts`/`worker.ts`; tatsächlich existiert `apps/api` mit
`main.ts`/`worker.ts`. Harmlose, aber dokumentierte Drift — in ADR-002 als Ist-Stand
festschreiben, nicht den Code umbenennen.

**L-11 — Vier Analysebefunde haben keinen Sprintvorgang.** Sie treffen genau die Vorgänge, die
„kontrolliert portieren" sollen:

| Befund                 | Schwere  | Inhalt                                                                            | Risiko bei Portierung |
| ---------------------- | -------- | --------------------------------------------------------------------------------- | --------------------- |
| `FIND-006` / `GAP-013` | Extreme  | Timer per `setInterval` + lokalisierte Anzeigezeit statt Instant                  | trifft **EYT-81**     |
| `FIND-005` / `GAP-012` | Elevated | Tagesbasierte Reservierungszählung meldet sequenzielle Nutzung als Doppelbelegung | trifft **EYT-72**     |
| `FIND-010` / `GAP-015` | High     | Geocoding/Kartenassets direkt aus dem Browser                                     | trifft **EYT-72**     |
| `GAP-014`              | High     | Arbeitszeitfreigabe/Korrektur-Ansicht fehlt vollständig                           | Lücke in EYT-72       |

**Auflage:** EYT-72 und EYT-81 dürfen diese Muster **nicht** mitportieren. Für jeden Befund ist
im PR zu belegen, dass er nicht übernommen wurde. Fehlende Vorgänge sind im Backlog anzulegen.

**L-12 — Transactional Outbox hat keinen eigenen Sprintvorgang.** EYT-50 verlangt
„Veröffentlichung erzeugt Audit und genau einen idempotenten Workerjob"; EYT-45 verlangt
„Businesswrite und zugehöriger Outbox-Eintrag rollen gemeinsam zurück". Der Worker-/pg-boss-Teil
(`TASK-013` des Boilerplate-Plans, `GAP-016`) ist in keinem Sprintvorgang abgedeckt. Der Sprint
liefert daher Outbox-**Tabelle und Transaktionssemantik**; die Zustellstrecke bleibt offen.

## 4. Aufgabenliste

Konventionen: eigener Branch `feat/eyt-<nr>-<slug>`, ein PR je Aufgabe, Commit-Präfix
`<typ>(<scope>): EYT-<nr> …`. Kein Merge ohne grüne Pflichtchecks. Migrationen heißen
`<timestamp>_NNNN_<slug>.sql` und sind append-only. Neue CI-Jobs **immer** zusammen mit
`scripts/setup-branch-protection.sh` und `docs/runbooks/branch-protection.md` ändern.

---

### S3-01 — EYT-78: Integrations-ADR, Evidenzbasis versionieren, Referenzen bereinigen

- **Abhängigkeit:** keine. Vorgänger für alle Integrations- und Migrationsarbeiten.
- **Liefert:**
  1. `docs/audit/` mit dem vollständigen Evidenzpaket (behebt L-2) inkl. Herkunfts- und
     Evidenzgrenzen-Hinweis („Builds/Tests in der Analysesitzung nicht ausgeführt").
  2. `docs/architecture/ADR-002-integration-canonical-repo.md`: Repository-URL, Default-Branch,
     Produktname (L-4), Status der Prototypen, Zielstruktur „ein Monorepo, zwei Rollen-Shells",
     Paketbenennung (L-9), Ist-Struktur-Drift (L-10), verworfene Optionen, Rückbaupfad.
  3. Bereinigung der Altverweise aus L-3.
- **Tests:** `git grep -n "Arborga"` liefert nur noch historisch markierte Treffer;
  `pnpm format` grün.
- **Abnahmeevidenz:** ADR-Datei + Grep-Ausgabe + grüner `format`-Lauf.
- **Offen:** L-4 Produktname bedarf Bestätigung durch den Product Owner.
- **Rollback:** reine Dokumentänderung, Revert des Merge-Commits.

---

### S3-02 — EYT-46: Domainmodule, `packages/domain` und Architekturgrenzen

- **Quelle:** Boilerplate-Plan **TASK-010** (korrigiert, siehe L-8); ADR-001 Z. 58–78;
  `INTEGRATION_ARCHITECTURE.md` „Zielstruktur".
- **Abhängigkeit:** S3-01.
- **Dateien:** `packages/domain` (reine Typen/Invarianten, framework-frei);
  `apps/api/src/modules/<modul>/{domain,application,infrastructure,interface/http,index.ts}`;
  Tabellenbesitz-Registry; `apps/api/test/architecture.test.ts`; CI-Job.
- **Module (ADR-001 Z. 60 ∪ Integrationsarchitektur):** planning, workforce, worksites,
  absence, resources, time, notifications, weather, tenancy/identity, audit.
- **Regeln:** Domain importiert kein NestJS/HTTP/Kysely/SDK; ein Modul schreibt nur eigene
  Tabellen; Querzugriff nur über `index.ts`; `packages/shared` bleibt verboten.
- **Abnahmeevidenz:** ein absichtlich verbotener Import lässt den Architekturtest rot werden —
  Nachweis im PR, danach zurückgenommen.
- **Planabweichung (bei Umsetzung entschieden, EYT-46):** _kein_ neuer CI-Job. Der Wächter läuft
  im bestehenden Pflichtjob `unit-tests`. Grund: ein neuer Pflichtcheck verlangt ein erneutes
  `setup-branch-protection.sh` mit Adminrechten. Wird der PR vor dem Ruleset-Update gemergt, ist
  der Check unverbindlich; wird das Ruleset zuerst aktualisiert, wartet GitHub bei
  `bypass_actors: []` auf einen Kontext, den noch kein Workflow erzeugt, und **jeder** PR wird
  dauerhaft unmergebar. Der Wächter im bestehenden Job hat dieselbe Blockwirkung ohne dieses
  Risiko. Ebenfalls entschieden: Modulgerüst nur für die drei Module, die Sprint 3 wirklich
  benutzt — leere Modulordner sind keine Grenzen (ADR-001 Z. 33).

---

### S3-03 — EYT-73 (Bug): Zeitintervallmodell — **reine Domainlogik, keine DB**

- **Abhängigkeit:** S3-02. (Korrigiert gegenüber Revision 1, siehe K-3.)
- **Belegtes Fehlerbild:** `FIND-004` (High) — „Gleiches Start-/Ende wird als 24 h
  interpretiert; Zeitvalidierung fehlt."
- **Dateien:** `packages/domain/src/time-interval.ts`; Validierung an der Command-Grenze;
  später DB-Check-Constraint als Rückfallebene (S3-06).
- **Regeln:** Start und Ende Pflicht; `start == end` ungültig; `end < start` abgelehnt, solange
  Nachtarbeit kein freigegebenes Fachmodell ist; **halb-offene Intervalle `[start, end)`**
  (`INTEGRATION_ARCHITECTURE.md`, „Zeit- und Veröffentlichungsregeln"); Dauer **und**
  Überlappung nutzen dasselbe Modell; Publish bleibt fail-closed.
- **Tests:** Unit-/Property-Tests für gleiche Zeiten, Mitternacht, angrenzende Intervalle,
  Überschneidung; später API-Negativtest für Publish (S3-08).
- **Abnahmeevidenz:** Testfälle waren vor dem Fix rot.

---

### S3-04 — EYT-74 (Bug): Wochenkapazität — **reine Domainlogik, keine DB**

- **Abhängigkeit:** S3-03.
- **Belegtes Fehlerbild:** `FIND-003` (High) — „Planer-Clickdummy aggregiert Wochenstunden nicht
  verlässlich pro Woche."
- **Dateien:** `packages/domain/src/capacity.ts`.
- **Regeln:** Kapazität deterministisch je (Mitarbeiter, Planungswoche); Wochenregel und
  Zeitzone **explizit dokumentiert** — Vorschlag `Europe/Berlin` + ISO-8601-Woche, in ADR-002
  festzuschreiben (nicht aus den Tickets ableitbar); zwei getrennte Wochen erzeugen keinen
  gemeinsamen Konflikt; Warnung ≠ Publish-Blocker; Vier-Wochen-Projektion nutzt dieselben
  Wochenwerte wie die Wochenansicht.
- **Tests:** Wochenwechsel, Jahreswechsel (ISO-Woche 52/53/01), DST-Grenzen.

---

### S3-05 — EYT-47 + EYT-79: `packages/contracts`, OpenAPI v1 und Gateway-Ports

- **Quelle:** Boilerplate-Plan **TASK-012** (korrigiert, L-8); `INTEGRATION_ARCHITECTURE.md`
  „UI-Port für Clickdummy und spätere API" — die Portsignaturen sind dort **wörtlich
  vorgegeben** (`PlanningGateway`, `EmployeeGateway`) und werden übernommen, nicht neu erfunden.
- **Abhängigkeit:** S3-02.
- **Dateien:** `packages/contracts` (OpenAPI-Dokument, DTO/Schemas, generierter TS-Client);
  `PlanningGateway`/`EmployeeGateway` als versionierte Ports; `MockPlanningGateway` /
  `MockEmployeeGateway`; `HttpPlanningGateway` / `HttpEmployeeGateway`;
  `packages/prototype-fixtures` (nur Clickdummy-/Testdaten, klar gekennzeichnet);
  CI-Job `contract-check`.
- **Vertragsinhalt:** einheitliche Fehler- (RFC-7807-nah wie im bestehenden
  `HttpExceptionFilter`), Pagination- und Idempotency-Schemata; Domainentitäten werden nicht
  direkt als Transportobjekte veröffentlicht.
- **Tests:** Contract-Tests laufen **identisch** gegen Mock und HTTP; Generierungs-Diff lässt
  CI scheitern; Boundary-Test erweitert `apps/web/test/no-supabase-import.test.ts` um
  „Komponenten importieren keine Fixtures und kein Supabase-SDK".
- **Abnahmeevidenz:** absichtlicher Spec-Drift lässt den neuen Job rot werden.
- **Hinweis:** EYT-60 (vollständiges Drift-Gate) ist nicht im Sprint; hier entsteht nur der Kern.

---

### S3-06 — EYT-80: Design-Tokens, Assets und Primitives in `packages/ui`

- **Abhängigkeit:** S3-01. **Teilblockiert durch EYT-12** (L-7).
- **Dateien:** `packages/ui/src/tokens/*`, neue Primitives, `packages/ui/ASSETS.md`
  (Herkunft/Lizenz je Asset).
- **Regeln:** Status nie nur über Farbe; Fokus-/Touch-Regeln aus EYT-12; Planer-Desktop und
  Mitarbeiter-Mobile teilen die Designbasis ohne identische Layoutzwänge.
- **Tests:** axe- und Tastatur-Smokes; Viewports 320/375/1440/1920 px ohne unkontrolliertes
  horizontales Seiten-Scrolling.
- **Im Sprint erreichbar:** Tokens/Primitives für den Referenzslice. **Offen:** verbindliche
  Regelbasis aus EYT-12; vollständiger Asset-/Lizenzaudit.

---

### S3-07 — Integrierter Mock-Clickdummy (Zwischenziel aus `MVP_PRD_GAP_ANALYSIS`)

- **Abhängigkeit:** S3-03 … S3-06. **Kein eigener Jira-Vorgang** — Zwischenergebnis, das
  EYT-50, EYT-72, EYT-81 und EYT-11 vorbereitet und die Empfehlung „Clickdummy vor MVP" umsetzt.
- **Liefert:** `/planung` und `/einsatz` gegen `Mock*Gateway`, mit **korrekter** Domainlogik aus
  S3-03/S3-04 statt der fehlerhaften Prototyp-Logik; alle Mock-/Demo-Zustände sichtbar
  gekennzeichnet.
- **Abnahmeevidenz:** Rollenübergang Planer → Publish → Mitarbeiter ist klickbar; keine
  Behauptung produktiver Backendfunktion (`AUDIT_REPORT`: „gilt nicht als Nachweis").
- **Wert:** validiert Produktlogik, bevor Datenbank- und API-Breite gebaut wird.

---

### S3-08 — EYT-45: Kysely-Zugriff, Transaktionsgrenze, Tenantkontext

- **Quelle:** Boilerplate-Plan TASK-008 (korrekt zitiert); ADR-001 Z. 51.
- **Abhängigkeit:** S3-02.
- **Dateien:** `apps/api/src/platform/database/*` (Kysely-Instanz, `UnitOfWork`,
  `TenantTransaction`), generierte DB-Typen, Generierungsskript.
- **Design:** Tenantkontext ausschließlich transaktionslokal
  (`set_config('request.jwt.claims', …, true)` + `set local role authenticated`) — exakt das
  Muster aus `apps/api/test/tenant-context.helper.ts`, weil Supavisor im Transaction Mode keine
  Session-Settings zulässt.
- **Tests:** Repository-Integrationstests; „Businesswrite + Outbox-Eintrag rollen gemeinsam
  zurück"; Nebenläufigkeit „parallele Requests vermischen keinen Tenantkontext"; Negativtest
  „Repository ohne Transaktionskontext wirft".
- **Abnahmeevidenz:** grüner Lauf gegen direkten Anschluss **und** Transaction-Pooler (54329).

---

### S3-09 — EYT-86: Fachliches Kerndomänenschema mit Migrationen und RLS

- **Abhängigkeit:** S3-08. **Vorgänger von S3-10** (L-5).
- **Entitäten:** Vereinigung aus EYT-86 und `INTEGRATION_ARCHITECTURE.md` „Zentrale
  Domänenobjekte" — Organization/User/Employee/Role/Permission; Worksite/Activity/MeetingPoint;
  Skill/Certification/EmployeeSkill; Vehicle/Equipment/ResourceReservation/ConditionReport;
  PlanningWindow/PlanVersion/Assignment/AssignmentChange; Conflict/ValidationResult/Publication;
  Confirmation/Rejection/Notification; AbsenceRequest/AbsenceDecision;
  ActiveTimeEntry/TimeEntry/TimeApproval/TimeCorrection; WeatherSnapshot/WeatherWarning; Audit;
  Outbox.
- **Regeln:**
  - `org_id NOT NULL` auf **jeder tenant-owned Tabelle** — nicht global. ADR-001 Z. 82 formuliert
    die Regel bewusst eng („Jede tenant-owned Zeile"). Ausgenommen sind die bereits bestehenden
    globalen bzw. identitätsnahen Tabellen: `public.organizations` (**ist** der Mandant, hat
    naturgemäß kein `org_id`) und `public.users` (1:1-Abbildung auf `auth.users`, RLS „nur
    self", kein `org_id` — beide Migrationen belegen das). Eine Zuordnung Benutzer ↔ Organisation
    erfolgt ausschließlich über `public.memberships`. Jede weitere globale Tabelle ist in der
    Migration ausdrücklich als solche zu kommentieren und zu begründen.
  - Composite-`unique (id, org_id)` als Ziel tenant-gebundener Fremdschlüssel.
  - Zeitwerte als UTC-Instant **plus** IANA-Zeitzone **plus** lokales Geschäftsdatum.
  - Effective Dates; RLS fail-closed; keine Personendaten im Seed.
- **Schnitt:** mehrere vertikale Teilmigrationen, **keine** Monstermigration.
- **Abnahmeevidenz:** zweimal `supabase db reset` + zweimal grünes `supabase test db`
  (`docs/runbooks/database-workflow.md`); CI-Job `db-gates` grün.

---

### S3-10 — EYT-49: Planungszeit- und Audit-Invarianten als SQL-Verträge

- **Quelle:** Boilerplate-Plan **TASK-009** (korrigiert, L-8).
- **Abhängigkeit:** S3-09.
- **Invarianten (wörtlich):** keine überlappenden veröffentlichten Mitarbeiterintervalle; keine
  Doppelreservierung exklusiver Ressourcen; höchstens ein aktiver Timer pro Mitarbeiter;
  veröffentlichte Planrevisionen nicht still überschreibbar; Arbeitszeitkorrektur bewahrt
  Originalwert, Korrektur, Grund und Akteur.
- **Technik:** `tstzrange` (halb-offen) + partielle `EXCLUDE USING gist` mit `org_id`-Gleichheit
  — **Voraussetzung:** Extension `btree_gist` (in der Migration anzulegen, aktuell nicht
  vorhanden); partieller Unique-Index für aktive Timer; Versionsspalte/Trigger.
- **Achtung `FIND-005`:** Ressourcenkonflikt über echte Intervallüberschneidung prüfen, **nicht**
  tagesbasiert zählen.
- **Tests:** pgTAP-Positiv-/Negativtests **plus** Nebenläufigkeitstest mit zwei parallelen
  Sitzungen.
- **Abnahmeevidenz:** paralleler Konflikt wird von der Datenbank abgelehnt, nicht nur von der
  Anwendung.

---

### S3-11 — EYT-61: Domain-, Zeit- und Idempotenzinvarianten test-first

- **Abhängigkeit:** S3-10.
- **Abdeckung (wörtlich):** je Invariante ein Positiv- und ein Negativtest; überlappende
  Mitarbeiter-/Ressourcenintervalle; höchstens ein aktiver Timer; gleicher Idempotency Key ohne
  Doppeleffekt; Revisionen/Korrekturen bewahren Originalwert, Grund, Akteur, Historie;
  Sommerzeitlücke, doppelte Winterzeitstunde, Mitternachtswechsel, Effective Dates.
- **Auflage:** kein Skip-Pfad, der ein Pflicht-Gate grün werden lässt (`CLAUDE.md`, bewiesen
  durch `apps/api/test/tenant-gate.fail-closed.test.ts`); Property-Seeds reproduzierbar.

---

### S3-12 — EYT-50: Vertikaler Planungs- und Publish-Referenzfluss

- **Abhängigkeit:** S3-05 … S3-11. **Kernstück des Sprintziels.**
- **Umsetzung:** die in S3-07 gebauten Ansichten wechseln von `Mock*Gateway` auf
  `Http*Gateway` — derselbe Vertrag, anderer Adapter. Backend liefert Domain Commands,
  Konfliktprüfung, atomare Planversion, Audit und **einen** Outbox-Eintrag.
- **AK (wörtlich, EYT-50):** synthetischer berechtigter Planer in genau einer Testorganisation;
  Mitarbeiter und Baustelle über Domain Commands; Wochenentwurf über den generierten Client;
  Behandlung gemäß EYT-73/74; überlappender Einsatz mit stabilem Konfliktcode abgelehnt;
  unveränderliche Planversion atomar veröffentlicht; Audit + genau ein idempotenter Workerjob;
  gemeinsame Primitives und Gateways; identische Assignment-/Planversions-IDs in beiden Sichten;
  Reload und zweiter Browserkontext zeigen den Serverstand.
- **Einschränkung aus L-12:** Outbox-Eintrag und Transaktionssemantik werden geliefert; die
  Zustellstrecke (pg-boss-Worker) hat keinen Sprintvorgang und bleibt offen.
- **Abnahmeevidenz:** Contract-, Integrations-, Browser- und Nebenläufigkeitstests grün **in CI**.

---

### S3-13 — EYT-62: Kritische vertikale Nutzerreisen als E2E-Suite

- **Abhängigkeit:** S3-12. EYT-57 ist erfüllt.
- **Harte Auflage:** Die Sprintziel-E2E läuft gegen `Http*Gateway` und eine **echte** Datenbank.
  Ein Lauf gegen `Mock*Gateway` ist **kein** Nachweis für das Sprintziel und darf nicht als
  solcher gemeldet werden.
- **Abdeckung (wörtlich):** Anmeldung und Auflösung nur der eigenen Organisation; fremde
  Organisation unzugänglich; gültiger Entwurf erstellbar/validierbar/veröffentlichbar; ungültige
  Veröffentlichung mit nachvollziehbarem Grund abgelehnt; veröffentlichter Zustand und
  Auditnachweis in UI **und** Datenbank konsistent; parallele/wiederholte Aktionen ohne
  Doppelwirkung; isolierte synthetische Daten, benutzernahe Selektoren.
- **Abnahmeevidenz:** ausgeführter CI-Lauf, kein lokaler Lauf.

---

### S3-14 — EYT-75 (Bug): Schnellzuweisung ohne explizites Ziel verbieten

- **Abhängigkeit:** S3-05, S3-12. **Teilblockiert durch EYT-17** (L-7).
- **Regeln:** jede Zuweisung trägt explizite Mitarbeiter-ID **und** Assignment-ID; ohne
  ausgewähltes Ziel keine Mutation; UI fordert Ziel und Zeitraum sichtbar an oder deaktiviert
  die Aktion; Server validiert Tenant, Berechtigung, Version, Zielzustand.
- **Tests:** Playwright-Negativtest — Aktion ohne Ziel verändert **serverseitig** keine Daten.

---

### S3-15 — EYT-87: Supabase Auth (Einladung, Reset, Session-Fehlerfälle)

- **Abhängigkeit:** S3-09. Laut Sprintziel-Kommentar **nicht** Teil des Sprintziels.
- **Belegt durch:** `FIND-008` (Extreme), `GAP-003`, `GAP-004`.
- **Regeln:** Browser erhält keine Service-Role-Credentials; Benutzer-/Employee-/
  Organization-Zuordnung serverseitig; abgelaufene, widerrufene, ungültige Sessions
  fail-closed; Rate Limit, Audit und minimale Fehleroffenlegung dokumentiert.
- **Bemerkung:** E-Mail-Provider ist laut `docs/README.md` ein **offener Freigabepunkt** —
  Einladung/Reset laufen gegen die lokale Supabase-Grenze, nicht gegen einen produktiven Provider.

---

### S3-16 — EYT-72: Admin-Vollansicht portieren

- **Abhängigkeit:** S3-12, S3-13. **Teilblockiert durch EYT-14/16/17/18/60** (L-7).
- **Umfang:** `/planung`; Wochenansicht primär, Monat und Vier-Wochen als Projektionen derselben
  serverseitigen Quelle; Command Bar, Summary Tiles, Tageskolumnen, Einsatzkarten,
  Nicht-zugewiesen/Abwesend, Ressourcenbereich, Detaildrawer, Quick Add, Publish-Dialog.
- **Verboten:** Runtime-Abhängigkeit auf `mockData.ts`, fest codierte September-2026-Daten,
  lokaler Rollenumschalter, lokale Publish-Wahrheit.
- **Nicht mitportieren (L-11):** tagesbasierte Reservierungszählung (`FIND-005`),
  Browser-Geocoding/Kartenassets (`FIND-010`). Fehlende Zeitfreigabe/Korrektur (`GAP-014`) als
  bekannte Lücke ausweisen.
- **Tests:** `pnpm typecheck`, `pnpm lint`, `pnpm build`, Planner-Playwright inkl. axe;
  Negativtest „Browsercode kann keine operativen Supabase-Schreibzugriffe importieren";
  ≥ 12 Personen und 3 parallele Baustellen bei 1440/1920 px; Mindestbedienbarkeit 320/375 px.

---

### S3-17 — EYT-81: Mitarbeiter-Ansichten portieren

- **Abhängigkeit:** S3-05, S3-06, S3-12.
- **Umfang:** Routen unter `/einsatz`; Heute, Woche, Baustellendetail, Wetterhinweis **als klar
  gekennzeichneter Mock**, Bestätigung/Ablehnung, Abwesenheit, Timer, Zustandsmeldung.
- **Nicht mitportieren (L-11):** `setInterval`-Timer mit lokalisierter Anzeigezeit
  (`FIND-006`, **Extreme**) — Start/Stop wird serverseitiger Command mit UTC-Instant und genau
  einer aktiven Buchung; Offline-/PWA-Claims (`FIND-007`, EYT-85 nicht im Sprint);
  `localStorage.clear()` im Demo-Reset; externe Demo-Assets für Foto/Audio.
- **Tests:** Browser-Smoke für Plan öffnen, bestätigen/ablehnen, Timerzustand,
  Zustandsmeldung; 320/375 px vollständig bedienbar.

---

### S3-18 — EYT-11: Zentrale mobile Nutzerreisen als Clickdummy validieren

- **Abhängigkeit:** S3-16, S3-17. **Blockiert durch EYT-82 und EYT-85** (L-7).
- **Umfang:** das achtschrittige Szenario aus `CLICKDUMMY_SCOPE_MATRIX.md` mit identischen
  Employee-, Worksite-, Resource-, Assignment- und Planversions-IDs; drei unterscheidbare
  Rollensichten; Mock-/Demo-/nicht-implementierte Zustände sichtbar gekennzeichnet; Test auf
  Smartphone-Größen sowie 1440/1920 px dokumentiert.
- **Ausdrücklich:** „Der Test gilt **nicht** als Nachweis einer produktiven Backendfunktion."
- **Bemerkung:** erfordert menschliche Stakeholder (Geschäftsführung, Administration,
  operativer Mitarbeiter). Ein Agent kann vorbereiten und dokumentieren, den Validierungstermin
  aber nicht ersetzen.

## 5. Reihenfolge (Revision 2 — „Verträge vor Backend")

```
S3-01  EYT-78   ADR-002 + Evidenz versionieren + Referenzen bereinigen
   │
   ├── S3-02  EYT-46   packages/domain + Module + Architekturgrenzen
   │      ├── S3-03  EYT-73   Zeitintervall      (reine Domainlogik)
   │      │     └── S3-04  EYT-74   Wochenkapazität (reine Domainlogik)
   │      └── S3-05  EYT-47+79 packages/contracts + Gateway-Ports (Mock & HTTP)
   └── S3-06  EYT-80   Tokens/Primitives                    [EYT-12 offen]
                    │
                    ▼
              S3-07  integrierter Mock-Clickdummy      ← früher Produktwert
                    │
                    ▼
              S3-08  EYT-45   Kysely + Tenant-Transaktion
                    ▼
              S3-09  EYT-86   fachliches Schema + RLS
                    ▼
              S3-10  EYT-49   SQL-Invarianten (btree_gist, EXCLUDE)
                    ▼
              S3-11  EYT-61   Invarianten test-first
                    ▼
              S3-12  EYT-50   HTTP-Adapter statt Mock  ◄── Sprintziel-Kern
                    ├── S3-13 EYT-62  E2E gegen HTTP + echte DB
                    └── S3-14 EYT-75  explizites Zuweisungsziel  [EYT-17 offen]
                    ▼
     S3-15 EYT-87 · S3-16 EYT-72 · S3-17 EYT-81   [nicht im Sprintziel / teilblockiert]
                    ▼
              S3-18  EYT-11   Stakeholder-Validierung  [EYT-82, EYT-85 offen]
```

## 6. Risiken und Rollback

| Risiko                                                                     | Gegenmaßnahme                                                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Umfang übersteigt das Sprintfenster deutlich (L-1)                         | Aufgabenweise Lieferung mit eigener Evidenz; kein Sammel-„fertig"                        |
| Evidenzbasis geht verloren oder ist für andere nicht prüfbar (L-2)         | S3-01 committet `docs/audit/` als Erstes                                                 |
| Fehlerhafte Prototyplogik wandert in den Kern (`FIND-003…006`, `FIND-010`) | S3-03/S3-04 **vor** jeder UI-Portierung; L-11 als PR-Auflage                             |
| Grüne E2E gegen Mock werden als Sprintzielnachweis gemeldet                | S3-13 harte Auflage: HTTP + echte DB                                                     |
| Neue CI-Jobs werden stillschweigend optional                               | `scripts/setup-branch-protection.sh` bricht ab; Skript + Runbook im selben PR nachziehen |
| Grüner Lauf durch Skips                                                    | Fail-closed wie `EASYTREE_TENANT_TESTS=required`; Report-Zeile in CI prüfen              |
| Schema als eine große, unrückbaubare Migration                             | vertikale Teilmigrationen mit dokumentierter Forward-fix-Strategie                       |
| Destruktive Migration ohne Restore-Nachweis                                | verboten laut `CLAUDE.md`; nur expand/verify/contract                                    |

**Globaler Rollback:** Jede Aufgabe liegt in eigenem Branch/PR. Solange kein produktiver
Datenbestand existiert, ist der Rückbau ein Revert des Merge-Commits; nach Schemaeinführung
gelten expand/verify/contract-Migrationen (ADR-001, Abschnitt „Rollback").
