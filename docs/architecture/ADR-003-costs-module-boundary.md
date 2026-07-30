# ADR-003: Kostenmodul als elfte Modulgrenze im Split-Monolithen

- **Status:** Accepted
- **Datum:** 2026-07-30
- **Jira:** EYT-105 (Sprint 5, Baseline S5-REQ-01, PRD `docs/prd/sprint-5-daily-cost-export.prd.md` REQ-001)
- **Entscheidungseigner:** Product/Engineering Owner
- **Betroffene Artefakte:** `apps/api/src/modules/costs/`, `apps/api/src/modules/module-catalogue.ts`,
  `supabase/migrations/` (künftig), `packages/contracts/` (künftig)
- **Verhältnis zu ADR-001:** **erweiternd.** ADR-001 bleibt der bindende
  Architekturvertrag. ADR-003 fügt seiner Modulliste (ADR-001 Z. 60) genau einen
  Eintrag hinzu — `costs` — und ändert sonst nichts an ihr. Alle Regeln aus
  ADR-001 Z. 72–78 und Z. 80–89 gelten für `costs` unverändert weiter.
- **Verhältnis zu ADR-002:** unberührt. Identität, Repository und Paketbenennung bleiben.

## Kontext

Sprint 5 liefert Tageskosten und einen XLSX-Export. Damit entsteht zum ersten Mal
Fachlogik, die **fremde** Fakten (veröffentlichte Planzuweisungen) liest, eigene
unveränderliche Stände persistiert und eine Datei erzeugt. Genau diese Kombination
ist die typische Stelle, an der ein modularer Monolith seine Grenzen verliert:
Kostenrechnung greift „nur kurz" direkt auf `public.assignments` zu, bekommt eine
eigene kleine Money-Klasse, und ein `services/`-Ordner sammelt ein, was nirgends
hinpasst.

Der Bestand am 30.07.2026 (gemessen): `apps/api/src/modules/` führt `planning/`,
`worksites/`, `workforce/` und `module-catalogue.ts`. `MODULE_SLUGS` bezeichnet
sich selbst als aus ADR-001 Z. 60 abgeleitet und als eingefroren. `@easytree/domain`
trägt seit EYT-95 den zentralen Geld-, Mengen-, Satz- und Rundungsvertrag
(`Money`, `PlanCostAmount`, `DurationMilliseconds`, `HourlyRateVersion`,
`COST_RULE_VERSION`, `ROUNDING_MODE`, `ROUNDING_STAGE`).

Eine Ergänzung der Modulliste ist deshalb keine Kleinigkeit, sondern eine Änderung
am bindenden Vertrag — EYT-105 AC 1 verlangt dafür wörtlich „**Eine neue ADR**".
Das ist dieses Dokument.

## Entscheidende Kräfte

1. Kosten sind Geld: eine zweite Rundungsregel erzeugt Beträge, die niemand mehr erklären kann.
2. Planung bleibt führende Faktenquelle; Kosten sind eine Ableitung, kein Zweitschema.
3. Kostendaten sind mandanten- und personenbezogen (Entgeltdaten).
4. Der Export muss austauschbar sein, ohne die Berechnung anzufassen.
5. Modulgrenzen, die nur im Review existieren, halten nicht — sie brauchen eine Messung.
6. Kein verteilter Dienst, kein Plugin-Framework, keine zweite technische Wahrheit.

## Verworfene Optionen

### A. Kosten als Teil des Planungsmoduls

**Vorteile:** kein neuer Slug, direkter Zugriff auf Planzeilen, kürzester Weg.
**Nachteile:** Planung schriebe Kostentabellen und umgekehrt; die Trennung „führende
Fakten" gegen „abgeleitete Stände" verschwände. Entgeltdaten lägen im selben Modul
wie die Wochenplanung, was die spätere Rechteschneidung (`costs.read` vs.
`planning.read`, REQ-002) zu einer reinen Controllerkonvention machte. Verworfen.

### B. Eigener Kostendienst (separates Deployment)

**Vorteile:** harte Isolation, unabhängige Skalierung.
**Nachteile:** Snapshot, Audit und Idempotenz müssten über eine Dienstgrenze hinweg
atomar werden — verteilte Transaktionen ohne jede Lastevidenz. ADR-001 verwirft
Microservices für diesen Scope aus denselben Gründen; nichts hat sich seither
geändert. Verworfen.

### C. Generischer `costs/services/`-Container im bestehenden Monolithen

**Vorteile:** schnell, keine Schichtdiskussion.
**Nachteile:** genau das Muster, das ADR-001 Z. 77 für Pakete verbietet — nur eine
Ebene tiefer. Ein Sammelordner hat keine Importrichtung und ist damit keine Grenze.
Verworfen; die Regel `costs-no-generic-container` macht ihn rot, und zwar für
`shared`, `services`, `common`, `utils`, `core`, `lib` und Geschwister, nicht nur für
die zwei im Ticket genannten Namen.

## Entscheidung

### 1. `costs` wird elftes Fachmodul — die Liste aus ADR-001 Z. 60 wird erweitert

`MODULE_SLUGS` führt zusätzlich `costs`. Die Herkunftsangabe im Katalog nennt ab
sofort **beide** Quellen: zehn Slugs aus ADR-001 Z. 60, einer aus diesem Dokument.
Ohne diese Klarstellung stünde im Katalog eine falsche Behauptung — ADR-001 Z. 60
kennt kein Kostenmodul.

`SCAFFOLDED_MODULES` führt `costs` ebenfalls. Das ist eine Zusage, keine Dekoration:
der Architekturtest verlangt daraufhin echte Dateien in `domain/` und `application/`,
und `costs-module-boundaries.test.ts` zusätzlich in `infrastructure/` und
`interface/http/` sowie eine nicht leere, sternfreie `index.ts`.

Verzeichnisaufbau, unverändert nach ADR-001 Z. 64–69:

```text
apps/api/src/modules/costs/
  domain/          reine Regeln und Value Objects, framework-frei
  application/     Use Cases, Commands, Queries und Ports
  infrastructure/  Repositories und externe Adapter
  interface/http/  Controller, DTO und Mapping
  index.ts         explizite öffentliche Modul-API, nur benannte Re-Exporte
```

Ein fünftes Verzeichnis auf Modulebene ist nicht zulässig.

### 2. Ownership

| Tabelle                      | Besitzer | Mandantengebunden | Schema kommt aus |
| ---------------------------- | -------- | ----------------- | ---------------- |
| `public.cost_rate_versions`  | `costs`  | ja (`org_id`)     | EYT-108          |
| `public.cost_snapshots`      | `costs`  | ja (`org_id`)     | EYT-109          |
| `public.cost_snapshot_items` | `costs`  | ja (`org_id`)     | EYT-109          |

Diese drei Namen sind mit dieser ADR entschieden und in `TABLE_OWNERSHIP`
registriert, **bevor** ihre Migration existiert — EYT-105 AC 1 verlangt die
Registrierung, EYT-108/EYT-109 liefern das Schema. Ein abweichender Name in der
Migration ist eine Änderung an dieser ADR, nicht ein Implementierungsdetail.

Was daraus **nicht** folgt: `costs` besitzt keine Planungstabelle und schreibt
keine. Umgekehrt besitzt kein anderes Modul eine `cost_*`-Tabelle.

**Ehrliche Reichweite des Besitzes.** Zur Laufzeit gibt es genau eine
Anwendungsrolle (`authenticated`), und RLS filtert nach Mandant, nicht nach Modul.
Tabellenbesitz ist damit heute **Registereintrag plus statischer Quelltextwächter**,
keine durchgesetzte Invariante. ADR-001 Z. 78 („Dependency- und
Tabellenbesitzregeln werden in CI geprüft") gilt weiterhin nur für die
Dependency-Hälfte; die Tabellenbesitz-Hälfte bleibt offen und darf nicht als
erfüllt gemeldet werden. Eine echte Durchsetzung bräuchte je Modul eine eigene
Datenbankrolle mit eigenen Grants.

### 3. Öffentliche Application-APIs

**Eingehend — was `costs` von anderen Modulen bezieht.** Veröffentlichte Planfakten
erreichen das Kostenmodul ausschließlich über die öffentliche
Planning-Application-API (`apps/api/src/modules/planning/index.ts`, Symbole aus
`./application/*`) und werden dort **nur gelesen**. Direktes SQL auf
Planungstabellen ist verboten — lesend wie schreibend. Die Anwendungsschicht des
Kostenmoduls kennt dafür ihren eigenen Port `PlanCostFactsPort`; die Kenntnis, dass
die Fakten heute aus der Planung stammen, liegt im Adapter in `infrastructure/`.

**Ausgehend — was `costs` anbietet.** Ausschließlich die benannten Exporte aus
`apps/api/src/modules/costs/index.ts`. Heute:

| Export                                                      | Schicht          | Zweck                                     |
| ----------------------------------------------------------- | ---------------- | ----------------------------------------- |
| `PlannedWorkFact`, `PublishedPlanFacts`                     | `domain`         | Einlassvokabular für Planfakten           |
| `PlanCostFactsPort`, `PlanCostFactsResult`, `…Problem`      | `application`    | Leseport für veröffentlichte Planfakten   |
| `PLAN_COST_FACTS`, `PLAN_COST_FACTS_PROBLEMS`               | `application`    | DI-Token, eingefrorene Ablehnungsgründe   |
| `CostExportPort`, `CostExportRendering`, `COST_EXPORT_PORT` | `application`    | Exportnaht, hinter der der Renderer hängt |
| `PlanningFactsAdapter`                                      | `infrastructure` | Adapter auf die Planning-Application-API  |
| `COSTS_ERROR_TYPE`, `CostsErrorType`                        | `interface/http` | stabile Fehlercodes der HTTP-Naht         |

Kein `export *`. Wer die Liste erweitert, erweitert damit die Modulgrenze und trifft
eine Entscheidung, die im Diff sichtbar ist.

### 4. Geld, Mengen und Rundung kommen ausschließlich aus `@easytree/domain`

Das Kostenmodul führt **keine** eigene Money-, Rate- oder Rundungsimplementierung.
Der Vertrag steht vollständig in `@easytree/domain` (EYT-95): Beträge in
EUR-Minor-Units als `bigint`, exakte Mengen, gerundet wird genau einmal beim
Erzeugen der persistenten Kostenposition (`ROUNDING_STAGE`), Summen entstehen nur
durch Addition bereits gerundeter Positionsbeträge.

Ein zweiter Anlauf im Kostenmodul ist keine Stilfrage, sondern erzeugt zwei
Ableitungspfade für denselben Betrag. Die Regel `costs-single-money-implementation`
lehnt Exporte mit Geld- und Rundungsvokabular unterhalb von `costs/` ab.

### 5. `CostsGateway` als Vertragsgrenze zum Browser

Der Browser spricht **nie** direkt mit Supabase und **nie** mit bare `fetch`. Kosten
erreichen die Oberfläche ausschließlich über einen `CostsGateway` — dasselbe Muster
wie `PlanningGateway`:

- Ort: `packages/contracts` (transport-only, kein `@easytree/domain`-Import — dessen
  `Money.minorUnits` ist `bigint` und `TimeInterval` eine Klasse mit privaten Feldern;
  beides kann nicht über die Leitung, die Abbildung gehört an die HTTP-Naht).
- Rückgabetyp: `GatewayResult<T>` — Fehler-, Leer- und Stale-Version-Zustände stehen
  im Rückgabewert, nicht in Ausnahmen. Kein `loading`-Zustand.
- Eingaben und Ausgaben gegen zentrale Zod-Schemata, Laufzeitvalidierung auf beiden
  Seiten; der Server prüft seine **eigene** Ausgabe.
- Jede Operation steht in `packages/contracts/openapi/v1.json`; das Drift-Gate
  (`openapi-drift.test.ts`, Byte-Vergleich) und die Routenkonformität
  (`openapi-route-conformance.test.ts`) gelten unverändert.

**Nicht Teil dieser ADR sind die Operationen des Gateways.** Sie hängen an
Satzpflege (EYT-108), Snapshot (EYT-109) und Export (EYT-110) und werden dort mit
Schema, OpenAPI-Eintrag und Route zusammen entschieden. Eine Operation vorwegzunehmen
hieße, den Vertrag zu raten; ein Vertragseintrag ohne Route macht außerdem
`openapi-route-conformance.test.ts` zu Recht rot.

### 6. Der Exportadapter hängt hinter einem Application-Port

`CostExportPort` ist Teil der Modulgrenze und steht deshalb heute. Der XLSX-Adapter
gehört zu EYT-110 und existiert bewusst **nicht** — auch nicht als Rumpf. Er wird,
wenn er kommt, ausschließlich unter `costs/infrastructure/` liegen, an diesem Port
hängen und einen **gespeicherten** Snapshot rendern, ohne einen einzigen Betrag neu
zu rechnen. Ein Import aus `costs/domain/` in den Renderer ist damit ein Verstoß und
wird als solcher gemeldet.

Heute liegt keine XLSX-Bibliothek im Monorepo. Die erste ist eine bewusste
Entscheidung mit Supply-Chain-Prüfung, kein Nebeneffekt eines Imports.

### 7. Stand des Moduls: Grenze, noch kein laufendes Feature

`costs` ist **nicht** in `AppModule` verdrahtet, hat **keine** Route und **keine**
Migration. Das ist der vollständige und ehrliche Umfang von EYT-105. Autorisierung
(EYT-106), veröffentlichte Planquelle (EYT-107), Sätze (EYT-108), Snapshot und Route
(EYT-109) und Export (EYT-110) sind eigene Tickets mit eigenen Nachweisen. Eine
Verdrahtung ohne Rechteprüfung wäre eine Zusage, die kein Test einlöst.

## Validierung

Nicht Prosa, sondern benannte Prüfungen im Pflichtjob `unit-tests` (`pnpm test`):

| Zusicherung                                                     | Prüfung                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `costs` in Slug-, Rüst- und Besitzregister; ADR vorhanden       | `apps/api/test/architecture.test.ts`, Block „Kostenmodul im Katalog"          |
| vier gefüllte Schichten, HTTP-Naht, schmale `index.ts`, ≥1 Port | `apps/api/test/costs-module-boundaries.test.ts`                               |
| Domain frei von NestJS/HTTP/PostgreSQL/Supabase/XLSX            | Regel `costs-domain-purity`                                                   |
| keine tiefen Querimporte in beide Richtungen                    | Regel `costs-cross-module-public-api-only`                                    |
| Planfakten nur aus der Planning-**Application**-Schicht         | Regel `costs-planning-facts-via-application-port`                             |
| kein fremder Tabellenzugriff, lesend **und** schreibend         | Regel `costs-touches-only-own-tables`                                         |
| kein generischer Sammelcontainer                                | Regel `costs-no-generic-container`                                            |
| keine zweite Geld-/Rundungsimplementierung                      | Regel `costs-single-money-implementation`                                     |
| XLSX nur in `infrastructure/`, an einem Port, ohne Neurechnung  | Regel `costs-xlsx-behind-application-port`                                    |
| jede dieser Regeln wird auch wirklich rot                       | `apps/api/test/costs-module-boundaries.red-case.test.ts` (synthetischer Baum) |

Die Regeln sind **statische Quelltextwächter**. Sie beweisen Importrichtungen,
Verzeichnisnamen, Exportnamen und SQL-Zugriffsziele im Quelltext — sie ersetzen
weder RLS noch serverseitige Autorisierung und sind kein Nachweis durchgesetzter
Datenbankrechte.

## Konsequenzen

### Positiv

- Kostenlogik ist von Anfang an eingegrenzt statt nachträglich herausgelöst.
- Der Geldvertrag hat genau eine Implementierung, und eine zweite fällt in CI auf.
- Planung bleibt führende Faktenquelle; die Abhängigkeitsrichtung ist einseitig und geprüft.
- Der Exportadapter ist austauschbar, ohne die Berechnung zu berühren.
- Entgeltdaten liegen in eigenen, mandantengebundenen Tabellen mit eigenem Rechtekreis.

### Negativ

- Elf statt zehn Slugs; die „eingefrorene" Liste ist einmal aufgetaut worden, und
  jede weitere Erweiterung braucht denselben Aufwand.
- Der Adapter kostet eine zusätzliche Abbildung gegenüber direktem SQL.
- Das Register führt drei Tabellen ohne Migration; die Lücke ist benannt, bleibt aber
  bis EYT-108/EYT-109 bestehen.
- Das Modul ist bis EYT-109 nicht verdrahtet: Code ohne laufenden Pfad, der bei einer
  Kursänderung der Folgetickets angepasst werden muss.

## Revisions- und Extraktionsbedingungen

Diese Entscheidung wird erneut geprüft, wenn eine der folgenden Bedingungen eintritt.
Keine davon ist heute erfüllt; jede ist beobachtbar formuliert, damit „wir prüfen
das mal wieder" nicht die einzige Auslösebedingung bleibt.

1. **Eigene Ownership oder Releasekadenz.** Kostenrechnung bekommt ein eigenes Team,
   eine eigene Freigabe oder ein eigenes SLO (identisch zu ADR-001 Z. 114).
2. **Abweichende Last.** Snapshot- oder Exportläufe verdrängen den interaktiven
   Planungspfad messbar — nicht: sie sind gefühlt langsam.
3. **Eigene Sicherheits- oder Residenzgrenze.** Ein Mandant verlangt vertraglich, dass
   Entgeltdaten getrennt gespeichert oder verarbeitet werden.
4. **Zweiter Konsument.** Ein Lohn-, Fakturierungs- oder Fremdsystem braucht dieselben
   Kostenstände über eine stabile Grenze hinweg — dann wird aus dem Modul ein Vertrag
   mit eigener Versionierung.
5. **Die Grenze hält nicht.** Wenn wiederholt Umgehungen nötig sind (direkte
   Planungsselects, Ausnahmen von den Regeln oben), ist entweder der Schnitt falsch
   oder die Fachlichkeit gehört zusammen. Beides ist eine Entscheidung, kein Workaround.

Für eine Extraktion gilt zusätzlich: der Schnitt ist erst dann sauber, wenn `costs`
ausschließlich über `PlanCostFactsPort` liest und keine Transaktionsklammer mehr mit
Planungstabellen teilt. Solange Snapshot und Publish atomar zusammen committen
müssten, ist eine Extraktion eine verteilte Transaktion und damit verworfen.

## Migration und Rollback

- **Schema.** Vorwärts über neue Dateien in `supabase/migrations/`, Reihenfolge
  `<timestamp>_NNNN_<slug>.sql`. Gemergte Migrationen sind append-only. Die
  `cost_*`-Tabellen brauchen `org_id NOT NULL`, tenant-sichere Composite-FKs auf
  `employees`, `worksites` und `plan_versions`, RLS-Policies über
  `app.user_org_ids()`, und Grants nur für `authenticated`. Snapshot und Positionen
  erhalten **kein** `update`- und **kein** `delete`-Grant: Unveränderlichkeit ist ein
  Recht, keine Konvention — dasselbe Muster wie `audit_events` (Migration 0008).
  Jede neue Tabelle wird zusätzlich im Katalog-Meta-Gate
  (`supabase/tests/0005_schema_meta_gate.sql`) eingetragen, sonst meldet es sie als
  unbekannte `public`-Tabelle.
- **Rollback des Codes.** Bis zur ersten Migration ist der Rückweg vollständig: Modul,
  Katalogeinträge und diese ADR zurücknehmen, dann ist der Zustand vor EYT-105
  wiederhergestellt. Kein Datenbestand ist betroffen.
- **Rollback nach Schemaeinführung.** Nur expand/verify/contract, nie destruktiv ohne
  genehmigten Rollback und Restore-Nachweis (ADR-001, `CLAUDE.md`). Ein Snapshot ist
  ein historischer Beleg; ihn zu löschen macht bereits ausgegebene Zahlen unerklärbar.
