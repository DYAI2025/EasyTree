# EYT-109 Task 10 — Use-Case `createCostSnapshot` — Implementierungsplan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Ziel:** Ein Application-Use-Case, der aus einer veroeffentlichten Planversion einen Kosten-Snapshot
erzeugt — und vor **jedem** fachlichen Blocker abbricht, bevor irgendetwas geschrieben wird.

**Architektur:** Reine Orchestrierung vorhandener Nahtstellen. Der Use-Case ruft
`PlanCostFactsPort.publishedFactsForVersion`, prueft den Baustellenfilter gegen
`facts.worksiteLabels`, laedt die Satzhistorien der betroffenen Mitarbeitenden ueber
`RateRepository.versionsFor`, uebergibt alles an `assembleCostSnapshotPositions` (Domain, Task 5),
bildet die Gesamtsumme als `bigint`, schreibt ueber `CostSnapshotRepository.create` und liefert
anschliessend den mit `read(snapshotId)` **gelesenen** Stand zurueck. Keine eigene Satzauswahl,
keine Tagesallokation, keine Uhr, kein SQL, kein NestJS, kein Zod.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`, `module: NodeNext`), Vitest mit SWC, `@easytree/domain` als einzige
Geld-/Marken-Quelle.

---

## 0. Gemessener Ausgangszustand (09.08.2026, vor jeder Aenderung)

Nicht uebernommen, sondern ausgefuehrt:

```text
Worktree:        /private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/
                 53a83129-a6b7-4e6a-9575-6b82421267b5/scratchpad/eyt109-wt
Branch:          feat/eyt-109-daily-plan-cost-snapshot
HEAD:            01cc751e5c06268a2674eef14e29579e3a1cb376
@{u}:            01cc751e5c06268a2674eef14e29579e3a1cb376   (identisch)
origin/master:   b44e38c6bf7e08a2996c2263309001a1304050f2
origin/master...HEAD: 0 hinterher / 28 voraus
git status:      leer
PR #69:          OPEN, isDraft=true, headRefOid=01cc751…, mergeable=MERGEABLE
```

Kein `BLOCKED_STATE_DRIFT`. **Wichtig:** Das Hauptverzeichnis `/Users/benjaminpoersch/EasyTree`
steht auf `fix/eyt-136-planning-data-api-boundary` und ist **nicht** der Arbeitsort dieses Plans.
Jeder Befehl unten laeuft im Worktree oben. Wer das verwechselt, committet Task 10 auf den
falschen Branch.

**Ablage dieses Plans.** `docs/plans/` ist auf diesem Branch versioniert (die beiden
EYT-109-Plaene sind committet). Der von der PO vorgegebene Task-10-Diff nennt aber genau drei
Dateien. Auflösung: dieser Plan wird als **eigener** `docs(plan)`-Commit **vor** dem
Implementierungscommit abgelegt (Schritt 1.0), damit der Feature-Commit exakt die drei Dateien
traegt und der Arbeitsbaum danach sauber ist. Das ist die einzige Abweichung vom Wortlaut des
Auftrags und ist hier bewusst benannt, nicht stillschweigend getan.

---

## 1. Scope

**Task 10 erzeugt genau:**

```text
A apps/api/src/modules/costs/application/create-cost-snapshot.use-case.ts
A apps/api/test/costs/create-cost-snapshot.use-case.test.ts
M apps/api/src/modules/costs/index.ts
```

Weitere Dateien nur bei **gemessener** Compile-Abhaengigkeit (also: `pnpm typecheck` verlangt sie,
nicht „waere schoener").

**Nicht anfangen:** Task 11 (PostgreSQL-Repository), Task 12 (pgTAP), Task 13 (HTTP-Routen,
AppModule-Verdrahtung), Task 14 (Unveraenderlichkeits-Integration), Task 15 (UI), EYT-110.

### 1.1 Uebernommene PO-Korrekturen am Basisplan

| Kennung | Basisplan sagt                           | Gilt stattdessen                                                                                                       |
| ------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| D-T10-1 | `RATE_MISSING`                           | `RATE_NOT_FOUND` / `RATE_AMBIGUOUS` — die Namen aus `SNAPSHOT_ASSEMBLY_PROBLEMS`. Keine zweite Bezeichnung.            |
| D-T10-2 | „Tagessummen je (localDate, worksiteId)" | Nur `totalMinorUnits`. `days` entsteht spaeter beim Lesen/HTTP-Mapping (so steht es im Kopf von `StoredCostSnapshot`). |
| D-T10-3 | `create(...)` → fertig                   | `create(...)` → `snapshotId` → `read(snapshotId)` → **gespeicherter** Snapshot ist das Erfolgsergebnis.                |

### 1.2 Uebernommene PO-Entscheidungen zu den Task-9-Findings

- `TOKEN_NAME_INCONSISTENCY`: **keine** Umbenennung von `COST_SNAPSHOT_REPOSITORY_FACTORY`.
- `NO_REPLAY_SIGNAL`: **kein** Replay-Boolean. Der Nachlesepfad aus D-T10-3 macht Erstaufruf und
  Wiederholung fuer die Aufruferin ununterscheidbar — genau das ist das gewuenschte Verhalten.
- `PLAN_SKETCH_HAD_DANGLING_COMMENT`: geschlossen, keine Arbeit.

---

## 2. Die Vertraege, gegen die gebaut wird (gemessen, nicht erinnert)

Alles hier stammt aus dem HEAD-Stand `01cc751`. Wer beim Implementieren etwas anderes vorfindet,
hat den falschen Worktree.

```ts
// application/plan-cost-facts.port.ts
type PlanCostFactsProblem =
  "NO_ORGANISATION" | "AMBIGUOUS_ORGANISATION" | "PLAN_NOT_PUBLISHED" | "PLAN_VERSION_NOT_FOUND";
type PlanCostFactsResult =
  | { readonly ok: true; readonly facts: PublishedPlanFacts }
  | { readonly ok: false; readonly problem: PlanCostFactsProblem };
interface PlanCostFactsPort {
  publishedFacts(weekKey: string): Promise<PlanCostFactsResult>;
  publishedFactsForVersion(planVersionId: string): Promise<PlanCostFactsResult>; // <- Einstieg
  publishedVersions(from: string, to: string): Promise<PublishedVersionsListResult>;
}

// domain/planned-work-fact.ts
interface PublishedPlanFacts {
  readonly planVersionId: PlanVersionId;
  readonly weekKey: string;
  readonly timeZone: string;
  readonly publishedAt: Date;
  readonly work: readonly PlannedWorkFact[];
  readonly employeeLabels: ReadonlyMap<string, string>;
  readonly worksiteLabels: ReadonlyMap<string, string>; // <- Quelle der Worksite-Pruefung
}
interface PlannedWorkFact {
  readonly assignmentId: AssignmentId;
  readonly employeeId: EmployeeId;
  readonly worksiteId: WorksiteId;
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date;
}

// application/rate-repository.port.ts
interface RateRepository {
  versionsFor(employeeId: string): Promise<readonly RateVersionRecord[]>;
  append(version: NewRateVersion): Promise<RateWriteResult>; // <- Task 10 fasst das NICHT an
}

// domain/cost-snapshot-assembly.ts
interface SnapshotAssemblyInput {
  readonly facts: PublishedPlanFacts;
  readonly worksiteFilter: string | null;
  readonly employeeLabels: ReadonlyMap<string, string>;
  readonly worksiteLabels: ReadonlyMap<string, string>;
  readonly ratesByEmployee: ReadonlyMap<string, readonly RateVersionRecord[]>;
}
type SnapshotAssemblyResult =
  | { readonly ok: true; readonly positions: readonly AssembledPosition[] }
  | {
      readonly ok: false;
      readonly problem: SnapshotAssemblyProblem;
      readonly assignmentId: string | null;
      readonly employeeId: string | null;
      readonly localDate: string | null;
    };

// application/cost-snapshot-repository.port.ts
type SnapshotWriteProblem =
  "IDEMPOTENCY_KEY_REUSED" | "WORKSITE_NOT_IN_ORG" | "WRITE_CHANNEL_REJECTED";
type SnapshotReadProblem = "SNAPSHOT_NOT_FOUND";
type SnapshotWriteResult =
  | { readonly ok: true; readonly snapshotId: string }
  | { readonly ok: false; readonly problem: SnapshotWriteProblem };
type SnapshotReadResult =
  | { readonly ok: true; readonly snapshot: StoredCostSnapshot }
  | { readonly ok: false; readonly problem: SnapshotReadProblem };
interface CostSnapshotRepository {
  create(input: NewCostSnapshot): Promise<SnapshotWriteResult>;
  read(snapshotId: string): Promise<SnapshotReadResult>;
}
// NewCostSnapshot: organisationId, planVersionId, worksiteId, weekKey, timeZone,
//                  currency: "EUR", ruleVersion, totalMinorUnits: bigint, createdAt: Date,
//                  correlationId, idempotencyKey, positions: readonly AssembledPosition[]
```

Drei Konsequenzen, die beim Schreiben leicht falsch laufen:

1. `NewCostSnapshot.ruleVersion` ist `CostRuleVersion = AssembledPosition["ruleVersion"] =
typeof COST_RULE_VERSION`. Der Wert kommt aus `@easytree/domain`, **nicht** aus
   `positions[0].ruleVersion` — ein leerer Snapshot hat keine erste Position.
2. `NewCostSnapshot.planVersionId`, `weekKey` und `timeZone` kommen aus den **Fakten**, nicht aus
   dem Kommando. Die Fakten sind die gelesene Wahrheit; das Kommando ist eine Behauptung.
3. `create` gibt nur eine Id zurueck. Der Portkopf sagt ausdruecklich, warum: eine aus der Eingabe
   rekonstruierte Antwort saehe im Wiederholungsfall anders aus als beim ersten Aufruf.

---

## Task 1.0: Diesen Plan committen (Vorlauf, kein Code)

**Dateien:** Create: `docs/plans/2026-08-09-eyt-109-task-10-create-cost-snapshot.md`

**Schritt 1: Ablegen und pruefen**

```bash
cd /private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/53a83129-a6b7-4e6a-9575-6b82421267b5/scratchpad/eyt109-wt
git branch --show-current          # erwartet: feat/eyt-109-daily-plan-cost-snapshot
git rev-parse HEAD                 # erwartet: 01cc751e5c06268a2674eef14e29579e3a1cb376
pnpm exec prettier --check docs/plans/2026-08-09-eyt-109-task-10-create-cost-snapshot.md
```

**Schritt 2: Committen**

```bash
git add docs/plans/2026-08-09-eyt-109-task-10-create-cost-snapshot.md
git diff --cached --name-only      # erwartet: genau diese eine Datei
git commit -m "docs(plan): EYT-109 — Task-10-Plan mit den drei PO-Korrekturen"
```

---

## Task 1.1: PR #69 auf den akzeptierten Stand bringen

Der Body beschreibt derzeit Task 8. Das ist vor Beginn von Task 10 zu korrigieren — ein PR-Body
wird spaeter als Evidenz gelesen.

**Schritt 1: Bestehenden Body sichern (nicht aus dem Kopf neu schreiben)**

```bash
gh pr view 69 --json body --jq .body > /tmp/pr69-body-before.md
wc -l /tmp/pr69-body-before.md
```

**Schritt 2: Body bearbeiten — bestehende Evidenz zu Tasks 5–8 vollstaendig erhalten**

Nur den Statusabschnitt ersetzen bzw. ergaenzen um:

```text
Tasks 1–9 implemented
Tasks 5–9 accepted at their current evidence gates
Task 10+ not started

Task 9:
Snapshot repository application port implemented
CI 31334288603
11/11 mandatory jobs green

Current head:
01cc751e5c06268a2674eef14e29579e3a1cb376

PR remains Draft.
DO NOT MERGE.
```

Regel aus CLAUDE.md/Memory: **komponieren → erneut lesen → senden.** Kein Entwurfsfragment in den
veroeffentlichten Body.

```bash
gh pr edit 69 --body-file /tmp/pr69-body-new.md
gh pr view 69 --json body --jq .body | head -60     # tatsaechlichen Body nachlesen
gh pr view 69 --json isDraft,state --jq '{isDraft, state}'   # erwartet: true / OPEN
```

**Schritt 3: Gegenprobe auf Verlust**

```bash
gh pr view 69 --json body --jq .body > /tmp/pr69-body-after.md
diff /tmp/pr69-body-before.md /tmp/pr69-body-after.md
```

Der Diff darf **nur** Zugewinn und den ersetzten Statusblock zeigen. Verschwindet Evidenz zu
Tasks 5–8, ist der Body falsch — zuruecksetzen und neu komponieren.

---

## Task 2: Der rote Test

**Dateien:** Create: `apps/api/test/costs/create-cost-snapshot.use-case.test.ts`

### Vor dem Start

```bash
cd /private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/53a83129-a6b7-4e6a-9575-6b82421267b5/scratchpad/eyt109-wt
pnpm --filter @easytree/domain build
pnpm --filter @easytree/contracts build
```

Pflicht, nicht Vorsicht: `noEmitOnError` ist nirgends gesetzt. Ein alter `dist/` faerbt den
Einzeltest gruen, ohne die neue Regel je auszufuehren (Memory `api-tests-read-stale-contracts-dist`).

### Schritt 1: Den Test schreiben

`apps/api/test/costs/create-cost-snapshot.use-case.test.ts`:

```ts
/**
 * Der Snapshot-Command (EYT-109, Task 10).
 *
 * Gestellte Ports, keine Datenbank, kein NestJS, keine Systemuhr. Was hier rot
 * wird, ist eine Reihenfolge- oder Blockadeentscheidung des Use-Cases und kein
 * Verdrahtungsfehler.
 *
 * Die Zaehler `create`/`read` sind Absicht und nicht Bequemlichkeit: die
 * zentrale Zusicherung von Task 10 ist NEGATIV — vor einem fachlichen Blocker
 * darf nichts geschrieben werden. Eine Zusicherung ueber etwas, das NICHT
 * passiert ist, braucht einen Zeugen, der mitzaehlt.
 */
import { describe, expect, it } from "vitest";
import { COST_RULE_VERSION, unsafeIdentifier } from "@easytree/domain";
import type { AssignmentId, EmployeeId, PlanVersionId, WorksiteId } from "@easytree/domain";
// Ausschliesslich ueber die oeffentliche Modul-API — ein tiefer Pfad nach
// `costs/application/` faellt am Waechter `costs-cross-module-public-api-only`.
import { createCostSnapshot } from "../../src/modules/costs";
import type {
  CreateCostSnapshotCommand,
  CreateCostSnapshotDependencies,
  CostSnapshotRepository,
  NewCostSnapshot,
  PlanCostFactsPort,
  PlanCostFactsResult,
  PlannedWorkFact,
  PublishedPlanFacts,
  RateRepository,
  RateVersion,
  SnapshotReadResult,
  SnapshotWriteResult,
  StoredCostSnapshot,
} from "../../src/modules/costs";

const ANNA = unsafeIdentifier<EmployeeId>("22222222-2222-4222-8222-222222222222");
const BERND = unsafeIdentifier<EmployeeId>("27777777-2777-4777-8777-277777777777");
const NORD = unsafeIdentifier<WorksiteId>("33333333-3333-4333-8333-333333333333");
const SUED = unsafeIdentifier<WorksiteId>("38888888-3888-4888-8888-388888888888");
const FREMD = "39999999-3999-4999-8999-399999999999";
const PLANVERSION = unsafeIdentifier<PlanVersionId>("44444444-4444-4444-8444-444444444444");
const SNAPSHOT_ID = "77777777-7777-4777-8777-777777777777";
const UHRZEIT = new Date("2026-06-20T08:30:00.000Z");

// 08:00–16:00 Berlin am 2026-06-15 = 06:00–14:00 UTC. Acht Stunden.
const EINSATZ_NORD: PlannedWorkFact = {
  assignmentId: unsafeIdentifier<AssignmentId>("11111111-1111-4111-8111-111111111111"),
  employeeId: ANNA,
  worksiteId: NORD,
  startsAtUtc: new Date("2026-06-15T06:00:00.000Z"),
  endsAtUtc: new Date("2026-06-15T14:00:00.000Z"),
};

// Zweite Baustelle, andere Person — trennt „gefiltert" von „zufaellig gleich".
const EINSATZ_SUED: PlannedWorkFact = {
  assignmentId: unsafeIdentifier<AssignmentId>("16666666-1666-4666-8666-166666666666"),
  employeeId: BERND,
  worksiteId: SUED,
  startsAtUtc: new Date("2026-06-16T06:00:00.000Z"),
  endsAtUtc: new Date("2026-06-16T10:00:00.000Z"),
};

function fakten(ueberschreibung: Partial<PublishedPlanFacts> = {}): PublishedPlanFacts {
  return {
    planVersionId: PLANVERSION,
    weekKey: "2026-W25",
    timeZone: "Europe/Berlin",
    publishedAt: new Date("2026-06-10T09:15:00.000Z"),
    work: [EINSATZ_NORD, EINSATZ_SUED],
    employeeLabels: new Map<string, string>([
      [ANNA, "Anna Bauer"],
      [BERND, "Bernd Christ"],
    ]),
    worksiteLabels: new Map<string, string>([
      [NORD, "Baustelle Nord"],
      [SUED, "Baustelle Sued"],
    ]),
    ...ueberschreibung,
  };
}

function satz(ueberschreibung: Partial<RateVersion> = {}): RateVersion {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    employeeId: ANNA,
    amountMinorUnits: "2500", // 25,00 EUR/h
    currency: "EUR",
    validFrom: "2026-01-01",
    validTo: null,
    predecessorId: null,
    reason: "Ersteintrag",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "66666666-6666-4666-8666-666666666666",
    ...ueberschreibung,
  };
}

/** Der gespeicherte Stand ist ABSICHTLICH anders als die Eingabe. */
function gespeichert(ueberschreibung: Partial<StoredCostSnapshot> = {}): StoredCostSnapshot {
  return {
    id: SNAPSHOT_ID,
    organisationId: "88888888-8888-4888-8888-888888888888",
    planVersionId: PLANVERSION,
    worksiteId: null,
    weekKey: "2026-W25",
    timeZone: "Europe/Berlin",
    currency: "EUR",
    ruleVersion: COST_RULE_VERSION,
    totalMinorUnits: 999n, // erkennbar NICHT die Eingabesumme
    createdAt: UHRZEIT,
    createdBy: "99999999-9999-4999-8999-999999999999", // gibt es in der Eingabe gar nicht
    correlationId: "corr-1",
    positions: [],
    ...ueberschreibung,
  };
}

interface Zeuge {
  readonly deps: CreateCostSnapshotDependencies;
  readonly createAufrufe: NewCostSnapshot[];
  readonly readAufrufe: string[];
  readonly versionsForAufrufe: string[];
}

function zeuge(
  optionen: {
    readonly faktenErgebnis?: PlanCostFactsResult;
    readonly schreibErgebnis?: SnapshotWriteResult;
    readonly leseErgebnis?: SnapshotReadResult;
    readonly saetze?: ReadonlyMap<string, readonly RateVersion[]>;
  } = {},
): Zeuge {
  const createAufrufe: NewCostSnapshot[] = [];
  const readAufrufe: string[] = [];
  const versionsForAufrufe: string[] = [];
  const saetze =
    optionen.saetze ??
    new Map<string, readonly RateVersion[]>([
      [ANNA, [satz()]],
      [BERND, [satz({ id: "55555555-5555-4555-8555-55555555bbbb", employeeId: BERND })]],
    ]);

  const facts: PlanCostFactsPort = {
    publishedFacts: () => {
      throw new Error("publishedFacts(weekKey) ist NICHT der Einstieg von Task 10.");
    },
    publishedFactsForVersion: async () => optionen.faktenErgebnis ?? { ok: true, facts: fakten() },
    publishedVersions: () => {
      throw new Error("publishedVersions gehoert zur Auswahlliste, nicht zum Snapshot.");
    },
  };

  const rates: RateRepository = {
    versionsFor: async (employeeId) => {
      versionsForAufrufe.push(employeeId);
      return saetze.get(employeeId) ?? [];
    },
    append: () => {
      throw new Error("Task 10 schreibt keine Saetze.");
    },
  };

  const repository: CostSnapshotRepository = {
    create: async (input) => {
      createAufrufe.push(input);
      return optionen.schreibErgebnis ?? { ok: true, snapshotId: SNAPSHOT_ID };
    },
    read: async (snapshotId) => {
      readAufrufe.push(snapshotId);
      return optionen.leseErgebnis ?? { ok: true, snapshot: gespeichert() };
    },
  };

  return {
    deps: { facts, rates, repository, now: () => UHRZEIT },
    createAufrufe,
    readAufrufe,
    versionsForAufrufe,
  };
}

function kommando(
  ueberschreibung: Partial<CreateCostSnapshotCommand> = {},
): CreateCostSnapshotCommand {
  return {
    organisationId: "88888888-8888-4888-8888-888888888888",
    publishedPlanVersionId: PLANVERSION,
    worksiteId: null,
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
    ...ueberschreibung,
  };
}

describe("createCostSnapshot", () => {
  it("Fall 1 — schreibt Kopf und ALLE Positionen in genau einem Aufruf und liefert den gelesenen Stand", async () => {
    const z = zeuge();
    const ergebnis = await createCostSnapshot(z.deps, kommando());

    expect(z.createAufrufe).toHaveLength(1);
    const geschrieben = z.createAufrufe[0];
    expect(geschrieben?.positions).toHaveLength(2);
    // 8 h * 25,00 + 4 h * 25,00 = 300,00 EUR, exakt in Minor Units.
    expect(geschrieben?.totalMinorUnits).toBe(30000n);
    expect(geschrieben?.planVersionId).toBe(PLANVERSION); // aus den Fakten, nicht dem Kommando
    expect(geschrieben?.weekKey).toBe("2026-W25");
    expect(geschrieben?.timeZone).toBe("Europe/Berlin");
    expect(geschrieben?.ruleVersion).toBe(COST_RULE_VERSION);
    expect(geschrieben?.idempotencyKey).toBe("idem-1");

    // Genau die zurueckgegebene Id wird gelesen — keine andere, und nur einmal.
    expect(z.readAufrufe).toEqual([SNAPSHOT_ID]);

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    // Persistenzwahrheit, NICHT die Eingabe: `createdBy` und `totalMinorUnits`
    // existieren so nur im gespeicherten Stand.
    expect(ergebnis.snapshot.createdBy).toBe("99999999-9999-4999-8999-999999999999");
    expect(ergebnis.snapshot.totalMinorUnits).toBe(999n);
  });

  it("Fall 2 — PLAN_NOT_PUBLISHED blockiert vor Satzlesung, create und read", async () => {
    const z = zeuge({ faktenErgebnis: { ok: false, problem: "PLAN_NOT_PUBLISHED" } });
    const ergebnis = await createCostSnapshot(z.deps, kommando());

    expect(z.versionsForAufrufe).toEqual([]);
    expect(z.createAufrufe).toEqual([]);
    expect(z.readAufrufe).toEqual([]);
    expect(ergebnis).toEqual({ ok: false, stage: "FACTS", problem: "PLAN_NOT_PUBLISHED" });
  });

  it("Fall 3 — PLAN_VERSION_NOT_FOUND blockiert vor Satzlesung, create und read", async () => {
    const z = zeuge({ faktenErgebnis: { ok: false, problem: "PLAN_VERSION_NOT_FOUND" } });
    const ergebnis = await createCostSnapshot(z.deps, kommando());

    expect(z.versionsForAufrufe).toEqual([]);
    expect(z.createAufrufe).toEqual([]);
    expect(z.readAufrufe).toEqual([]);
    expect(ergebnis).toEqual({ ok: false, stage: "FACTS", problem: "PLAN_VERSION_NOT_FOUND" });
  });

  it("Fall 4 — RATE_NOT_FOUND schreibt nichts und erhaelt employeeId und localDate", async () => {
    const z = zeuge({ saetze: new Map([[BERND, [satz({ employeeId: BERND })]]]) }); // Anna ohne Satz
    const ergebnis = await createCostSnapshot(z.deps, kommando());

    expect(z.createAufrufe).toEqual([]);
    expect(z.readAufrufe).toEqual([]);
    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.stage).toBe("ASSEMBLY");
    if (ergebnis.stage !== "ASSEMBLY") return;
    expect(ergebnis.problem).toBe("RATE_NOT_FOUND");
    expect(ergebnis.employeeId).toBe(ANNA);
    expect(ergebnis.localDate).toBe("2026-06-15");
  });

  it("Fall 5 — RATE_AMBIGUOUS schreibt nichts und erhaelt employeeId und localDate", async () => {
    // Zwei Saetze, deren Gueltigkeit denselben Leistungstag ueberdeckt.
    const z = zeuge({
      saetze: new Map([
        [
          ANNA,
          [satz(), satz({ id: "55555555-5555-4555-8555-5555555aaaaa", amountMinorUnits: "3000" })],
        ],
        [BERND, [satz({ employeeId: BERND })]],
      ]),
    });
    const ergebnis = await createCostSnapshot(z.deps, kommando());

    expect(z.createAufrufe).toEqual([]);
    expect(z.readAufrufe).toEqual([]);
    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.stage).toBe("ASSEMBLY");
    if (ergebnis.stage !== "ASSEMBLY") return;
    expect(ergebnis.problem).toBe("RATE_AMBIGUOUS");
    expect(ergebnis.employeeId).toBe(ANNA);
    expect(ergebnis.localDate).toBe("2026-06-15");
  });

  it("Fall 6 — fremde Baustellen-Id ergibt WORKSITE_NOT_IN_ORG, ohne Satzlesung und ohne Schreiben", async () => {
    const z = zeuge();
    const ergebnis = await createCostSnapshot(z.deps, kommando({ worksiteId: FREMD }));

    expect(z.versionsForAufrufe).toEqual([]);
    expect(z.createAufrufe).toEqual([]);
    expect(z.readAufrufe).toEqual([]);
    expect(ergebnis).toEqual({ ok: false, stage: "WRITE", problem: "WORKSITE_NOT_IN_ORG" });
  });

  it("Fall 7 — eigene Baustelle mit Einsaetzen nutzt nur deren Mitarbeitende, Saetze und Positionen", async () => {
    const z = zeuge();
    const ergebnis = await createCostSnapshot(z.deps, kommando({ worksiteId: SUED }));

    // Anna arbeitet nur auf Nord — ihre Satzhistorie wird gar nicht erst geholt.
    expect(z.versionsForAufrufe).toEqual([BERND]);
    expect(z.createAufrufe).toHaveLength(1);
    expect(z.createAufrufe[0]?.positions).toHaveLength(1);
    expect(z.createAufrufe[0]?.positions[0]?.employeeId).toBe(BERND);
    expect(z.createAufrufe[0]?.totalMinorUnits).toBe(10000n); // 4 h * 25,00
    expect(z.createAufrufe[0]?.worksiteId).toBe(SUED);
    expect(ergebnis.ok).toBe(true);
  });

  it("Fall 8 — eigene Baustelle ohne Einsaetze ergibt einen gueltigen Snapshot mit 0n und leerer Liste", async () => {
    const z = zeuge({
      faktenErgebnis: {
        ok: true,
        facts: fakten({
          work: [EINSATZ_NORD],
          // Sued ist eine eigene Baustelle, hat aber keinen Einsatz.
          worksiteLabels: new Map<string, string>([
            [NORD, "Baustelle Nord"],
            [SUED, "Baustelle Sued"],
          ]),
        }),
      },
    });
    const ergebnis = await createCostSnapshot(z.deps, kommando({ worksiteId: SUED }));

    expect(z.versionsForAufrufe).toEqual([]); // niemand ist beteiligt
    expect(z.createAufrufe).toHaveLength(1);
    expect(z.createAufrufe[0]?.positions).toEqual([]);
    expect(z.createAufrufe[0]?.totalMinorUnits).toBe(0n);
    // Der Kopf traegt die Regel trotzdem — es gibt keine erste Position, aus der
    // man sie ableiten koennte.
    expect(z.createAufrufe[0]?.ruleVersion).toBe(COST_RULE_VERSION);
    expect(ergebnis.ok).toBe(true);
  });

  it("Fall 9 — createdAt ist der injizierte Zeitpunkt, nicht die Systemuhr", async () => {
    const z = zeuge();
    const vorher = new Date();
    await createCostSnapshot(z.deps, kommando());

    expect(z.createAufrufe[0]?.createdAt).toBe(UHRZEIT);
    // Gegenprobe: der Wert liegt nachweislich NICHT im Fenster dieses Laufs.
    expect(z.createAufrufe[0]?.createdAt.getTime()).toBeLessThan(vorher.getTime());
  });

  it.each([["IDEMPOTENCY_KEY_REUSED"], ["WRITE_CHANNEL_REJECTED"]] as const)(
    "Fall 10 — %s wird unveraendert durchgereicht, ohne read",
    async (problem) => {
      const z = zeuge({ schreibErgebnis: { ok: false, problem } });
      const ergebnis = await createCostSnapshot(z.deps, kommando());

      expect(z.createAufrufe).toHaveLength(1);
      expect(z.readAufrufe).toEqual([]);
      expect(ergebnis).toEqual({ ok: false, stage: "WRITE", problem });
    },
  );

  it("Fall 11 — ein idempotenter Wiederholungsaufruf liefert dieselbe Persistenzwahrheit", async () => {
    // Das Repository antwortet mit der Id des BESTEHENDEN Snapshots (Retry).
    const bestehend = gespeichert({
      totalMinorUnits: 30000n,
      createdAt: new Date("2026-06-19T05:00:00.000Z"),
    });
    const z = zeuge({
      schreibErgebnis: { ok: true, snapshotId: SNAPSHOT_ID },
      leseErgebnis: { ok: true, snapshot: bestehend },
    });
    const ergebnis = await createCostSnapshot(z.deps, kommando());

    expect(z.readAufrufe).toEqual([SNAPSHOT_ID]);
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    // Der frueher gespeicherte Zeitpunkt gewinnt gegen die Uhr dieses Laufs —
    // genau das ist der Beweis, dass nichts rekonstruiert wurde.
    expect(ergebnis.snapshot.createdAt).toEqual(new Date("2026-06-19T05:00:00.000Z"));
    expect(ergebnis.snapshot).toBe(bestehend);
  });
});
```

**Hinweis zu Fall 5:** Ob zwei ueberlappende Saetze `RATE_AMBIGUOUS` ergeben, entscheidet
`rate-effectivity.ts`, nicht dieser Test. Beim Schreiben pruefen: liefert die Montage stattdessen
`RATE_NOT_FOUND` oder gar Erfolg, ist das Fixture falsch gebaut — dann die Gueltigkeiten so
setzen, dass **beide** Saetze den 2026-06-15 abdecken (z. B. `validFrom: "2026-01-01"` bei beiden,
`validTo: null`). Nicht die Zusicherung an das Fixture anpassen, sondern das Fixture an die Regel.

### Schritt 2: Rot messen — und zwar fachlich rot

```bash
pnpm --filter @easytree/api exec vitest run test/costs/create-cost-snapshot.use-case.test.ts
```

Erwartet in diesem ersten Lauf: Fehlschlag, weil `createCostSnapshot` aus
`../../src/modules/costs` nicht exportiert wird. Das ist **Struktur**-rot, kein fachliches Rot —
es zaehlt nur als „der Test laeuft ueberhaupt". Der fachliche Rotnachweis kommt in Task 5
(Gegenmutationen), wo die Implementierung existiert und gezielt verletzt wird. Dieser Unterschied
ist explizit zu protokollieren; ihn zu verwischen waere genau der Fehler, den die Regel
„Gegenmutation statt gruener Haken" adressiert.

---

## Task 3: Die Implementierung

**Dateien:** Create: `apps/api/src/modules/costs/application/create-cost-snapshot.use-case.ts`

### Schritt 1: Datei schreiben

```ts
/**
 * Der Snapshot-Command (EYT-109, Task 10).
 *
 * ## Was dieser Use-Case ist
 *
 * Orchestrierung, sonst nichts. Er liest versionsgenaue Planfakten, prueft den
 * Baustellenfilter, holt die noetigen Satzhistorien, laesst die Domaene montieren,
 * bildet die Summe, schreibt einmal und liest den geschriebenen Stand zurueck.
 * Jede fachliche Entscheidung liegt woanders: die Satzauswahl je Leistungstag in
 * `assembleCostSnapshotPositions`, die Mandantengrenze in RLS und in der
 * `CostAccessPolicy`, die Kanalgrenze in der Datenbank.
 *
 * ## Warum die Reihenfolge bindend ist
 *
 * Ein Snapshot ist ein unveraenderliches Dokument: es gibt kein `update` und kein
 * `delete` (Migration 0018, keine Grants). Was faelschlich geschrieben wurde,
 * bleibt. Deshalb steht JEDE Blockade vor `create` — nicht aus Stilgefuehl,
 * sondern weil der Teilzustand sonst dauerhaft waere.
 *
 * ## Warum nach dem Schreiben gelesen wird
 *
 * `create` gibt nur eine Id zurueck; Positions-Ids, `createdBy` und der
 * tatsaechlich gespeicherte Kopf entstehen in der Datenbank. Aus der Eingabe
 * eine Antwort zu rekonstruieren hiesse, im Wiederholungsfall etwas anderes zu
 * antworten als beim ersten Aufruf — obwohl beide denselben Vorgang meinen. Ein
 * Replay-Kennzeichen braucht es dadurch nicht: die Aufruferin bekommt in beiden
 * Faellen denselben gespeicherten Stand.
 *
 * ## Was hier bewusst NICHT steht
 *
 * Keine Uhr (`now` reist als Abhaengigkeit herein), keine Id-Erzeugung, keine
 * Tagessummen (`days` entsteht an der HTTP-Naht, Task 13), keine Zod-Pruefung,
 * keine Autorisierung, kein Audit, kein `subjectUserId` — die uebergebenen Ports
 * sind bereits an das Subjekt der Anfrage gebunden (Factory-Muster).
 */
import { COST_RULE_VERSION } from "@easytree/domain";
import { assembleCostSnapshotPositions } from "../domain/cost-snapshot-assembly";
import type { SnapshotAssemblyResult } from "../domain/cost-snapshot-assembly";
import type {
  CostSnapshotRepository,
  SnapshotReadResult,
  SnapshotWriteProblem,
  SnapshotWriteResult,
  StoredCostSnapshot,
} from "./cost-snapshot-repository.port";
import type { PlanCostFactsPort, PlanCostFactsResult } from "./plan-cost-facts.port";
import type { RateRepository, RateVersionRecord } from "./rate-repository.port";

/**
 * Das Kommando.
 *
 * `organisationId` ist eine bereits SERVERSEITIG aufgeloeste Tatsache aus der
 * `CostAccessPolicy` und stammt nie aus `CreateCostSnapshotCommandSchema`: der
 * HTTP-Rumpf kennt nur `publishedPlanVersionId` und `worksiteId`. Eine
 * clientseitige Organisationsautoritaet gaebe es damit nicht — und soll es auch
 * nicht geben (REQ-002).
 */
export interface CreateCostSnapshotCommand {
  readonly organisationId: string;
  readonly publishedPlanVersionId: string;
  /** `null` = alle Baustellen der Planversion. */
  readonly worksiteId: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface CreateCostSnapshotDependencies {
  readonly facts: PlanCostFactsPort;
  readonly rates: RateRepository;
  readonly repository: CostSnapshotRepository;
  /**
   * Die Uhr als kleinste moegliche Abhaengigkeit.
   *
   * Kein globaler Clock-Dienst: ein `now: () => Date` ist im Test ein Literal
   * und in der Verdrahtung ein Einzeiler. Ein `new Date()` im Rumpf machte den
   * Erstellungszeitpunkt unpruefbar.
   */
  readonly now: () => Date;
}

/**
 * Der Fehlerzweig eines bestehenden Resultattyps, ohne dessen `ok`.
 *
 * `Extract` statt abgeschriebener Stringlisten: verschwaende jemand einen Grund
 * aus einer der eingefrorenen Listen, wird dieser Typ enger und die betroffene
 * Rueckgabe kompiliert nicht mehr. Eine zweite Liste haette den Verlust
 * verschwiegen.
 */
type Failure<T> = Omit<Extract<T, { ok: false }>, "ok">;

/**
 * Warum kein Snapshot entstanden ist — nach Abschnitt getrennt.
 *
 * Das `stage`-Feld ist keine zweite Fehlertaxonomie, sondern die Herkunft: die
 * Problemnamen selbst sind unveraendert die der bestehenden Ports. Es steht hier,
 * weil nur der Montagezweig Kontextfelder traegt und die HTTP-Abbildung (Task 13)
 * ohne `as`-Cast erschoepfend werden soll.
 */
export type CreateCostSnapshotFailure =
  | ({ readonly stage: "FACTS" } & Failure<PlanCostFactsResult>)
  | ({ readonly stage: "ASSEMBLY" } & Failure<SnapshotAssemblyResult>)
  | ({ readonly stage: "WRITE" } & Failure<SnapshotWriteResult>)
  | ({ readonly stage: "READ" } & Failure<SnapshotReadResult>);

export type CreateCostSnapshotResult =
  | { readonly ok: true; readonly snapshot: StoredCostSnapshot }
  | ({ readonly ok: false } & CreateCostSnapshotFailure);

/**
 * Derselbe Grund, den das Repository beim Schreiben nennt — hier nur frueher.
 *
 * Ueber `Extract` an die eingefrorene Liste gebunden statt als nacktes Literal:
 * verschwaende der Name dort, wuerde dieser Typ `never` und die Zuweisung rot.
 * Ein zweiter, unabhaengiger String saehe dagegen bis zur HTTP-Naht korrekt aus.
 */
const WORKSITE_NOT_IN_ORG: Extract<SnapshotWriteProblem, "WORKSITE_NOT_IN_ORG"> =
  "WORKSITE_NOT_IN_ORG";

export async function createCostSnapshot(
  deps: CreateCostSnapshotDependencies,
  command: CreateCostSnapshotCommand,
): Promise<CreateCostSnapshotResult> {
  // 1. Versionsgenaue Fakten. Nicht `publishedFacts(weekKey)`: dessen Antwort
  //    haengt an der Woche und koennte einen neuen, unveroeffentlichten Entwurf
  //    derselben Woche einfrieren.
  const faktenErgebnis = await deps.facts.publishedFactsForVersion(command.publishedPlanVersionId);
  if (!faktenErgebnis.ok) {
    return { ok: false, stage: "FACTS", problem: faktenErgebnis.problem };
  }
  const facts = faktenErgebnis.facts;

  // 2. Baustellenfilter gegen die BEZEICHNUNGEN pruefen, nicht gegen die
  //    Einsaetze: eine eigene Baustelle ohne Einsatz bleibt eine eigene
  //    Baustelle und ergibt einen leeren Snapshot. Wer hier „hat mindestens
  //    einen Einsatz" pruefte, verwandelte ein leeres Ergebnis in einen Fehler.
  if (command.worksiteId !== null && !facts.worksiteLabels.has(command.worksiteId)) {
    return { ok: false, stage: "WRITE", problem: WORKSITE_NOT_IN_ORG };
  }

  // 3. Nur die tatsaechlich beteiligten Mitarbeitenden, dedupliziert. Ein
  //    ungefiltertes Laden waere eine Satzlesung fuer Personen, die im Snapshot
  //    nicht vorkommen.
  const relevant =
    command.worksiteId === null
      ? facts.work
      : facts.work.filter((einsatz) => einsatz.worksiteId === command.worksiteId);
  const employeeIds = [...new Set<string>(relevant.map((einsatz) => einsatz.employeeId))];
  const historien = await Promise.all(
    employeeIds.map(
      async (employeeId) => [employeeId, await deps.rates.versionsFor(employeeId)] as const,
    ),
  );
  const ratesByEmployee: ReadonlyMap<string, readonly RateVersionRecord[]> = new Map(historien);

  // 4. Montage. Die Auswahl des Satzes je lokalem Leistungstag passiert
  //    ausschliesslich dort.
  const montage = assembleCostSnapshotPositions({
    facts,
    worksiteFilter: command.worksiteId,
    employeeLabels: facts.employeeLabels,
    worksiteLabels: facts.worksiteLabels,
    ratesByEmployee,
  });
  if (!montage.ok) {
    // Vollstaendig erhalten — `employeeId` und `localDate` sind der Unterschied
    // zwischen „ein Satz fehlt" und „irgendwo fehlt ein Satz".
    return {
      ok: false,
      stage: "ASSEMBLY",
      problem: montage.problem,
      assignmentId: montage.assignmentId,
      employeeId: montage.employeeId,
      localDate: montage.localDate,
    };
  }

  // 5. Summe in Minor Units, durchgehend `bigint`. Ein `Number(...)` waere die
  //    Stelle, an der Genauigkeit still verloren geht.
  const totalMinorUnits = montage.positions.reduce(
    (summe, position) => summe + position.amountMinorUnits,
    0n,
  );

  // 6. Ein Schreibvorgang, Kopf und alle Positionen zusammen. `planVersionId`,
  //    `weekKey` und `timeZone` kommen aus den gelesenen Fakten, nicht aus dem
  //    Kommando; `ruleVersion` aus der kanonischen Konstante, nicht aus
  //    `positions[0]` — den gibt es bei leerer Liste nicht.
  const schreiben = await deps.repository.create({
    organisationId: command.organisationId,
    planVersionId: facts.planVersionId,
    worksiteId: command.worksiteId,
    weekKey: facts.weekKey,
    timeZone: facts.timeZone,
    currency: "EUR",
    ruleVersion: COST_RULE_VERSION,
    totalMinorUnits,
    createdAt: deps.now(),
    correlationId: command.correlationId,
    idempotencyKey: command.idempotencyKey,
    positions: montage.positions,
  });
  if (!schreiben.ok) {
    return { ok: false, stage: "WRITE", problem: schreiben.problem };
  }

  // 7. Persistenzwahrheit statt Rekonstruktion — auch und gerade beim Retry.
  const gelesen = await deps.repository.read(schreiben.snapshotId);
  if (!gelesen.ok) {
    return { ok: false, stage: "READ", problem: gelesen.problem };
  }
  return { ok: true, snapshot: gelesen.snapshot };
}
```

### Schritt 2: `index.ts` erweitern

`apps/api/src/modules/costs/index.ts` — direkt **hinter** dem Exportblock des
Snapshot-Repository-Ports (der Block endet mit `} from "./application/cost-snapshot-repository.port";`)
einfuegen:

```ts
// EYT-109: der Snapshot-Command. Steht in der oeffentlichen Modul-API, weil ihn
// die Verdrahtung (Task 13) und der Test von aussen brauchen — ein tiefer Pfad
// nach `application/` faellt am Waechter `costs-cross-module-public-api-only`.
export { createCostSnapshot } from "./application/create-cost-snapshot.use-case";
export type {
  CreateCostSnapshotCommand,
  CreateCostSnapshotDependencies,
  CreateCostSnapshotFailure,
  CreateCostSnapshotResult,
} from "./application/create-cost-snapshot.use-case";
```

Pruefen, ob `PlanCostFactsPort`, `RateRepository` und `PlannedWorkFact` bereits als Typen
exportiert werden — der Test importiert sie ueber die Modul-API. Fehlt einer, ist sein Zusatz
eine **gemessene** Compile-Abhaengigkeit und gehoert in denselben Commit:

```bash
grep -n "PlanCostFactsPort\|RateRepository\|PlannedWorkFact\|PublishedPlanFacts\|RateVersion\b" \
  apps/api/src/modules/costs/index.ts
```

### Schritt 3: Gruen messen

```bash
pnpm --filter @easytree/api exec vitest run test/costs/create-cost-snapshot.use-case.test.ts
```

Erwartet: 12 bestandene Faelle (Fall 10 laeuft zweimal ueber `it.each`).

---

## Task 4: Gruen-Gates

```bash
cd /private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/53a83129-a6b7-4e6a-9575-6b82421267b5/scratchpad/eyt109-wt
pnpm --filter @easytree/api exec vitest run \
  test/costs/create-cost-snapshot.use-case.test.ts \
  test/costs/cost-snapshot-assembly.test.ts \
  test/costs/planning-facts.adapter.test.ts \
  test/costs-module-boundaries.test.ts \
  test/architecture.test.ts
pnpm typecheck
pnpm lint
pnpm format
```

`pnpm format` meldet lokal moeglicherweise Dateien aus `penpot/` und `_sprint2-transfer/`, die CI
nie sieht. Bei Rauschen einschraenken: `pnpm exec prettier --check apps packages docs`.

Alle fuenf Suiten muessen gruen sein, **bevor** die Gegenmutationen beginnen — sonst misst man
hinterher nicht die Mutation, sondern einen Altfehler.

---

## Task 5: Gegenmutationen (mindestens vier, tatsaechlich ausgefuehrt)

Regeln, die hier zweimal weh getan haben und deshalb woertlich gelten:

- **Ausfuehren, nicht ausdenken.** Eine benannte, aber nie eingespielte Mutation ist kein Nachweis.
- **Vor dem Testlauf die Mutation belegen** (`git diff` zeigen), nicht nur behaupten.
- **Kohaerent mutieren.** Eine halbe Mutation zerbricht am internen Waechter; der rote Test misst
  dann die Selbstverteidigung des Codes, nicht die Regel. Ein `TypeError` oder Compilefehler ist
  **kein** fachlicher Rotnachweis, wenn die Mutation den behaupteten Fehler gar nicht modelliert.
- **Nichts committen.** Zuruecksetzen ueber eine **Sicherungskopie**, nicht ueber
  `git checkout --`: die Datei ist zu diesem Zeitpunkt bereits committet (Task 6 kommt danach),
  aber wenn dieser Ablauf je vor den Commit rutscht, stellt `checkout` den Commitstand her und
  nicht den Arbeitsstand — zweimal Arbeit verloren.

### Vorbereitung

```bash
U=apps/api/src/modules/costs/application/create-cost-snapshot.use-case.ts
cp "$U" /tmp/eyt109-usecase.orig
```

Nach **jeder** Mutation:

```bash
cp /tmp/eyt109-usecase.orig "$U"
git status --short          # erwartet: leer
```

### GM-T10-1 — `PLAN_NOT_PUBLISHED` ignorieren und trotzdem schreiben

Kohaerent heisst hier: nicht nur das `return` loeschen (dann fehlt `facts` und es gibt einen
Compilefehler), sondern den Fehlerzweig durch leere Fakten ersetzen:

```ts
const facts = faktenErgebnis.ok
  ? faktenErgebnis.facts
  : ({
      planVersionId: command.publishedPlanVersionId,
      weekKey: "2026-W25",
      timeZone: "Europe/Berlin",
      publishedAt: deps.now(),
      work: [],
      employeeLabels: new Map<string, string>(),
      worksiteLabels: new Map<string, string>(),
    } as unknown as PublishedPlanFacts);
```

Erwartet rot: **Fall 2 und Fall 3** — `createAufrufe` ist nicht mehr leer.

### GM-T10-2 — Worksite-Pruefung entfernen

Den gesamten `if (command.worksiteId !== null && …)`-Block loeschen.

Erwartet rot: **Fall 6** — statt `WORKSITE_NOT_IN_ORG` entsteht ein leerer Snapshot, `create` wird
aufgerufen.

### GM-T10-3 — bei `RATE_NOT_FOUND` trotzdem einen 0-Euro-Snapshot schreiben

```ts
const positions = montage.ok ? montage.positions : [];
```

und den Fehlerzweig streichen, danach durchgehend `positions` statt `montage.positions` verwenden.

Erwartet rot: **Fall 4 und Fall 5** — `createAufrufe` nicht leer, und das Ergebnis ist `ok: true`
statt eines Montagefehlers mit `employeeId`/`localDate`.

### GM-T10-4 — Summe ueber `Number(...)`

```ts
const totalMinorUnits = BigInt(
  montage.positions.reduce((summe, position) => summe + Number(position.amountMinorUnits), 0),
);
```

Erwartet rot: **Fall 1 und Fall 7**, sobald die Zusicherung auf `bigint` typgenau ist
(`toBe(30000n)` gegen `30000n` haelt — deshalb zusaetzlich pruefen:
`expect(typeof geschrieben?.totalMinorUnits).toBe("bigint")`). **Wenn diese Mutation gruen bleibt,
ist die Zusicherung zu schwach** — dann den Test verschaerfen, nicht die Mutation weglassen. Eine
belastbare Variante: eine Position mit `amountMinorUnits: 9007199254740993n` im Fixture, deren
Summe ueber `Number` nachweislich verspringt.

### GM-T10-5 — nach `create` aus der Eingabe rekonstruieren statt `read`

```ts
return {
  ok: true,
  snapshot: {
    id: schreiben.snapshotId,
    organisationId: command.organisationId,
    planVersionId: facts.planVersionId,
    worksiteId: command.worksiteId,
    weekKey: facts.weekKey,
    timeZone: facts.timeZone,
    currency: "EUR",
    ruleVersion: COST_RULE_VERSION,
    totalMinorUnits,
    createdAt: deps.now(),
    createdBy: command.organisationId,
    correlationId: command.correlationId,
    positions: montage.positions.map((p, i) => ({ ...p, id: String(i) })),
  } as unknown as StoredCostSnapshot,
};
```

Erwartet rot: **Fall 1** (`createdBy`, `totalMinorUnits`), **Fall 11** (`createdAt` des
bestehenden Snapshots) und die `readAufrufe`-Zusicherungen.

### GM-T10-6 — `createdAt` aus `new Date()`

```ts
    createdAt: new Date(),
```

Erwartet rot: **Fall 9** — beide Zusicherungen.

### Protokoll

Fuer jede ausgefuehrte Mutation festhalten: `git diff` (Ausschnitt), der Befehl, die **Namen** der
rot gewordenen Faelle, und dass der Arbeitsbaum danach wieder leer war. Mindestens vier; empfohlen
sind GM-T10-1, -2, -3, -5, -6 (die decken die fuenf Blockade- und Wahrheitszusagen ab), GM-T10-4
zusaetzlich, wenn die Summenzusicherung verschaerft wurde.

### Nach den Mutationen

```bash
git status --short   # erwartet: leer
pnpm --filter @easytree/api exec vitest run \
  test/costs/create-cost-snapshot.use-case.test.ts \
  test/costs/cost-snapshot-assembly.test.ts \
  test/costs-module-boundaries.test.ts \
  test/architecture.test.ts
pnpm typecheck
```

---

## Task 6: Commit

```bash
git status --short
git diff
git diff --check
```

Erwarteter Diff — **genau** drei Dateien (plus gemessene Compile-Abhaengigkeiten, falls
`index.ts`-Typexporte gefehlt haben; die stecken ohnehin in `index.ts`):

```text
A apps/api/src/modules/costs/application/create-cost-snapshot.use-case.ts
A apps/api/test/costs/create-cost-snapshot.use-case.test.ts
M apps/api/src/modules/costs/index.ts
```

```bash
git add apps/api/src/modules/costs/application/create-cost-snapshot.use-case.ts \
        apps/api/test/costs/create-cost-snapshot.use-case.test.ts \
        apps/api/src/modules/costs/index.ts
git diff --cached --name-only     # lesen, nicht ueberfliegen
git commit -m "feat(costs): EYT-109 — Snapshot-Command blockiert vor jedem Schreiben"
git status --short                # erwartet: leer
```

Benannte Pfade, kein verzeichnisweites `git add` — das hat schon zweimal Dutzende fremder Dateien
mitgenommen.

---

## Task 7: Push und CI

```bash
git push origin feat/eyt-109-daily-plan-cost-snapshot   # Fast-Forward, KEIN --force
git fetch origin
git rev-parse HEAD
git rev-parse @{u}        # muss identisch sein
```

Dann den neuen Lauf auf **exakt diesem** HEAD abwarten und **alle elf** Pflichtjobs einzeln lesen:

```bash
SHA=$(git rev-parse HEAD)
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$SHA" 3600
gh run list --commit "$SHA" --json databaseId,name,conclusion,headSha
gh run view <databaseId> --json jobs --jq '.jobs[] | "\(.name)\t\(.conclusion)"'
```

Erwartet: elf Zeilen, alle `success` — `format`, `lint`, `typecheck`, `unit-tests`, `build-web`,
`web-smoke`, `build-api`, `secret-scan`, `db-gates`, `read-through`, `auth-journey`. Der
Gesamtstatus des Workflows allein ist **kein** Nachweis.

PR #69 bleibt Draft. Kein Merge, kein Jira-Statuswechsel.

### Bei roter CI

Nur task-10-bezogene Ursachen reparieren. Root Cause **messen** (Joblog lesen, nicht raten),
kleinsten Fix bauen, bei einer ungemessenen Eigenschaft Regressionstest oder Gegenmutation
ergaenzen, committen, normal pushen, CI erneut vollstaendig lesen. Nach drei **unterschiedlichen**
gescheiterten Reparaturhypothesen:

```text
STOP — BLOCKED_AFTER_THREE_HYPOTHESES
```

---

## Task 8: PR-Body und Handoff

Task 11 **nicht** beginnen.

PR-Body auf Tasks 1–10 und den neuen CI-HEAD aktualisieren, weiterhin `DRAFT` / `DO NOT MERGE`,
bestehende Evidenz erhalten, danach den tatsaechlichen Body nachlesen.

Der Handoff enthaelt zwingend:

1. Remote-HEAD und `@{u}` (identisch nachgewiesen)
2. CI-Run-Id und die elf Jobzeilen
3. den exakten Task-10-Diff (`git show --stat`)
4. Kommando- und Resultatform des Use-Cases
5. die Reihenfolge der Orchestrierung, so wie sie im Code steht
6. jeden Blockadefall und den Beleg, dass davor nicht geschrieben wurde
7. den `bigint`-Summennachweis
8. die Clock-Evidenz (Fall 9)
9. jede **tatsaechlich gefahrene** Gegenmutation mit den rot gewordenen Fallnamen
10. die beiden offenen Architekturfindings unten

Endstatus:

```text
Task 5: VERIFIED
Task 6: VERIFIED
Task 7: EXECUTION VERIFIED / MUTATION GATE PENDING TASK 19
Task 8: VERIFIED
Task 9: VERIFIED
Task 10: VERIFIED oder BLOCKED
Task 11: NOT STARTED

EYT-109: IN PROGRESS
EYT-110: NOT STARTED
EYT-130: NOT DONE

PR #69: DRAFT
MERGE: NOT PERFORMED
JIRA TRANSITION: NOT PERFORMED
```

Final genau eines: `READY_FOR_PO_REVIEW_BEFORE_TASK_11` oder `BLOCKED_<reason>`. Dann STOP.

---

## Offene Architekturfindings — in Task 10 NICHT loesen

### `ARCH_RISK_MULTI_ORG_CONTEXT` → `BLOCKER_BEFORE_TASK_13_MULTI_ORG_CONTEXT`

Die `CostAccessPolicy` kann ueber `X-EasyTree-Organization-Id` bei mehreren Mitgliedschaften eine
konkrete Organisation waehlen. Der `TenantQueryRunner` traegt dagegen nur `userId`. Dadurch sieht
`PlanningWindowRepository.organisationOf()` alle per RLS sichtbaren Organisationen und liefert bei
mehr als einer `AMBIGUOUS_ORGANISATION`. Wie eine bereits serverseitig ausgewaehlte
Kostenorganisation bis zur Planning-Faktenlesung eingegrenzt wird, ist vor Task 13 unbewiesen.

Task 10 aendert deshalb **nichts** an `TenantQueryRunner`, `PlanningQueriesFactory`,
`PlanningFactsAdapter`, RLS oder JWT-Claims. Task 11 ist davon unabhaengig pruefbar.

### `SOURCE_NEEDED_ASSIGNMENT_DURATION_LIMIT`

Der alte Task-11-Plan nennt eine Obergrenze fuer extrem lange Assignments, weil die lokale
Tagesallokation linear ueber Kalendertage laeuft. Task 11 bekommt aber bereits montierte
Positionen und ist fuer eine Pruefung **vor** der Allokation zu spaet. Ein autorisierter
fachlicher Grenzwert („31 Tage") existiert nicht. Deshalb wird in Task 10 **keine** Maximaldauer
eingefuehrt. Vor Task 11/Release ist zu entscheiden, an welcher Fakten- oder Planungsgrenze ein
belegter Schutz hingehoert. Keine Zahl erfinden.
