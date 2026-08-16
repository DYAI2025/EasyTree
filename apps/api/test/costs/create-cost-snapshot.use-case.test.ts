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
  RateVersionRecord,
  SnapshotReadResult,
  SnapshotWriteResult,
  StoredCostSnapshot,
} from "../../src/modules/costs";

const ANNA = unsafeIdentifier<EmployeeId>("22222222-2222-4222-8222-222222222222");
const BERND = unsafeIdentifier<EmployeeId>("27777777-2777-4777-8777-277777777777");
const NORD = unsafeIdentifier<WorksiteId>("33333333-3333-4333-8333-333333333333");
const SUED = unsafeIdentifier<WorksiteId>("38888888-3888-4888-8888-388888888888");
const FREMD = "39999999-3999-4999-8999-399999999999";
/** Die Planversion, die im KOMMANDO steht — die Behauptung der Aufruferin. */
const PLANVERSION = unsafeIdentifier<PlanVersionId>("44444444-4444-4444-8444-444444444444");
/**
 * Die Planversion, die in den gelesenen FAKTEN steht — erkennbar eine andere.
 *
 * Absichtlich verschieden, gleiche Bauart wie `gespeichert()` mit seiner
 * „erkennbar NICHT die Eingabesumme": waeren beide dieselbe Konstante, koennte
 * der Use-Case `command.publishedPlanVersionId` in den Schreibvorgang stellen
 * statt `facts.planVersionId`, und kein Fall wuerde rot. Die Zusicherung
 * „aus den Fakten, nicht dem Kommando" traegt erst durch diese Trennung.
 *
 * Fachlich sind die beiden Werte in Produktion gleich — der Faktenport wird ja
 * mit genau dieser Id befragt. Hier gehen sie auseinander, damit die HERKUNFT
 * des geschriebenen Feldes messbar wird; das ist eine Testfiktion mit Zweck,
 * keine Modellierung eines echten Zustands.
 */
const PLANVERSION_FAKTEN = unsafeIdentifier<PlanVersionId>("4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a");
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
    planVersionId: PLANVERSION_FAKTEN,
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

function satz(ueberschreibung: Partial<RateVersionRecord> = {}): RateVersionRecord {
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
    // Der gespeicherte Stand traegt die Planversion der FAKTEN — das ist es ja,
    // was der Use-Case geschrieben hat.
    planVersionId: PLANVERSION_FAKTEN,
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
  /**
   * Womit die Buendellesung angefragt wurde — je Aufruf ein Feld.
   *
   * Zwei Zeugen statt eines: `versionsForAufrufe` muss dabei LEER bleiben. Eine
   * Zusicherung ueber die Anzahl der Lesevorgaenge braucht beide Seiten, sonst
   * bliebe ein Rueckfall auf den Einzelaufruf ungemessen — die Montage bekaeme
   * dieselben Saetze, und jeder inhaltliche Fall bliebe gruen.
   */
  readonly versionsForManyAufrufe: string[][];
  /**
   * Womit die Fakten angefragt wurden.
   *
   * Ohne diesen Zeugen ist die Weiterleitung des Arguments ungemessen: ein Stub,
   * der seinen Parameter ignoriert, antwortet auf JEDE Id gleich. Der Aufruf
   * koennte auf `command.idempotencyKey` umgestellt werden, und Fall 1 wuerde
   * weiterhin behaupten, `planVersionId` stamme „aus den Fakten" — waehrend die
   * Fakten zu einer ganz anderen Planversion gelesen wurden.
   */
  readonly faktenAufrufe: string[];
}

function zeuge(
  optionen: {
    readonly faktenErgebnis?: PlanCostFactsResult;
    readonly schreibErgebnis?: SnapshotWriteResult;
    readonly leseErgebnis?: SnapshotReadResult;
    readonly saetze?: ReadonlyMap<string, readonly RateVersionRecord[]>;
  } = {},
): Zeuge {
  const createAufrufe: NewCostSnapshot[] = [];
  const readAufrufe: string[] = [];
  const versionsForAufrufe: string[] = [];
  const versionsForManyAufrufe: string[][] = [];
  const faktenAufrufe: string[] = [];
  const saetze =
    optionen.saetze ??
    new Map<string, readonly RateVersionRecord[]>([
      [ANNA, [satz()]],
      [BERND, [satz({ id: "55555555-5555-4555-8555-55555555bbbb", employeeId: BERND })]],
    ]);

  const facts: PlanCostFactsPort = {
    publishedFacts: () => {
      throw new Error("publishedFacts(weekKey) ist NICHT der Einstieg von Task 10.");
    },
    publishedFactsForVersion: async (planVersionId) => {
      faktenAufrufe.push(planVersionId);
      return optionen.faktenErgebnis ?? { ok: true, facts: fakten() };
    },
    publishedVersions: () => {
      throw new Error("publishedVersions gehoert zur Auswahlliste, nicht zum Snapshot.");
    },
  };

  const rates: RateRepository = {
    versionsFor: async (employeeId) => {
      versionsForAufrufe.push(employeeId);
      return saetze.get(employeeId) ?? [];
    },
    versionsForMany: async (employeeIds) => {
      versionsForManyAufrufe.push([...employeeIds]);
      // Wie die echte Umsetzung: JEDE angefragte Id bekommt einen Eintrag,
      // notfalls ein leeres Feld. Eine Attrappe, die nur Treffer zurueckgibt,
      // verschoebe den Unterschied zwischen „nichts vorhanden" und „nie
      // gefragt" — genau den, den der Port zusichert.
      const abbildung = new Map<string, readonly RateVersionRecord[]>();
      for (const id of new Set(employeeIds)) abbildung.set(id, saetze.get(id) ?? []);
      return abbildung;
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
    // Keine Uhr mehr: `created_at` entsteht in der Datenbank (Migration 0018
    // erteilt kein insert-Recht auf die Spalte), also hat der Use-Case nichts
    // zu takten (EYT-138).
    deps: { facts, rates, repository },
    createAufrufe,
    readAufrufe,
    versionsForAufrufe,
    versionsForManyAufrufe,
    faktenAufrufe,
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

    // Die Fakten werden mit der Planversion des KOMMANDOS angefragt — und mit
    // keiner anderen Zeichenkette daraus.
    expect(z.faktenAufrufe).toEqual([PLANVERSION]);

    expect(z.createAufrufe).toHaveLength(1);
    const geschrieben = z.createAufrufe[0];
    expect(geschrieben?.positions).toHaveLength(2);
    // 8 h * 25,00 + 4 h * 25,00 = 300,00 EUR, exakt in Minor Units.
    expect(geschrieben?.totalMinorUnits).toBe(30000n);
    // Nur der statische Typ, nicht die Genauigkeit: bei Betraegen unterhalb von
    // 2^53 haelt auch eine ueber `number` gebildete und zurueckgewandelte Summe
    // diese Zusicherung. Was die Genauigkeit wirklich bindet, ist Fall 14.
    expect(typeof geschrieben?.totalMinorUnits).toBe("bigint");
    // Die HERKUNFT des Feldes, nicht nur sein Wert: `PLANVERSION_FAKTEN` steht
    // ausschliesslich in den gelesenen Fakten, `PLANVERSION` ausschliesslich im
    // Kommando. Schriebe der Use-Case `command.publishedPlanVersionId`, stuende
    // hier `PLANVERSION` und der Fall waere rot.
    expect(geschrieben?.planVersionId).toBe(PLANVERSION_FAKTEN);
    expect(geschrieben?.weekKey).toBe("2026-W25");
    expect(geschrieben?.timeZone).toBe("Europe/Berlin");
    expect(geschrieben?.ruleVersion).toBe(COST_RULE_VERSION);
    expect(geschrieben?.idempotencyKey).toBe("idem-1");
    // Beide reisen unveraendert aus dem Kommando in die Zeile. Ohne diese
    // Zusicherungen koennten sie aus der Nutzlast fallen, ohne dass irgendetwas
    // rot wird — `organisationId` ist die Mandantenspalte, `correlationId` die
    // einzige Spur, an der ein Schreibvorgang spaeter wiedergefunden wird.
    expect(geschrieben?.organisationId).toBe("88888888-8888-4888-8888-888888888888");
    expect(geschrieben?.correlationId).toBe("corr-1");
    // Direkt geprueft, nicht dem Zufall ueberlassen: `employeeLabels` und
    // `worksiteLabels` sind benachbarte, identisch getypte
    // `ReadonlyMap<string, string>`-Parameter. Vertauscht man sie, meldet `tsc`
    // nichts, und heute faellt es nur auf, weil die Fixture-Ids zufaellig
    // disjunkt sind und daraus `LABEL_MISSING` wird.
    expect(geschrieben?.positions[0]?.employeeLabel).toBe("Anna Bauer");
    expect(geschrieben?.positions[0]?.worksiteLabel).toBe("Baustelle Nord");

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

    expect(z.versionsForManyAufrufe).toEqual([]);
    expect(z.versionsForAufrufe).toEqual([]);
    expect(z.createAufrufe).toEqual([]);
    expect(z.readAufrufe).toEqual([]);
    expect(ergebnis).toEqual({ ok: false, stage: "FACTS", problem: "PLAN_NOT_PUBLISHED" });
  });

  it("Fall 3 — PLAN_VERSION_NOT_FOUND blockiert vor Satzlesung, create und read", async () => {
    const z = zeuge({ faktenErgebnis: { ok: false, problem: "PLAN_VERSION_NOT_FOUND" } });
    const ergebnis = await createCostSnapshot(z.deps, kommando());

    expect(z.versionsForManyAufrufe).toEqual([]);
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

    expect(z.versionsForManyAufrufe).toEqual([]);
    expect(z.versionsForAufrufe).toEqual([]);
    expect(z.createAufrufe).toEqual([]);
    expect(z.readAufrufe).toEqual([]);
    expect(ergebnis).toEqual({ ok: false, stage: "WRITE", problem: "WORKSITE_NOT_IN_ORG" });
  });

  it("Fall 7 — eigene Baustelle mit Einsaetzen nutzt nur deren Mitarbeitende, Saetze und Positionen", async () => {
    const z = zeuge();
    const ergebnis = await createCostSnapshot(z.deps, kommando({ worksiteId: SUED }));

    // Anna arbeitet nur auf Nord — ihre Satzhistorie wird gar nicht erst geholt.
    expect(z.versionsForManyAufrufe).toEqual([[BERND]]);
    expect(z.versionsForAufrufe).toEqual([]);
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

    // Gefragt wird trotzdem — mit einer leeren Beteiligtenliste. Das ist der
    // Unterschied zu „gar nicht gefragt": die Buendellesung kuerzt selbst ab
    // (keine Transaktion bei leerer Eingabe), und diese Entscheidung gehoert
    // ins Repository, nicht in den Use-Case.
    expect(z.versionsForManyAufrufe).toEqual([[]]);
    expect(z.versionsForAufrufe).toEqual([]);
    expect(z.createAufrufe).toHaveLength(1);
    expect(z.createAufrufe[0]?.positions).toEqual([]);
    expect(z.createAufrufe[0]?.totalMinorUnits).toBe(0n);
    // Der Kopf traegt die Regel trotzdem — es gibt keine erste Position, aus der
    // man sie ableiten koennte.
    expect(z.createAufrufe[0]?.ruleVersion).toBe(COST_RULE_VERSION);
    expect(ergebnis.ok).toBe(true);
  });

  it("Fall 9 — der Schreibvorgang gibt KEINEN Erstellungszeitpunkt mit (EYT-138)", async () => {
    const z = zeuge();
    await createCostSnapshot(z.deps, kommando());

    // Migration 0018 erteilt kein insert-Recht auf `created_at`; der
    // Serverdefault `now()` ist die einzige Quelle. Ein Feld in der Nutzlast
    // waere eine Zusage, die die Datenbank mit 42501 ablehnt.
    //
    // Auf dem SCHLUESSEL geprueft, nicht auf `undefined`: mit
    // `exactOptionalPropertyTypes` waere ein `createdAt: undefined` ein
    // Typfehler, aber ein `as`-Cast irgendwo darueber koennte ihn einschmuggeln.
    // `in` sieht auch den eingeschmuggelten.
    const geschrieben = z.createAufrufe[0];
    expect(geschrieben).toBeDefined();
    expect(Object.keys(geschrieben ?? {})).not.toContain("createdAt");
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

  it("Fall 11 — der gelesene Stand gewinnt gegen die Uhr dieses Laufs (keine Rekonstruktion)", async () => {
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

  it("Fall 12 — zwei Einsaetze derselben Person holen ihre Satzhistorie genau einmal", async () => {
    // Ohne diesen Fall misst die Suite die Deduplizierung nicht: in allen
    // anderen Fixtures gehoert jeder Einsatz einer anderen Person, und das
    // `new Set(...)` im Use-Case koennte ersatzlos entfallen, ohne dass
    // irgendetwas rot wird.
    const z = zeuge({
      faktenErgebnis: {
        ok: true,
        facts: fakten({
          work: [
            EINSATZ_NORD,
            {
              assignmentId: unsafeIdentifier<AssignmentId>("1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a"),
              employeeId: ANNA, // dieselbe Person, zweiter Tag
              worksiteId: NORD,
              startsAtUtc: new Date("2026-06-16T06:00:00.000Z"),
              endsAtUtc: new Date("2026-06-16T14:00:00.000Z"),
            },
          ],
        }),
      },
    });
    const ergebnis = await createCostSnapshot(z.deps, kommando());

    // Auf dem Array, nicht auf der Laenge: `[ANNA, ANNA]` haette dieselbe
    // Laenge wie ein Aufruf plus ein fremder — die Identitaet muss mitgeprueft
    // werden.
    expect(z.versionsForManyAufrufe).toEqual([[ANNA]]);
    expect(z.versionsForAufrufe).toEqual([]);
    expect(z.createAufrufe[0]?.positions).toHaveLength(2); // zwei Tage, eine Person
    expect(z.createAufrufe[0]?.totalMinorUnits).toBe(40000n); // 2 * 8 h * 25,00
    expect(ergebnis.ok).toBe(true);
  });

  it("Fall 13 — SNAPSHOT_NOT_FOUND nach erfolgreichem Schreiben ergibt stage READ", async () => {
    // Kein konstruierter Fall: Schreibkanal und Lesepfad koennen sich
    // widersprechen (fehlendes Leserecht, andere Verbindung). Ohne diesen Fall
    // ist der Zweig `stage: "READ"` im Use-Case nie ausgefuehrt.
    const z = zeuge({
      schreibErgebnis: { ok: true, snapshotId: SNAPSHOT_ID },
      leseErgebnis: { ok: false, problem: "SNAPSHOT_NOT_FOUND" },
    });
    const ergebnis = await createCostSnapshot(z.deps, kommando());

    expect(z.createAufrufe).toHaveLength(1);
    expect(z.readAufrufe).toEqual([SNAPSHOT_ID]);
    expect(ergebnis).toEqual({ ok: false, stage: "READ", problem: "SNAPSHOT_NOT_FOUND" });
  });

  it("Fall 14 — eine Summe jenseits von 2^53 bleibt exakt", async () => {
    // Der eigentliche Genauigkeitszeuge. Die `typeof`-Zusicherung in Fall 1
    // bindet nur den statischen Typ; eine ueber `number` gebildete und mit
    // `BigInt(...)` zurueckgewandelte Summe kaeme dort unbemerkt durch, weil
    // 30000, 10000 und 0 exakt darstellbar sind.
    //
    // Hier nicht: 1125899906842624 Minor Units je Stunde * 8 h ergeben genau
    // 2^53 = 9007199254740992, dazu eine zweite Position ueber 1. Die exakte
    // Summe 9007199254740993 ist ungerade und oberhalb von 2^53 nicht mehr als
    // `double` darstellbar — `Number`-Arithmetik rundet auf 9007199254740992.
    const EIN_STUNDE_SUED: PlannedWorkFact = {
      assignmentId: unsafeIdentifier<AssignmentId>("1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b"),
      employeeId: BERND,
      worksiteId: SUED,
      startsAtUtc: new Date("2026-06-16T06:00:00.000Z"),
      endsAtUtc: new Date("2026-06-16T07:00:00.000Z"),
    };
    const z = zeuge({
      faktenErgebnis: { ok: true, facts: fakten({ work: [EINSATZ_NORD, EIN_STUNDE_SUED] }) },
      saetze: new Map<string, readonly RateVersionRecord[]>([
        [ANNA, [satz({ amountMinorUnits: "1125899906842624" })]],
        [
          BERND,
          [
            satz({
              id: "55555555-5555-4555-8555-55555555bbbb",
              employeeId: BERND,
              amountMinorUnits: "1",
            }),
          ],
        ],
      ]),
    });
    const ergebnis = await createCostSnapshot(z.deps, kommando());

    expect(z.createAufrufe[0]?.positions.map((position) => position.amountMinorUnits)).toEqual([
      9007199254740992n,
      1n,
    ]);
    expect(z.createAufrufe[0]?.totalMinorUnits).toBe(9007199254740993n);
    expect(ergebnis.ok).toBe(true);
  });

  it("Fall 15 — holt ALLE Satzhistorien in genau EINEM Lesevorgang (EYT-138)", async () => {
    // Drei Personen auf zwei Baustellen, eine davon mit zwei Einsaetzen: der
    // Faecher haette hier drei Transaktionen geoeffnet.
    const CARLA = unsafeIdentifier<EmployeeId>("2ccccccc-2ccc-4ccc-8ccc-2ccccccccccc");
    const EINSATZ_CARLA: PlannedWorkFact = {
      assignmentId: unsafeIdentifier<AssignmentId>("1ccccccc-1ccc-4ccc-8ccc-1ccccccccccc"),
      employeeId: CARLA,
      worksiteId: NORD,
      startsAtUtc: new Date("2026-06-17T06:00:00.000Z"),
      endsAtUtc: new Date("2026-06-17T10:00:00.000Z"),
    };
    // Zweiter Einsatz derselben Person — die Id darf im Argument nur EINMAL
    // stehen, sonst laese die Datenbank dieselbe Historie doppelt.
    const ZWEITER_EINSATZ_ANNA: PlannedWorkFact = {
      assignmentId: unsafeIdentifier<AssignmentId>("1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a"),
      employeeId: ANNA,
      worksiteId: SUED,
      startsAtUtc: new Date("2026-06-18T06:00:00.000Z"),
      endsAtUtc: new Date("2026-06-18T10:00:00.000Z"),
    };
    const z = zeuge({
      faktenErgebnis: {
        ok: true,
        facts: fakten({
          work: [EINSATZ_NORD, EINSATZ_SUED, EINSATZ_CARLA, ZWEITER_EINSATZ_ANNA],
          employeeLabels: new Map<string, string>([
            [ANNA, "Anna Bauer"],
            [BERND, "Bernd Christ"],
            [CARLA, "Carla Diaz"],
          ]),
        }),
      },
      saetze: new Map<string, readonly RateVersionRecord[]>([
        [ANNA, [satz()]],
        [BERND, [satz({ id: "55555555-5555-4555-8555-55555555bbbb", employeeId: BERND })]],
        [CARLA, [satz({ id: "55555555-5555-4555-8555-55555555cccc", employeeId: CARLA })]],
      ]),
    });

    const ergebnis = await createCostSnapshot(z.deps, kommando());

    // EIN Lesevorgang — nicht drei. Das ist die ganze Zusicherung von EYT-138
    // auf dieser Ebene; dass ein Lesevorgang auch EINE Transaktion und EINE
    // Anweisung ist, misst `test/costs/rate-batch-read.test.ts`.
    expect(z.versionsForManyAufrufe).toHaveLength(1);
    // Auf dem Feld, nicht auf der Laenge: dedupliziert, in der Reihenfolge des
    // ersten Auftretens. `[ANNA, BERND, CARLA, ANNA]` haette dieselbe Laenge
    // wie drei Ids plus eine fremde.
    expect(z.versionsForManyAufrufe[0]).toEqual([ANNA, BERND, CARLA]);
    // Der Einzelaufruf bleibt unberuehrt — sonst waere die Buendellesung nur
    // eine zusaetzliche Lesung und keine Ersetzung.
    expect(z.versionsForAufrufe).toEqual([]);
    expect(ergebnis.ok).toBe(true);
  });
});
