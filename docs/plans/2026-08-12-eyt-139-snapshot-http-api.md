# EYT-139 — Snapshot-HTTP-API und Fehlerabbildung: Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `POST /api/v1/kosten/snapshots` und `GET /api/v1/kosten/snapshots/{snapshotId}` an die eine
bestehende Zugangskette binden, sodass ein berechtigter Nutzer über die reale API aus einer
veröffentlichten Planversion einen unveränderlichen Personalkosten-Snapshot erzeugen und denselben
gespeicherten Snapshot wieder lesen kann.

**Architecture:** Beide Routen hängen am vorhandenen `CostsController` und laufen durch dessen
private Methode `zugang(...)` — Identität → Mitgliedschaften → `CostAccessPolicy` → Protokoll. Die
dort **serverseitig aufgelöste** Organisation wird unverändert an `PLAN_COST_FACTS_FACTORY`
weitergereicht; der Use-Case `createCostSnapshot` orchestriert, `PgCostSnapshotRepository`
schreibt und liest zurück. Die HTTP-Antwort entsteht **ausschliesslich** aus dem zurückgelesenen
`StoredCostSnapshot`; `days` wird an der HTTP-Naht deterministisch aus den **gespeicherten**
Positionen gruppiert. Beträge und Dauern reisen durchgehend als `bigint` → `String`, nie über
`number`.

**Tech Stack:** NestJS 11 (SWC, Legacy-Decorators), Zod-abgeleitete Contracts
(`@easytree/contracts`), Vitest + supertest, PostgreSQL/Supabase mit RLS, pnpm/Turborepo.

---

## 0. Verifizierter Ausgangsstand (gemessen 12.08.2026)

| Größe                                   | Wert                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| PR                                      | `#69 — EYT-109: daily personnel cost snapshot`, **Draft**, `mergeable: MERGEABLE`                        |
| Branch                                  | `feat/eyt-109-daily-plan-cost-snapshot`                                                                  |
| Head (lokal == `origin`)                | `b8a96a944363eff47418417f94605385dc44ebf0` — **entspricht exakt dem erwarteten Head, kein `HEAD_DRIFT`** |
| Base (merge-base gegen `origin/master`) | `b44e38c6bf7e08a2996c2263309001a1304050f2`                                                               |
| ahead/behind gegen `origin/master`      | `0 behind / 44 ahead`                                                                                    |

Reproduktion (der erste Schritt jeder Session, siehe Task 0):

```bash
git fetch --all --prune
gh pr view 69 --json number,headRefName,headRefOid,baseRefName,isDraft,state
git merge-base origin/master origin/feat/eyt-109-daily-plan-cost-snapshot
git rev-list --left-right --count origin/master...origin/feat/eyt-109-daily-plan-cost-snapshot
```

**Weicht `headRefOid` von `b8a96a9…` ab: keine Implementierung beginnen, Drift rekonstruieren,
`HEAD_DRIFT` melden.**

### Was bereits steht und NICHT neu gebaut wird

| Baustein                 | Datei                                                                              | Zustand                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Vertrag Request/Response | `packages/contracts/src/costs/schemas.ts`                                          | `CreateCostSnapshotCommandSchema`, `CostSnapshotSchema`, `CostPositionDtoSchema`, `CostDayTotalDtoSchema` — **fertig** |
| OpenAPI-Operationen      | `packages/contracts/src/openapi/document.ts`, `packages/contracts/openapi/v1.json` | `createCostSnapshot` (201) und `getCostSnapshot` (200), je `...problemResponses` — **fertig, nicht anfassen**          |
| HTTP-Client              | `packages/contracts/src/http/costs-gateway.ts`                                     | `createSnapshot` / `snapshot`, 409 → `REJECTED` — **fertig**                                                           |
| Autorisierung            | `apps/api/src/modules/costs/application/cost-access.policy.ts`                     | `MembershipCostAccessPolicy`, Rechte `costs.read` / `costs.calculate` — **fertig**                                     |
| Zugangskette + Protokoll | `apps/api/src/modules/costs/interface/http/costs.controller.ts` (`private zugang`) | **fertig, wird erweitert**                                                                                             |
| Faktenport-Fabrik        | `apps/api/src/modules/costs/infrastructure/plan-cost-facts.factory.ts`             | `planCostFactsFactory(queriesFor)`, Organisation **pflichtig** — **fertig, in `AppModule` registriert**                |
| Use-Case                 | `apps/api/src/modules/costs/application/create-cost-snapshot.use-case.ts`          | `createCostSnapshot(deps, command)` mit `stage`-getaggter Fehlerunion — **fertig**                                     |
| Persistenz               | `apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts`         | `PgCostSnapshotRepository(runner, subjectUserId, idempotenz)` — **fertig, aber NIRGENDS registriert**                  |
| Migration                | `supabase/migrations/20260809120000_0018_cost_snapshots.sql`                       | **fertig — keine neue Migration in diesem Slice**                                                                      |

### Sechs gemessene Randbedingungen, die den Entwurf festlegen

1. **Es gibt im gesamten Vertrag kein 404 und kein 5xx.** `problemResponses` in
   `packages/contracts/src/openapi/document.ts:151` ist repoweit `{400, 401, 403, 409}` und wird in
   **alle** 18 Operationen gespreizt. Jede fachliche Ablehnung dieses Slices bekommt deshalb einen
   dieser vier Codes. Für 5xx siehe Punkt 4.
2. **`ProblemDocumentSchema` ist ein `z.strictObject`** (`packages/contracts/src/primitives.ts:59`)
   mit exakt `type,title,status,detail,correlationId`. Zusatzfelder wie `employeeId`/`localDate` im
   Problem-Dokument würden vom Client **stillschweigend verworfen**: `readProblem` in
   `packages/contracts/src/http/costs-gateway.ts` macht ein `safeParse` und gibt bei Misserfolg
   `null` zurück — der Nutzer sähe dann **gar kein** Problem-Dokument mehr.
   → **Person und Tag gehören in `detail`, nicht in eigene Felder.** (Eine ältere Fassung von
   Task 13 in `docs/plans/2026-08-08-eyt-109-tageskosten-snapshot.md:1969` forderte eigene Felder;
   das ist mit dem strikten Schema unvereinbar und wird hier korrigiert.)
3. **Nur der 409-Pfad trägt heute einen stabilen URN.** `HttpExceptionFilter`
   (`apps/api/src/common/http-exception.filter.ts`) setzt `type` **hart** auf `"about:blank"` und
   liest aus der Exception ausschliesslich `detail`. Ein
   `throw new BadRequestException({ type: …, message: … })` verliert sein `type` auf dem Weg nach
   draussen — genau das passiert heute schon bei `ORG_CONTEXT_REQUIRED`. Der einzige Pfad, der einen
   URN durchreicht, ist `ConflictProblem` → `CostsProblemFilter` (`@Catch(ConflictProblem)`).
   → Dieser Slice führt eine zweite Ausnahme `CostsProblem` mit **eigenem Statuscode** ein und
   erweitert den vorhandenen Filter. Bestehendes Verhalten der EYT-108-Routen bleibt **unverändert**;
   `ConflictProblem` wird nicht angefasst.
4. **5xx ist auf diesen Routen erwartbar, auch ohne Eintrag im Dokument.**
   `HttpCostsGateway.send` behandelt `status >= 500` ausdrücklich als `UNAVAILABLE`. Ein
   `WRITE_CHANNEL_REJECTED` (die Verbindung war nicht der Laufzeitkanal) ist ein Betriebsfehler und
   kein Aufruferfehler; er wird deshalb **500** mit stabilem URN. Das ist keine Vertragsänderung —
   das Dokument zählt für **keine** Operation 5xx auf, und der Client behandelt es trotzdem.
5. **Tests dürfen NICHT tief ins Kostenmodul greifen — auch Tests nicht.** Gemessen bei der
   Ausführung von Task 1: ein Import auf `src/modules/costs/interface/http/…` aus
   `apps/api/test/costs/` lässt `costs-module-boundaries.test.ts` rot werden
   (`[costs-cross-module-public-api-only] … erlaubt ist nur apps/api/src/modules/costs/index.ts`).
   `moduleOf` in `apps/api/test/architecture/rules.ts` vergibt nur unterhalb von
   `apps/api/src/modules/<slug>/` einen Slug, für Testdateien also `null` — ein anderer Testort
   hilft nicht, alle 13 Nachbartests in `test/costs/` importieren über die Modulwurzel.
   **Jedes neue Symbol, das ein Test braucht, gehört benannt in `costs/index.ts`** — kein
   `export *`. Innerhalb des Moduls bleiben relative Pfade richtig; der Controller macht das
   heute schon.
6. **Ein Vertragsschema beweist keine Herkunft.** Ebenfalls bei Task 1 gemessen: vertauscht man in
   der Positionsabbildung zwei gleichtypige Felder (`employeeId: position.assignmentId`,
   `employeeLabel: position.worksiteLabel`), kompiliert das (`TSC_EXIT=0`) und **jeder** Test bleibt
   grün — `CostSnapshotSchema.safeParse` prüft Anwesenheit und Typ, nicht Herkunft. Genau davor
   warnt der Kopfkommentar von `PublishedPlanFacts`: „ein vertauschtes Paar faende niemand — der
   Bericht saehe vollstaendig aus und naennte die falsche Person."
   **Regel für jeden Abbildungsschritt in diesem Slice:** ein `toEqual` über das GANZE Objekt mit
   paarweise verschiedenen Werten, nicht drei einzelne Feldprüfungen.

### Entschieden, nicht offen: `WRITE_CHANNEL_REJECTED` wird 500

Die Spec-Prüfung von Task 2 hat zu Recht verlangt, das **vor** Task 3 zu entscheiden. Hier steht
die Entscheidung samt der Alternativen, die geprüft und verworfen wurden — damit Task 3 sie nicht
neu verhandelt.

Der PO-Auftrag verlangt `SOURCE_NEEDED_CONTRACT_MAPPING`, **wenn Contract und
Application-Problemunion einander widersprechen**. Sie tun es hier nicht: der Vertrag zählt
Antworten auf, er verbietet keine.

| Kandidat | Warum nicht                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **403**  | **Vom Port selbst ausgeschlossen.** `cost-snapshot-repository.port.ts` schreibt zu diesem Grund wörtlich: „KEINE Umdeutung in einen Auth- oder Mandantenfehler: das Subjekt kann korrekt angemeldet und berechtigt sein und trotzdem ueber den falschen Kanal kommen. Ein `401`/`403` daraus zu machen schickte die Betreiberin auf die Suche nach einem Rechteproblem, das es nicht gibt." |
| **409**  | Sagt „dein Stand passt nicht zum Server" und legt einen Retry mit frischem Schlüssel nahe. Der behebt nichts — die Verbindung bleibt der falsche Kanal.                                                                                                                                                                                                                                     |
| **400**  | Beschuldigt die Aufruferin. Die Anfrage war wohlgeformt; falsch ist die Betriebskonfiguration.                                                                                                                                                                                                                                                                                              |
| **500**  | **Gewählt.** Der einzige Code, der „hier ist der Server falsch konfiguriert" sagt.                                                                                                                                                                                                                                                                                                          |

Dass 500 im Dokument fehlt, ist eine repoweite Dokumentationslücke und keine Aussage über diese
Operation: `problemResponses` zählt für **keine** der 18 Operationen 5xx auf. Zwei Messungen zeigen,
dass 5xx auf genau diesen Routen bereits gelebte Praxis ist:

- `AuthProblemFilter` (`modules/tenancy/interface/http/auth-problem.filter.ts`) antwortet auf
  `AUTH_SERVER_UNAVAILABLE` mit **503** — und dieser Filter hängt via `@UseFilters` am
  `CostsController`.
- `HttpCostsGateway.send` behandelt `status >= 500` ausdrücklich als `UNAVAILABLE`. Der Client
  rechnet also mit 5xx.

Gleiches gilt für `stage: "READ"` nach erfolgreichem Schreiben: der eben geschriebene Snapshot war
nicht lesbar — ein Serverfehler, kein Aufruferfehler. Auch **500**.

**Als FINDINGS-Eintrag (Minor) zu melden:** `problemResponses` dokumentiert für keine Operation
5xx, obwohl 5xx real vorkommt. Das gehört in einen eigenen Slice — eine Vertragsänderung an
18 Operationen ist nicht Teil von EYT-139.

### Abgrenzung

- **`GET /kosten/planversionen` ist NICHT Teil dieses Slices.** Die Auswahlliste ist die Datenquelle
  der `/kosten`-Oberfläche, und UI ist ausdrücklich out of scope. Der Eintrag in
  `NOT_YET_IMPLEMENTED` bleibt deshalb stehen; die Liste schrumpft in diesem Slice von **acht auf
  sechs**, nicht auf fünf.
- Keine Migration, kein RLS-Umbau, keine neue Auth-Architektur, keine UI, kein EYT-110, kein XLSX.
- `scripts/assert-tenant-report.sh` pinnt weiterhin keine absolute Testanzahl. **Nicht nebenbei
  reparieren.**

---

## Task 0: Arbeitsbaum, Branch, Bauabhängigkeiten

**Dateien:** keine.

**Schritt 1: Isolierten Worktree anlegen**

```bash
cd /Users/benjaminpoersch/EasyTree
git fetch --all --prune
git worktree add /private/tmp/claude-501/eyt139-wt feat/eyt-109-daily-plan-cost-snapshot
cd /private/tmp/claude-501/eyt139-wt
git rev-parse HEAD
```

Erwartet: `b8a96a944363eff47418417f94605385dc44ebf0`.

> `git worktree list` zeigt bereits ältere Worktrees anderer Sessions. Nicht wiederverwenden — ein
> fremder Worktree kann uncommittete Änderungen tragen. `git worktree prune` räumt die als
> `prunable` markierten weg.

**Schritt 2: Sauberen Arbeitsbaum bestätigen**

```bash
git status --porcelain
```

Erwartet: **leer**. Ist er es nicht: stoppen und melden, nicht aufräumen.

**Schritt 3: Workspace-Abhängigkeiten bauen**

```bash
pnpm install --frozen-lockfile
pnpm --filter @easytree/api^... build
```

> **Pflicht, nicht optional.** `vitest`-Einzelaufrufe über `pnpm --filter … exec` umgehen Turbos
> `^build`. Ein veraltetes `packages/contracts/dist/` lässt einen Einzeltest grün werden, ohne
> irgendetwas zu messen (`noEmitOnError` ist nirgends gesetzt — ein roter Build hinterlässt ein
> benutzbares altes `dist`).

**Schritt 4: Ausgangsmessung festhalten**

```bash
pnpm --filter @easytree/api exec vitest run test/openapi-route-conformance.test.ts
```

Erwartet: **grün**, mit acht Einträgen in `NOT_YET_IMPLEMENTED`. Das ist der Referenzwert, gegen den
Task 4 misst.

---

## Task 1: HTTP-DTO — `StoredCostSnapshot` → `CostSnapshot`

Die einzige Stelle, an der ein gespeicherter Snapshot zur Transportform wird. Sie ist rein: kein
Repository, keine Uhr, keine Anfrage.

**Dateien:**

- Erstellen: `apps/api/src/modules/costs/interface/http/cost-snapshot.dto.ts`
- Test: `apps/api/test/costs/cost-snapshot-dto.test.ts` (neu)

**Schritt 1: Roten Test schreiben**

`apps/api/test/costs/cost-snapshot-dto.test.ts`:

```ts
/**
 * Die HTTP-Naht des Snapshots (EYT-139).
 *
 * ## Was hier gemessen wird
 *
 * Drei Aussagen, die kein anderer Test trifft:
 *
 * 1. Die Antwort entsteht AUS DEM GESPEICHERTEN STAND. Jedes Feld stammt aus
 *    `StoredCostSnapshot`; nichts wird aus einer Anfrage rekonstruiert.
 * 2. `days` ist eine ABLEITUNG aus den gespeicherten Positionen, keine zweite
 *    Datenquelle — und sie ist deterministisch sortiert.
 * 3. Kein Betrag und keine Dauer laeuft durch `number`. Der Nachweis ist ein
 *    Wert oberhalb von 2^53, den eine `Number()`-Umleitung still verfaelschte.
 *
 * ## Gegenmutationen, die diese Datei rot machen
 *
 * - `amountMinorUnits: String(Number(position.amountMinorUnits))` (Praezision).
 * - `days` aus der Reihenfolge der Positionen statt sortiert (Determinismus).
 * - `totalMinorUnits` aus der Summe der Positionen statt aus dem Kopf
 *   (Serverwahrheit).
 */
import { describe, expect, it } from "vitest";

import { CostSnapshotSchema } from "@easytree/contracts";

import { toCostSnapshotDto, type StoredCostSnapshot } from "../../src/modules/costs";

const SNAPSHOT = "00000000-0000-4000-8000-00000000d001";
const ORG = "00000000-0000-4000-8000-00000000a001";
const PLAN = "00000000-0000-4000-8000-00000000b001";
const WORKSITE = "00000000-0000-4000-8000-0000005010a1";
const EMPLOYEE_1 = "00000000-0000-4000-8000-0000004010a1";
const EMPLOYEE_2 = "00000000-0000-4000-8000-0000004010a2";
const SATZ = "00000000-0000-4000-8000-0000006c5001";
const POS_1 = "00000000-0000-4000-8000-00000000e001";
const POS_2 = "00000000-0000-4000-8000-00000000e002";
const POS_3 = "00000000-0000-4000-8000-00000000e003";

/**
 * Die gespeicherte Reihenfolge WIDERSPRICHT der Datumsreihenfolge — Absicht.
 *
 * Stimmten beide ueberein, waere die Sortierung von `days` durch die
 * Einfuegereihenfolge maskiert: der Test bliebe gruen, auch wenn niemand
 * sortierte. Position 1 traegt den SPAETEREN Tag.
 */
const GESPEICHERT: StoredCostSnapshot = {
  id: SNAPSHOT,
  organisationId: ORG,
  planVersionId: PLAN,
  worksiteId: null,
  weekKey: "2026-W33",
  timeZone: "Europe/Berlin",
  currency: "EUR",
  ruleVersion: "personnel-plan-cost-v1",
  // Bewusst NICHT die Summe der Positionen (7500 + 2500 + 1000 = 11000).
  // Der Kopf ist die Serverwahrheit; eine heimlich nachsummierende Naht faellt
  // an dieser Zahl auf.
  totalMinorUnits: 9007199254740993n,
  createdAt: new Date("2026-08-12T09:15:00.000Z"),
  createdBy: "00000000-0000-4000-8000-00000000aaa1",
  correlationId: "korrelation-1",
  positions: [
    {
      id: POS_1,
      assignmentId: "00000000-0000-4000-8000-00000000c001",
      worksiteId: WORKSITE,
      worksiteLabel: "Baustelle A",
      employeeId: EMPLOYEE_1,
      employeeLabel: "Person 1",
      localDate: "2026-08-12",
      durationMilliseconds: 28800000n,
      rateVersionId: SATZ,
      amountMinorUnits: 7500n,
    },
    {
      id: POS_2,
      assignmentId: "00000000-0000-4000-8000-00000000c002",
      worksiteId: WORKSITE,
      worksiteLabel: "Baustelle A",
      employeeId: EMPLOYEE_2,
      employeeLabel: "Person 2",
      localDate: "2026-08-11",
      durationMilliseconds: 14400000n,
      rateVersionId: SATZ,
      amountMinorUnits: 2500n,
    },
    {
      id: POS_3,
      assignmentId: "00000000-0000-4000-8000-00000000c003",
      worksiteId: WORKSITE,
      worksiteLabel: "Baustelle A",
      employeeId: EMPLOYEE_1,
      employeeLabel: "Person 1",
      localDate: "2026-08-11",
      durationMilliseconds: 3600000n,
      rateVersionId: SATZ,
      amountMinorUnits: 1000n,
    },
  ],
};

describe("toCostSnapshotDto (EYT-139)", () => {
  it("erfuellt den Vertrag CostSnapshotSchema", () => {
    const geprueft = CostSnapshotSchema.safeParse(toCostSnapshotDto(GESPEICHERT));
    expect(geprueft.success, JSON.stringify(geprueft.error?.issues)).toBe(true);
  });

  it("uebernimmt Kopffelder unveraendert aus dem gespeicherten Stand", () => {
    const dto = toCostSnapshotDto(GESPEICHERT);
    expect(dto.id).toBe(SNAPSHOT);
    expect(dto.planVersionId).toBe(PLAN);
    expect(dto.worksiteId).toBeNull();
    expect(dto.weekKey).toBe("2026-W33");
    expect(dto.timeZone).toBe("Europe/Berlin");
    expect(dto.currency).toBe("EUR");
    expect(dto.ruleVersion).toBe("personnel-plan-cost-v1");
    expect(dto.createdAt).toBe("2026-08-12T09:15:00.000Z");
    expect(dto.createdBy).toBe("00000000-0000-4000-8000-00000000aaa1");
    expect(dto.correlationId).toBe("korrelation-1");
  });

  it("gibt die Gesamtsumme des KOPFES zurueck, nicht die Summe der Positionen", () => {
    // 9007199254740993 = 2^53 + 1. Ueber `number` wuerde daraus 9007199254740992.
    expect(toCostSnapshotDto(GESPEICHERT).totalMinorUnits).toBe("9007199254740993");
  });

  it("haelt die gespeicherte Positionsreihenfolge und wandelt bigint zu String", () => {
    const dto = toCostSnapshotDto(GESPEICHERT);
    expect(dto.positions.map((p) => p.id)).toEqual([POS_1, POS_2, POS_3]);
    expect(dto.positions[0]?.amountMinorUnits).toBe("7500");
    expect(dto.positions[0]?.durationMilliseconds).toBe("28800000");
  });

  it("gruppiert days aus den gespeicherten Positionen, aufsteigend nach lokalem Tag", () => {
    // Die Positionsreihenfolge beginnt mit dem 12., die Tagesliste mit dem 11. —
    // erst dieser Widerspruch beweist, dass sortiert und nicht eingefuegt wird.
    expect(toCostSnapshotDto(GESPEICHERT).days).toEqual([
      { localDate: "2026-08-11", amountMinorUnits: "3500" },
      { localDate: "2026-08-12", amountMinorUnits: "7500" },
    ]);
  });

  it("erzeugt fuer einen Snapshot ohne Positionen eine leere Tagesliste", () => {
    const leer = toCostSnapshotDto({ ...GESPEICHERT, positions: [], totalMinorUnits: 0n });
    expect(leer.days).toEqual([]);
    expect(leer.positions).toEqual([]);
    expect(leer.totalMinorUnits).toBe("0");
  });
});
```

**Schritt 2: Rot bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-dto.test.ts
```

Erwartet: Fehlschlag mit „Cannot find module … cost-snapshot.dto".

> **Kontrolle gegen still übersprungene Pfadfilter:** die Ausgabe muss `Test Files 1 failed`
> zeigen. Meldet vitest `No test files found`, hat der Pfad nicht getroffen und es wurde nichts
> gemessen.

**Schritt 3: Implementieren**

`apps/api/src/modules/costs/interface/http/cost-snapshot.dto.ts`:

```ts
/**
 * Die eine Uebersetzung gespeicherter Stand -> Transportform (EYT-139).
 *
 * ## Warum diese Funktion existiert und der Controller sie nicht selbst macht
 *
 * Weil sie die einzige Stelle ist, an der `days` entsteht, und weil ein Test sie
 * ohne Nest, ohne Datenbank und ohne Anfrage messen koennen muss. Baute der
 * Controller die Antwort inline, waere die Ableitung nur ueber einen HTTP-Test
 * erreichbar — und der misst dann zwei Dinge gleichzeitig.
 *
 * ## `days` ist eine Ableitung, keine zweite Datenquelle
 *
 * Gespeichert ist ausschliesslich `total_minor_units` im Kopf (Migration 0018).
 * Die Tagessummen werden HIER aus den gespeicherten Positionen gruppiert —
 * deterministisch, aufsteigend nach lokalem Tag. Aufsteigend und nicht in
 * Einfuegereihenfolge: `positions` traegt die eingefrorene `ordinal`-Ordnung,
 * die fachlich etwas anderes bedeutet als eine Tagesliste. Waere `days` bloss
 * die Reihenfolge des ersten Vorkommens, haetten zwei Snapshots mit denselben
 * Zahlen je nach Einsatzreihenfolge verschiedene Tageslisten.
 *
 * `YYYY-MM-DD` sortiert lexikographisch in Kalenderreihenfolge — deshalb genuegt
 * ein Stringvergleich, und deshalb steht hier KEIN `localeCompare`: das haenge
 * ohne explizites Locale an der Umgebung.
 *
 * ## Kein `number`, nirgends
 *
 * Betraege und Dauern sind in Prozess `bigint` und im Vertrag Ziffernfolgen.
 * `.toString()` ist der einzige erlaubte Weg dazwischen. Ein `Number(...)` waere
 * die Stelle, an der oberhalb von 2^53 still Genauigkeit verloren geht — der
 * Test haelt das an einem Wert von 2^53+1 fest.
 *
 * ## Was hier NICHT passiert
 *
 * Keine Neuberechnung, keine Satzermittlung, keine Planungsauswertung. Diese
 * Funktion sieht ausschliesslich einen bereits gespeicherten Snapshot.
 */
import type { CostDayTotalDto, CostPositionDto, CostSnapshot } from "@easytree/contracts";

import type {
  StoredCostSnapshot,
  StoredCostSnapshotPosition,
} from "../../application/cost-snapshot-repository.port";

function toPositionDto(position: StoredCostSnapshotPosition): CostPositionDto {
  return {
    id: position.id,
    assignmentId: position.assignmentId,
    worksiteId: position.worksiteId,
    worksiteLabel: position.worksiteLabel,
    employeeId: position.employeeId,
    employeeLabel: position.employeeLabel,
    localDate: position.localDate,
    durationMilliseconds: position.durationMilliseconds.toString(),
    rateVersionId: position.rateVersionId,
    amountMinorUnits: position.amountMinorUnits.toString(),
  };
}

function tagessummen(positions: readonly StoredCostSnapshotPosition[]): CostDayTotalDto[] {
  const summen = new Map<string, bigint>();
  for (const position of positions) {
    summen.set(
      position.localDate,
      (summen.get(position.localDate) ?? 0n) + position.amountMinorUnits,
    );
  }
  return [...summen.entries()]
    .sort(([links], [rechts]) => (links < rechts ? -1 : links > rechts ? 1 : 0))
    .map(([localDate, betrag]) => ({ localDate, amountMinorUnits: betrag.toString() }));
}

export function toCostSnapshotDto(stored: StoredCostSnapshot): CostSnapshot {
  return {
    id: stored.id,
    planVersionId: stored.planVersionId,
    worksiteId: stored.worksiteId,
    weekKey: stored.weekKey,
    timeZone: stored.timeZone,
    currency: stored.currency,
    // Der Vertrag tippt `ruleVersion` heute auf das Literal `personnel-plan-cost-v1`,
    // der gespeicherte Stand auf `string` — Absicht (ein unter v1 entstandener
    // Snapshot bleibt v1). Der Cast ist die dokumentierte Naht dazwischen; kommt
    // v2, wird das Vertragsliteral zu einem `z.enum` und dieser Cast faellt weg.
    ruleVersion: stored.ruleVersion as CostSnapshot["ruleVersion"],
    createdAt: stored.createdAt.toISOString(),
    createdBy: stored.createdBy,
    correlationId: stored.correlationId,
    totalMinorUnits: stored.totalMinorUnits.toString(),
    days: tagessummen(stored.positions),
    positions: stored.positions.map(toPositionDto),
  };
}
```

**Schritt 4: Grün bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-dto.test.ts
pnpm --filter @easytree/api exec tsc -p tsconfig.json --noEmit
```

Erwartet: `Test Files 1 passed`, `Tests 6 passed`; `tsc` ohne Ausgabe.

**Schritt 5: Committen**

```bash
git add apps/api/src/modules/costs/interface/http/cost-snapshot.dto.ts \
        apps/api/test/costs/cost-snapshot-dto.test.ts
git diff --cached --name-only
git commit -m "feat(costs): EYT-139 — gespeicherten Snapshot an der HTTP-Naht in die Transportform uebersetzen"
```

---

## Task 2: Stabile Fehlercodes und eine Ausnahme mit eigenem Status

**Dateien:**

- Erstellen: `apps/api/src/modules/costs/interface/http/costs-problem.ts`
- Ändern: `apps/api/src/modules/costs/interface/http/costs-problem.filter.ts`
- Ändern: `apps/api/src/modules/costs/interface/http/costs-error-type.ts`
- Ändern: `apps/api/src/modules/costs/index.ts`
- Test: `apps/api/test/costs/costs-problem-mapping.test.ts` (neu)
- Test: `apps/api/test/costs/costs-problem-filter.test.ts` (neu — beide Filterzweige)

**Schritt 1: Roten Test schreiben**

`apps/api/test/costs/costs-problem-mapping.test.ts`:

```ts
/**
 * Jeder Ablehnungsgrund des Snapshot-Pfades hat genau einen stabilen URN
 * (EYT-139).
 *
 * ## Warum ein eigener Test und nicht bloss `satisfies`
 *
 * `satisfies Record<Problem, string>` erzwingt VOLLSTAENDIGKEIT zur Compilezeit
 * — es erzwingt nicht, dass die Werte verschieden sind. Zwei Gruende mit
 * demselben URN saehen fuer den Compiler korrekt aus, und die Oberflaeche
 * koennte „Satz fehlt" nicht von „Satz mehrdeutig" unterscheiden. Diese Datei
 * misst die Injektivitaet.
 *
 * ## Gegenmutation
 *
 * Zwei Eintraege auf denselben URN legen -> „URNs sind paarweise verschieden"
 * wird rot. Einen Eintrag streichen -> der Compiler wird rot, nicht dieser Test.
 */
import { describe, expect, it } from "vitest";

// AUSSCHLIESSLICH ueber die Modulwurzel — siehe die Regel unterhalb dieses
// Blocks. Ein tiefer Pfad nach `interface/http/` faellt am Waechter
// `costs-cross-module-public-api-only`, auch aus einem Test heraus.
import {
  COSTS_ERROR_TYPE,
  CostsProblem,
  PLAN_COST_FACTS_PROBLEMS,
  RATE_ERROR_TYPE,
  SNAPSHOT_ASSEMBLY_ERROR_TYPE,
  SNAPSHOT_ASSEMBLY_PROBLEMS,
  SNAPSHOT_READ_ERROR_TYPE,
  SNAPSHOT_READ_PROBLEMS,
  SNAPSHOT_WRITE_ERROR_TYPE,
  SNAPSHOT_WRITE_PROBLEMS,
} from "../../src/modules/costs";

describe("Fehlercodes des Snapshot-Pfades (EYT-139)", () => {
  it("nennt fuer JEDEN Montagegrund einen Code", () => {
    for (const problem of SNAPSHOT_ASSEMBLY_PROBLEMS) {
      expect(SNAPSHOT_ASSEMBLY_ERROR_TYPE[problem], problem).toMatch(/^urn:easytree:costs:/);
    }
  });

  it("nennt fuer JEDEN Schreib- und Lesegrund einen Code", () => {
    for (const problem of SNAPSHOT_WRITE_PROBLEMS) {
      expect(SNAPSHOT_WRITE_ERROR_TYPE[problem], problem).toMatch(/^urn:easytree:costs:/);
    }
    for (const problem of SNAPSHOT_READ_PROBLEMS) {
      expect(SNAPSHOT_READ_ERROR_TYPE[problem], problem).toMatch(/^urn:easytree:costs:/);
    }
    for (const problem of PLAN_COST_FACTS_PROBLEMS) {
      expect(COSTS_ERROR_TYPE[problem], problem).toMatch(/^urn:easytree:costs:/);
    }
  });

  it("haelt die URNs des Snapshot-Pfades paarweise verschieden", () => {
    const alle = [
      ...Object.values(SNAPSHOT_ASSEMBLY_ERROR_TYPE),
      ...Object.values(SNAPSHOT_WRITE_ERROR_TYPE),
      ...Object.values(SNAPSHOT_READ_ERROR_TYPE),
      ...Object.values(COSTS_ERROR_TYPE),
    ];
    expect(new Set(alle).size).toBe(alle.length);
  });

  it("wiederverwendet die bestehenden Satz-URNs statt neue zu erfinden", () => {
    // RATE_NOT_FOUND und RATE_AMBIGUOUS gibt es seit EYT-108. Ein zweiter URN
    // fuer dieselbe Aussage waere ein neuer Problemname ohne Vertragsdeckung.
    expect(SNAPSHOT_ASSEMBLY_ERROR_TYPE.RATE_NOT_FOUND).toBe(RATE_ERROR_TYPE.RATE_NOT_FOUND);
    expect(SNAPSHOT_ASSEMBLY_ERROR_TYPE.RATE_AMBIGUOUS).toBe(RATE_ERROR_TYPE.RATE_AMBIGUOUS);
    expect(SNAPSHOT_WRITE_ERROR_TYPE.IDEMPOTENCY_KEY_REUSED).toBe(
      RATE_ERROR_TYPE.IDEMPOTENCY_KEY_REUSED,
    );
  });

  it("traegt in CostsProblem Status, Titel, Typ und Text — jeden aus SEINEM Feld", () => {
    // Vier paarweise verschiedene Werte, drei davon `string`: nur so faellt eine
    // vertauschte Zuweisung auf. Siehe die Begruendung im Kopf von
    // `costs-problem.ts`, warum der Konstruktor ueberhaupt ein Objekt nimmt.
    const problem = new CostsProblem({
      status: 400,
      title: "Ungueltige Anfrage",
      type: "urn:easytree:costs:probe",
      detail: "Beschreibender Text",
    });
    expect(problem.status).toBe(400);
    expect(problem.title).toBe("Ungueltige Anfrage");
    expect(problem.type).toBe("urn:easytree:costs:probe");
    expect(problem.message).toBe("Beschreibender Text");
    expect(problem).toBeInstanceOf(Error);
  });
});
```

**Schritt 2: Rot bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/costs-problem-mapping.test.ts
```

Erwartet: Fehlschlag beim Modulauflösen (`costs-problem`, `SNAPSHOT_ASSEMBLY_ERROR_TYPE`).

**Schritt 3: `CostsProblem` anlegen**

`apps/api/src/modules/costs/interface/http/costs-problem.ts`:

```ts
/**
 * Eine fachliche Ablehnung des Kostenpfades mit stabilem URN UND eigenem
 * Statuscode (EYT-139).
 *
 * ## Warum es diese Klasse zusaetzlich zu `ConflictProblem` gibt
 *
 * Gemessen, nicht vermutet: `HttpExceptionFilter` setzt `type` hart auf
 * `"about:blank"` und liest aus einer `HttpException` ausschliesslich `detail`.
 * Ein `throw new BadRequestException({ type: … })` verliert seinen URN also auf
 * dem Weg nach draussen. Der einzige Pfad, der heute einen URN durchreicht, ist
 * `ConflictProblem` -> `CostsProblemFilter`. Der Snapshot-Pfad braucht stabile
 * URNs auch bei 400, 403 und 500 — deshalb diese Klasse.
 *
 * ## Warum `ConflictProblem` NICHT erweitert wird
 *
 * Weil eine „ConflictProblem" mit Status 400 im Namen luegen wuerde, und weil
 * jede Aenderung daran das Verhalten der EYT-108-Satzrouten mitveraenderte.
 * Zwei Klassen, ein Filter: das Bestehende bleibt Byte fuer Byte, das Neue
 * bekommt seinen eigenen Weg.
 *
 * ## Warum ein Objekt und keine vier Positionsparameter
 *
 * `title`, `type` und `detail` sind alle `string`. Drei gleichtypige
 * Positionsparameter lassen sich vertauschen, ohne dass irgendetwas auffaellt —
 * der Compiler schweigt, und die Antwort traegt dann den URN im Titel. Das ist
 * dieselbe Begruendung, mit der `PublishedPlanVersionsQuerySchema` in
 * `packages/contracts/src/costs/schemas.ts` einen Wochenbereich als Objekt statt
 * als zwei nackte Strings fuehrt, und dieselbe, die `NewCostSnapshot` kein
 * eigenes `ordinal`-Feld gibt. Benannte Felder machen die Vertauschung
 * unmoeglich statt bloss unwahrscheinlich.
 */
export interface CostsProblemInput {
  readonly status: number;
  readonly title: string;
  readonly type: string;
  readonly detail: string;
}

export class CostsProblem extends Error {
  readonly status: number;
  readonly title: string;
  readonly type: string;

  constructor(input: CostsProblemInput) {
    super(input.detail);
    this.name = "CostsProblem";
    this.status = input.status;
    this.title = input.title;
    this.type = input.type;
  }
}
```

**Schritt 4: Filter erweitern**

`costs-problem.filter.ts` — `@Catch(ConflictProblem, CostsProblem)`, Verzweigung nach Typ. Der
`ConflictProblem`-Zweig bleibt unverändert (Status 409, Titel „Konflikt").

> **Beide Zweige brauchen eine Messung, und zwar in DIESEM Commit.** Sonst schiebt der
> Filterumbau eine ungetestete Verzweigung vor sich her, bis Task 3 sie zufällig mitnimmt. Der
> Test treibt `CostsProblemFilter.catch` mit einem gestellten `ArgumentsHost` (Muster: ein
> Objekt mit `switchToHttp()`, das `getResponse()`/`getRequest()` liefert; `res.status()` gibt
> `res` zurück, `res.json()` merkt sich den Rumpf) und vergleicht den Rumpf mit **einem
> `toEqual` über das ganze Objekt** — nicht feldweise, siehe Randbedingung 6.
>
> Zwei Fälle:
>
> 1. **Der `ConflictProblem`-Zweig ist die Regressionsprobe.** Er muss weiterhin exakt
>    `{ type, title: "Konflikt", status: 409, detail, correlationId }` liefern. Geht er kaputt,
>    ändert dieser Commit stillschweigend das Verhalten der EYT-108-Satzrouten.
> 2. **Der `CostsProblem`-Zweig** muss Status und Titel aus der Ausnahme übernehmen — geprüft
>    mit einem Status, der **nicht** 409 ist, und einem Titel, der **nicht** „Konflikt" ist.
>    Sonst wäre der Fall von der Vorbelegung des anderen Zweigs nicht zu unterscheiden.
>
> Dritter Fall: fehlende `correlationId` am Request ⇒ `"unknown"`.

```ts
@Catch(ConflictProblem, CostsProblem)
export class CostsProblemFilter implements ExceptionFilter {
  catch(exception: ConflictProblem | CostsProblem, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // Der 409-Zweig ist unveraendert der aus EYT-108 — gleiche Werte, gleiche
    // Form. Nur der zweite Zweig ist neu.
    const status = exception instanceof CostsProblem ? exception.status : HttpStatus.CONFLICT;
    const title = exception instanceof CostsProblem ? exception.title : "Konflikt";

    res.status(status).json({
      type: exception.type,
      title,
      status,
      detail: exception.message,
      correlationId: (req as Partial<RequestWithCorrelationId>).correlationId ?? "unknown",
    });
  }
}
```

**Schritt 5: URNs ergänzen**

`costs-error-type.ts` um drei Konstanten erweitern, jede mit `satisfies`-Vollständigkeitszusicherung
gegen die zugehörige eingefrorene Problemliste. Bestehende Konstanten **nicht** verändern.

```ts
import type {
  SnapshotReadProblem,
  SnapshotWriteProblem,
} from "../../application/cost-snapshot-repository.port";
import type { SnapshotAssemblyProblem } from "../../domain/cost-snapshot-assembly";

/**
 * Genau ein Code je Montagegrund (EYT-139).
 *
 * Zwei Eintraege verweisen bewusst auf bestehende URNs aus `RATE_ERROR_TYPE`:
 * „Satz fehlt" und „Satz mehrdeutig" bedeuten hier dasselbe wie in der
 * Satzverwaltung. Ein zweiter URN fuer dieselbe Aussage waere ein neuer
 * Problemname, den kein Vertrag verlangt.
 */
export const SNAPSHOT_ASSEMBLY_ERROR_TYPE = {
  RATE_NOT_FOUND: RATE_ERROR_TYPE.RATE_NOT_FOUND,
  RATE_AMBIGUOUS: RATE_ERROR_TYPE.RATE_AMBIGUOUS,
  RATE_INVALID: "urn:easytree:costs:rate-invalid",
  LABEL_MISSING: "urn:easytree:costs:label-missing",
  DAY_BOUNDARY_NONEXISTENT: "urn:easytree:costs:day-boundary-nonexistent",
  DAY_BOUNDARY_AMBIGUOUS: "urn:easytree:costs:day-boundary-ambiguous",
  TIME_ZONE_UNKNOWN: "urn:easytree:costs:time-zone-unknown",
  INTERVAL_INVALID: "urn:easytree:costs:interval-invalid",
} as const satisfies Record<SnapshotAssemblyProblem, string>;

export const SNAPSHOT_WRITE_ERROR_TYPE = {
  IDEMPOTENCY_KEY_REUSED: RATE_ERROR_TYPE.IDEMPOTENCY_KEY_REUSED,
  WORKSITE_NOT_IN_ORG: "urn:easytree:costs:worksite-not-in-org",
  WRITE_CHANNEL_REJECTED: "urn:easytree:costs:write-channel-rejected",
} as const satisfies Record<SnapshotWriteProblem, string>;

/**
 * Ein Grund, ein Code — und das ist die Aussage.
 *
 * „gibt es nicht", „gehoert einem anderen Mandanten" und „das Subjekt darf
 * Kosten nicht sehen" fallen im Port bereits zu EINEM Grund zusammen. Dass es
 * hier genau einen URN gibt, ist die HTTP-Haelfte derselben Zusage: es gibt
 * keinen Weg, aus der Antwort auf die Existenz einer fremden Id zu schliessen.
 */
export const SNAPSHOT_READ_ERROR_TYPE = {
  SNAPSHOT_NOT_FOUND: "urn:easytree:costs:snapshot-not-found",
} as const satisfies Record<SnapshotReadProblem, string>;
```

> **`RATE_ERROR_TYPE` muss oberhalb dieser Konstanten stehen** — es wird von ihnen gelesen.
> Zirkuläre Importe entstehen keine: `interface/http` darf `application/` und `domain/` lesen
> (der `CostsController` tut es bereits).

**Schritt 6: Modul-API ergänzen**

`apps/api/src/modules/costs/index.ts`: `CostsProblem` sowie die drei neuen Konstanten und ihre
Typen benannt re-exportieren (kein `export *` — der Architekturtest lehnt es ab).

**Schritt 7: Grün bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/costs-problem-mapping.test.ts
pnpm --filter @easytree/api exec vitest run test/costs-module-boundaries.test.ts test/architecture.test.ts
pnpm --filter @easytree/api exec tsc -p tsconfig.json --noEmit
```

Erwartet: alle grün. Die Architekturläufe sind hier Pflicht, nicht Kür — die neuen Importe kreuzen
Schichtgrenzen innerhalb des Moduls.

**Schritt 8: Committen**

```bash
git add apps/api/src/modules/costs/interface/http/costs-problem.ts \
        apps/api/src/modules/costs/interface/http/costs-problem.filter.ts \
        apps/api/src/modules/costs/interface/http/costs-error-type.ts \
        apps/api/src/modules/costs/index.ts \
        apps/api/test/costs/costs-problem-mapping.test.ts
git diff --cached --name-only
git commit -m "feat(costs): EYT-139 — stabile URNs und eine Ablehnung mit eigenem Statuscode"
```

---

## Task 3: Die zwei Routen an die eine Zugangskette binden

Der Kern des Slices.

**Dateien:**

- Ändern: `apps/api/src/modules/costs/interface/http/costs.controller.ts`
- Ändern: `apps/api/src/app.module.ts`
- Test: `apps/api/test/costs/snapshot-http.test.ts` (neu)

### Die verbindliche Fehlerabbildung

Bestehende Contracts sind die Autorität. **Kein Fall bleibt offen, kein `as`-Cast, kein `default`.**

**`POST /api/v1/kosten/snapshots`**

| Application-Problem                                                                                                                         | HTTP    | `type`                      | Begründung                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identität ungültig                                                                                                                          | **401** | (AuthProblemFilter)         | unverändert                                                                                                                                                 |
| `ORG_CONTEXT_REQUIRED`                                                                                                                      | **400** | `…:no-organisation`         | unverändert (Zugangskette)                                                                                                                                  |
| `ORG_NOT_A_MEMBER` / `PERMISSION_MISSING` (`costs.calculate`)                                                                               | **403** | `…:no-organisation`         | unverändert; beide antworten absichtlich gleich                                                                                                             |
| Idempotenzschlüssel fehlt/ungültig                                                                                                          | **409** | `…:missing-idempotency-key` | wie `POST /kosten/stundensaetze` (`ConflictProblem`)                                                                                                        |
| Rumpf verletzt `CreateCostSnapshotCommandSchema` (inkl. `organisationId` im Body)                                                           | **400** | `about:blank`               | `strictObject`; wie `createRateVersion`                                                                                                                     |
| `FACTS` / `NO_ORGANISATION`                                                                                                                 | **400** | `…:no-organisation`         |                                                                                                                                                             |
| `FACTS` / `AMBIGUOUS_ORGANISATION`                                                                                                          | **400** | `…:ambiguous-organisation`  | auf diesem Pfad unerreichbar (die Fabrik bindet eine aufgelöste Organisation) — Zweig steht trotzdem, ein `!` behauptete eine Prüfung, die niemand ausführt |
| `FACTS` / `PLAN_NOT_PUBLISHED`                                                                                                              | **409** | `…:plan-not-published`      | Der Aufrufer hat nichts falsch formuliert; sein Stand passt nicht zum Server — dieselbe Begründung wie bei `STALE_ACTIVE_VERSION` in EYT-108                |
| `FACTS` / `PLAN_VERSION_NOT_FOUND`                                                                                                          | **400** | `…:plan-version-not-found`  | Der Aufrufer nannte eine Id, die es im Mandanten nicht gibt. Kein Existenzleck: „unbekannt" und „fremd" sind bereits im Port EIN Grund                      |
| `ASSEMBLY` / `RATE_NOT_FOUND`                                                                                                               | **409** | `…:rate-not-found`          | `detail` nennt Person und Tag                                                                                                                               |
| `ASSEMBLY` / `RATE_AMBIGUOUS`                                                                                                               | **409** | `…:rate-ambiguous`          | `detail` nennt Person und Tag                                                                                                                               |
| `ASSEMBLY` / `RATE_INVALID`, `LABEL_MISSING`, `DAY_BOUNDARY_NONEXISTENT`, `DAY_BOUNDARY_AMBIGUOUS`, `TIME_ZONE_UNKNOWN`, `INTERVAL_INVALID` | **409** | je eigener URN              | Serverzustand blockiert den Vorgang                                                                                                                         |
| `WRITE` / `IDEMPOTENCY_KEY_REUSED`                                                                                                          | **409** | `…:idempotency-key-reused`  | Aufruferfehler, mit frischem Schlüssel behoben                                                                                                              |
| `WRITE` / `WORKSITE_NOT_IN_ORG`                                                                                                             | **400** | `…:worksite-not-in-org`     | wie `PLAN_VERSION_NOT_FOUND`: eine vom Aufrufer genannte Id ist im Mandanten nicht sichtbar                                                                 |
| `WRITE` / `WRITE_CHANNEL_REJECTED`                                                                                                          | **500** | `…:write-channel-rejected`  | Betriebsfehler, kein Rechteproblem. `detail` verweist auf den Laufzeitkanal, **nennt keine Verbindungsdaten**                                               |
| `READ` / `SNAPSHOT_NOT_FOUND` (nach erfolgreichem Schreiben)                                                                                | **500** | `…:snapshot-not-found`      | Der eben geschriebene Stand war nicht lesbar — Serverfehler, kein Aufruferfehler                                                                            |
| Erfolg                                                                                                                                      | **201** | —                           | Rumpf = `toCostSnapshotDto(stored)`                                                                                                                         |

**`GET /api/v1/kosten/snapshots/{snapshotId}`**

| Fall                                                                  | HTTP    | `type`                 |
| --------------------------------------------------------------------- | ------- | ---------------------- |
| Identität ungültig                                                    | **401** | (AuthProblemFilter)    |
| Zugangskette lehnt ab (`costs.read` fehlt / fremde Organisation)      | **403** | `…:no-organisation`    |
| `snapshotId` verletzt `IdSchema`                                      | **400** | `about:blank`          |
| `SNAPSHOT_NOT_FOUND` (unbekannt **oder** fremd **oder** nicht lesbar) | **403** | `…:snapshot-not-found` |
| Erfolg                                                                | **200** | —                      |

> **Warum 403 und nicht 404 für den Lesefall.** Der Vertrag führt kein 404 — `problemResponses`
> ist repoweit `{400,401,403,409}`. 403 ist unter den verfügbaren Codes die wahrheitsgemässe
> Aussage für alle drei zusammengefassten Fälle: „dieser Snapshot ist für dich nicht sichtbar".
> Die Ununterscheidbarkeit ist strukturell garantiert, nicht durch Sorgfalt: `SnapshotReadProblem`
> hat genau **einen** Wert, und `SNAPSHOT_READ_ERROR_TYPE` genau **einen** URN.

**Schritt 1: Roten Test schreiben**

`apps/api/test/costs/snapshot-http.test.ts` — Muster:
`apps/api/test/costs/cost-access-audit.http.test.ts` (echtes `AppModule`, echter Controller, echte
Policy, echte Filter, echte Korrelations-Middleware; ersetzt werden nur `DATABASE_PING`,
`REQUEST_IDENTITY`, `SESSION_ORGANISATIONS`, `RATE_REPOSITORY_FACTORY`,
`EMPLOYEE_DIRECTORY_FACTORY`, `PLAN_COST_FACTS_FACTORY`, `COST_SNAPSHOT_REPOSITORY_FACTORY`).

Der Aufbau muss **die Argumente der Fabriken aufzeichnen** — daran hängt H11:

```ts
const fabrikaufrufe: { subject: string; organisation: string }[] = [];
// …
.overrideProvider(PLAN_COST_FACTS_FACTORY)
.useValue((subjectUserId: string, organisationId: string) => {
  fabrikaufrufe.push({ subject: subjectUserId, organisation: organisationId });
  // Fakten NUR fuer ORG_BETA. Wird die Fabrik mit ORG_ALPHA gerufen, gibt es
  // keine Fakten — der Test faellt dann auf, statt gruen zu bleiben.
  return organisationId === ORG_BETA ? faktenPortBeta : faktenPortAlpha;
})
```

Zu schreibende Fälle (jeder mit sprechendem `it`-Titel, weil Task 4/6 sie namentlich zitieren):

| ID   | `it`-Titel (verbatim)                                                                     | Aussage                                                                                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1   | `H1 — POST liefert 201 und den gespeicherten Snapshot`                                    | Rumpf durch `CostSnapshotSchema.parse`; `id`, `planVersionId`, `createdAt`, `ruleVersion`, `currency`, `positions`, `days`, `totalMinorUnits` stammen aus dem gestellten Repository-Rückgabewert, **nicht** aus dem Request |
| H2   | `H2 — Retry mit gleichem Schluessel liefert dieselbe gespeicherte Wahrheit`               | zweiter POST, gleicher Key, gleiche Nutzlast → identischer Rumpf (`toEqual`), `create` genau **zweimal** gerufen, Repository meldet beide Male dieselbe `snapshotId`                                                        |
| H3   | `H3 — gleicher Schluessel mit anderer Nutzlast wird fail-closed abgelehnt`                | Repository liefert `IDEMPOTENCY_KEY_REUSED` → **409**, `type` = `…:idempotency-key-reused`                                                                                                                                  |
| H4   | `H4 — nicht veroeffentlichte Planversion schreibt keinen Snapshot`                        | Faktenport liefert `PLAN_NOT_PUBLISHED` → **409**, `create` **nie** gerufen                                                                                                                                                 |
| H4b  | `H4b — unbekannte oder fremde Planversion antwortet mit einem Grund`                      | `PLAN_VERSION_NOT_FOUND` → **400**, `create` nie gerufen                                                                                                                                                                    |
| H5   | `H5 — fehlender Satz nennt Person und Tag und erzeugt keinen 0-EUR-Snapshot`              | Montage scheitert mit `RATE_NOT_FOUND` → **409**, `detail` enthält `employeeId` und `localDate`, `create` **nie** gerufen, `totalMinorUnits` kommt im Rumpf **nicht** vor                                                   |
| H6   | `H6 — mehrdeutiger Satz erzeugt keinen Snapshot`                                          | `RATE_AMBIGUOUS` → **409**, `create` nie gerufen                                                                                                                                                                            |
| H7   | `H7 — fremde Baustelle wird fail-closed abgelehnt`                                        | `worksiteId` nicht in `facts.worksiteLabels` → **400** `…:worksite-not-in-org`, `create` nie gerufen                                                                                                                        |
| H8   | `H8 — GET liefert den gespeicherten Stand, nicht eine Neuberechnung`                      | Repository-`read` liefert andere Werte als die Montage-Fakten; die Antwort zeigt die Repository-Werte. Faktenport-Fabrik wird auf dem GET-Pfad **nie** gerufen (`fabrikaufrufe.length` unverändert)                         |
| H9   | `H9 — unbekannte, fremde und unlesbare Snapshot-Id sind ununterscheidbar`                 | drei Ids, alle → `SNAPSHOT_NOT_FOUND`; Status, `type` **und** `detail` sind byteweise gleich (`toEqual` über `{status,type,detail}`)                                                                                        |
| H10a | `H10 — POST ohne costs.calculate wird abgelehnt, auch mit costs.read`                     | Mitgliedschaft nur mit `costs.read` → **403**, Use-Case **nie** erreicht (`create` und Faktenport nie gerufen)                                                                                                              |
| H10b | `H10 — GET ohne costs.read wird abgelehnt, auch mit costs.calculate`                      | → **403**                                                                                                                                                                                                                   |
| H10c | `H10 — POST ohne Idempotenzschluessel wird abgelehnt`                                     | → **409** `…:missing-idempotency-key`, nichts ausgeführt                                                                                                                                                                    |
| H10d | `H10 — organisationId im Rumpf wird abgelehnt`                                            | `strictObject` → **400**                                                                                                                                                                                                    |
| H11  | `H11 — POST verarbeitet ausschliesslich die von der Policy aufgeloeste Organisation`      | Subjekt Mitglied in A **und** B, Header wählt B → `fabrikaufrufe` enthält genau `{subject: USER, organisation: ORG_BETA}`, **kein** Aufruf mit `ORG_ALPHA`; der Snapshot enthält keine Position aus A                       |
| H12a | `H12 — jede Antwort dieser Routen erfuellt ProblemDocumentSchema oder CostSnapshotSchema` | tabellengetrieben über alle obigen Fälle                                                                                                                                                                                    |
| H12b | `H12 — beide Routen erzeugen genau ein cost.access.decision-Ereignis`                     | erlaubt wie abgelehnt, mit Korrelations-Id, ohne Beträge/Namen                                                                                                                                                              |

> **Zu H5, gemessen:** `ProblemDocumentSchema` ist ein `z.strictObject`. `employeeId` und
> `localDate` dürfen **nicht** als eigene Felder auftauchen — der Client verwürfe das ganze
> Dokument. Der Test prüft deshalb `expect(problem.detail).toContain(EMPLOYEE_1)` und
> `toContain("2026-08-12")`, und zusätzlich
> `expect(ProblemDocumentSchema.safeParse(body).success).toBe(true)`.

**Schritt 2: Rot bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts
```

Erwartet: 404 auf beiden Routen (die Routen gibt es noch nicht). **`Test Files 1 failed`** — nicht
`No test files found`.

**Schritt 3: Controller erweitern**

`zugang(...)` liefert zusätzlich Snapshot-Repository und Faktenport. **Eine** Kette bleibt, keine
zweite:

```ts
private async zugang(
  req: Request,
  organisationHeader: string | undefined,
  permission: CostPermission,
  route: string,
): Promise<{
  repository: RateRepository;
  snapshots: CostSnapshotRepository;
  facts: PlanCostFactsPort;
  organisationId: string;
  subjectUserId: string;
}> {
  // … unveraendert bis zum Erfolgszweig …
  return {
    repository: this.repositoryFor(identitaet.userId),
    // Die AUFGELOESTE Organisation, nicht der Header und nicht
    // `mitgliedschaften[0]`. Genau hier verlaesst die Entscheidung der Policy
    // die Zugangskette — ein anderer Wert an dieser Stelle waere eine zweite,
    // erfundene Mandantenwahl (REQ-002).
    facts: this.factsFor(identitaet.userId, entscheidung.organisationId),
    snapshots: this.snapshotsFor(identitaet.userId),
    organisationId: entscheidung.organisationId,
    subjectUserId: identitaet.userId,
  };
}
```

Konstruktor um zwei Injektionen erweitern:

```ts
@Inject(PLAN_COST_FACTS_FACTORY) private readonly factsFor: PlanCostFactsFactory,
@Inject(COST_SNAPSHOT_REPOSITORY_FACTORY) private readonly snapshotsFor: CostSnapshotRepositoryFactory,
```

Zwei Routenmethoden:

```ts
@Post("snapshots")
async createSnapshot(
  @Req() req: Request,
  @Body() body: unknown,
  @Headers(ORGANISATION_HEADER) organisationHeader?: string,
  @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
): Promise<CostSnapshot> {
  // Erzeugen braucht `costs.calculate`. NICHT `costs.read`: wer Kosten sehen
  // darf, darf sie damit nicht einfrieren.
  const { facts, snapshots, repository, organisationId } = await this.zugang(
    req, organisationHeader, "costs.calculate", "POST /kosten/snapshots",
  );

  const schluessel = IdempotencyKeySchema.safeParse(idempotencyKey);
  if (!schluessel.success) {
    throw new ConflictProblem(
      RATE_ERROR_TYPE.MISSING_IDEMPOTENCY_KEY,
      "Diese Anfrage braucht einen gueltigen Idempotency-Key. Ohne ihn koennte eine Wiederholung einen zweiten Snapshot anlegen.",
    );
  }

  const geprueft = CreateCostSnapshotCommandSchema.safeParse(body);
  if (!geprueft.success) {
    throw new BadRequestException(
      `Ungueltiges Snapshot-Kommando: ${geprueft.error.issues.map((i) => i.path.join(".") || "koerper").join(", ")}`,
    );
  }

  const ergebnis = await createCostSnapshot(
    { facts, rates: repository, repository: snapshots },
    {
      // `organisationId` kommt AUSSCHLIESSLICH aus der Zugangskette. Der
      // Vertrag `CreateCostSnapshotCommandSchema` kennt das Feld gar nicht —
      // ein `organisationId` im Rumpf faellt am `strictObject` durch.
      organisationId,
      publishedPlanVersionId: geprueft.data.publishedPlanVersionId,
      worksiteId: geprueft.data.worksiteId,
      correlationId: (req as Partial<RequestWithCorrelationId>).correlationId ?? "unbekannt",
      idempotencyKey: schluessel.data,
    },
  );

  if (!ergebnis.ok) throw snapshotProblemFor(ergebnis);
  // Die Antwort entsteht aus dem ZURUECKGELESENEN Stand — nie aus `geprueft.data`.
  return toCostSnapshotDto(ergebnis.snapshot);
}

@Get("snapshots/:snapshotId")
async snapshot(
  @Req() req: Request,
  @Param("snapshotId") snapshotId: string,
  @Headers(ORGANISATION_HEADER) organisationHeader?: string,
): Promise<CostSnapshot> {
  const { snapshots } = await this.zugang(
    req, organisationHeader, "costs.read", "GET /kosten/snapshots/{snapshotId}",
  );

  const id = IdSchema.safeParse(snapshotId);
  if (!id.success) throw new BadRequestException("Ungueltige Snapshot-Id.");

  // Nur lesen. Keine Planungsauswertung, keine Satzermittlung, keine
  // Kostenberechnung — der Faktenport wird auf diesem Pfad nicht angefasst.
  const gelesen = await snapshots.read(id.data);
  if (!gelesen.ok) {
    throw new CostsProblem(
      HttpStatus.FORBIDDEN,
      "Nicht berechtigt",
      SNAPSHOT_READ_ERROR_TYPE[gelesen.problem],
      "Dieser Snapshot ist nicht verfuegbar.",
    );
  }
  return toCostSnapshotDto(gelesen.snapshot);
}
```

Die Abbildungsfunktion — **erschöpfend über `stage`, ohne `default`**:

```ts
/**
 * Ein Ablehnungsgrund, eine Antwort — und der Compiler erzwingt die
 * Vollstaendigkeit.
 *
 * Kein `default`-Zweig und kein `as`: die Fehlerunion ist ueber `stage`
 * diskriminiert und die vier Problemlisten sind eingefroren. Kommt ein Grund
 * dazu, wird `never` verletzt und diese Datei kompiliert nicht mehr. Ein
 * `default` haette denselben Fall stillschweigend zu 500 gemacht.
 */
function snapshotProblemFor(failure: CreateCostSnapshotFailure): Error {
  switch (failure.stage) {
    case "FACTS":
      return factsProblem(failure.problem);
    case "ASSEMBLY":
      return new CostsProblem(
        HttpStatus.CONFLICT,
        "Konflikt",
        SNAPSHOT_ASSEMBLY_ERROR_TYPE[failure.problem],
        // Person und Tag stehen im TEXT, nicht in eigenen Feldern:
        // `ProblemDocumentSchema` ist strikt, und ein Zusatzfeld liesse den
        // Client das ganze Dokument verwerfen.
        montageText(failure),
      );
    case "WRITE":
      return writeProblem(failure.problem);
    case "READ":
      return new CostsProblem(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "Serverfehler",
        SNAPSHOT_READ_ERROR_TYPE[failure.problem],
        "Der Snapshot wurde geschrieben, konnte aber nicht zurueckgelesen werden.",
      );
  }
}
```

**Schritt 4: `AppModule` verdrahten**

`COST_SNAPSHOT_REPOSITORY_FACTORY` als Fabrik je Subjekt registrieren, neben
`RATE_REPOSITORY_FACTORY`:

```ts
{
  // Repository je Subjekt, Pool je Prozess — gleiche Begruendung wie beim
  // Satzrepository: ein Singleton truege die Identitaet der ERSTEN Anfrage in
  // alle folgenden.
  provide: COST_SNAPSHOT_REPOSITORY_FACTORY,
  inject: [TENANT_QUERY_RUNNER, IDEMPOTENCY_STORE],
  useFactory: (
    runner: TenantQueryRunnerProvider,
    idempotenz: IdempotencyStore,
  ): CostSnapshotRepositoryFactory =>
    (subjectUserId: string) => new PgCostSnapshotRepository(runner, subjectUserId, idempotenz),
},
```

`PLAN_COST_FACTS_FACTORY` ist bereits registriert — **nicht verdoppeln**.

**Schritt 5: Die Konformitätsliste im SELBEN Commit kürzen**

> **Planfehler, beim Durchdenken von Task 3 gefunden und hier korrigiert.** Eine frühere Fassung
> hob das für Task 4 auf. Das geht nicht: `openapi-route-conformance.test.ts` prüft mit einer
> `stale`-Zusicherung, dass kein Eintrag eine **bereits implementierte** Operation nennt. Sobald
> die zwei Routen registriert sind, ist der Test rot — Task 3 könnte also gar nicht grün
> committen. Der alte EYT-109-Plan sagt dasselbe („Task 13 muss alle drei `/kosten/*`-Einträge im
> SELBEN Commit entfernen, der die Routen anlegt").

Erst messen, dass es rot ist — das ist der Nachweis, dass die Routen wirklich registriert sind:

```bash
pnpm --filter @easytree/api exec vitest run test/openapi-route-conformance.test.ts
```

Erwartet: rot mit `stale` = `["GET /kosten/snapshots/{snapshotId}", "POST /kosten/snapshots"]`.

Dann genau diese zwei Einträge aus `NOT_YET_IMPLEMENTED` streichen. **`GET /kosten/planversionen`
bleibt** — nicht Teil dieses Slices. Ergebnis greppen, nicht dem Exit-Code glauben:

```bash
grep -n "/kosten/" apps/api/test/openapi-route-conformance.test.ts
grep -n "acht\|sieben\|sechs" apps/api/test/openapi-route-conformance.test.ts
```

Erwartet: genau **eine** `/kosten/`-Zeile (`planversionen`). Nennt der Kopfkommentar eine Zahl,
muss sie jetzt **sechs** lauten.

**Schritt 6: Grün bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts \
  test/openapi-route-conformance.test.ts test/costs/cost-access-audit.http.test.ts
pnpm --filter @easytree/api exec tsc -p tsconfig.json --noEmit
pnpm --filter @easytree/api test
```

`cost-access-audit.http.test.ts` ist hier **Pflicht, nicht Kür**: es ist die Regressionsprobe der
drei bestehenden Routen, die dieselbe `zugang(...)`-Kette benutzen.

**Schritt 7: Committen**

```bash
git add apps/api/src/modules/costs/interface/http/costs.controller.ts \
        apps/api/src/app.module.ts apps/api/test/costs/snapshot-http.test.ts \
        apps/api/test/openapi-route-conformance.test.ts
git diff --cached --name-only
git commit -m "feat(api): EYT-139 — Snapshot-Routen an die eine Zugangskette binden"
```

---

## Task 4: Modulhonorigkeit

> Die Kürzung von `NOT_YET_IMPLEMENTED` ist nach **Task 3** gewandert (Begründung dort). Hier
> bleibt nur die Ehrlichkeitskorrektur.

**Dateien:**

- Ändern: `apps/api/src/modules/costs/index.ts`

**Schritt 1: Messen, was jetzt rot ist**

```bash
pnpm --filter @easytree/api exec vitest run test/openapi-route-conformance.test.ts
```

Erwartet: **rot** mit `stale` = `["GET /kosten/snapshots/{snapshotId}", "POST /kosten/snapshots"]`.
Das ist die Messung — die Routen existieren, die Einträge behaupten das Gegenteil.

**Schritt 2: Die zwei Einträge entfernen**

Genau die beiden `/kosten/snapshots`-Einträge aus `NOT_YET_IMPLEMENTED` streichen.
**`GET /kosten/planversionen` bleibt** (nicht Teil dieses Slices).

**Schritt 3: Ergebnis greppen, nicht dem Exit-Code glauben**

```bash
grep -c "NOT_YET_IMPLEMENTED\|/kosten/snapshots" apps/api/test/openapi-route-conformance.test.ts
grep -n "/kosten/" apps/api/test/openapi-route-conformance.test.ts
```

Erwartet: nur noch **eine** `/kosten/`-Zeile (`planversionen`).

**Schritt 4: Stale-Zählung im Kopfkommentar prüfen**

```bash
grep -n "acht\|sechs\|fuenf" apps/api/test/openapi-route-conformance.test.ts
```

Nennt der Kopfkommentar eine Zahl, muss sie jetzt **sechs** lauten. Eine falsche Zahl in einem
Kommentar ist eine Falschaussage, die später als Evidenz gelesen wird.

**Schritt 5: `costs/index.ts` ehrlich machen**

Der Kopfkommentar behauptet heute wörtlich: „der Kosten-Snapshot hat noch KEINE Route …
`COST_SNAPSHOT_REPOSITORY_FACTORY` ist nirgends registriert und der Endpunkt folgt in Task 13".
Beides ist ab Task 3 falsch. Umschreiben auf den gemessenen Stand: fünf Routen unter `/kosten`,
`COST_SNAPSHOT_REPOSITORY_FACTORY` in `AppModule` registriert, offen bleiben
`GET /kosten/planversionen` und der `CostExportPort` (EYT-110).

**Schritt 6: Grün bestätigen**

```bash
pnpm --filter @easytree/api exec vitest run test/openapi-route-conformance.test.ts
```

**Schritt 7: Committen**

```bash
git add apps/api/test/openapi-route-conformance.test.ts apps/api/src/modules/costs/index.ts
git diff --cached --name-only
git commit -m "test(api): EYT-139 — zwei erfuellte Zusagen aus der Liste offener Operationen entfernen"
```

---

## Task 5: Der Nachweis gegen echtes PostgreSQL

Der HTTP-Test aus Task 3 stellt die Repositories. Er kann drei Aussagen strukturell nicht treffen:
dass RLS die fremde Organisation wirklich ausblendet (H11), dass bei einem Montagefehler wirklich
**keine Zeile** entsteht (H5/H6) und dass ein gelesener Snapshot nach einer späteren Satzänderung
unverändert bleibt (H8).

**Dateien:**

- Erstellen: `apps/api/test/costs/snapshot-http.integration.test.ts`
- Ändern: `.github/workflows/ci.yml`

**Schritt 1: Test schreiben**

Muster: `apps/api/test/costs/cost-snapshot.integration.test.ts` (zwei Verbindungen, `FailClosedGate`,
Aufräumen über eine Marke). Neu ist, dass hier das **echte `AppModule`** über supertest läuft und
nur `REQUEST_IDENTITY`, `SESSION_ORGANISATIONS` und `DATABASE_PING` ersetzt werden — Repositories,
Fabriken, Runner, Pool, Controller und Filter sind die echten.

```ts
const gate = new FailClosedGate("snapshot-http", TENANT_TESTS_MODE, "EYT-139");
```

> **Zwei Verbindungen, und warum.** `EASYTREE_TEST_DB_URL` ist die Verwaltungs- und
> BEOBACHTERverbindung (`postgres`): Fixtures, Aufräumen, Zählungen. `EASYTREE_TEST_APP_DB_URL` ist
> der Laufzeitkanal (`easytree_app`), über den `AppModule` schreibt — `cost_snapshots` verlangt
> `app.is_runtime_channel()`. Eine Zählung über den Laufzeitkanal sähe wegen `NOINHERIT` + RLS
> gerade das nicht, dessen Abwesenheit sie belegen soll, und scheiterte an `42501`.

Fälle (jeder mit einer Zählung **unmittelbar nach** dem jeweiligen Versuch — Netto-Zählungen am
Ende heben sich auf):

| ID  | `it`-Titel (verbatim)                                                              | Messung                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | `H1/DB — POST schreibt genau einen Snapshot mit seinen Positionen`                 | `select count(*) from cost_snapshots where correlation_id = …` = 1; Positionszahl = erwartete Zahl                                                                                                                                             |
| I2  | `H2/DB — Retry mit gleichem Schluessel legt keinen zweiten Snapshot an`            | nach dem zweiten POST: Zeilenzahl **weiterhin 1**, gleiche `id` im Rumpf                                                                                                                                                                       |
| I5  | `H5/DB — fehlender Satz hinterlaesst keine Zeile`                                  | Satz für eine beteiligte Person löschen → POST → 409, `count(*)` = **0**                                                                                                                                                                       |
| I8  | `H8/DB — eine spaetere Satzversion laesst den gespeicherten Snapshot unveraendert` | Snapshot anlegen, danach über den regulären EYT-108-Ablösungspfad V2 anlegen, dann **GET** über HTTP: `id`, Positions-Ids in gleicher Reihenfolge, `rateVersionId`, `amountMinorUnits`, `totalMinorUnits`, `createdAt` **feldweise** identisch |
| I11 | `H11/DB — ein Snapshot in Organisation B enthaelt keine Zeile aus Organisation A`  | Subjekt in A **und** B, in beiden ein veröffentlichter Plan mit Einsätzen; Header wählt B → jede Position trägt eine `worksiteId`/`employeeId` aus B, `org_id` der Zeile = B                                                                   |
| I9  | `H9/DB — die Id eines fremden Snapshots antwortet wie eine unbekannte`             | echten Snapshot in A anlegen, als Nutzer von B lesen → gleicher Status, `type` und `detail` wie bei einer frei erfundenen Id                                                                                                                   |

> **Warnung aus früheren Läufen (`planning-fixtures-collide-with-real-invariants`):** ein Entwurf je
> Woche/Organisation, veröffentlichte Wochen sind unlöschbar, jede Suite braucht **eigene**
> ISO-Wochen. Für diese Suite eigene Wochenschlüssel wählen und in einer Konstante festhalten.

**Schritt 2: Lokal messen (nur falls eine Supabase-Instanz erreichbar ist)**

```bash
EASYTREE_TENANT_TESTS=required \
EASYTREE_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
EASYTREE_TEST_APP_DB_URL=postgresql://easytree_app:<pw>@127.0.0.1:54322/postgres \
  pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.integration.test.ts
```

> **Auf diesem Mac läuft die Supabase-Instanz nicht** (Memory `sql-only-runs-in-ci-not-locally`).
> Dann ist **CI die erste Ausführung** — das ist zulässig, muss aber im Bericht als Evidenzstufe
> genannt werden. Ohne erreichbare Datenbank läuft die Suite mit `EASYTREE_TENANT_TESTS=local` und
> **überspringt**; das ist kein Nachweis.

**Schritt 3: CI-Schritt ergänzen**

In `.github/workflows/ci.yml`, im **bestehenden** Job `db-gates`, direkt **nach** dem Schritt
`Kosten-Snapshot — Persistenz, Atomizitaet, Rechte, Kanal (fail-closed, zwei Verbindungen, EYT-138)`
(ca. Zeile 404):

```yaml
# EYT-139: die HTTP-Naht des Snapshots gegen echtes PostgreSQL. Was hier
# gemessen wird, kann der Nahttest mit gestellten Repositories
# (test/costs/snapshot-http.test.ts) strukturell nicht: dass RLS die
# fremde Organisation wirklich ausblendet, dass ein Montagefehler KEINE
# Zeile hinterlaesst, und dass ein gelesener Snapshot eine spaetere
# Satzversion nicht sieht.
#
# Eigener Schritt im BESTEHENDEN Job db-gates, kein neuer Job: ein neuer
# Job waere ein Status-Check, den das Ruleset nicht kennt, und beide
# Listen in setup-/verify-branch-protection.sh muessten mitwachsen.
- name: Snapshot-HTTP-Naht (fail-closed, zwei Verbindungen, EYT-139)
  env:
    EASYTREE_TENANT_TESTS: required
    EASYTREE_TEST_DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
    EASYTREE_TEST_APP_DB_URL: postgresql://easytree_app:ci-local-app-password@127.0.0.1:54322/postgres
  shell: bash
  run: |
    pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.integration.test.ts 2>&1 | tee /tmp/snapshot-http.log
    bash scripts/assert-tenant-report.sh snapshot-http /tmp/snapshot-http.log
```

> **Kein neuer Job, keine Änderung an `setup-branch-protection.sh` oder
> `verify-branch-protection.sh`.** Beide Skripte führen **Job**-Listen, keine Schrittlisten. Wer
> hier einen Job anlegte, erzeugte einen Pflichtcheck, den das Ruleset nicht kennt.

**Schritt 4: Ergebnis greppen**

```bash
grep -n "snapshot-http" .github/workflows/ci.yml
```

Erwartet: **drei** Zeilen (Schrittname, `vitest run`, `assert-tenant-report.sh`).

**Schritt 5: Committen**

```bash
git add apps/api/test/costs/snapshot-http.integration.test.ts .github/workflows/ci.yml
git diff --cached --name-only
git commit -m "test(costs): EYT-139 — die Snapshot-HTTP-Naht gegen echtes PostgreSQL messen"
```

---

## Task 6: Gegenmutationen — ausführen, messen, zurücknehmen

**Keine gedachten Gegenmutationen.** Jede wird eingespielt, ihr roter Lauf wird gemessen, dann wird
sie zurückgenommen und die Rücknahme belegt. Eine Mutation, die am Compiler scheitert, zählt
**nicht** — sie misst die Selbstverteidigung des Typsystems, nicht die Regel.

**Vor jeder Mutation:**

```bash
cp <ziel-datei> /private/tmp/claude-501/eyt139-wt-backup-$(basename <ziel-datei>)
```

> `git checkout --` stellt den **Commit**-Stand her, nicht den Arbeitsstand. Zu diesem Zeitpunkt
> ist alles committed, also wäre `git checkout --` korrekt — die Kopie ist trotzdem billiger als
> ein zweiter Verlust.

### GM-H1 — die Organisation der Policy umgehen

**Mutation** in `costs.controller.ts`, `zugang(...)`:

```ts
-    facts: this.factsFor(identitaet.userId, entscheidung.organisationId),
+    facts: this.factsFor(identitaet.userId, mitgliedschaften[0]?.organisationId ?? entscheidung.organisationId),
```

Kompiliert (beides `string`). Bei einem Nutzer in A und B mit Header B greift jetzt A.

```bash
pnpm --filter @easytree/api exec tsc -p tsconfig.json --noEmit   # muss SAUBER sein
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts -t "H11"
```

**Erwartet: rot**, mit `fabrikaufrufe` = `ORG_ALPHA` statt `ORG_BETA`. Roten Ausgabeblock
wörtlich ins Protokoll.

**Rücknahme + Beleg:**

```bash
git checkout -- apps/api/src/modules/costs/interface/http/costs.controller.ts
git diff --stat -- apps/api/src/modules/costs/interface/http/costs.controller.ts
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts -t "H11"
```

Erwartet: `git diff --stat` **leer** (auf die Datei eingegrenzt, nicht global), Test wieder grün.

### GM-H2 — die Antwort aus der Anfrage statt aus dem gespeicherten Stand bauen

**Mutation** in `costs.controller.ts`, `createSnapshot`:

```ts
-  return toCostSnapshotDto(ergebnis.snapshot);
+  return {
+    ...toCostSnapshotDto(ergebnis.snapshot),
+    planVersionId: geprueft.data.publishedPlanVersionId,
+    createdAt: new Date().toISOString(),
+  };
```

Kompiliert (beide Felder sind Strings desselben Vertragstyps).

```bash
pnpm --filter @easytree/api exec tsc -p tsconfig.json --noEmit
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts -t "H2"
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts -t "H8"
```

**Erwartet: beide rot** — H2, weil zwei Aufrufe desselben Vorgangs verschiedene `createdAt`
liefern; H8, weil der POST-Rumpf und der spätere GET-Rumpf auseinanderfallen.

Rücknahme wie oben, mit eingegrenztem `git diff --stat`.

### GM-H3 — fehlenden Satz zu einem 0-EUR-Erfolg machen

**Mutation** in `create-cost-snapshot.use-case.ts`, Schritt 4: unbepreisbare Einsätze überspringen
statt abzulehnen.

```ts
-  if (!montage.ok) {
-    return { ok: false, stage: "ASSEMBLY", … };
-  }
+  const positionen = montage.ok ? montage.positions : [];
```

(Die nachfolgenden Zugriffe auf `montage.positions` entsprechend auf `positionen` umstellen —
**vollständig**, sonst zerbricht die Mutation am Compiler und misst nichts.)

```bash
pnpm --filter @easytree/api exec tsc -p tsconfig.json --noEmit   # muss SAUBER sein
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts -t "H5"
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts -t "H6"
```

**Erwartet: beide rot** — statt 409 kommt 201, und `create` wurde gerufen.

In CI zusätzlich `I5` (Zeilenzahl 0 → 1). Die DB-Hälfte lässt sich lokal nicht messen; das im
Bericht als Evidenzstufe benennen.

Rücknahme wie oben.

### GM-H4 — das Existenzleck einbauen

**Mutation** in `costs.controller.ts`, `snapshot(...)`: statt einer Antwort für alle drei Fälle
eine, die die Existenz verrät — z. B. `detail` mit der angefragten Id anreichern und für eine
bekannte Id einen anderen Status wählen. Der billigste kohärente Weg: `detail` um die Id ergänzen
und zusätzlich für Ids, die `IdSchema` passieren, aber ein Präfix des Testfixtures tragen, einen
anderen `title` setzen.

```bash
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts -t "H9"
```

**Erwartet: rot** — der `toEqual`-Vergleich über `{status,type,detail}` der drei Antworten fällt.

Rücknahme wie oben.

**Nach allen vier Mutationen:**

```bash
git status --porcelain
```

Erwartet: **leer**.

---

## Task 7: Vollständige Validierung, Push, CI

**Schritt 1: Gate lokal, vollständig**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

> **Alle vier lesen, bevor gepusht wird.** `vitest` allein genügt nicht: ein Typfehler in einer
> Testdatei taucht erst unter `tsc` auf. Und `pnpm format` läuft im Worktree über alles — bei
> Rauschen aus untracked Verzeichnissen mit
> `pnpm exec prettier --check apps packages docs .github` eingrenzen.

**Schritt 2: Fokussierte Läufe, jeder einzeln bestätigt**

```bash
pnpm --filter @easytree/api exec vitest run \
  test/costs/cost-snapshot-dto.test.ts \
  test/costs/costs-problem-mapping.test.ts \
  test/costs/snapshot-http.test.ts \
  test/openapi-route-conformance.test.ts \
  test/costs-module-boundaries.test.ts \
  test/costs-module-boundaries.red-case.test.ts \
  test/architecture.test.ts \
  test/architecture-red-case.test.ts
pnpm --filter @easytree/contracts exec vitest run test/openapi-drift.test.ts test/http-costs-gateway.test.ts
```

Erwartet: `Test Files 8 passed` bzw. `2 passed`. **Die Dateizahl gegenlesen** — ein Pfadfilter ohne
Treffer meldet Exit 0, ohne geprüft zu haben.

**Schritt 3: `openapi/v1.json` darf sich NICHT geändert haben**

```bash
git diff --stat -- packages/contracts/openapi/v1.json packages/contracts/src/openapi/document.ts
```

Erwartet: **leer**. Dieser Slice ändert keinen Vertrag — die Operationen stehen seit Task 2 des
EYT-109-Plans. Eine Ausgabe hier heisst: etwas ist ausserhalb des Auftrags passiert.

**Schritt 4: Pushen**

```bash
git log --oneline origin/feat/eyt-109-daily-plan-cost-snapshot..HEAD
git push origin HEAD:feat/eyt-109-daily-plan-cost-snapshot
git rev-parse HEAD
```

Den finalen SHA notieren.

**Schritt 5: CI auf genau diesem SHA abwarten**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree <FINALER_SHA> 3600
```

Exit 0 = alle Läufe erfolgreich, 1 = Fehlschlag, 2 = Timeout.

**Schritt 6: Die elf Jobs einzeln lesen — Aggregatstatus zählt nicht**

```bash
gh run list --commit <FINALER_SHA> --json databaseId,name,conclusion,status
gh run view <RUN_ID> --json jobs --jq '.jobs[] | "\(.conclusion)\t\(.name)"'
```

Erwartet: `format`, `lint`, `typecheck`, `unit-tests`, `build-web`, `web-smoke`, `build-api`,
`secret-scan`, `db-gates`, `read-through`, `auth-journey` — **elf**, alle `success`.

**Schritt 7: Nachweisen, dass die Pflicht-Suites wirklich LIEFEN**

Ein grüner Job ist kein Beleg dafür, dass die Suite lief.

```bash
gh run view --job <DB_GATES_JOB_ID> --log | grep -E "^\[(snapshot-http|cost-snapshot|planning-published-reads|tenant-isolation|tenant-pooling)\]"
```

Erwartet je Zeile `mode=required executed=<n> passed=<n> skipped=0` mit `n >= 1`. Insbesondere:

```
[snapshot-http] mode=required executed=… passed=… skipped=0
```

Fehlt diese Zeile, ist der neue Gate-Schritt nicht gelaufen — dann ist der Slice **nicht** fertig,
gleich was der Aggregatstatus sagt.

Zusätzlich für `unit-tests` belegen, dass die neuen Dateien ausgeführt wurden:

```bash
gh run view --job <UNIT_TESTS_JOB_ID> --log | grep -E "snapshot-http.test.ts|cost-snapshot-dto.test.ts|costs-problem-mapping.test.ts"
```

---

## Task 8: PR-Body und Abschlussbericht

**Schritt 1: PR-Body faktisch aktualisieren**

```bash
gh pr view 69 --json body --jq .body > /private/tmp/claude-501/pr69-body.md
```

Abschnitt zu EYT-139 ergänzen: zwei Routen, Fehlerabbildung, Gegenmutationen, CI-Lauf mit SHA und
Run-Id. **Erst schreiben, dann zurücklesen, dann senden** — Entwurfsfragmente sind in einem PR-Body
sichtbar und versioniert.

```bash
gh pr edit 69 --body-file /private/tmp/claude-501/pr69-body.md
gh pr view 69 --json body --jq .body | head -40
```

**PR bleibt Draft. Kein Merge. Kein „Ready for review". Jira wird nicht angefasst. EYT-109 bleibt
In Arbeit.**

**Schritt 2: Bericht im vom PO geforderten Format**

Genau diese zehn Abschnitte, in dieser Reihenfolge:

1. **START STATE** — Base, Head, Branch, ahead/behind, Working Tree
2. **HTTP ARCHITECTURE** — Request → Auth → Policy → Organisation → Facts → Use Case → Repository → DTO
3. **CHANGED FILES** — je Datei ein Satz Zweck
4. **ACCEPTANCE MATRIX** — H1–H12 mit Testname (verbatim) und Ergebnis
5. **ERROR MAPPING** — Application Problem → HTTP Status → Problem Type (die Tabelle aus Task 3)
6. **MUTATION RESULTS** — Mutation → rote Tests → Revertbeleg
7. **CI** — finaler SHA, Run-Id, elf Jobs, tatsächlich ausgeführte Required-Suites (die
   `[…] mode=required executed=… skipped=0`-Zeilen)
8. **FINDINGS** — Blocker / Important / Minor / SOURCE_NEEDED
9. **NEXT SLICE** — genau eines: `YES — HTTP GATE CLOSED` oder `NO — HTTP BLOCKER REMAINS`
10. **VERDICT** — genau eines: `ACCEPTED CANDIDATE` / `CHANGES REQUIRED` / `BLOCKED`

Danach **STOP**. Kein UI, kein EYT-110.

**Bereits jetzt für FINDINGS vorgemerkt (nicht in diesem Slice reparieren):**

- **Important — `docs/plans/2026-08-08-eyt-109-tageskosten-snapshot.md:1969`** fordert für den
  `RATE_MISSING`-Fall ein Problem-Dokument mit eigenen Feldern `employeeId`/`localDate`. Das ist mit
  `ProblemDocumentSchema` (`z.strictObject`) unvereinbar und liesse den Client das Dokument
  verwerfen. Dieser Plan legt die Angaben stattdessen in `detail`.
- **Minor — `RATE_MISSING` existiert nicht.** Derselbe Planabschnitt nennt einen Problemnamen, den
  keine eingefrorene Liste führt; er heisst `RATE_NOT_FOUND`.
- **Minor — `GET /kosten/planversionen`** bleibt unimplementiert und weiterhin in
  `NOT_YET_IMPLEMENTED`; die Liste schrumpft auf **sechs**, nicht auf fünf.
- **Minor — `HttpCostsGateway.rateHistory`** prüft seinen `employeeId`-String nicht gegen
  `IdSchema`, anders als `snapshot(snapshotId)`. Bereits im Quelltext als Nachzug notiert
  (EYT-108er Code).
- **Offen, nicht erfunden:** `SOURCE_NEEDED_ASSIGNMENT_DURATION_LIMIT`.

---

## Stop-Bedingungen

Sofort **STOP** und `BLOCKED` melden, wenn:

- der PR-Head nicht `b8a96a9…` ist und die Drift nicht sicher rekonstruierbar ist;
- eine Migration nötig erscheint (Migration 0018 muss reichen — tut sie es nicht, ist das ein
  Befund, keine neue Migration);
- RLS oder Auth aufgeweicht werden müssten;
- ein benötigter Fehler in der bestehenden Contract-Semantik nicht eindeutig definiert ist →
  `SOURCE_NEEDED_CONTRACT_MAPPING`;
- eine neue fachliche Regel nötig wird;
- der Slice nur durch einen allgemeinen Architekturumbau lösbar wäre;
- nach **drei** verschiedenen Reparaturhypothesen derselbe Fehler bestehen bleibt.

---

## Was dieser Slice ausdrücklich NICHT anfasst

`/kosten`-UI · Basisdesign-v2-Frontend · EYT-110 · XLSX · Sprint 6 ·
Assignment-Maximaldauer · neue Businessregeln · neue Auth-Architektur · RLS-Redesign ·
allgemeine CI-Aufräumarbeiten · `scripts/assert-tenant-report.sh` ·
`GET /kosten/planversionen` · `packages/contracts/openapi/v1.json`
