# EYT-109 — Täglicher Plan-Personalkosten-Snapshot (Implementierungsplan)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eine Person mit `costs.calculate` erzeugt aus einer **veröffentlichten** Planversion
einen in PostgreSQL **persistierten, unveränderlichen** Kosten-Snapshot; `/kosten` liest
ausschließlich diesen gespeicherten Stand, und eine spätere Stundensatzversion verändert ihn nicht.

**Architecture:** Kleinste Erweiterung des bestehenden Split-Monolithen. Zwei neue Tabellen
(`public.cost_snapshots`, `public.cost_snapshot_positions`) mit Kanalgrenze nach dem Muster von
Migration 0015/0017. Ein synchroner Application-Command im vorhandenen Modul
`apps/api/src/modules/costs/`, der Planfakten **nur** über die öffentliche Planning-Application-API
liest, Geld ausschließlich über `@easytree/domain` (EYT-95) rechnet und Header plus Positionen in
**einer** Transaktion schreibt. Keine Queue, kein Worker, kein Cache, keine materialisierte View,
kein XLSX.

**Tech Stack:** TypeScript (NodeNext, strict + `noUncheckedIndexedAccess` +
`exactOptionalPropertyTypes`), NestJS (SWC), Next.js 16 App Router, Zod → generiertes
`openapi/v1.json`, PostgreSQL 17 / Supabase mit RLS + pgTAP, Vitest, fast-check (fester Seed),
Playwright.

---

## 0. Live-Bootstrap — gemessen am 08.08.2026

Alles hier ist **gemessen**, nicht angenommen. Wer den Plan später ausführt, misst neu; weicht der
Stand ab, gewinnt der Remote-Stand.

| Gegenstand | Messwert |
| --- | --- |
| `git rev-parse origin/master` | `b44e38c6bf7e08a2996c2263309001a1304050f2` |
| Kopf-Commit | `Merge PR #56: EYT-136 planning Data API boundary` |
| Lokaler Branch beim Messen | `fix/eyt-136-planning-data-api-boundary` (nicht Basis für diese Arbeit) |
| Letzte Migration | `20260807220000_0017_planning_write_channel_boundary.sql` |
| Letzter pgTAP-Test | `supabase/tests/0012_planning_data_api_boundary.sql` |
| CI-Jobs | `format, lint, typecheck, unit-tests, build-web, web-smoke, build-api, secret-scan, db-gates, read-through, auth-journey` |

**Jira (gemessen, `issues`-Modus, nicht `count`):**

| Key | Status | Priorität | Typ |
| --- | --- | --- | --- |
| EYT-109 | Zu erledigen | Highest | Story |
| EYT-110 | Zu erledigen | High | Story |
| EYT-130 | Zu erledigen | Medium | Task |
| EYT-80 | Zu erledigen | Highest | Task |
| EYT-136 / 135 / 108 / 107 / 106 / 105 / 95 | Fertig | — | — |

**Confluence gelesen:** `8552449` (Sprint 5) und `8814623` (Basisdesign v2.0) vollständig.
`5505026`, `7766017` (PRD v1.4) und `9306113` **nicht** in diesem Durchlauf gelesen — die
verbindlichen Sätze daraus stehen in der Jira-Beschreibung von EYT-109 und in Sprint-5 §6
(S5-REQ-05/06) und wurden von dort übernommen. Wer den Plan ausführt, liest sie vor Task 1
nach und meldet Abweichungen als `SOURCE_NEEDED`.

**Verbindlich aus Confluence, für diesen Slice relevant:**

- Sprint 5 §6 S5-REQ-05: Eingabe ist eine veröffentlichte Planversion plus optionaler
  Baustellenfilter; Verteilung auf lokale Kalendertage nach Organisationszeitzone; über
  Mitternacht laufende Einsätze werden **deterministisch geteilt**; Snapshot und Positionen sind
  nach Erstellung unveränderlich.
- Basisdesign §3.1: `/kosten` erscheint in der Navigation **nur** bei `costs.read`; kein Betrag,
  kein Satz, kein Kostenindikator ohne dieses Recht.
- Basisdesign §4: Kosten brauchen zusätzlich die Zustände *Satz fehlt*, *Satz mehrdeutig*,
  *Snapshot wird erstellt*, *Snapshot unveränderlich verfügbar*.
- Basisdesign §5: sichtbar unter `/kosten` müssen sein — Snapshot-ID, Planversion, erzeugt am,
  Regelversion, Währung, autorisierter Benutzer.
- Basisdesign §5 nennt als primäre Aktion „Diesen Kostenstand als Excel exportieren“. **Das ist
  EYT-110 und in diesem Slice ausdrücklich nicht enthalten** — dokumentierte Abweichung, kein
  Versehen.

---

## 1. Repository-Map — was schon da ist

Das Kostenmodul ist keine grüne Wiese. Vor jeder Zeile Code gilt: **weiterverwenden, nicht
nachbauen.**

### Vorhanden und produktiv verdrahtet

| Baustein | Datei | Rolle für EYT-109 |
| --- | --- | --- |
| `CostsController` (`/kosten/mitarbeiter`, `/kosten/stundensaetze*`) | `apps/api/src/modules/costs/interface/http/costs.controller.ts` | Die **Zugangskette** (`zugang()`) wird für beide neuen Routen wiederverwendet — Identität → Mitgliedschaften → Policy → Protokoll → Arbeit. Nicht kopieren, erweitern. |
| `MembershipCostAccessPolicy` | `.../application/cost-access.policy.ts` | Kennt bereits `costs.read` **und** `costs.calculate` als atomare Rechte. |
| `NestCostAccessAuditLog` + `COST_ACCESS_DECISION_EVENT` | `.../infrastructure/cost-access-audit.logger.ts` | EYT-135. **Keine zweite Audit-Lösung.** |
| `PgRateRepository` | `.../infrastructure/rate-repository.pg.ts` | Vorlage für das Snapshot-Repository: `TenantQuery`, Advisory-Lock über `IdempotencyStore`, Replay-Erkennung per Fingerabdruck, `bigint` als String. |
| `effectiveRateVersion` / `rateVersionStatus` | `.../domain/rate-effectivity.ts` | Satzauswahl **halboffen** `[validFrom, validTo)` — identisch mit dem EXCLUDE-Constraint in 0013. |
| `IdempotencyStore` / `PgIdempotencyStore` | `apps/api/src/platform/idempotency/` | Vorhandene Idempotenzinfrastruktur, Tabelle `public.idempotency_records` (0012). |
| `TenantQueryRunner` | `apps/api/src/platform/database/tenant-query-runner.ts` | Einzige Stelle mit `pg`. Setzt JWT-Claims + `set local role authenticated`. |
| `KostenZugang` | `apps/web/components/kosten-zugang.tsx` | Rendert Loading / Fehler / Unauthenticated / Organisationswahl / Forbidden. Wiederverwenden. |
| `HttpCostsGateway` | `packages/contracts/src/http/costs-gateway.ts` | Wächst um zwei Methoden. |
| `minorUnitsToEuro` | `apps/web/lib/euro-minor-units.ts` | Anzeigeformat, kein `parseFloat`. |

### Vorhanden, aber **ohne Verbraucher** (Grenze, kein Feature)

| Baustein | Datei | Was EYT-109 damit tut |
| --- | --- | --- |
| `PlanCostFactsPort.publishedFacts(weekKey)` | `.../application/plan-cost-facts.port.ts` | **Erweitern** um eine Lesung nach Planversions-ID. Die Wochenmethode bleibt stehen (öffentliche API, Entfernen wäre eine eigene Entscheidung) — als Finding notieren. |
| `PlanningFactsAdapter` | `.../infrastructure/planning-facts.adapter.ts` | Bekommt die neue Methode und wird **erstmals** in `AppModule` verdrahtet. |
| `CostExportPort` (`render(snapshotId)`) | `.../application/cost-export.port.ts` | **Nicht anfassen.** EYT-110 hängt daran; der Snapshot muss allein über seine ID renderbar sein. |
| `PlannedWorkFact` / `PublishedPlanFacts` | `.../domain/planned-work-fact.ts` | Einlassvokabular; wächst um Ressourcenlabels. |

### Domänenprimitive aus EYT-95 (`packages/domain`) — Pflichtbausteine

| Export | Datei | Vertrag |
| --- | --- | --- |
| `costOfDuration(rate, quantity)` | `cost-position.ts` | Die **einzige** Rundung: `roundHalfUp(satz × ms, 3_600_000)`, alles in `bigint`. |
| `COST_RULE_VERSION` = `"personnel-plan-cost-v1"` | `cost-position.ts` | Regelversion jeder Position. |
| `hourlyRateVersion(input)` / `HourlyRateVersion` | `rate-version.ts` | Geprüfte, gebrandete Satzversion. `validTo` **einschließend**. |
| `selectRateVersion(versions, on)` | `rate-version.ts` | Auswahl, `validTo` **einschließend** — siehe Entscheidung D1. |
| `durationMilliseconds(bigint)` / `toDurationMilliseconds(number)` | `duration-milliseconds.ts` | Geprüfte nichtnegative Menge. |
| `localBusinessDate(instant, zone)` | `planning-week.ts` | Kalendertag eines Instants in einer IANA-Zone (`Intl.formatToParts`). |
| `utcInstantOfLocalWallTime(wall, zone)` | `planning-week.ts` | Gegenrichtung; meldet `NONEXISTENT_LOCAL_TIME` / `AMBIGUOUS_LOCAL_TIME` statt zu raten. |
| `compareLocalBusinessDate` / `dayAfter` | `local-business-date.ts` | Reine Kalenderarithmetik, kein `Date`. |
| `createTimeZone(id)` | `planning-week.ts` | Prüft die Zonenkennung gegen `Intl`. |

### Geplant / nicht vorhanden

`cost_snapshots`, `cost_snapshot_positions`, Tagesallokation über Mitternacht, `dayBefore`,
Snapshot-Repository, Snapshot-Use-Case, Snapshot-Contract, `/kosten`-Ansicht (heute nur ein
ehrlicher Leerzustand in `apps/web/app/kosten/page.tsx`).

---

## 2. Entscheidungen und Annahmen

Diese acht Punkte sind der Grund, warum der Plan so aussieht. Wer sie ändert, ändert den Plan.

### D1 — Zwei Intervallsemantiken existieren bereits. Die Datenbank gewinnt.

**Gemessener Befund.** Es gibt im Repository zwei Satzauswahlen mit **unterschiedlicher**
Intervallsemantik:

- `packages/domain/src/rate-version.ts::selectRateVersion` — `validTo` **einschließend**
  (`exclusiveEnd = dayAfter(validTo)`, Dateikopf V3).
- `apps/api/src/modules/costs/domain/rate-effectivity.ts::effectiveRateVersion` — `validTo`
  **ausschließend** (`businessDate < version.validTo`), ausdrücklich „derselbe Vertrag wie der
  EXCLUDE-Constraint in Migration 0013“.

Migration 0013 ist eindeutig: `exclude using gist (… daterange(valid_from, valid_to, '[)') with &&)`
plus `check (valid_to is null or valid_to > valid_from)`. Die Datenbank lässt also
`valid_to = 2026-07-01` neben einem Nachfolger mit `valid_from = 2026-07-01` **zu**. Genau diese
Konstellation legt `selectRateVersion` als `RATE_AMBIGUOUS` aus — an jedem Satzwechsel, an jedem
Nahtstellentag.

**Entscheidung.** Der Snapshot wählt mit `effectiveRateVersion` (Modulregel, DB-treu) und rechnet
mit `costOfDuration` (zentrale Geldregel, EYT-95). `computeCostPosition` wird **nicht** verwendet,
weil es die einschließende Auswahl fest eingebaut hat.

Damit `costOfDuration` eine geprüfte `HourlyRateVersion` bekommt, wird die aus der Datenbank
gelesene, **halboffene** Gültigkeit einmal in die einschließende Form der Domäne übersetzt:
`validTo_inklusiv = dayBefore(valid_to)`, `null` bleibt `null`. Dafür kommt `dayBefore` neu nach
`packages/domain/src/local-business-date.ts` (Task 3). Der DB-Check `valid_to > valid_from`
schließt den entarteten Fall aus, es gibt also kein leeres Intervall.

**Keine stille Vereinheitlichung.** Ein Test friert die Divergenz ein (Task 5, Schritt 5), damit
niemand später „aufräumt“ und dabei einen Nahtstellentag verliert. Die Vereinheitlichung ist ein
eigenes Ticket — `DOC_DRIFT` im Abschlusspaket.

### D2 — Tagesallokation ist eine neue Domänenfunktion, und sie darf blockieren

Neu: `packages/domain/src/local-day-allocation.ts` mit

```ts
allocateAcrossLocalDays(interval: TimeInterval, timeZone: IanaTimeZone): LocalDayAllocationResult
```

Rückgabe im Erfolgsfall eine nach Datum aufsteigende Liste
`{ date: LocalBusinessDate; quantity: DurationMilliseconds }`. Tragende Eigenschaft: **Die Summe
aller Anteile ist exakt `durationMs(interval)`** — nicht ungefähr, nicht gerundet.

Die Tagesgrenzen entstehen über `utcInstantOfLocalWallTime({ date, hour: 0, minute: 0 }, zone)`.
Das ist der Grund, warum die Funktion blockieren können muss: in manchen Zonen springt die Uhr
**um Mitternacht**, dann existiert die lokale Mitternacht nicht oder zweimal. Statt zu raten
liefert die Funktion `DAY_BOUNDARY_NONEXISTENT` bzw. `DAY_BOUNDARY_AMBIGUOUS`, und der Command
bricht ab. Für `Europe/Berlin` tritt der Fall nicht auf (Umstellung um 02:00), er ist aber real
und darf nicht stillschweigend falsch werden.

> **Messen, nicht annehmen:** In Task 4 wird zuerst eine Zone **gemessen**, in der die lokale
> Mitternacht wirklich verschwindet (Kandidat: `America/Santiago`, Umstellung um 24:00). Wenn die
> Laufzeit-Zonendatenbank das nicht hergibt, wird der Testfall als `SOURCE_NEEDED` gemeldet und
> der Fehlerzweig bleibt ungetestet-aber-vorhanden — **nicht** entfernt und **nicht** als geprüft
> behauptet.

### D3 — Identität des Kommandos: vorhandener Idempotenzschlüssel, kein „ein Snapshot je Planversion“

Wiederverwendet wird `IDEMPOTENCY_HEADER` + `public.idempotency_records` (0012), Vorgangsname
`costs.create_cost_snapshot`, Fingerabdruck über `(publishedPlanVersionId, worksiteId ?? "")`.
Ein Retry mit demselben Schlüssel liefert **denselben** Snapshot zurück; derselbe Schlüssel mit
anderer Nutzlast ergibt `IDEMPOTENCY_KEY_REUSED` (409).

**ASSUMPTION:** Es gibt **keine** Eindeutigkeit „eine Planversion → höchstens ein Snapshot“. Weder
Jira noch Confluence entscheiden das. Die kleinste umkehrbare Variante ist, mehrere Snapshots
zuzulassen: eine erneute Veröffentlichung erzeugt ohnehin eine neue Planversion, und ein zweiter
Snapshot nach einer Satzkorrektur ist fachlich sinnvoll, während der alte lesbar bleibt. Eine
Eindeutigkeit lässt sich später per Constraint nachziehen; sie nachträglich zu **entfernen**, nachdem
Nutzer damit gearbeitet haben, ist teurer.

### D4 — Planning bekommt zwei Leseoperationen, Costs schreibt nichts in Planning

Der vorhandene `PlanningQueries.planningWindow(weekKey)` genügt nicht: er liefert bei einem Entwurf
über einer veröffentlichten Version den **Entwurf** als `sourceVersion` und wäre für Kosten
unbrauchbar. Deshalb wächst der Leseport der Planung um genau zwei Methoden:

```ts
publishedVersions(fromWeekKey: string, toWeekKey: string): Promise<PublishedVersionsResult>
publishedAssignments(planVersionId: string): Promise<PublishedAssignmentsResult>
```

`publishedAssignments` liefert in **einer** Transaktion: Planversion, `weekKey`, `timeZone`,
die Zuweisungen der Version und die Ressourcenlabels (Beschäftigte, Baustellen). Ablehnungen:
`PLAN_VERSION_NOT_FOUND` (auch für fremde Mandanten — RLS filtert, kein Existenzleck) und
`PLAN_NOT_PUBLISHED`.

Das Kostenmodul liest ausschließlich über `PlanCostFactsPort` → `PlanningFactsAdapter` →
`PlanningQueries`. Kein SQL auf `public.assignments` im Kostenmodul — die Architekturregel
`costs-touches-only-own-tables` prüft das lesend **und** schreibend.

### D5 — Zwei neue Tabellen, Unveränderlichkeit durch fehlende Rechte

`public.cost_snapshots` und `public.cost_snapshot_positions`, Migration `0018`. Struktur der
Zusicherung, nach dem Muster 0013 + 0015/0017:

- `enable row level security` **und** `force row level security`;
- `revoke all` von `anon` und `authenticated`;
- `grant select` (Policy: gleiche Organisation **und** `costs.read`);
- `grant insert (<explizite Spaltenliste>)` (Policy: `app.is_runtime_channel()` **und** gleiche
  Organisation **und** `costs.calculate` **und** `created_by = auth.uid()`);
- **kein** `update`-Grant, **kein** `delete`-Grant, für keine der beiden Tabellen.

Unveränderlichkeit ist damit keine Trigger-Regel, sondern **ein fehlendes Recht** — die billigste
und am schwersten zu umgehende Form. Die Bindung Position → Snapshot läuft über den
mandantengebundenen zusammengesetzten FK
`(snapshot_id, org_id) references public.cost_snapshots (id, org_id)`; das hält auch dann, wenn eine
Policy irrt, weil FK-Prüfung und RLS unabhängig sind.

`app.is_runtime_channel()` steht in der Konjunktion **zuerst** — dieselbe Reihenfolge wie in 0015
und 0017.

### D6 — Contract-first, drei Operationen, ein Vertrag

| Operation | Recht | Zweck |
| --- | --- | --- |
| `GET /kosten/planversionen?von=&bis=` | `costs.read` | Auswahlliste veröffentlichter Planversionen im Wochenbereich |
| `POST /kosten/snapshots` | `costs.calculate` | Snapshot erzeugen (Idempotenzschlüssel Pflicht) |
| `GET /kosten/snapshots/{snapshotId}` | `costs.read` | Gespeicherten Snapshot lesen |

Alles in `packages/contracts/src/costs/schemas.ts` + `gateway.ts` + `http/costs-gateway.ts` +
`openapi/document.ts`; `openapi/v1.json` wird **regeneriert**, nie von Hand editiert.

### D7 — Lesen rechnet nicht

`GET /kosten/snapshots/{id}` liest ausschließlich `cost_snapshots` und `cost_snapshot_positions`.
Kein Zugriff auf `employee_rate_versions`, kein Zugriff auf Planfakten, keine Berechnung. Das ist
die Kerninvariante und wird per Gegenmutation GM5 belegt.

### D8 — Positionen tragen Labels, weil ein Snapshot ein historisches Dokument ist

Jede Position speichert neben `employee_id` / `worksite_id` auch `employee_label` und
`worksite_label`, gelesen zum Erzeugungszeitpunkt aus den Ressourcen der Planung. Eine spätere
Umbenennung darf einen exportierten Kostenstand nicht rückwirkend ändern — dieselbe Begründung wie
für die eingefrorene Satzversion. Das ist kein Fremdtabellenzugriff: die Werte kommen über die
öffentliche Planning-API herein und werden **kopiert**.

### Ausdrücklich NICHT in diesem Slice

XLSX, Download-Endpunkt, Spreadsheet-Bibliothek, Export-UI (EYT-110) · vollständiges EYT-130 ·
vollständiges EYT-80 (insbesondere **kein** `DateRangeControl` in `packages/ui` — siehe Task 15) ·
Ist-Kosten, Arbeitszeiten, Tagessätze, Fahrzeuge, Maschinen · Queue, Worker, Cache, materialisierte
View, Rule-Engine · Merge, Jira-Statuswechsel auf *Fertig*.

---

## 3. Stärkste Gegenposition — geprüft, nicht abgenickt

> „Ein persistierter Snapshot ist für ein MVP unnötige Komplexität. Man könnte die Kosten bei jedem
> Seitenaufruf aus der veröffentlichten Planung und den aktuellen Stundensätzen berechnen.“

Das Argument ist ernst: es spart zwei Tabellen, eine Migration, ein Repository und ein Kommando.

Es trägt hier trotzdem nicht, und zwar aus einem einzigen, nicht wegdiskutierbaren Grund:
**Stundensatzversionen sind veränderlich in der Zukunft.** `employee_rate_versions` ist append-only;
sobald jemand eine Version mit `valid_from` in der Vergangenheit oder eine Ablösung anlegt, liefert
dieselbe Planversion einen **anderen** Betrag. Eine Live-Berechnung machte damit aus „die Kosten der
KW 32“ eine Zahl, die vom Abrufzeitpunkt abhängt — und EYT-110 exportierte eine Excel-Datei, die
sich nicht reproduzieren lässt. Sprint 5 §6 S5-REQ-05 sagt das wörtlich („spätere Sätze verändern
ihn nicht“), und `CostExportPort.render(snapshotId)` ist bereits genau darauf zugeschnitten:
er bekommt eine ID, keine Positionen.

Zusätzlich, aber nachrangig: fehlender oder mehrdeutiger Satz muss **blockieren**. Bei einer
Live-Berechnung wäre die Kostenseite eines Tages plötzlich unbenutzbar, weil jemand einen Satz
angelegt hat — ohne dass irgendwer eine Aktion ausgelöst hätte. Als Kommando ist die Blockade ein
Ergebnis einer Handlung und benennbar.

**Falsifikation:** Wäre `employee_rate_versions` unveränderlich *und* rückwirkungsfrei *und*
verlangte EYT-110 keine Reproduzierbarkeit, wäre die Live-Berechnung richtig. Gemessen ist das
Gegenteil (Migration 0013 erlaubt `valid_from` in der Vergangenheit; EYT-108 hat den
Ablösungspfad gebaut). Die Persistenz bleibt.

---

## 4. Failure-Mode-Ketten und wo sie im Plan gebrochen werden

| Kette | Bruchstelle | Task |
| --- | --- | --- |
| **A — falsche Quelle:** Entwurf gelangt in den Snapshot → Management bewertet unverbindliche Planung → EYT-110 exportiert vertrauenswürdig aussehende falsche Zahlen | `publishedAssignments` lehnt jede Version ohne `published_at` ab; Test + GM1 | 7, 19 |
| **B — historische Drift:** Lesen rechnet neu → Satzänderung verändert alten Stand | `GET` liest nur zwei Tabellen; Immutabilitätstest V1→Snapshot→V2; GM5 | 12, 14, 19 |
| **C — Zeitzonenfehler:** UTC-Tag statt Organisationstag → Stunden auf falschem Kalendertag → Tagessummen falsch | `allocateAcrossLocalDays` mit expliziter Zone; Mitternachts- und DST-Tests; GM6 | 4, 19 |
| **D — Autorisierung:** Route oder Data-API offen → Mitarbeitende sehen Wirtschaftsdaten | `costs.read`/`costs.calculate` getrennt in Policy **und** RLS; `is_runtime_channel`; Cross-Tenant-Test; GM2/GM3 | 6, 11, 13, 19 |
| **E — Überengineering:** generisches Berechnungsframework → großer Diff → schwer reviewbar | Ein Use-Case, eine Transaktion, zwei Tabellen. Keine Abstraktion ohne zweiten Verbraucher. | ganzer Plan |

---

## 5. Falsifikationsliste — der Slice ist NICHT fertig, solange eines davon gilt

- [ ] Ein Entwurf kann einen Snapshot erzeugen.
- [ ] Eine fremde Planversion oder fremde Baustelle wird akzeptiert.
- [ ] Eine `orgId` aus Body, URL oder Header wird geglaubt.
- [ ] Ein fehlender Satz wird zu `0,00 €`.
- [ ] Ein mehrdeutiger Satz wird willkürlich gewählt.
- [ ] Irgendwo im Geldpfad steht `number`, `parseFloat` oder `toFixed`.
- [ ] Die Tagesaufteilung ignoriert die IANA-Zone der Organisation.
- [ ] Eine spätere Satzversion verändert einen bestehenden Snapshot.
- [ ] Reload oder ein zweiter Browserkontext zeigen andere IDs oder Summen.
- [ ] Eine Person mit Rolle `member` sieht Beträge, Sätze oder die Route.
- [ ] Ein direkter Data-API-Write kann einen Snapshot erzeugen oder verändern.
- [ ] Die UI benutzt Mock oder LocalStorage als operative Wahrheit.
- [ ] `openapi/v1.json` weicht von den Zod-Schemata ab.
- [ ] Ein Required Check ist rot oder übersprungen.
- [ ] Eine Gegenmutation öffnet eine Kernregel und **kein** benannter Zieltest fällt.

---

# Tasks

Reihenfolge ist bindend: rote Tests vor Verhaltenscode, Migration vor Repository, Contract vor
Controller, UI vor E2E, Gegenmutationen zuletzt.

**Sprache:** Kommentare und Dokumentation auf Deutsch (Hausstil), Bezeichner wie im umgebenden
Code. **Nach jeder Aufgabe committen.** Nur benannte Dateien stagen
(`git add <pfad> …`, danach `git diff --cached --name-only` lesen) — ein verzeichnisweites
`git add` hat in diesem Repo schon zweimal fremde Dateien mitgenommen.

> **Falle, gemessen 08.08.2026 — gilt für jede Task ab hier.** `apps/api` und `apps/web`
> importieren `@easytree/contracts` und `@easytree/domain` **per Paketname**, lesen also `dist/`,
> nicht `src/`. `noEmitOnError` ist im ganzen Monorepo nirgends gesetzt, also erzeugt `tsc` auch
> bei einem Typfehler vollständige Ausgabe und verlässt sich mit Exitcode ≠ 0. Turbo überspringt
> danach die Downstream-Aufgaben, lässt aber ein **benutzbares, veraltetes** `dist` liegen. Wer den
> Test dann einzeln mit `pnpm --filter @easytree/api exec vitest run …` fährt, bekommt grün — und
> misst nichts. Real passiert: ein `dist` von 19:04 gegen eine Quelle von 20:27, ohne einen der
> neuen Namen.
>
> **Deshalb: vor jedem `apps/api`- oder `apps/web`-Testlauf, der neue Contract- oder
> Domain-Exporte benutzt, erst explizit `pnpm --filter @easytree/contracts build` bzw.
> `… @easytree/domain build`.** Im Zweifel `ls -la` auf `dist/<datei>.d.ts` gegen `src/<datei>.ts`
> — ist `dist` älter, ist das Ergebnis wertlos. Besonders scharf in Task 2, 5, 8, 10 und 13.

---

## Task 0: Arbeitsbaum und Branch

**Dateien:** keine.

**Schritt 1: Aktuellen Stand messen**

```bash
cd /Users/benjaminpoersch/EasyTree
git fetch origin --prune
git rev-parse origin/master
git log -3 --oneline origin/master
gh pr list --state open --limit 100
```

Erwartet: `b44e38c…` oder neuer. Ist es neuer, gilt der neue Stand; die Messwerte in Abschnitt 0
dieses Plans sind dann veraltet und werden im Abschlusspaket als solche benannt.

**Schritt 2: Eigenen Worktree anlegen**

Der aktuelle Arbeitsbaum trägt unversionierte Nutzerdateien (`docs/plans/*`, `scripts/ops/`,
eine geänderte Canvas-Datei). Diese Dateien werden **nicht** angefasst, **nicht** gelöscht und
**nicht** committet. Deshalb ein eigener Worktree:

```bash
git worktree add -b feat/eyt-109-daily-plan-cost-snapshot \
  ../EasyTree-eyt109 origin/master
cd ../EasyTree-eyt109
git status --short   # muss leer sein
```

Kein `git reset --hard`, kein `git clean`, kein fremder Stash.

**Schritt 3: Abhängigkeiten installieren und Ausgangslage grün messen**

```bash
pnpm install --frozen-lockfile
pnpm --filter @easytree/config build
pnpm --filter @easytree/contracts build
pnpm --filter @easytree/domain build
pnpm --filter @easytree/ui build
pnpm typecheck && pnpm test
```

Erwartet: grün. Ist es das nicht, **stoppen** — ein roter Ausgangsstand macht jeden späteren roten
Test unlesbar.

**Schritt 4: Jira auf *In Arbeit***

Nur wenn EYT-109 tatsächlich noch `Zu erledigen` ist. Danach Readback (Issue erneut lesen und den
Status zitieren). **Nicht** auf *Fertig*.

**Schritt 5: Repository-Regeln lesen**

`CLAUDE.md`, `docs/handoff/AGENT_HANDOFF_v1.3.md`,
`docs/architecture/ADR-001-boilerplate-architecture.md`, `docs/runbooks/database-workflow.md`,
`docs/runbooks/planning-publish.md`. Widersprüche zu diesem Plan **melden**, nicht still auflösen.

---

## Task 1: Contract — Schemata für Snapshot und Planversionsliste

**Dateien:**
- Ändern: `packages/contracts/src/costs/schemas.ts`
- Ändern: `packages/contracts/src/costs/gateway.ts`
- Ändern: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/costs-snapshot-schemas.test.ts` (neu)

**Schritt 1: Roten Test schreiben**

`packages/contracts/test/costs-snapshot-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  CostSnapshotSchema,
  CreateCostSnapshotCommandSchema,
  PublishedPlanVersionsSchema,
} from "../src/costs/schemas.js";

const UUID = "3f1c9c2a-5b7e-4d21-9f0a-8c6e2b1d4a77";
const UUID2 = "9a2b7c1d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

describe("CreateCostSnapshotCommandSchema", () => {
  it("nimmt eine Planversions-Id ohne Baustellenfilter an", () => {
    const geprueft = CreateCostSnapshotCommandSchema.safeParse({
      publishedPlanVersionId: UUID,
      worksiteId: null,
    });
    expect(geprueft.success).toBe(true);
  });

  it("lehnt eine mitgeschickte Organisations-Id ab — sie ist keine Autoritaetsquelle", () => {
    const geprueft = CreateCostSnapshotCommandSchema.safeParse({
      publishedPlanVersionId: UUID,
      worksiteId: null,
      organisationId: UUID2,
    });
    expect(geprueft.success).toBe(false);
  });
});

describe("CostSnapshotSchema", () => {
  it("laesst keinen Betrag als JSON-Zahl durch", () => {
    const geprueft = CostSnapshotSchema.safeParse({
      id: UUID,
      planVersionId: UUID2,
      worksiteId: null,
      weekKey: "2026-W32",
      timeZone: "Europe/Berlin",
      currency: "EUR",
      ruleVersion: "personnel-plan-cost-v1",
      createdAt: "2026-08-08T10:00:00.000Z",
      createdBy: UUID,
      correlationId: "abc",
      totalMinorUnits: 123456,
      days: [],
      positions: [],
    });
    expect(geprueft.success).toBe(false);
  });
});

describe("PublishedPlanVersionsSchema", () => {
  it("verlangt gueltige ISO-Wochenschluessel", () => {
    expect(
      PublishedPlanVersionsSchema.safeParse({
        versions: [{ id: UUID, weekKey: "2026-W54", publishedAt: "2026-08-01T00:00:00.000Z" }],
      }).success,
    ).toBe(false);
  });
});
```

**Schritt 2: Test laufen lassen, Rot bestätigen**

```bash
pnpm --filter @easytree/contracts exec vitest run test/costs-snapshot-schemas.test.ts
```

Erwartet: FAIL — `CostSnapshotSchema` existiert nicht.

**Schritt 3: Schemata ergänzen**

An `packages/contracts/src/costs/schemas.ts` anhängen. Den vorhandenen Wochenschlüssel aus
`../planning/schemas.js` wiederverwenden (**nicht** neu bauen — EYT-88 hat den
`^\d{4}-W\d{2}$`-Fehler dort bereits einmal gekostet).

> **Korrektur, gemessen 08.08.2026:** Der Export heißt **`IsoWeekKeySchema`**
> (`packages/contracts/src/planning/schemas.ts:104`), nicht `WeekKeySchema`. Er trägt neben dem
> Muster ein `.refine(isValidIsoWeekKey)` und damit die Kalenderregel — `2025-W53` fällt nur an
> dieser Prüfung, nicht am Muster.
>
> **Pflicht, sonst ist die Kalenderregel unbewiesen:** Jedes neue Schema mit einem `weekKey` muss
> als Zeile in `STELLEN` in `packages/contracts/test/iso-week-key.test.ts` eingetragen und
> `expect(STELLEN).toHaveLength(n)` mitgezogen werden. Der Wächter merkt eine ausgelassene Zeile
> **nicht** von selbst. Gemessen: ohne die Registrierung bleiben alle 125 Tests grün, während die
> Kalenderregel aus den Kostenschemata verschwindet. Betrifft in diesem Plan Task 1 (erledigt,
> Stellen 6 und 7) und jede spätere Task, die ein `weekKey`-Schema anlegt.

```ts
/** Ein Kostenanteil einer Person an einem lokalen Kalendertag. */
export const CostPositionDtoSchema = z.strictObject({
  id: IdSchema,
  assignmentId: IdSchema,
  worksiteId: IdSchema,
  worksiteLabel: z.string().min(1),
  employeeId: IdSchema,
  employeeLabel: z.string().min(1),
  /** Lokaler Leistungstag in der Zone der Organisation. */
  localDate: BusinessDateSchema,
  /** Anteil an diesem lokalen Tag, in Millisekunden — als String, nie als Zahl. */
  durationMilliseconds: MinorUnitsSchema,
  rateVersionId: IdSchema,
  amountMinorUnits: MinorUnitsSchema,
});
export type CostPositionDto = z.infer<typeof CostPositionDtoSchema>;

/** Tagessumme — vorberechnet, damit die UI nicht selbst addiert. */
export const CostDayTotalSchema = z.strictObject({
  localDate: BusinessDateSchema,
  worksiteId: IdSchema,
  amountMinorUnits: MinorUnitsSchema,
});
export type CostDayTotal = z.infer<typeof CostDayTotalSchema>;

export const CostSnapshotSchema = z.strictObject({
  id: IdSchema,
  planVersionId: IdSchema,
  worksiteId: IdSchema.nullable(),
  weekKey: WeekKeySchema,
  timeZone: z.string().min(1),
  currency: z.literal("EUR"),
  ruleVersion: z.literal("personnel-plan-cost-v1"),
  createdAt: InstantSchema,
  createdBy: IdSchema,
  correlationId: z.string().min(1),
  totalMinorUnits: MinorUnitsSchema,
  days: z.array(CostDayTotalSchema),
  positions: z.array(CostPositionDtoSchema),
});
export type CostSnapshot = z.infer<typeof CostSnapshotSchema>;

export const CreateCostSnapshotCommandSchema = z.strictObject({
  publishedPlanVersionId: IdSchema,
  /** Optionaler Baustellenfilter desselben Mandanten. `null` = alle Baustellen. */
  worksiteId: IdSchema.nullable(),
});
export type CreateCostSnapshotCommand = z.infer<typeof CreateCostSnapshotCommandSchema>;

export const PublishedPlanVersionDtoSchema = z.strictObject({
  id: IdSchema,
  weekKey: WeekKeySchema,
  publishedAt: InstantSchema,
});
export type PublishedPlanVersionDto = z.infer<typeof PublishedPlanVersionDtoSchema>;

export const PublishedPlanVersionsSchema = z.strictObject({
  versions: z.array(PublishedPlanVersionDtoSchema),
});
export type PublishedPlanVersions = z.infer<typeof PublishedPlanVersionsSchema>;
```

`gateway.ts` um drei Methoden erweitern:

```ts
  /** Veroeffentlichte Planversionen im Wochenbereich — die Auswahlliste von `/kosten`. */
  publishedPlanVersions(
    fromWeekKey: string,
    toWeekKey: string,
  ): Promise<GatewayResult<PublishedPlanVersions>>;
  /** Erzeugt einen unveraenderlichen Snapshot. Pflicht-Idempotenzschluessel wie jeder Write. */
  createSnapshot(
    command: CreateCostSnapshotCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<CostSnapshot>>;
  /** Liest einen GESPEICHERTEN Snapshot. Rechnet nichts neu. */
  snapshot(snapshotId: string): Promise<GatewayResult<CostSnapshot>>;
```

`packages/contracts/src/index.ts` um die neuen Werte und Typen erweitern (benannte Exporte, kein
`export *`).

**Schritt 4: Test laufen lassen, Grün bestätigen**

```bash
pnpm --filter @easytree/contracts exec vitest run test/costs-snapshot-schemas.test.ts
```

**Schritt 5: Committen**

```bash
git add packages/contracts/src/costs/schemas.ts packages/contracts/src/costs/gateway.ts \
        packages/contracts/src/index.ts packages/contracts/test/costs-snapshot-schemas.test.ts
git diff --cached --name-only
git commit -m "feat(contracts): EYT-109 — Snapshot- und Planversionsschemata"
```

---

## Task 2: Contract — HTTP-Gateway und OpenAPI

> **Task 2 ist blockierend, nicht bloß der nächste Schritt.** Nach Task 1 erfüllt
> `HttpCostsGateway` das erweiterte `CostsGateway` nicht mehr (TS2420); `@easytree/contracts#build`
> scheitert, turbo hält an, und **kein Downstream-Paket kann typechecken oder testen**, bis Task 2
> landet. Gemessen 08.08.2026 auf `7be8ebb`: genau ein Fehler in `contracts`, zwei Folgefehler in
> `apps/web`.

**Dateien:**
- Ändern: `packages/contracts/src/http/costs-gateway.ts`
- Ändern: `packages/contracts/src/openapi/document.ts` (**beides**: `NAMED_SCHEMAS` **und** `paths`)
- Ändern: `packages/contracts/openapi/v1.json` (**generiert**)
- Ändern: `apps/web/test/rate-management.test.tsx` (`gatewayMit` bei `:86` ist als `CostsGateway`
  deklariert und jetzt strukturell unvollständig, TS2739)
- Test: `packages/contracts/test/costs-gateway.contract.test.ts` (vorhanden erweitern oder neu)

`apps/web/lib/costs-gateway-factory.ts:13` ist ebenfalls rot, klärt sich aber von selbst, sobald
`HttpCostsGateway` wieder vollständig ist — keine eigene Änderung nötig, nur nach dem Fix messen.

> **Vollständige Implementorenliste, gemessen** (`HttpCostsGateway`, `gatewayMit`): mehr gibt es
> nicht. Kein Mock-Gateway in `packages/contracts/src/mock/` oder `src/testing/`, keine Referenz in
> `apps/api`. Wer hier etwas hinzufügt, ergänzt diese Liste.

> **Korrektur zu Schritt 4, gemessen 08.08.2026:** Ein neues Schema bewegt `v1.json` **nicht** von
> allein, und der Drift-Test wird davon **nicht** rot. `packages/contracts/src/openapi/document.ts`
> baut das Dokument aus einer handgeschriebenen Registrierung
> `const NAMED_SCHEMAS = { … } as const satisfies Record<string, z.ZodType>` (heute 24 Einträge,
> iteriert weiter unten). Was dort nicht steht, erreicht `v1.json` nie. Nach Task 1 ist
> `git diff b44e38c -- packages/contracts/openapi/v1.json` **leer** und der Drift-Test grün.
> Task 2 muss deshalb die neuen Schemata **in `NAMED_SCHEMAS` eintragen UND die drei Pfade
> ergänzen** — sonst schickt der Vertrag stillschweigend eine Route ohne Schema, und der
> Konformitätstest in Task 13 fällt erst viel später darüber.

**Schritt 1: Roten Test schreiben**

Der Test fährt `HttpCostsGateway` gegen ein gestelltes `fetch` und prüft: Pfad, Methode,
Idempotenzheader, Organisationsheader, und dass eine vertragswidrige Antwort als
`CONTRACT_VIOLATION` und nicht als Erfolg herauskommt.

**Schritt 2: Rot bestätigen**

```bash
pnpm --filter @easytree/contracts exec vitest run test/costs-gateway.contract.test.ts
```

**Schritt 3: Gateway und OpenAPI-Dokument ergänzen**

`http/costs-gateway.ts` nach dem Muster der vorhandenen Methoden. `openapi/document.ts` um die drei
Pfade `/kosten/planversionen`, `/kosten/snapshots`, `/kosten/snapshots/{snapshotId}` erweitern —
in derselben Form wie die vorhandenen `/kosten/*`-Einträge (Zeilen 298–330).

**Schritt 4: Vertrag regenerieren und Drift-Test messen**

```bash
pnpm --filter @easytree/contracts run openapi:write
pnpm --filter @easytree/contracts exec vitest run test/openapi-drift.test.ts
git diff --stat packages/contracts/openapi/v1.json
```

`v1.json` **niemals** von Hand editieren. Der Drift-Test vergleicht byteweise.

Der `git diff --stat` ist hier die eigentliche Messung: bleibt er **leer**, sind die Schemata nicht
in `NAMED_SCHEMAS` angekommen und die Arbeit ist nicht getan — auch wenn alle Tests grün sind.

**Schritt 5: Ganzen Baum wieder gruen bekommen**

Task 2 ist die Task, die den Build repariert. Deshalb hier vollständig messen, nicht nur das eigene
Paket:

```bash
pnpm --filter @easytree/contracts exec tsc -p tsconfig.json --noEmit   # TS2420 muss weg sein
pnpm --filter @easytree/web exec tsc -p tsconfig.json --noEmit         # beide TS2739 muessen weg sein
pnpm typecheck && pnpm test
```

**Schritt 6: Committen**

```bash
git add packages/contracts/src/http/costs-gateway.ts packages/contracts/src/openapi/document.ts \
        packages/contracts/openapi/v1.json packages/contracts/test/costs-gateway.contract.test.ts \
        apps/web/test/rate-management.test.tsx
git diff --cached --name-only
git commit -m "feat(contracts): EYT-109 — Snapshot-Operationen im HTTP-Gateway und in OpenAPI"
```

---

## Task 3: Domain — `dayBefore`

**Dateien:**
- Ändern: `packages/domain/src/local-business-date.ts`
- Ändern: `packages/domain/src/index.ts`
- Test: `packages/domain/test/local-business-date.test.ts` (vorhanden erweitern)

**Schritt 1: Roten Test schreiben**

```ts
describe("dayBefore", () => {
  it("geht ueber Monats-, Jahres- und Schaltjahresgrenze zurueck", () => {
    expect(dayBefore({ year: 2026, month: 8, day: 1 })).toEqual({ year: 2026, month: 7, day: 31 });
    expect(dayBefore({ year: 2026, month: 1, day: 1 })).toEqual({ year: 2025, month: 12, day: 31 });
    expect(dayBefore({ year: 2028, month: 3, day: 1 })).toEqual({ year: 2028, month: 2, day: 29 });
    expect(dayBefore({ year: 2026, month: 3, day: 1 })).toEqual({ year: 2026, month: 2, day: 28 });
  });

  it("ist die Umkehrung von dayAfter — Negativfall der Rundreise", () => {
    const tag = { year: 2026, month: 12, day: 31 };
    expect(dayBefore(dayAfter(tag))).toEqual(tag);
    // Gegenrichtung: eine Implementierung, die einfach `day - 1` rechnet,
    // liefert hier {2026,12,30} und faellt.
    expect(dayBefore(dayAfter(tag))).not.toEqual({ year: 2026, month: 12, day: 30 });
  });
});
```

**Schritt 2: Rot bestätigen**

```bash
pnpm --filter @easytree/domain exec vitest run test/local-business-date.test.ts
```

**Schritt 3: Implementieren**

```ts
/**
 * Der vorherige Kalendertag, ueber Monats-, Jahres- und Schaltjahresgrenze hinweg.
 *
 * Spiegelbild von {@link dayAfter} und aus demselben Grund ohne `Date`: V3 verbietet,
 * Kalendertage in UTC-Zeitpunkte zu wandeln.
 *
 * Gebraucht wird sie an genau einer Naht (EYT-109): die Datenbank fuehrt
 * Satzgueltigkeiten halboffen (`daterange(valid_from, valid_to, '[)')`, Migration
 * 0013), die Domaene einschliessend (`[validFrom, validTo]`, V3). `dayBefore` ist
 * die Uebersetzung zwischen beiden — sichtbar an einer Stelle statt still ueberall.
 */
export function dayBefore(date: LocalBusinessDate): LocalBusinessDate {
  if (date.day > 1) return { year: date.year, month: date.month, day: date.day - 1 };
  if (date.month > 1) {
    const vormonat = date.month - 1;
    return { year: date.year, month: vormonat, day: daysInMonth(date.year, vormonat) };
  }
  return { year: date.year - 1, month: 12, day: 31 };
}
```

Export in `packages/domain/src/index.ts` ergänzen.

**Schritt 4: Grün bestätigen und Vollständigkeitsprüfung anpassen**

```bash
pnpm --filter @easytree/domain exec vitest run test/local-business-date.test.ts
pnpm --filter @easytree/domain build
pnpm --filter @easytree/api exec vitest run test/domain-invariant-coverage.test.ts
```

Der Coverage-Test wird **rot**, weil ein neuer Wert-Export ohne Registereintrag existiert. Eintrag
in `apps/api/test/domain-invariants/registry.ts` ergänzen (`kind: "regel"`, Positiv- und Negativtest
mit den oben verwendeten Titeln), dann erneut laufen lassen.

**Schritt 5: Committen**

```bash
git add packages/domain/src/local-business-date.ts packages/domain/src/index.ts \
        packages/domain/test/local-business-date.test.ts apps/api/test/domain-invariants/registry.ts
git diff --cached --name-only
git commit -m "feat(domain): EYT-109 — dayBefore als sichtbare Naht zwischen halboffener DB und einschliessender Domaene"
```

---

## Task 4: Domain — Tagesallokation über lokale Kalendertage

**Dateien:**
- Erstellen: `packages/domain/src/local-day-allocation.ts`
- Ändern: `packages/domain/src/index.ts`
- Test: `packages/domain/test/local-day-allocation.test.ts` (neu)
- Test: `packages/domain/test/local-day-allocation.property.test.ts` (neu)

**Schritt 1: Roten Test schreiben — die fünf geforderten Fälle plus DST**

```ts
import { describe, expect, it } from "vitest";

import { allocateAcrossLocalDays } from "../src/local-day-allocation.js";
import { EUROPE_BERLIN, createTimeZone } from "../src/planning-week.js";
import { TimeInterval } from "../src/time-interval.js";

function intervall(startIso: string, endeIso: string): TimeInterval {
  const gebaut = TimeInterval.create(new Date(startIso), new Date(endeIso));
  if (!gebaut.ok) throw new Error(`Testfixture ungueltig: ${gebaut.error}`);
  return gebaut.interval;
}

const STUNDE = 3_600_000n;

describe("allocateAcrossLocalDays", () => {
  it("laesst einen Einsatz innerhalb eines lokalen Tages ungeteilt", () => {
    // 2026-08-03 08:00–16:00 Europe/Berlin (UTC+2)
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-08-03T06:00:00.000Z", "2026-08-03T14:00:00.000Z"),
      EUROPE_BERLIN,
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.parts).toHaveLength(1);
    expect(ergebnis.parts[0]?.date).toEqual({ year: 2026, month: 8, day: 3 });
    expect(ergebnis.parts[0]?.quantity.milliseconds).toBe(8n * STUNDE);
  });

  it("teilt an der lokalen Mitternacht auf zwei Kalendertage", () => {
    // 2026-08-03 22:00 – 2026-08-04 02:00 Europe/Berlin
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-08-03T20:00:00.000Z", "2026-08-04T00:00:00.000Z"),
      EUROPE_BERLIN,
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.parts.map((teil) => teil.date.day)).toEqual([3, 4]);
    expect(ergebnis.parts.map((teil) => teil.quantity.milliseconds)).toEqual([2n * STUNDE, 2n * STUNDE]);
  });

  it("ordnet einer UTC-Zuordnung widersprechend dem ORTSTAG zu", () => {
    // 2026-08-02T22:30Z ist in Europe/Berlin bereits Montag, der 3. August.
    // Genau dieser Fall unterscheidet die richtige von der naheliegenden falschen
    // Implementierung (UTC-Tag).
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-08-02T22:30:00.000Z", "2026-08-03T06:30:00.000Z"),
      EUROPE_BERLIN,
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.parts).toHaveLength(1);
    expect(ergebnis.parts[0]?.date).toEqual({ year: 2026, month: 8, day: 3 });
  });

  it("erhaelt die Summe ueber den Sommerzeitbeginn — der Tag hat 23 Stunden", () => {
    // 2026-03-29: Europe/Berlin springt 02:00 -> 03:00.
    // Lokal 2026-03-28 23:00 bis 2026-03-29 12:00 sind 13 Stunden lokal,
    // aber nur 12 Stunden echte Dauer.
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-03-28T22:00:00.000Z", "2026-03-29T10:00:00.000Z"),
      EUROPE_BERLIN,
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    const summe = ergebnis.parts.reduce((a, teil) => a + teil.quantity.milliseconds, 0n);
    expect(summe).toBe(12n * STUNDE);
    expect(ergebnis.parts.map((teil) => teil.date.day)).toEqual([28, 29]);
  });

  it("erhaelt die Summe ueber das Sommerzeitende — der Tag hat 25 Stunden", () => {
    // 2026-10-25: Europe/Berlin springt 03:00 -> 02:00.
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-10-24T22:00:00.000Z", "2026-10-25T10:00:00.000Z"),
      EUROPE_BERLIN,
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    const summe = ergebnis.parts.reduce((a, teil) => a + teil.quantity.milliseconds, 0n);
    expect(summe).toBe(12n * STUNDE);
  });

  it("blockiert, wenn die lokale Mitternacht in der Zone nicht existiert", () => {
    // MESSEN, NICHT ANNEHMEN: Zone und Datum werden in Schritt 2 gegen die
    // Laufzeit-Zonendatenbank geprueft. Kandidat: America/Santiago, Umstellung um 24:00.
    const zone = createTimeZone("America/Santiago");
    expect(zone.ok).toBe(true);
    if (!zone.ok) return;
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-09-05T20:00:00.000Z", "2026-09-06T20:00:00.000Z"),
      zone.timeZone,
    );
    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.error).toBe("DAY_BOUNDARY_NONEXISTENT");
  });
});
```

**Schritt 2: Rot bestätigen UND die Mitternachtsumstellung wirklich messen**

```bash
pnpm --filter @easytree/domain exec vitest run test/local-day-allocation.test.ts
```

Erwartet: FAIL, Modul existiert nicht.

Bevor der letzte Testfall stehen bleibt, wird er **gemessen**:

```bash
node -e '
const z="America/Santiago";
for (const tag of ["2026-09-05","2026-09-06","2026-10-03","2026-10-04"]) {
  const f=new Intl.DateTimeFormat("en-US",{timeZone:z,hour:"2-digit",hourCycle:"h23",
    year:"numeric",month:"2-digit",day:"2-digit"});
  // Mitternacht UTC-nah abtasten und die lokale Stunde 00 suchen
  let gefunden=false;
  for (let m=0;m<1440;m++){
    const d=new Date(Date.parse(tag+"T00:00:00Z")+m*60000);
    const p=Object.fromEntries(f.formatToParts(d).map(x=>[x.type,x.value]));
    if (p.day===tag.slice(8) && p.hour==="00") { gefunden=true; break; }
  }
  console.log(tag, "lokale Stunde 00 existiert:", gefunden);
}'
```

Gibt es für kein Datum eine fehlende Mitternacht, wird dieser eine Testfall **entfernt** und im
Abschlusspaket als `SOURCE_NEEDED` gemeldet („Fehlerzweig `DAY_BOUNDARY_NONEXISTENT` existiert,
konnte in dieser Laufzeit-Zonendatenbank aber nicht ausgelöst werden“). Der Zweig bleibt im Code.
Er wird **nicht** als geprüft behauptet.

**Schritt 3: Implementieren**

`packages/domain/src/local-day-allocation.ts`:

```ts
/**
 * Verteilung eines Einsatzes auf lokale Kalendertage (EYT-109, S5-REQ-05).
 *
 * ## Warum das nicht `planning-week.ts` macht
 *
 * Dort steht die Regel „ein Einsatz gehoert in die Woche seines Beginns, eine Schicht
 * ueber Mitternacht wird NICHT aufgeteilt". Das ist fuer die Wochenzuordnung richtig
 * und fuer Tageskosten falsch: eine Nachtschicht faellt wirtschaftlich auf zwei
 * Arbeitstage. Beide Regeln stehen nebeneinander, weil sie verschiedene Fragen
 * beantworten — nicht weil eine die andere ersetzt.
 *
 * ## Warum die Funktion blockieren kann
 *
 * Die Tagesgrenze ist eine lokale Mitternacht, und in manchen Zonen springt die Uhr
 * genau dort. `utcInstantOfLocalWallTime` meldet das als NONEXISTENT/AMBIGUOUS statt
 * zu raten; hier wird es durchgereicht. Ein still gewaehlter Zweig verschoebe eine
 * ganze Nachtschicht um eine Stunde, ohne dass es jemand saehe.
 *
 * ## Summenerhaltung
 *
 * Die Anteile werden aus AUFEINANDERFOLGENDEN Instants gebildet und ihre Differenzen
 * summieren sich per Konstruktion exakt auf `durationMs(interval)` — auch an den
 * Umstellungstagen mit 23 bzw. 25 Stunden. Es wird nirgends gerundet.
 */
import { durationMilliseconds } from "./duration-milliseconds.js";
import type { DurationMilliseconds } from "./duration-milliseconds.js";
import { compareLocalBusinessDate, dayAfter } from "./local-business-date.js";
import { localBusinessDate, utcInstantOfLocalWallTime } from "./planning-week.js";
import type { IanaTimeZone, LocalBusinessDate } from "./planning-week.js";
import { durationMs } from "./time-interval.js";
import type { TimeInterval } from "./time-interval.js";

export interface LocalDayPart {
  readonly date: LocalBusinessDate;
  readonly quantity: DurationMilliseconds;
}

export const LOCAL_DAY_ALLOCATION_ERRORS = [
  /** Die lokale Mitternacht existiert an diesem Tag nicht (Umstellung um 00:00). */
  "DAY_BOUNDARY_NONEXISTENT",
  /** Die lokale Mitternacht existiert zweimal. Keine stille Wahl. */
  "DAY_BOUNDARY_AMBIGUOUS",
] as const;
export type LocalDayAllocationError = (typeof LOCAL_DAY_ALLOCATION_ERRORS)[number];

export type LocalDayAllocationResult =
  | { readonly ok: true; readonly parts: readonly LocalDayPart[] }
  | { readonly ok: false; readonly error: LocalDayAllocationError };

export function allocateAcrossLocalDays(
  interval: TimeInterval,
  timeZone: IanaTimeZone,
): LocalDayAllocationResult {
  const startMs = interval.startUtc.getTime();
  const endeMs = startMs + durationMs(interval);

  const parts: LocalDayPart[] = [];
  let cursorMs = startMs;
  let tag = localBusinessDate(interval.startUtc, timeZone);

  // Obergrenze als Bruchbalken gegen eine Endlosschleife bei einer kaputten Zone:
  // ein Einsatz ueber mehr als 400 lokale Tage ist kein Planungsfall, sondern ein
  // Fehler — und dann laut, nicht endlos.
  for (let schutz = 0; schutz < 400; schutz += 1) {
    const naechsterTag = dayAfter(tag);
    const grenze = utcInstantOfLocalWallTime(
      { date: naechsterTag, hour: 0, minute: 0 },
      timeZone,
    );
    if (!grenze.ok) {
      return {
        ok: false,
        error:
          grenze.error === "AMBIGUOUS_LOCAL_TIME"
            ? "DAY_BOUNDARY_AMBIGUOUS"
            : "DAY_BOUNDARY_NONEXISTENT",
      };
    }

    const schnittMs = Math.min(grenze.instant.getTime(), endeMs);
    const anteil = durationMilliseconds(BigInt(schnittMs - cursorMs));
    if (!anteil.ok) {
      // Unerreichbar mit einem gueltigen TimeInterval (Ende > Start, Grenzen
      // aufsteigend). Laut abbrechen statt einen negativen Anteil zu verschlucken —
      // gleiche Konvention wie `costOfDuration` und `daysInMonth`.
      throw new RangeError(
        `Invariante verletzt: negativer Tagesanteil ${String(schnittMs - cursorMs)} ms in Zone ${timeZone}.`,
      );
    }
    if (anteil.quantity.milliseconds > 0n) parts.push({ date: tag, quantity: anteil.quantity });

    if (schnittMs >= endeMs) return { ok: true, parts };
    cursorMs = schnittMs;
    tag = naechsterTag;
    // Absicherung gegen eine nicht monoton wachsende Zonenrechnung.
    if (compareLocalBusinessDate(tag, naechsterTag) !== 0) {
      throw new RangeError(`Invariante verletzt: Tagesgrenze in Zone ${timeZone} nicht monoton.`);
    }
  }

  throw new RangeError(
    `Invariante verletzt: mehr als 400 lokale Tage in einem Einsatz (Zone ${timeZone}).`,
  );
}
```

Export in `packages/domain/src/index.ts`.

**Schritt 4: Property-Test mit festem Seed**

`packages/domain/test/local-day-allocation.property.test.ts` — die tragende Eigenschaft ist die
Summenerhaltung über beliebige Intervalle und mehrere Zonen:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
// … Importe wie oben

const ZONEN = ["Europe/Berlin", "UTC", "Australia/Lord_Howe", "Pacific/Chatham"];

describe("allocateAcrossLocalDays — Eigenschaften", () => {
  it("Summe der Anteile ist exakt die Dauer des Intervalls", () => {
    fc.assert(
      fc.property(
        // Ein Jahr um die beiden Umstellungen herum, Dauer 1 Minute bis 3 Tage.
        fc.integer({ min: Date.parse("2026-01-01T00:00:00Z"), max: Date.parse("2027-01-01T00:00:00Z") }),
        fc.integer({ min: 60_000, max: 3 * 86_400_000 }),
        fc.constantFrom(...ZONEN),
        (startMs, dauerMs, zonenId) => {
          const zone = createTimeZone(zonenId);
          if (!zone.ok) return true;
          const gebaut = TimeInterval.create(new Date(startMs), new Date(startMs + dauerMs));
          if (!gebaut.ok) return true;
          const ergebnis = allocateAcrossLocalDays(gebaut.interval, zone.timeZone);
          if (!ergebnis.ok) return true; // blockierend ist ein zulaessiger Ausgang
          const summe = ergebnis.parts.reduce((a, t) => a + t.quantity.milliseconds, 0n);
          return summe === BigInt(dauerMs);
        },
      ),
      { seed: 20260109, numRuns: 500 },
    );
  });

  it("die Tage sind streng aufsteigend und lueckenlos", () => {
    /* gleiche Bauart, prueft compareLocalBusinessDate(vorher, nachher) < 0
       und dayAfter(vorher) === nachher */
  });
});
```

Fester Seed, damit ein roter CI-Lauf lokal ohne Zusatzargument reproduzierbar ist.

**Schritt 5: Alles grün, dann Register und Commit**

```bash
pnpm --filter @easytree/domain exec vitest run test/local-day-allocation.test.ts test/local-day-allocation.property.test.ts
pnpm --filter @easytree/domain build
pnpm --filter @easytree/api exec vitest run test/domain-invariant-coverage.test.ts
```

Registereintrag für `allocateAcrossLocalDays` (Positiv: „teilt an der lokalen Mitternacht auf zwei
Kalendertage“; Negativ: „ordnet einer UTC-Zuordnung widersprechend dem ORTSTAG zu“ — das ist der
unterscheidende Gegenfall, bei dem die naheliegende falsche Implementierung nachweislich etwas
anderes liefert) und für `LOCAL_DAY_ALLOCATION_ERRORS` (`kind: "konstante"`).

```bash
git add packages/domain/src/local-day-allocation.ts packages/domain/src/index.ts \
        packages/domain/test/local-day-allocation.test.ts \
        packages/domain/test/local-day-allocation.property.test.ts \
        apps/api/test/domain-invariants/registry.ts
git diff --cached --name-only
git commit -m "feat(domain): EYT-109 — summenerhaltende Tagesallokation in der Organisationszone"
```

---

## Task 5: Domain-Naht — Satzauswahl und Betrag im Kostenmodul

**Dateien:**
- Erstellen: `apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts`
- Test: `apps/api/test/costs/cost-snapshot-assembly.test.ts` (neu)

Diese Datei ist die **einzige** Stelle, an der Tagesallokation, Satzauswahl und Geldrechnung
zusammenkommen. Sie ist rein: kein NestJS, kein `pg`, keine Uhr (`computedAt` ist Eingabe).
Die Regel `costs-domain-purity` erlaubt hier nur relative Pfade innerhalb `costs/domain/` und
`@easytree/domain`.

**Schritt 1: Roten Test schreiben**

Mindestens diese Fälle:

1. Ein Einsatz, ein Satz → eine Position, Betrag exakt nach `costOfDuration`.
2. Ein Einsatz über Mitternacht → **zwei** Positionen mit demselben `assignmentId`, verschiedenen
   `localDate`, Summe der Beträge nachvollziehbar.
3. **Kein** Satz am Leistungsdatum → `{ ok: false, error: "RATE_MISSING" }` mit `employeeId` und
   `localDate` im Befund, **kein** Betrag, **kein** `0`.
4. **Zwei** Sätze am Leistungsdatum → `RATE_AMBIGUOUS`, kein willkürlicher Griff.
5. **Nahtstellentag** (der D1-Fall): Satz A `valid_from 2026-06-01, valid_to 2026-07-01`, Satz B
   `valid_from 2026-07-01, valid_to null`. Am 2026-07-01 muss **genau B** gewählt werden.
   Kommentar im Test: „Dieser Fall friert D1 ein. Wer hier auf `selectRateVersion` aus
   `@easytree/domain` umstellt, bekommt `RATE_AMBIGUOUS` — die einschließende Lesart der Domäne
   passt nicht zur halboffenen Lesart der Datenbank (Migration 0013).“
6. Blockade ist **total**: enthält irgendeine Position einen Fehler, gibt es **kein** Teilergebnis.

**Schritt 2: Rot bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-assembly.test.ts
```

**Schritt 3: Implementieren**

Signatur (Fehler im Rückgabetyp, nie als Ausnahme — Hausmuster):

```ts
export interface SnapshotAssemblyInput {
  readonly facts: PublishedPlanFacts;         // Planversion, Woche, Zone, Arbeit, Labels
  readonly worksiteFilter: string | null;
  readonly ratesByEmployee: ReadonlyMap<string, readonly RateVersionRecord[]>;
  readonly computedAt: Date;                   // EINGABE, nicht aus der Uhr gelesen
}

export const SNAPSHOT_ASSEMBLY_PROBLEMS = [
  "RATE_MISSING",
  "RATE_AMBIGUOUS",
  "DAY_BOUNDARY_UNDEFINED",
  "TIME_ZONE_UNKNOWN",
  "INTERVAL_INVALID",
] as const;

export type SnapshotAssemblyResult =
  | { readonly ok: true; readonly positions: readonly AssembledPosition[] }
  | {
      readonly ok: false;
      readonly problem: SnapshotAssemblyProblem;
      /** Genug fuer eine handlungsorientierte Meldung — und nicht mehr. */
      readonly employeeId: string | null;
      readonly localDate: string | null;
    };
```

Ablauf je Einsatz:

1. `createTimeZone(facts.timeZone)` — die Zonenprüfung passiert **hier**, wo die Zone angewendet
   wird (so steht es im Kopfkommentar von `planned-work-fact.ts`).
2. `TimeInterval.create(startsAtUtc, endsAtUtc)`.
3. `allocateAcrossLocalDays(interval, zone)`.
4. Je Anteil: lokales Datum als `YYYY-MM-DD` formatieren (String-Padding, **kein** `Date`),
   `effectiveRateVersion(rates, datum)` aufrufen.
5. Aus der gewählten Satzzeile eine geprüfte `HourlyRateVersion` bauen:
   `validTo` der Zeile ist **halboffen** → `dayBefore(parse(validTo))`, `null` bleibt `null`.
   `amountPerHour` über `hourlyRateAmount(moneyOfMinorUnits(BigInt(row.amountMinorUnits), "EUR"))`.
6. `costOfDuration(version, anteil.quantity)` — die eine Rundung.
7. Position mit `ruleVersion: COST_RULE_VERSION` ausgeben.

Deterministische Reihenfolge: sortiert nach `(localDate, worksiteId, employeeLabel, assignmentId)`.
Ohne feste Sortierung wären zwei Läufe nicht vergleichbar und der Excel-Export von EYT-110 nicht
reproduzierbar.

**Schritt 4: Grün bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-assembly.test.ts
pnpm --filter @easytree/api exec vitest run test/costs-module-boundaries.test.ts test/architecture.test.ts
```

Die Modulgrenztests müssen grün bleiben — insbesondere `costs-domain-purity` und
`costs-single-money-implementation`.

**Schritt 5: Committen**

```bash
git add apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts \
        apps/api/test/costs/cost-snapshot-assembly.test.ts
git diff --cached --name-only
git commit -m "feat(costs): EYT-109 — reine Snapshot-Montage aus Tagesanteilen, Satzversion und zentraler Geldregel"
```

---

## Task 6: Migration 0018 — Snapshot-Tabellen mit Kanalgrenze

**Dateien:**
- Erstellen: `supabase/migrations/<timestamp>_0018_cost_snapshots.sql`
- Ändern: `apps/api/src/modules/module-catalogue.ts` (`TABLE_OWNERSHIP`)
- Ändern: `supabase/tests/0005_schema_meta_gate.sql` (`expected_tables`)

**Schritt 1: Migrationsdatei anlegen und umbenennen**

```bash
pnpm exec supabase migration new cost_snapshots
ls supabase/migrations/ | tail -3
```

`supabase migration new` erzeugt nur den Zeitstempel. Die Datei **umbenennen**, damit die
`NNNN`-Sequenz weiterläuft:

```bash
mv supabase/migrations/<neuerTimestamp>_cost_snapshots.sql \
   supabase/migrations/<neuerTimestamp>_0018_cost_snapshots.sql
```

`0018` ist hier korrekt, weil `0017` die höchste gemergte Nummer ist (gemessen 08.08.2026) — vor
dem Anlegen erneut `ls supabase/migrations/` prüfen.

**Schritt 2: Migration schreiben**

Kopf mit Zweck, Ownership, Grants/RLS, bestehenden Verbrauchern, Rollback-vorwärts und
Datenverlustrisiko — Form wie 0017.

```sql
-- Migration 0018_cost_snapshots (EYT-109)
--
-- ZWECK
-- ---------------------------------------------------------------------------
-- Der taegliche Plan-Personalkosten-Snapshot als HISTORISCHES DOKUMENT: Header
-- plus Positionen, nach dem Anlegen unveraenderlich. Grundlage fuer /kosten
-- (EYT-109) und den spaeteren XLSX-Export (EYT-110), der ausschliesslich eine
-- Snapshot-Id bekommt.
--
-- OWNERSHIP
-- ---------------------------------------------------------------------------
-- Modul `costs`. Eingetragen in TABLE_OWNERSHIP (module-catalogue.ts) und in
-- expected_tables (supabase/tests/0005_schema_meta_gate.sql). Das Kostenmodul
-- liest Planfakten ausschliesslich ueber die Planning-Application-API; hier
-- entstehen KEINE Fremdschluessel auf assignments/plan_versions als
-- Schreibrecht, sondern nur die Herkunftsangaben als Werte.
--
-- WARUM KEINE FK AUF plan_versions/assignments
-- ---------------------------------------------------------------------------
-- Ein Snapshot ist ein historisches Dokument. Ein FK mit `on delete cascade`
-- loeschte ihn mit der Quelle; `on delete restrict` machte das Aufraeumen der
-- Planung von Kostendaten abhaengig. Beide Richtungen sind falsch. Die Ids
-- werden als Werte gefuehrt, die Mandantenbindung uebernimmt org_id + RLS.
--
-- UNVERAENDERLICHKEIT = FEHLENDES RECHT
-- ---------------------------------------------------------------------------
-- Es gibt fuer `authenticated` KEIN update- und KEIN delete-Grant auf beiden
-- Tabellen — dieselbe Bauart wie audit_events (0008), idempotency_records
-- (0012) und employee_rate_versions (0013). Kein Trigger noetig: ein Recht,
-- das nicht existiert, kann keine Policy falsch auslegen.
--
-- KANALGRENZE (EYT-136 uebertragen)
-- ---------------------------------------------------------------------------
-- `app.is_runtime_channel()` (0015) steht in der insert-Policy ZUERST. PostgREST
-- meldet sich als `authenticator` an und ist nicht Mitglied von `easytree_app`
-- (gemessen 04.08.2026, pg_auth_members), erfuellt die Bedingung also nie. Ein
-- angemeldetes Organisationsmitglied kann damit ueber die Data-API keinen
-- Snapshot fingieren, auch nicht mit costs.calculate.
--
-- BETRIEBSHINWEIS POOLER
-- ---------------------------------------------------------------------------
-- Wie 0015/0017: laeuft die Anwendung ueber den Supavisor-Transaktionspooler,
-- lautet session_user `postgres.<tenant>` und das Erzeugen bricht LAUT ab
-- (null betroffene Zeilen bzw. 42501). Siehe docs/runbooks/planning-publish.md.
--
-- ROLLBACK (vorwaerts, als NEUE Migration — 0018 wird nach dem Merge nie editiert)
-- ---------------------------------------------------------------------------
--   drop table public.cost_snapshot_positions;
--   drop table public.cost_snapshots;
--   Eintraege aus TABLE_OWNERSHIP und expected_tables entfernen.
--
-- DATENVERLUSTRISIKO
-- ---------------------------------------------------------------------------
-- Keines beim Anwenden: beide Tabellen sind neu, kein Bestand wird beruehrt.
-- Beim Rollback nach echtem Betrieb gehen erzeugte Snapshots verloren; deshalb
-- gilt Sprint-5 §9 — keine destruktive Down-Migration nach echtem Datenbestand.

create table public.cost_snapshots (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan_version_id uuid not null,
  worksite_id uuid null,
  week_key text not null,
  time_zone text not null check (length(trim(time_zone)) > 0),
  currency text not null check (currency = 'EUR'),
  rule_version text not null check (length(trim(rule_version)) > 0),
  total_minor_units bigint not null check (total_minor_units >= 0),
  created_by uuid not null references public.users (id),
  correlation_id text not null check (length(trim(correlation_id)) > 0),
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  -- Mandantengebundener FK auf die Baustelle, unabhaengig von RLS wirksam.
  foreign key (worksite_id, org_id) references public.worksites (id, org_id) on delete restrict
);

comment on table public.cost_snapshots is
  'Unveraenderlicher Kopf eines Plan-Personalkosten-Snapshots (EYT-109). Kein update-, kein delete-Grant; Anlegen nur ueber den Laufzeitkanal mit costs.calculate.';

create table public.cost_snapshot_positions (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  snapshot_id uuid not null,
  assignment_id uuid not null,
  worksite_id uuid not null,
  worksite_label text not null check (length(trim(worksite_label)) > 0),
  employee_id uuid not null,
  employee_label text not null check (length(trim(employee_label)) > 0),
  local_date date not null,
  duration_ms bigint not null check (duration_ms > 0),
  rate_version_id uuid not null,
  amount_minor_units bigint not null check (amount_minor_units >= 0),
  /** Stabile Anzeigereihenfolge, im Snapshot festgeschrieben. */
  ordinal integer not null check (ordinal >= 0),
  primary key (id),
  unique (id, org_id),
  unique (snapshot_id, ordinal),
  foreign key (snapshot_id, org_id) references public.cost_snapshots (id, org_id) on delete restrict,
  foreign key (worksite_id, org_id) references public.worksites (id, org_id) on delete restrict,
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete restrict,
  foreign key (rate_version_id, org_id)
    references public.employee_rate_versions (id, org_id) on delete restrict
);

comment on table public.cost_snapshot_positions is
  'Einzelposition eines Kosten-Snapshots: ein Mitarbeiteranteil an einem lokalen Kalendertag (EYT-109). Unveraenderlich. rate_version_id friert die verwendete Satzversion ein — eine spaetere Version rechnet nichts um.';

create index cost_snapshots_lookup_idx
  on public.cost_snapshots (org_id, plan_version_id, created_at desc);
create index cost_snapshot_positions_snapshot_idx
  on public.cost_snapshot_positions (snapshot_id, ordinal);

alter table public.cost_snapshots enable row level security;
alter table public.cost_snapshots force row level security;
alter table public.cost_snapshot_positions enable row level security;
alter table public.cost_snapshot_positions force row level security;

revoke all on public.cost_snapshots from anon;
revoke all on public.cost_snapshots from authenticated;
revoke all on public.cost_snapshot_positions from anon;
revoke all on public.cost_snapshot_positions from authenticated;

-- Spaltenlisten statt pauschalem insert: die Serverdefaults (id, created_at)
-- und die berechneten Felder bleiben ausserhalb der Reichweite des Clients.
grant select on public.cost_snapshots to authenticated;
grant insert (org_id, plan_version_id, worksite_id, week_key, time_zone, currency,
              rule_version, total_minor_units, created_by, correlation_id)
  on public.cost_snapshots to authenticated;

grant select on public.cost_snapshot_positions to authenticated;
grant insert (org_id, snapshot_id, assignment_id, worksite_id, worksite_label,
              employee_id, employee_label, local_date, duration_ms,
              rate_version_id, amount_minor_units, ordinal)
  on public.cost_snapshot_positions to authenticated;

create policy cost_snapshots_select on public.cost_snapshots
  for select to authenticated
  using (
    org_id in (select app.user_org_ids())
    and app.has_cost_permission(org_id, 'costs.read')
  );

create policy cost_snapshots_insert on public.cost_snapshots
  for insert to authenticated
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_cost_permission(org_id, 'costs.calculate')
    and created_by = auth.uid()
  );

create policy cost_snapshot_positions_select on public.cost_snapshot_positions
  for select to authenticated
  using (
    org_id in (select app.user_org_ids())
    and app.has_cost_permission(org_id, 'costs.read')
  );

create policy cost_snapshot_positions_insert on public.cost_snapshot_positions
  for insert to authenticated
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_cost_permission(org_id, 'costs.calculate')
  );
```

**Schritt 3: Registrierungen nachziehen**

`apps/api/src/modules/module-catalogue.ts` → `TABLE_OWNERSHIP` um beide Tabellen mit
`owner: "costs"`, `tenantOwned: true` und einer Notiz ergänzen.

`supabase/tests/0005_schema_meta_gate.sql` → `insert into expected_tables …` um beide Tabellen
ergänzen (das Semikolon der letzten Zeile wandert mit).

**Schritt 4: Lokal prüfen, soweit möglich**

Auf dieser Maschine läuft die Supabase-Stack-Prüfung erfahrungsgemäß nicht — SQL wird zuerst in CI
ausgeführt. Deshalb hier nur, was lokal geht:

```bash
pnpm --filter @easytree/api exec vitest run test/architecture.test.ts
pnpm exec prettier --check supabase apps packages
```

Wenn Docker verfügbar ist, zusätzlich:

```bash
pnpm exec supabase db reset && pnpm exec supabase db reset
pnpm exec supabase test db
```

**Schritt 5: Committen**

```bash
git add supabase/migrations/<timestamp>_0018_cost_snapshots.sql \
        apps/api/src/modules/module-catalogue.ts supabase/tests/0005_schema_meta_gate.sql
git diff --cached --name-only
git commit -m "feat(db): EYT-109 — Snapshot-Tabellen mit Kanalgrenze und ohne Aenderungsrecht"
```

---

## Task 7: Planning — zwei Leseoperationen für veröffentlichte Stände

**Dateien:**
- Ändern: `apps/api/src/modules/planning/application/planning-queries.port.ts`
- Ändern: `apps/api/src/modules/planning/infrastructure/planning-window.repository.ts`
- Ändern: `apps/api/src/modules/planning/index.ts`
- Test: `apps/api/test/planning-published-reads.integration.test.ts` (neu)

**Schritt 1: Roten Integrationstest schreiben**

Muster: `apps/api/test/planning-publish.integration.test.ts`. Der Test fährt gegen die reale
Datenbank, respektiert `EASYTREE_TENANT_TESTS` und druckt eine greppbare Zeile
`[planning-published-reads] mode=… executed=… skipped=…`.

Fälle:

1. Veröffentlichte Version → `publishedAssignments(id)` liefert Zuweisungen, `weekKey`, `timeZone`
   und Ressourcenlabels.
2. **Entwurfsversion** → `PLAN_NOT_PUBLISHED`. Der Fall, den GM1 später öffnet.
3. Version eines **fremden Mandanten** → `PLAN_VERSION_NOT_FOUND` (kein Existenzleck, gleiche
   Antwort wie „gibt es nicht“).
4. Ein Entwurf **über** einer veröffentlichten Version derselben Woche → `publishedAssignments`
   liefert weiterhin die **veröffentlichten** Zuweisungen. (Das ist der Fall, an dem
   `planningWindow(weekKey)` scheitert und der Grund für diese Methode.)
5. `publishedVersions("2026-W30", "2026-W35")` liefert nur veröffentlichte Versionen des eigenen
   Mandanten, nach `weekKey` sortiert.

> **Beobachterverbindung nicht vergessen.** Stellt der Test seine Kommandos auf `easytree_app` um,
> müssen alle rohen Zählabfragen gleichzeitig auf `postgres` wandern — sonst `42501`.
> Und: nach **jedem einzelnen** Angriffsschritt den Zustand prüfen, nicht einmal am Ende;
> INSERT+DELETE heben sich in einer Netto-Zählung auf.

**Schritt 2: Rot bestätigen**

```bash
EASYTREE_TENANT_TESTS=required \
  pnpm --filter @easytree/api exec vitest run test/planning-published-reads.integration.test.ts
```

Ohne laufenden Stack läuft der Test lokal im Modus `local` und meldet Skips — das ist **kein**
grüner Nachweis. Der echte Nachweis kommt aus `db-gates` (Task 18).

**Schritt 3: Port, Repository und Index erweitern**

`planning-queries.port.ts`:

```ts
export interface PublishedPlanVersionRow {
  readonly id: string;
  readonly weekKey: string;
  readonly publishedAt: Date;
}

export interface PublishedAssignmentsRow {
  readonly planVersionId: string;
  readonly weekKey: string;
  readonly timeZone: string;
  readonly publishedAt: Date;
  readonly assignments: readonly AssignmentRow[];
  /** In DERSELBEN Transaktion gelesen — sonst saehen zwei Aufrufe zwei Zeitpunkte. */
  readonly resources: ResourcesRow;
}

export type PublishedReadProblem =
  | PlanningQueryProblem
  /** Es gibt keine sichtbare Planversion dieser Id. Auch fuer fremde Mandanten. */
  | "PLAN_VERSION_NOT_FOUND"
  /** Die Version existiert, ist aber nicht veroeffentlicht. Kosten brauchen einen verbindlichen Stand. */
  | "PLAN_NOT_PUBLISHED";

export interface PlanningQueries {
  planningWindow(weekKey: string): Promise<PlanningWindowResult>;
  publishedVersions(fromWeekKey: string, toWeekKey: string): Promise<PublishedVersionsResult>;
  publishedAssignments(planVersionId: string): Promise<PublishedAssignmentsResult>;
}
```

Repository: **eine** Transaktion je Aufruf über `TenantQueryRunner`, `org_id` steht in **keiner**
`where`-Klausel (RLS filtert), Zeitzone aus `organizations.time_zone` wie im vorhandenen
`planningWindow`.

Index: die neuen Typen benannt re-exportieren.

**Schritt 4: Grün bestätigen**

Lokal, was geht:

```bash
pnpm --filter @easytree/api exec vitest run test/architecture.test.ts test/planning-gateway-parity.test.ts
pnpm typecheck
```

**Schritt 5: Committen**

```bash
git add apps/api/src/modules/planning/application/planning-queries.port.ts \
        apps/api/src/modules/planning/infrastructure/planning-window.repository.ts \
        apps/api/src/modules/planning/index.ts \
        apps/api/test/planning-published-reads.integration.test.ts
git diff --cached --name-only
git commit -m "feat(planning): EYT-109 — veroeffentlichte Versionen und ihre Zuweisungen lesbar machen"
```

---

## Task 8: Costs — Faktenport und Adapter erweitern

**Dateien:**
- Ändern: `apps/api/src/modules/costs/application/plan-cost-facts.port.ts`
- Ändern: `apps/api/src/modules/costs/domain/planned-work-fact.ts`
- Ändern: `apps/api/src/modules/costs/infrastructure/planning-facts.adapter.ts`
- Ändern: `apps/api/src/modules/costs/index.ts`
- Test: `apps/api/test/costs/planning-facts.adapter.test.ts` (neu)

**Schritt 1: Roten Test schreiben**

Der Adapter bekommt ein gestelltes `PlanningQueries` und muss:
1. `PLAN_NOT_PUBLISHED` durchreichen;
2. `PLAN_VERSION_NOT_FOUND` durchreichen;
3. bei Erfolg Labels und Zone übernehmen;
4. **nicht** kompilieren, wenn die Planung einen neuen Ablehnungsgrund hinzufügt (der vorhandene
   Kommentar in `planning-facts.adapter.ts` beschreibt genau diesen Effekt — er bleibt gültig).

**Schritt 2: Rot bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/planning-facts.adapter.test.ts
```

**Schritt 3: Implementieren**

`PublishedPlanFacts` um `publishedAt`, `worksiteLabels` und `employeeLabels`
(`ReadonlyMap<string, string>`) erweitern. `PLAN_COST_FACTS_PROBLEMS` um
`PLAN_VERSION_NOT_FOUND` erweitern — die eingefrorene Liste ist an die HTTP-Naht gebunden, ein
neuer Eintrag ohne Fehlercode kompiliert nicht (`costs-error-type.ts`).

Neue Portmethoden:

```ts
  /** Veroeffentlichte Fakten GENAU DIESER Planversion. Der Einstieg von EYT-109. */
  publishedFactsForVersion(planVersionId: string): Promise<PlanCostFactsResult>;
  /** Auswahlliste fuer /kosten. */
  publishedVersions(fromWeekKey: string, toWeekKey: string): Promise<PublishedVersionsListResult>;
```

`publishedFacts(weekKey)` bleibt bestehen. **Finding notieren:** eine Portmethode ohne Verbraucher;
Entfernen ist eine eigene Entscheidung (EYT-105 hat sie bewusst so eingeführt).

**Schritt 4: Grün bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/planning-facts.adapter.test.ts \
  test/costs-module-boundaries.test.ts
```

**Schritt 5: Committen**

```bash
git add apps/api/src/modules/costs/application/plan-cost-facts.port.ts \
        apps/api/src/modules/costs/domain/planned-work-fact.ts \
        apps/api/src/modules/costs/infrastructure/planning-facts.adapter.ts \
        apps/api/src/modules/costs/index.ts apps/api/test/costs/planning-facts.adapter.test.ts
git diff --cached --name-only
git commit -m "feat(costs): EYT-109 — Planfakten nach Planversions-Id, mit Labels und Publish-Zeitpunkt"
```

---

## Task 9: Costs — Snapshot-Repository-Port

**Dateien:**
- Erstellen: `apps/api/src/modules/costs/application/cost-snapshot-repository.port.ts`
- Ändern: `apps/api/src/modules/costs/index.ts`

Reiner Vertrag, kein Test nötig (er wird durch die Nutzer geprüft). Enthält:

```ts
export const SNAPSHOT_WRITE_PROBLEMS = [
  "IDEMPOTENCY_KEY_REUSED",
  "WORKSITE_NOT_IN_ORG",
  /** Die Kanalgrenze hat abgelehnt — Data-API oder Pooler statt Laufzeitrolle. */
  "WRITE_CHANNEL_REJECTED",
] as const;

export interface CostSnapshotRepository {
  /** Header und ALLE Positionen in EINER Transaktion. Alles oder nichts. */
  create(input: NewCostSnapshot): Promise<SnapshotWriteResult>;
  /** Liest den GESPEICHERTEN Stand. Rechnet nichts neu. */
  read(snapshotId: string): Promise<SnapshotReadResult>;
  /** Auswahlliste — reicht an den Faktenport durch, damit die Route eine Quelle hat. */
}

export type CostSnapshotRepositoryFactory = (subjectUserId: string) => CostSnapshotRepository;
export const COST_SNAPSHOT_REPOSITORY_FACTORY = "COST_SNAPSHOT_REPOSITORY_FACTORY";
```

**Commit:**

```bash
git add apps/api/src/modules/costs/application/cost-snapshot-repository.port.ts \
        apps/api/src/modules/costs/index.ts
git diff --cached --name-only
git commit -m "feat(costs): EYT-109 — Port des Snapshot-Repositories"
```

---

## Task 10: Costs — Use-Case `CreateCostSnapshot`

**Dateien:**
- Erstellen: `apps/api/src/modules/costs/application/create-cost-snapshot.use-case.ts`
- Test: `apps/api/test/costs/create-cost-snapshot.use-case.test.ts` (neu)

**Schritt 1: Roten Test schreiben**

Mit gestellten Ports (Fakten, Sätze, Repository) — kein NestJS, keine Datenbank:

1. Erfolg: Fakten + Sätze → Repository bekommt Header und Positionen **in einem** Aufruf.
2. `PLAN_NOT_PUBLISHED` → Repository wird **nie** aufgerufen (`expect(repo.create).not.toHaveBeenCalled()`).
3. `RATE_MISSING` → Repository wird **nie** aufgerufen; Ergebnis nennt `employeeId` und `localDate`.
4. `RATE_AMBIGUOUS` → dito.
5. Baustellenfilter auf eine **fremde** Baustelle → `WORKSITE_NOT_IN_ORG`, kein Schreiben.
6. Baustellenfilter auf eine eigene Baustelle → nur deren Positionen im Ergebnis.
7. Der Use-Case liest **nirgends** die Uhr: `computedAt` wird hineingereicht, zwei Läufe mit
   derselben Eingabe ergeben dieselben Positionen.

**Schritt 2: Rot bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/create-cost-snapshot.use-case.test.ts
```

**Schritt 3: Implementieren**

Ablauf, in dieser Reihenfolge:

1. Fakten der Planversion holen (`publishedFactsForVersion`). Nicht veröffentlicht / nicht
   gefunden → sofort blockieren.
2. Baustellenfilter, falls gesetzt, gegen die Baustellen der Fakten prüfen →
   `WORKSITE_NOT_IN_ORG`. Fakten kommen bereits RLS-gefiltert, das ist die zweite,
   anwendungsseitige Hälfte.
3. Sätze aller beteiligten Mitarbeitenden über `RateRepository.versionsFor` laden.
4. `assembleSnapshot(...)` (Task 5). Blockiert → **kein** Schreiben.
5. Summen bilden (`bigint`), Tagessummen je `(localDate, worksiteId)`.
6. `repository.create(...)` — eine Transaktion.

**Schritt 4: Grün bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/create-cost-snapshot.use-case.test.ts
```

**Schritt 5: Committen**

```bash
git add apps/api/src/modules/costs/application/create-cost-snapshot.use-case.ts \
        apps/api/test/costs/create-cost-snapshot.use-case.test.ts apps/api/src/modules/costs/index.ts
git diff --cached --name-only
git commit -m "feat(costs): EYT-109 — Snapshot-Command blockiert vor jedem Schreiben"
```

---

## Task 11: Costs — PostgreSQL-Repository

**Dateien:**
- Erstellen: `apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts`
- Ändern: `apps/api/src/modules/costs/index.ts`
- Test: `apps/api/test/costs/cost-snapshot.integration.test.ts` (neu)

**Schritt 1: Roten Integrationstest schreiben**

Gegen die reale Datenbank, `EASYTREE_TENANT_TESTS`-konform, mit greppbarer Zeile
`[cost-snapshot] mode=… executed=… skipped=0`. Fälle:

1. **Persistenz:** `create` schreibt Header und alle Positionen; ein anschließendes `read` liefert
   exakt dieselben IDs, Beträge und die Reihenfolge nach `ordinal`.
2. **Atomarität:** ein Fehler bei der letzten Position (z. B. `rate_version_id` eines fremden
   Mandanten → FK 23503) hinterlässt **keinen** Header. Nach dem Fehlversuch Zustand prüfen —
   `select count(*) from public.cost_snapshots` über die **Beobachterverbindung** (`postgres`).
3. **Unveränderlichkeit, gemessen doppelt:**
   - Verhalten: `update public.cost_snapshots set total_minor_units = 0` als `easytree_app` mit
     gesetztem Kontext → Fehler.
   - Struktur: `select has_table_privilege('authenticated','public.cost_snapshots','UPDATE')`
     und `… 'DELETE'` sind `false`, ebenso für die Positionen.
     (`42501` allein ist mehrdeutig — Spaltenrecht **oder** RLS. Beide Aussagen nötig.)
4. **Cross-Tenant:** ein Subjekt von Mandant B liest den Snapshot von Mandant A nicht — `read`
   liefert `NOT_FOUND`, und eine rohe Zählung über die Beobachterverbindung zeigt, dass die Zeile
   existiert. Ohne die zweite Hälfte wäre „nicht sichtbar“ von „nicht vorhanden“ nicht zu trennen.
5. **Mitarbeiterrolle:** ein Subjekt mit Rolle `member` bekommt beim `read` nichts und beim
   `create` einen Fehler — beide Male, obwohl es Mitglied derselben Organisation ist.
6. **Idempotenz:** zweimal derselbe Schlüssel + dieselbe Nutzlast → **eine** Zeile, dieselbe ID.
   Derselbe Schlüssel + andere Nutzlast → `IDEMPOTENCY_KEY_REUSED`, **keine** zweite Zeile.
7. **Kanalgrenze positiv:** derselbe `insert` über eine Verbindung, die **nicht** als
   `easytree_app` angemeldet ist (z. B. `postgres` mit `set local role authenticated` und
   gesetzten Claims), wird abgelehnt. Das ist der Nachweis, den pgTAP nicht führen kann
   (`SET SESSION AUTHORIZATION` braucht Superuser).

**Schritt 2: Rot bestätigen**

```bash
EASYTREE_TENANT_TESTS=required \
  pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot.integration.test.ts
```

**Schritt 3: Implementieren**

Vorlage: `rate-repository.pg.ts`. Wichtige Punkte:

- **Kein** `pg`-Import; nur `TenantQuery` / `TenantQueryRunner`.
- `create` in **einer** `run(...)`-Transaktion:
  1. `idempotenz.lock(tx, "costs.create_cost_snapshot", key)`,
  2. `idempotenz.find(...)` → Replay mit Fingerabdruckvergleich,
  3. Header `insert … returning id`,
  4. Positionen als **ein** `insert … select * from unnest($1::uuid[], …)` — ein Statement statt
     N Roundtrips,
  5. `idempotenz.remember(...)` mit `subjectId = snapshotId`.
- Beträge und Dauern reisen als **String** (`::text`), nie als `number`.
- `rowCount === 0` beim Header ist **nicht** „nichts zu tun“, sondern die Kanalgrenze oder eine
  Policy → `WRITE_CHANNEL_REJECTED` mit klarer Meldung (dieselbe Bauart wie
  `planning-write.repository.ts` beim Publish).
- `read` selektiert **nur** aus `cost_snapshots` und `cost_snapshot_positions`. Kein Join auf
  `employee_rate_versions`, kein Zugriff auf Planungstabellen. Das ist D7 und wird von
  `costs-touches-only-own-tables` zusätzlich abgesichert.

**Schritt 4: Grün bestätigen**

```bash
EASYTREE_TENANT_TESTS=required \
  pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot.integration.test.ts
pnpm --filter @easytree/api exec vitest run test/costs-module-boundaries.test.ts
```

**Schritt 5: Committen**

```bash
git add apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts \
        apps/api/src/modules/costs/index.ts apps/api/test/costs/cost-snapshot.integration.test.ts
git diff --cached --name-only
git commit -m "feat(costs): EYT-109 — Snapshot atomar schreiben und unveraendert lesen"
```

---

## Task 12: pgTAP — Schema, Rechte und Policies

**Dateien:**
- Erstellen: `supabase/tests/0013_cost_snapshots.sql`

**Schritt 1: Test schreiben**

Prüft strukturell, was der Integrationstest verhaltensbezogen prüft — beide zusammen, weil `42501`
mehrdeutig ist:

- Tabellen existieren, `rowsecurity` und `relforcerowsecurity` sind `true`;
- `has_table_privilege('authenticated', …, 'UPDATE')` und `'DELETE'` sind **false** für beide
  Tabellen;
- `has_table_privilege('anon', …, 'SELECT')` ist **false**;
- `has_column_privilege('authenticated', 'public.cost_snapshots', 'id', 'INSERT')` ist **false**
  (Server vergibt die ID);
- die vier Policies existieren, und die beiden `insert`-Policies enthalten
  `app.is_runtime_channel()` (`pg_policies.with_check` per `like` prüfen);
- die zusammengesetzten FKs existieren (`pg_constraint`), insbesondere
  `(snapshot_id, org_id) -> cost_snapshots (id, org_id)`.

> pgTAP läuft als `postgres` und kann `session_user` nicht wechseln. Die **positive**
> Kanalzusicherung („als `easytree_app` geht es“) steht deshalb ausschließlich im
> Integrationstest aus Task 11. Hier nur die negative Richtung und die Struktur — und der
> Dateikopf sagt das ausdrücklich, damit niemand die Lücke später für Abdeckung hält.

**Schritt 2: Ausführen (nur mit Docker)**

```bash
pnpm exec supabase db reset && pnpm exec supabase test db
```

Ohne Docker: **nicht** grün behaupten. Der Nachweis kommt aus `db-gates`.

**Schritt 3: Gegenmutation der Metagate-Bindung messen**

Der Meta-Gate-Test aus `0005` muss die neuen Tabellen **fordern**. Zum Beweis den Eintrag für
`cost_snapshots` in `expected_tables` kurz auskommentieren, `supabase test db` laufen lassen — die
Suite muss rot werden und die Tabelle **namentlich** melden. Danach zurücknehmen.

> **Sicherungskopie statt `git checkout --`:** die Datei ist committet, ein `checkout` stellt den
> Commit-Stand her und kann uncommittete Nachbararbeit verlieren. `cp datei datei.bak` vorher.

**Schritt 4: Committen**

```bash
git add supabase/tests/0013_cost_snapshots.sql
git diff --cached --name-only
git commit -m "test(db): EYT-109 — Rechte, Policies und Kanalbedingung der Snapshot-Tabellen zusichern"
```

---

## Task 13: API — Routen und Verdrahtung

**Dateien:**
- Ändern: `apps/api/src/modules/costs/interface/http/costs.controller.ts`
- Ändern: `apps/api/src/modules/costs/interface/http/costs-error-type.ts`
- Ändern: `apps/api/src/app.module.ts`
- Test: `apps/api/test/costs/snapshot-http.test.ts` (neu)

**Schritt 1: Roten Test schreiben**

Nest-Testmodul mit überschriebenen Tokens (Identität, Mitgliedschaften, Repositories) —
Muster: `apps/api/test/costs/cost-access-audit.http.test.ts`.

1. `POST /kosten/snapshots` **ohne** `costs.calculate`, aber **mit** `costs.read` → 403, und der
   Use-Case wird **nie** aufgerufen. (Die beiden Rechte werden nicht gleichgesetzt.)
2. `GET /kosten/snapshots/{id}` **ohne** `costs.read` → 403.
3. `POST` ohne Idempotenzschlüssel → 409 mit stabilem URN, **keine** Ausführung.
4. `POST` mit `organisationId` im Body → 400 (`strictObject`).
5. `RATE_MISSING` → RFC-7807 mit Typ-URN, `employeeId`, `localDate` — und **ohne** Betrag,
   **ohne** Stundensatz.
6. Jede der drei Routen erzeugt genau ein `cost.access.decision`-Ereignis mit Korrelations-ID,
   erlaubt wie abgelehnt.
7. Antwortkörper werden gegen `CostSnapshotSchema` geparst.

**Schritt 2: Rot bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts
```

**Schritt 3: Implementieren**

Drei Methoden am vorhandenen `CostsController`, jede über `this.zugang(...)` mit dem passenden
Recht und einer eigenen Routenbezeichnung für das Protokoll:

```ts
@Get("planversionen")   // costs.read      "GET /kosten/planversionen"
@Post("snapshots")      // costs.calculate "POST /kosten/snapshots"
@Get("snapshots/:snapshotId") // costs.read "GET /kosten/snapshots/{snapshotId}"
```

`zugang()` gibt heute `{ repository, organisationId, subjectUserId }` zurück und ist auf
`RateRepository` festgelegt. Sie wird so erweitert, dass sie zusätzlich das Snapshot-Repository und
den Faktenport für dieses Subjekt liefert — **eine** Zugangskette bleibt, keine zweite.

`costs-error-type.ts` um die neuen stabilen URNs erweitern: `RATE_MISSING`, `RATE_AMBIGUOUS`,
`PLAN_NOT_PUBLISHED`, `PLAN_VERSION_NOT_FOUND`, `WORKSITE_NOT_IN_ORG`, `DAY_BOUNDARY_UNDEFINED`,
`SNAPSHOT_NOT_FOUND`, `WRITE_CHANNEL_REJECTED`.

`app.module.ts`: `COST_SNAPSHOT_REPOSITORY_FACTORY` und `PLAN_COST_FACTS_FACTORY` als Fabriken je
Subjekt registrieren (**nie** Singleton — sonst trägt die Identität der ersten Anfrage in alle
folgenden), `PlanningFactsAdapter` erstmals verdrahten.

**Schritt 4: Konformität messen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts \
  test/openapi-route-conformance.test.ts
```

Der Konformitätstest ist die Messung: eine Route ohne Vertragseintrag **und** ein Vertragseintrag
ohne Route werden beide rot. `NOT_YET_IMPLEMENTED` (heute fünf `/einsatz/`-Einträge) darf dabei
**nicht** wachsen.

**Schritt 5: Committen**

```bash
git add apps/api/src/modules/costs/interface/http/costs.controller.ts \
        apps/api/src/modules/costs/interface/http/costs-error-type.ts \
        apps/api/src/app.module.ts apps/api/test/costs/snapshot-http.test.ts
git diff --cached --name-only
git commit -m "feat(api): EYT-109 — Snapshot-Routen an die eine Zugangskette binden"
```

---

## Task 14: Immutabilitätsnachweis V1 → Snapshot → V2

**Dateien:**
- Erstellen: `apps/api/test/costs/snapshot-immutability.integration.test.ts`

Das ist der Nachweis, den EYT-108 ausdrücklich an EYT-109 delegiert hat. Er bekommt eine eigene
Datei, weil er eine eigene Aussage trägt.

**Schritt 1: Test schreiben**

```
1. veröffentlichte Planversion mit einem Einsatz anlegen
2. Satzversion V1 anlegen, wirksam am Leistungsdatum
3. Snapshot S1 erzeugen  → merken: snapshotId, positionIds, rateVersionId, Beträge, Gesamtsumme
4. prüfen: S1.positions[*].rateVersionId === V1
5. Satzversion V2 mit späterem validFrom anlegen (regulärer Ablösungspfad aus EYT-108)
6. S1 ERNEUT lesen
7. prüfen — Feld für Feld, nicht nur die Summe:
     gleiche snapshotId
     gleiche positionIds in gleicher Reihenfolge
     gleiche rateVersionId (V1, nicht V2)
     gleiche amountMinorUnits
     gleiche totalMinorUnits
     gleicher createdAt
8. zusätzlich: eine V2 anlegen, die RÜCKWIRKEND wirksam wäre — S1 bleibt trotzdem unverändert
```

Schritt 8 ist der scharfe Fall: eine nachträglich eingefügte Version, die am Leistungsdatum
gegolten hätte. Nur er unterscheidet „Snapshot“ von „Cache“.

**Schritt 2: Rot bestätigen, dann grün**

```bash
EASYTREE_TENANT_TESTS=required \
  pnpm --filter @easytree/api exec vitest run test/costs/snapshot-immutability.integration.test.ts
```

**Schritt 3: Committen**

```bash
git add apps/api/test/costs/snapshot-immutability.integration.test.ts
git diff --cached --name-only
git commit -m "test(costs): EYT-109 — spaetere Satzversion laesst einen bestehenden Snapshot unveraendert"
```

---

## Task 15: Web — `/kosten`-Ansicht

**Dateien:**
- Erstellen: `apps/web/components/kosten-ansicht.tsx`
- Ändern: `apps/web/app/kosten/page.tsx`
- Test: `apps/web/test/kosten-ansicht.test.tsx` (neu)
- Ändern: `apps/web/test/a11y.test.tsx`

**Schritt 1: Roten Test schreiben (jsdom + Testing Library)**

Ein Test je Zustand, jeder mit `data-testid`:

| Zustand | `data-testid` | Bedingung |
| --- | --- | --- |
| Laden | `kosten-laedt` | Gateway-Promise offen |
| Leer | `kosten-leer` | keine veröffentlichte Planversion im Zeitraum |
| Snapshot wird erstellt | `kosten-erzeugt` | `POST` läuft |
| Erfolg | `kosten-snapshot` | Metadaten + Positionen sichtbar |
| Satz fehlt | `kosten-satz-fehlt` | `RATE_MISSING`, nennt Person und Tag |
| Satz mehrdeutig | `kosten-satz-mehrdeutig` | `RATE_AMBIGUOUS` |
| Entwurf/nicht veröffentlicht | `kosten-nicht-veroeffentlicht` | `PLAN_NOT_PUBLISHED` |
| Forbidden | `kosten-forbidden` | über `KostenZugang`, vorhanden |
| Stale | `kosten-stale` | `STALE_VERSION` |
| Fehler | `kosten-fehler` | `UNAVAILABLE` / `CONTRACT_VIOLATION` |

Zusätzlich:

- Metadaten sichtbar: Snapshot-ID, Planversion, erzeugt am, Regelversion, Währung, autorisierter
  Benutzer (Basisdesign §5).
- Positionen zeigen Baustelle, lokalen Tag, Person, Dauer, Satzversion, Positionsbetrag.
- Tages- und Gesamtsumme sichtbar.
- **Kein** Zustand wird nur farblich vermittelt — jeder trägt Text (Basisdesign §7). Der Test
  prüft das, indem er den Text sucht, nicht die Klasse.
- **Keine** Clientberechnung: der Test stellt eine Antwort, deren `totalMinorUnits` bewusst **nicht**
  die Summe der Positionen ist, und erwartet, dass die UI den **Serverwert** anzeigt. Das ist der
  Gegenfall, der eine heimlich mitrechnende Komponente auffliegen lässt.

**Schritt 2: Rot bestätigen**

```bash
pnpm --filter @easytree/web exec vitest run test/kosten-ansicht.test.tsx
```

**Schritt 3: Implementieren**

- `KostenAnsicht` ist ein Client-Component und bekommt den `CostsGateway` aus dem Context
  (`costs-gateway-provider.tsx`). **Kein** `fetch`, **kein** Supabase-SDK
  (`no-supabase-import.test.ts` ist ein statischer Wächter).
- Primitives aus `@easytree/ui`: `Card`, `PageHeader`, `EmptyState`, `ErrorState`, `StateBanner`,
  `StatusBadge`, `PrimaryAction`.
- Beträge über `minorUnitsToEuro` aus `apps/web/lib/euro-minor-units.ts`; tabellarische Ziffern per
  CSS (Basisdesign §2.2). **Kein** `parseFloat`, **kein** `Number()` auf einem Betrag.
- Positionen als `<table>` mit `<caption>`, `scope="col"`-Headern und einer
  `<details>/<summary>`-Aufklappung je Tag (Disclosure-Semantik statt eines ARIA-Nachbaus).
- Zeitraumfilter: **zwei ISO-Wochenfelder** („Von Woche“ / „Bis Woche“), lokal in dieser
  Komponente.
  > **Bewusste Abweichung:** Basisdesign §6 listet `DateRangeControl` in `packages/ui`. Dieses
  > Primitive gehört zu **EYT-80** und arbeitet auf Kalenderdaten, nicht auf ISO-Wochen. Hier unter
  > demselben Namen ein Wochenpaar zu bauen, wäre ein falsch benanntes Primitive, das EYT-80
  > später wegwerfen müsste. Der Filter bleibt deshalb lokal. Als `DOC_DRIFT` melden.
- Idempotenzschlüssel: `crypto.randomUUID()` **je Auslösung**, nicht je Render — sonst erzeugt ein
  Re-Render bei einem Retry einen zweiten Snapshot.
- Nach Erfolg wird die Snapshot-ID in die URL geschrieben (`?snapshot=<id>`), damit **Reload** und
  ein **zweiter Browserkontext** denselben Snapshot laden — über `GET`, nicht über eine neue
  Berechnung. Das ist die UI-Hälfte von D7.

`app/kosten/page.tsx`: den Leerzustands-`Card` durch `<KostenAnsicht />` innerhalb von
`<KostenZugang>` ersetzen. Der Link zur Stundensatzverwaltung bleibt.

**Schritt 4: Grün bestätigen, inklusive Barrierefreiheit**

```bash
pnpm --filter @easytree/web exec vitest run test/kosten-ansicht.test.tsx test/a11y.test.tsx
```

**Schritt 5: Committen**

```bash
git add apps/web/components/kosten-ansicht.tsx apps/web/app/kosten/page.tsx \
        apps/web/test/kosten-ansicht.test.tsx apps/web/test/a11y.test.tsx
git diff --cached --name-only
git commit -m "feat(web): EYT-109 — /kosten liest den gespeicherten Snapshot"
```

---

## Task 16: Web — Gateway-Verdrahtung

**Dateien:**
- Ändern: `apps/web/lib/costs-gateway-factory.ts` (nur falls nötig)
- Test: `apps/web/test/costs-gateway-factory.test.ts` (neu oder vorhanden erweitern)

Der Test muss **dieselbe** Funktion aufrufen, die auch `app/providers.tsx` benutzt. Ein Test, der
sein eigenes Gateway baut, bliebe grün, was immer `providers.tsx` tut — genau dieser Fehler ist im
Repository schon einmal aufgetreten und ist in `CLAUDE.md` festgehalten.

```bash
pnpm --filter @easytree/web exec vitest run test/costs-gateway-factory.test.ts
git add apps/web/lib/costs-gateway-factory.ts apps/web/test/costs-gateway-factory.test.ts
git diff --cached --name-only
git commit -m "test(web): EYT-109 — Snapshot-Pfad geht durch dieselbe Gateway-Fabrik wie die Produktion"
```

---

## Task 17: Browser-E2E — die echte Reise

**Dateien:**
- Ändern: `apps/web/e2e/auth-journey/journey.pwtest.ts`
- Ändern: `apps/web/e2e/auth-journey/fixtures.sql`
- Ändern: `apps/web/e2e/auth-journey/teardown.sql`

`auth-journey` ist der **einzige** Job, der Identität beweist (echte GoTrue-Anmeldung, echte
HttpOnly-Cookies, zweiter Browserkontext). `read-through` ersetzt das Subjekt in seinem Harness und
taugt hier **nicht** als Nachweis. Die Kostenreise gehört deshalb in `auth-journey`.

**Schritt 1: Fixtures erweitern**

`fixtures.sql`: eine Baustelle, eine beschäftigte Person, eine **veröffentlichte** Planversion mit
mindestens zwei Zuweisungen (eine davon über die lokale Mitternacht) und eine Stundensatzversion
V1. Feste UUID v4 — `IdSchema` lehnt andere Formen ab (EYT-91).

`teardown.sql` um die neuen Tabellen erweitern und den Marker
`[auth-journey-teardown] … restzeilen=0` beibehalten. Der CI-Schritt fährt ihn **zweimal**; beide
Läufe müssen `restzeilen=0` melden.

**Schritt 2: Reise erweitern**

```
 1. echte Anmeldung als berechtigte Person (Rolle manager oder owner)
 2. /kosten ist erreichbar und zeigt keine Beträge, bevor ein Snapshot existiert
 3. Zeitraum wählen → die veröffentlichte Planversion erscheint in der Auswahl
 4. „Snapshot erzeugen" → Zustand „wird erstellt" → Erfolg
 5. PostgreSQL prüfen (Beobachterverbindung): 1 Zeile in cost_snapshots,
    N Zeilen in cost_snapshot_positions, Summe == angezeigte Gesamtsumme
 6. UI zeigt Snapshot-ID, Planversion, erzeugt am, Regelversion, Währung
 7. Reload → gleiche Snapshot-ID, gleiche Positions-IDs, gleiche Summen
 8. zweiter Browserkontext, gleiche Person → gleiche IDs und Summen
 9. Abmelden, als Person mit Rolle `member` anmelden:
      /kosten zeigt Forbidden, kein Betrag im DOM,
      direkter GET auf /api/v1/kosten/snapshots/{id} liefert 403
10. Satzversion V2 anlegen (über die reale Route, mit costs.manage_rates)
11. Snapshot erneut lesen → identische Positionen, identische Beträge, V1
```

Schritt 9 prüft **beides**: die Route **und** den DOM. Ein Forbidden-Banner über einem versteckten
`<table>` mit Beträgen wäre kein Schutz.

**Schritt 3: Lokal fahren, falls möglich**

```bash
pnpm exec supabase start -x studio && pnpm exec supabase db reset
pnpm --filter @easytree/api... build
EASYTREE_API_PROXY_TARGET="http://127.0.0.1:3101" pnpm --filter @easytree/web... build
pnpm --filter @easytree/web exec playwright test -c e2e/auth-journey/config.ts
```

Ohne Docker: **nicht** grün behaupten. Der Nachweis kommt aus dem `auth-journey`-Job.

**Schritt 4: Committen**

```bash
git add apps/web/e2e/auth-journey/journey.pwtest.ts apps/web/e2e/auth-journey/fixtures.sql \
        apps/web/e2e/auth-journey/teardown.sql
git diff --cached --name-only
git commit -m "test(e2e): EYT-109 — echte Kostenreise mit Reload, zweitem Kontext und Mitarbeiterablehnung"
```

---

## Task 18: CI — neue Nachweise in bestehende Jobs

**Dateien:**
- Ändern: `.github/workflows/ci.yml`

**Keine neuen Required Checks.** Ein neuer Job würde die Branch-Protection-Liste in
`scripts/setup-branch-protection.sh` **und** die zweite, unabhängige Liste in
`scripts/verify-branch-protection.sh` erzwingen, und ohne Admin-Reapply bliebe er optional —
genau die Falle, in die `read-through` gelaufen ist.

**Schritt 1: `db-gates` um drei Schritte erweitern**

Nach dem vorhandenen `rate-succession`-Schritt, in derselben Form (mit `EASYTREE_TENANT_TESTS:
required`, `tee` in eine Logdatei und einer erzwungenen Markerzeile):

```yaml
      - name: Planungslesungen fuer veroeffentlichte Staende (EYT-109)
        env:
          EASYTREE_TENANT_TESTS: required
        run: |
          pnpm --filter @easytree/api exec vitest run test/planning-published-reads.integration.test.ts 2>&1 \
            | tee /tmp/planning-published-reads.log
          grep -q '\[planning-published-reads\] mode=required .* skipped=0' /tmp/planning-published-reads.log

      - name: Kosten-Snapshot: Persistenz, Rechte, Kanal (EYT-109)
        env:
          EASYTREE_TENANT_TESTS: required
        run: |
          pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot.integration.test.ts 2>&1 \
            | tee /tmp/cost-snapshot.log
          grep -q '\[cost-snapshot\] mode=required .* skipped=0' /tmp/cost-snapshot.log

      - name: Kosten-Snapshot: Immutabilitaet ueber Satzversionen (EYT-109)
        env:
          EASYTREE_TENANT_TESTS: required
        run: |
          pnpm --filter @easytree/api exec vitest run test/costs/snapshot-immutability.integration.test.ts 2>&1 \
            | tee /tmp/snapshot-immutability.log
          grep -q '\[snapshot-immutability\] mode=required .* skipped=0' /tmp/snapshot-immutability.log
```

> `grep -q` steht **allein**, nichts wird dahinter gepipt. Ein `cmd | grep x | head` liefert den
> Exit-Code von `head` und ist immer `0` — die Prüfung wäre wirkungslos.

**Schritt 2: Schrittweise Gegenmutation der Markerprüfung**

Einen Marker im Testcode absichtlich verfälschen (z. B. `skipped=1` drucken), Schritt lokal
nachstellen und belegen, dass `grep -q` fehlschlägt. Danach zurücknehmen.

**Schritt 3: Wächter der Branch-Protection prüfen**

```bash
grep -c "^  [a-z-]*:" .github/workflows/ci.yml   # Jobanzahl unveraendert: 11
bash scripts/verify-branch-protection.sh || true
```

Die Jobzahl darf sich **nicht** ändern. Ändert sie sich doch, müssen **beide** Listen in
`setup-branch-protection.sh` und `verify-branch-protection.sh` mitwachsen, sonst bricht `verify`
mit einem internen Driftfehler ab statt den realen Zustand zu melden.

**Schritt 4: Committen**

```bash
git add .github/workflows/ci.yml
git diff --cached --name-only
git commit -m "ci: EYT-109 — Snapshot-Nachweise in db-gates, keine neuen Pflichtchecks"
```

---

## Task 19: Gegenmutationen — jede einzeln ausgeführt und gemessen

**Wichtig:** Eine Gegenmutation zählt nur, wenn sie **eingespielt**, der benannte Zieltest
**ausgeführt** und rot **beobachtet** wurde. „Hätte gefeuert“ ist kein Nachweis; das ist in diesem
Projekt schon zweimal schiefgegangen.

**Vorgehen je Mutation, ohne Ausnahme:**

```bash
# Wegwerf-Branch, damit die Historie des Feature-PR sauber bleibt
git switch -c gm/eyt-109-<n>
# … Mutation einspielen …
<Zielkommando>            # MUSS rot sein — Ausgabe in die Evidenzakte kopieren
git switch feat/eyt-109-daily-plan-cost-snapshot
git branch -D gm/eyt-109-<n>
git status --short        # muss leer sein
```

| # | Mutation (konkret) | Zieltest | Kommando |
| --- | --- | --- | --- |
| GM1 | In `planning-window.repository.ts::publishedAssignments` die Bedingung `and published_at is not null` entfernen | „lehnt eine Entwurfsversion ab“ | `EASYTREE_TENANT_TESTS=required pnpm --filter @easytree/api exec vitest run test/planning-published-reads.integration.test.ts` |
| GM2 | In `costs.controller.ts` bei `POST /kosten/snapshots` das Recht von `costs.calculate` auf `costs.read` ändern | „ohne costs.calculate keine Erzeugung“ | `pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts` |
| GM3 | Im Use-Case die Baustellenprüfung `WORKSITE_NOT_IN_ORG` entfernen **und** in Migration 0018 den mandantengebundenen FK auf `worksites` durch einen einspaltigen ersetzen | „fremde Baustelle abgelehnt“ + Cross-Tenant-Fall | `pnpm --filter @easytree/api exec vitest run test/costs/create-cost-snapshot.use-case.test.ts` und der Integrationstest |
| GM4 | In `cost-snapshot-assembly.ts` `effectiveRateVersion(...)` durch „nimm die Version mit dem größten `validFrom`“ ersetzen | „waehlt die am Leistungsdatum wirksame Version, nicht die neueste“ | `pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-assembly.test.ts` |
| GM5 | In `cost-snapshot-repository.pg.ts::read` die Positionen nicht lesen, sondern aus aktuellen Sätzen neu berechnen | Immutabilitätstest, Schritt 7 | `EASYTREE_TENANT_TESTS=required pnpm --filter @easytree/api exec vitest run test/costs/snapshot-immutability.integration.test.ts` |
| GM6 | In `local-day-allocation.ts` `utcInstantOfLocalWallTime` durch UTC-Mitternacht ersetzen | „ordnet einer UTC-Zuordnung widersprechend dem ORTSTAG zu“ + Summenerhaltung | `pnpm --filter @easytree/domain exec vitest run test/local-day-allocation.test.ts test/local-day-allocation.property.test.ts` |
| GM7 | In `cost-snapshot-assembly.ts` `costOfDuration` durch `Math.round(satz * ms / 3_600_000)` ersetzen | Rundungsfall mit exaktem Halbwert | `pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-assembly.test.ts` |
| GM8 | In Migration 0018 `app.is_runtime_channel()` aus **beiden** insert-Policies entfernen | Kanalgrenze positiv/negativ (Task 11 Fall 7, Task 12 Policy-Assertion) | `pnpm exec supabase db reset && pnpm exec supabase test db` und der Integrationstest |
| GM9 | In Migration 0018 `grant update … to authenticated` ergänzen | „kein UPDATE-Recht“ (Verhalten **und** `has_table_privilege`) | wie GM8 |

**GM8 und GM9 brauchen einen laufenden Stack.** Ist auf der Maschine kein Docker verfügbar, werden
sie auf einem Wegwerf-PR gegen die CI gefahren (`db-gates` muss rot werden und den Grund nennen).
Der Wegwerf-PR wird **ohne Merge geschlossen**; sein Lauf wird mit URL in der Tabelle des
Abschlusspakets zitiert.

**Ergebnis festhalten** in `docs/reviews/2026-08-08-eyt-109-gegenmutationen.md`: je Zeile Mutation,
Branch/SHA, Lauf-URL oder lokale Ausgabe, Zieltest, beobachtetes Ergebnis.

```bash
git add docs/reviews/2026-08-08-eyt-109-gegenmutationen.md
git diff --cached --name-only
git commit -m "docs(review): EYT-109 — Evidenzakte der neun Gegenmutationen"
```

---

## Task 20: Vollständiger Gate-Lauf, Dokumentation, PR

**Schritt 1: Alle lokal möglichen Gates lesen, nicht nur laufen lassen**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`vitest` allein genügt nicht — ein Typfehler in einer Testdatei fällt erst unter `tsc` auf. Die
Ausgabe **lesen**, dann erst pushen.

**Schritt 2: Dokumentation nachziehen**

- `docs/runbooks/planning-publish.md`: Abschnitt ergänzen, dass die Kanalgrenze jetzt auch für
  `cost_snapshots` gilt und dass ein Wechsel auf den Supavisor-Pooler das Erzeugen von Snapshots
  ebenfalls bricht — laut, nicht still.
- `CLAUDE.md`: die Migrationsanzahl, die Tabellenliste und der Satz „`costs` ist heute eine Grenze,
  kein laufendes Feature“ sind nach diesem Slice **veraltet**. Korrigieren.
- `docs/traceability/REQUIREMENT_TO_JIRA_v1.3.csv`: EYT-109 auf die neuen Artefakte zeigen lassen.

**Schritt 3: Pushen und PR öffnen**

```bash
git push -u origin feat/eyt-109-daily-plan-cost-snapshot
gh pr create --base master --title "feat: EYT-109 — täglicher Plan-Personalkosten-Snapshot (PostgreSQL → API → /kosten)" --body-file <(cat <<'MD'
… (Gliederung siehe unten)
MD
)
```

**Kein Merge. Kein Auto-Merge.**

PR-Body-Gliederung: User Value · Architektur · DB-Schema · Source of Truth · Authorization ·
Snapshot-Immutabilität · Zeit-/DST-Regeln · Money-/Rate-Regeln (**einschließlich D1**) · reale
E2E-Reise · Gegenmutationen (Tabelle mit Lauf-URLs) · Tests · Rollback · offene Risiken ·
Out of Scope.

**Schritt 4: CI auf dem finalen Head abwarten**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 3600
```

Exit 0 = alle Läufe grün. Kein handgeschriebener Poll-Loop.

**Schritt 5: Jira-Kommentar (optional) und Abschlusspaket**

Kommentar an EYT-109 mit PR-Nummer, Head-SHA, implementiertem Slice, CI-Status und offenen Punkten.
**Nicht** auf *Fertig*. EYT-110 **nicht** anfassen.

> **Externe Mutation:** Kommentar erst verfassen, dann **erneut lesen**, dann senden. Ein
> Entwurfsfragment in einem Jira-Kommentar ist hier schon einmal passiert.

Dann das Abschlusspaket in der vom Auftrag vorgegebenen Form (22 Abschnitte,
`READY_FOR_PO_REVIEW` oder `BLOCKED`, mit `NO MERGE PERFORMED`, `EYT-109 NOT MOVED TO DONE`,
`EYT-110 NOT STARTED`) — und **STOP**.

---

## Anhang A: Erwartete Dateiliste

**Neu (17):**

```
supabase/migrations/<ts>_0018_cost_snapshots.sql
supabase/tests/0013_cost_snapshots.sql
packages/domain/src/local-day-allocation.ts
packages/domain/test/local-day-allocation.test.ts
packages/domain/test/local-day-allocation.property.test.ts
packages/contracts/test/costs-snapshot-schemas.test.ts
apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts
apps/api/src/modules/costs/application/cost-snapshot-repository.port.ts
apps/api/src/modules/costs/application/create-cost-snapshot.use-case.ts
apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
apps/api/test/costs/cost-snapshot-assembly.test.ts
apps/api/test/costs/create-cost-snapshot.use-case.test.ts
apps/api/test/costs/cost-snapshot.integration.test.ts
apps/api/test/costs/snapshot-immutability.integration.test.ts
apps/api/test/costs/snapshot-http.test.ts
apps/api/test/costs/planning-facts.adapter.test.ts
apps/api/test/planning-published-reads.integration.test.ts
apps/web/components/kosten-ansicht.tsx
apps/web/test/kosten-ansicht.test.tsx
docs/reviews/2026-08-08-eyt-109-gegenmutationen.md
```

**Geändert (≈20):**

```
packages/domain/src/local-business-date.ts, index.ts
packages/domain/test/local-business-date.test.ts
packages/contracts/src/costs/schemas.ts, costs/gateway.ts, http/costs-gateway.ts,
  openapi/document.ts, index.ts, openapi/v1.json (generiert)
packages/contracts/test/iso-week-key.test.ts   (STELLEN 6 und 7 — Pflicht, siehe Task 1)
apps/web/test/rate-management.test.tsx         (zweiter Implementor von CostsGateway — Task 2)
apps/api/src/modules/planning/application/planning-queries.port.ts,
  infrastructure/planning-window.repository.ts, index.ts
apps/api/src/modules/costs/application/plan-cost-facts.port.ts,
  domain/planned-work-fact.ts, infrastructure/planning-facts.adapter.ts,
  interface/http/costs.controller.ts, interface/http/costs-error-type.ts, index.ts
apps/api/src/modules/module-catalogue.ts
apps/api/src/app.module.ts
apps/api/test/domain-invariants/registry.ts
supabase/tests/0005_schema_meta_gate.sql
apps/web/app/kosten/page.tsx, test/a11y.test.tsx
apps/web/e2e/auth-journey/journey.pwtest.ts, fixtures.sql, teardown.sql
.github/workflows/ci.yml
CLAUDE.md, docs/runbooks/planning-publish.md, docs/traceability/REQUIREMENT_TO_JIRA_v1.3.csv
```

**Nicht angefasst:** `apps/api/src/modules/costs/application/cost-export.port.ts` (EYT-110),
`packages/ui/**` (EYT-80), alle Migrationen 0001–0017, `packages/contracts/openapi/v1.json` von
Hand.

---

## Anhang B: Offene Punkte für den Ausführenden

| Kennung | Punkt | Was zu tun ist |
| --- | --- | --- |
| `SOURCE_NEEDED` | Confluence `5505026`, `7766017` (PRD v1.4), `9306113` wurden für diesen Plan nicht gelesen | Vor Task 1 lesen; Abweichungen zu Abschnitt 0/2 melden, nicht still einarbeiten |
| `SOURCE_NEEDED` | Zone mit fehlender lokaler Mitternacht | In Task 4 Schritt 2 messen; findet sich keine, Testfall entfernen und den ungetesteten Fehlerzweig ausweisen |
| `DOC_DRIFT` | Zwei Satzauswahlen mit unterschiedlicher Intervallsemantik (D1) | Folgeticket vorschlagen; in diesem Slice nur einfrieren, nicht vereinheitlichen |
| `DOC_DRIFT` | `DateRangeControl` aus Basisdesign §6 wird hier bewusst nicht gebaut | Im PR-Body und im Abschlusspaket benennen; gehört zu EYT-80 |
| `DOC_DRIFT` | Basisdesign §5 nennt „Als Excel exportieren“ als primäre Aktion auf `/kosten` | Gehört zu EYT-110; Abweichung benennen |
| `DOC_DRIFT` | `CLAUDE.md` sagt „`costs` ist eine Grenze, kein laufendes Feature“ und nennt 12 Migrationen | Nach Task 20 korrigieren |
| `UNVERIFIED` | Migration 0017 in der produktiven DB angewendet? | **Nicht** behaupten. Für diesen Slice irrelevant — 0018 wird ausschließlich lokal und in CI gemessen |
| `ASSUMPTION` | Mehrere Snapshots je Planversion zulässig (D3) | Im PR-Body als Annahme ausweisen; PO entscheidet |

### Korrekturen am Plan, gemessen während der Ausführung

Der Plan lag an drei Stellen falsch. Die Korrekturen stehen bei den betroffenen Tasks; hier
gesammelt, damit sie nicht übersehen werden.

| Datum | Planaussage | Gemessen |
| --- | --- | --- |
| 08.08.2026 | „`WeekKeySchema` aus `../planning/schemas.js`" (Task 1) | Existiert nicht. Heißt **`IsoWeekKeySchema`**, `planning/schemas.ts:104`. Zusätzlich unerwähnt geblieben: die Registrierungspflicht in `STELLEN` (`test/iso-week-key.test.ts`). Ohne sie bleibt die Kalenderregel unbewiesen — gemessen blieben alle 125 Tests grün, während `.refine(isValidIsoWeekKey)` aus den Kostenschemata verschwand. |
| 08.08.2026 | „Der Drift-Test wird rot, sobald ein Schema hinzukommt" (Task 2) | Falsch. `openapi/document.ts:62-94` ist ein handgeschriebenes `NAMED_SCHEMAS`-Register (24 Einträge). Ein unregistriertes Schema erreicht `v1.json` nie; `git diff` darauf ist nach Task 1 leer, Drift-Test grün. Task 2 muss Register **und** Pfade eintragen. |
| 08.08.2026 | Task-2-Dateiliste | Unvollständig. `apps/web/test/rate-management.test.tsx:86` deklariert `gatewayMit` als `CostsGateway` und ist nach Task 1 strukturell unvollständig (TS2739). `apps/web/lib/costs-gateway-factory.ts:13` ebenfalls rot, klärt sich aber mit `HttpCostsGateway` von selbst. Vollständige Implementorenliste gemessen: genau diese beiden plus `HttpCostsGateway`. |
