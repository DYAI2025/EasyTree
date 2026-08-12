/**
 * Die Naht zwischen Kostenmodul und Planung (EYT-109, Task 8).
 *
 * Keine Datenbank, kein NestJS: was hier rot wird, ist eine Abbildungsregel und
 * kein Verdrahtungsfehler. Das gestellte `PlanningQueries` ist der ganze Punkt —
 * es kann Antworten liefern, die eine echte Datenbank nur unter Aufwand
 * herstellt (Entwurf ueber veroeffentlichter Version), und es kann beweisen,
 * WELCHE Methode der Adapter benutzt hat.
 *
 * Der Adapter wird hier ueber `planCostFactsFactory` gebaut, weil die Klasse
 * nicht mehr oeffentlich ist: sie hat genau eine Konstruktionsstelle, und ein
 * tiefer Pfad an ihr vorbei faellt am Waechter
 * `costs-cross-module-public-api-only`. An den Aussagen der Faelle aendert das
 * nichts — sie messen weiterhin die Abbildung des Adapters, nur ueber die
 * einzige zulaessige Konstruktionsstelle.
 */
import { describe, expect, it } from "vitest";

import { unsafeIdentifier } from "@easytree/domain";
import type { PlanVersionId } from "@easytree/domain";

// Ausschliesslich ueber die oeffentlichen Modul-APIs, wie die Nachbartests.
import { planCostFactsFactory } from "../../src/modules/costs";
import type { PlanCostFactsProblem } from "../../src/modules/costs";
import type {
  PlanningQueries,
  PlanningWindowResult,
  PublishedAssignmentsResult,
  PublishedReadProblem,
  PublishedVersionsResult,
} from "../../src/modules/planning";

const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const ANNA = "22222222-2222-4222-8222-222222222222";
const BERND = "77777777-7777-4777-8777-777777777777";
const NORD = "33333333-3333-4333-8333-333333333333";
const SUED = "88888888-8888-4888-8888-888888888888";
const EINSATZ_ID = "11111111-1111-4111-8111-111111111111";

// Subjekt und Organisation der Fabrik. Beide sind hier ohne Aussage: die
// gestellte Planungsfabrik ignoriert sie, weil dieser Test die ABBILDUNG des
// Adapters misst und nicht die Weitergabe des Kontexts — die steht in
// `plan-cost-facts-factory.test.ts`.
const USER = "00000000-0000-4000-8000-00000000aaa1";
const ORG = "00000000-0000-4000-8000-0000000000b2";

const VEROEFFENTLICHT_AM = new Date("2026-06-10T09:15:00.000Z");

/**
 * Der veroeffentlichte Stand, wie die Planung ihn liefert.
 *
 * Zwei Personen und zwei Baustellen, aber nur EIN Einsatz: so kann keine
 * Abbildung ueber die Listenposition zufaellig richtig sein. Die Reihenfolge in
 * `resources` widerspricht der Reihenfolge, in der der Einsatz sie nennt.
 */
function veroeffentlicht(): PublishedAssignmentsResult {
  return {
    ok: true,
    published: {
      planVersionId: VERSION_ID,
      weekKey: "2026-W25",
      timeZone: "Europe/Berlin",
      publishedAt: VEROEFFENTLICHT_AM,
      assignments: [
        {
          id: EINSATZ_ID,
          employeeId: ANNA,
          worksiteId: NORD,
          startsAtUtc: new Date("2026-06-15T06:00:00.000Z"),
          endsAtUtc: new Date("2026-06-15T14:00:00.000Z"),
        },
      ],
      resources: {
        employees: [
          { id: BERND, label: "Bernd Berg", active: false },
          { id: ANNA, label: "Anna Bauer", active: true },
        ],
        worksites: [
          { id: SUED, label: "Baustelle Sued", active: true },
          { id: NORD, label: "Baustelle Nord", active: true },
        ],
      },
    },
  };
}

/**
 * Gestellte Planung.
 *
 * `planningWindow` WIRFT standardmaessig. Das ist die eigentliche Zusicherung
 * dieses Tests: die versionsgenaue Methode darf das Wochenfenster nicht
 * anfassen. Waere die Vorgabe ein harmloser Rueckgabewert, bliebe ein Adapter,
 * der wieder auf `planningWindow` umschwenkt, gruen.
 */
function planung(ueberschreibung: Partial<PlanningQueries> = {}): PlanningQueries {
  return {
    planningWindow: (): Promise<PlanningWindowResult> => {
      throw new Error(
        "planningWindow darf fuer einen versionsgenauen Lesevorgang nicht aufgerufen werden",
      );
    },
    publishedVersions: (): Promise<PublishedVersionsResult> =>
      Promise.resolve({ ok: true, versions: [] }),
    publishedAssignments: (): Promise<PublishedAssignmentsResult> =>
      Promise.resolve(veroeffentlicht()),
    ...ueberschreibung,
  };
}

function abgelehnt(problem: PublishedReadProblem): PublishedAssignmentsResult {
  return { ok: false, problem };
}

describe("PlanningFactsAdapter — publishedFactsForVersion (EYT-109)", () => {
  it("reicht PLAN_NOT_PUBLISHED unveraendert durch", async () => {
    const adapter = planCostFactsFactory(() =>
      planung({ publishedAssignments: () => Promise.resolve(abgelehnt("PLAN_NOT_PUBLISHED")) }),
    )(USER, ORG);

    const ergebnis = await adapter.publishedFactsForVersion(VERSION_ID);

    expect(ergebnis.ok).toBe(false);
    // Kein `PLAN_VERSION_NOT_FOUND`: die Version GIBT es, sie ist nur ein
    // Entwurf. Die beiden Faelle verlangen spaeter unterschiedliche
    // Oberflaechen — "veroeffentliche zuerst" gegen "diese Version kenne ich
    // nicht" — und duerfen deshalb nicht zusammenfallen.
    expect(ergebnis).toStrictEqual({ ok: false, problem: "PLAN_NOT_PUBLISHED" });
  });

  it("reicht PLAN_VERSION_NOT_FOUND unveraendert durch, ohne Existenzaussage", async () => {
    const adapter = planCostFactsFactory(() =>
      planung({ publishedAssignments: () => Promise.resolve(abgelehnt("PLAN_VERSION_NOT_FOUND")) }),
    )(USER, ORG);

    const ergebnis = await adapter.publishedFactsForVersion(VERSION_ID);

    expect(ergebnis).toStrictEqual({ ok: false, problem: "PLAN_VERSION_NOT_FOUND" });
  });

  it("uebernimmt Version, Woche, Zone und Veroeffentlichungszeitpunkt unveraendert", async () => {
    const adapter = planCostFactsFactory(() => planung())(USER, ORG);

    const ergebnis = await adapter.publishedFactsForVersion(VERSION_ID);

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.facts.planVersionId).toBe(unsafeIdentifier<PlanVersionId>(VERSION_ID));
    expect(ergebnis.facts.weekKey).toBe("2026-W25");
    expect(ergebnis.facts.timeZone).toBe("Europe/Berlin");
    // Genau der Zeitpunkt der Planung — kein `new Date()`, keine Rundung.
    expect(ergebnis.facts.publishedAt).toStrictEqual(VEROEFFENTLICHT_AM);
  });

  it("bildet die Zuweisungen auf Kostenfakten ab", async () => {
    const adapter = planCostFactsFactory(() => planung())(USER, ORG);

    const ergebnis = await adapter.publishedFactsForVersion(VERSION_ID);

    if (!ergebnis.ok) throw new Error("erwartet: Erfolg");
    expect(ergebnis.facts.work).toStrictEqual([
      {
        assignmentId: EINSATZ_ID,
        employeeId: ANNA,
        worksiteId: NORD,
        startsAtUtc: new Date("2026-06-15T06:00:00.000Z"),
        endsAtUtc: new Date("2026-06-15T14:00:00.000Z"),
      },
    ]);
  });

  it("bildet Bezeichnungen ueber Ids ab, nicht ueber die Reihenfolge", async () => {
    const adapter = planCostFactsFactory(() => planung())(USER, ORG);

    const ergebnis = await adapter.publishedFactsForVersion(VERSION_ID);

    if (!ergebnis.ok) throw new Error("erwartet: Erfolg");
    // `resources` nennt Bernd/Sued zuerst, der Einsatz zeigt auf Anna/Nord.
    // Eine positionsgekoppelte Abbildung liefert hier "Bernd Berg".
    expect(ergebnis.facts.employeeLabels.get(ANNA)).toBe("Anna Bauer");
    expect(ergebnis.facts.worksiteLabels.get(NORD)).toBe("Baustelle Nord");
    // Auch die inaktive Person behaelt ihren Namen: ein historischer Einsatz
    // auf eine deaktivierte Person darf nicht namenlos werden.
    expect(ergebnis.facts.employeeLabels.get(BERND)).toBe("Bernd Berg");
    expect(ergebnis.facts.worksiteLabels.get(SUED)).toBe("Baustelle Sued");
    expect(ergebnis.facts.employeeLabels.size).toBe(2);
    expect(ergebnis.facts.worksiteLabels.size).toBe(2);
  });

  it("liest NICHT das Wochenfenster, auch wenn dieses einen abweichenden Entwurf traegt", async () => {
    let fensterGelesen = 0;
    const adapter = planCostFactsFactory(() =>
      planung({
        planningWindow: (): Promise<PlanningWindowResult> => {
          fensterGelesen += 1;
          // Ein Entwurf DERSELBEN Woche mit anderen Zuweisungen — genau der
          // Stand, den ein Snapshot niemals einfrieren darf.
          return Promise.resolve({
            ok: true,
            window: {
              weekKey: "2026-W25",
              timeZone: "Europe/Berlin",
              assignments: [
                {
                  id: "99999999-9999-4999-8999-999999999999",
                  employeeId: BERND,
                  worksiteId: SUED,
                  startsAtUtc: new Date("2026-06-16T06:00:00.000Z"),
                  endsAtUtc: new Date("2026-06-16T14:00:00.000Z"),
                },
              ],
              sourceVersion: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", state: "draft" },
              publishedVersionId: VERSION_ID,
              resources: { employees: [], worksites: [] },
            },
          });
        },
      }),
    )(USER, ORG);

    const ergebnis = await adapter.publishedFactsForVersion(VERSION_ID);

    if (!ergebnis.ok) throw new Error("erwartet: Erfolg");
    expect(fensterGelesen).toBe(0);
    expect(ergebnis.facts.planVersionId).toBe(unsafeIdentifier<PlanVersionId>(VERSION_ID));
    expect(ergebnis.facts.work).toHaveLength(1);
    expect(ergebnis.facts.work[0]?.assignmentId).toBe(EINSATZ_ID);
  });
});

describe("PlanningFactsAdapter — publishedVersions (EYT-109)", () => {
  it("reicht beide Wochengrenzen unveraendert an die Planung durch", async () => {
    const gesehen: Array<readonly [string, string]> = [];
    const adapter = planCostFactsFactory(() =>
      planung({
        publishedVersions: (von: string, bis: string): Promise<PublishedVersionsResult> => {
          gesehen.push([von, bis]);
          return Promise.resolve({ ok: true, versions: [] });
        },
      }),
    )(USER, ORG);

    await adapter.publishedVersions("2026-W20", "2026-W25");

    expect(gesehen).toStrictEqual([["2026-W20", "2026-W25"]]);
  });

  it("bildet Version, Woche und Zeitpunkt ab, ohne neu zu sortieren", async () => {
    const adapter = planCostFactsFactory(() =>
      planung({
        publishedVersions: (): Promise<PublishedVersionsResult> =>
          Promise.resolve({
            ok: true,
            versions: [
              { id: VERSION_ID, weekKey: "2026-W25", publishedAt: VEROEFFENTLICHT_AM },
              {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                weekKey: "2026-W20",
                publishedAt: new Date("2026-05-05T08:00:00.000Z"),
              },
            ],
          }),
      }),
    )(USER, ORG);

    const ergebnis = await adapter.publishedVersions("2026-W20", "2026-W25");

    if (!ergebnis.ok) throw new Error("erwartet: Erfolg");
    // Die Eingabe ist absichtlich absteigend nach Woche. Sortierte das
    // Kostenmodul nach, gaebe es eine zweite, stille Ordnung neben der aus
    // Task 7 — und der dortige Test bewiese die tatsaechliche nicht mehr.
    expect(ergebnis.versions).toStrictEqual([
      { planVersionId: VERSION_ID, weekKey: "2026-W25", publishedAt: VEROEFFENTLICHT_AM },
      {
        planVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        weekKey: "2026-W20",
        publishedAt: new Date("2026-05-05T08:00:00.000Z"),
      },
    ]);
  });

  it("reicht AMBIGUOUS_ORGANISATION durch", async () => {
    const adapter = planCostFactsFactory(() =>
      planung({
        publishedVersions: (): Promise<PublishedVersionsResult> =>
          Promise.resolve({ ok: false, problem: "AMBIGUOUS_ORGANISATION" }),
      }),
    )(USER, ORG);

    expect(await adapter.publishedVersions("2026-W20", "2026-W25")).toStrictEqual({
      ok: false,
      problem: "AMBIGUOUS_ORGANISATION",
    });
  });
});

describe("PlanningFactsAdapter — publishedFacts(weekKey) bleibt unveraendert (EYT-105)", () => {
  it("meldet PLAN_NOT_PUBLISHED, wenn der Wochenstand ein Entwurf ist", async () => {
    const adapter = planCostFactsFactory(() =>
      planung({
        planningWindow: (): Promise<PlanningWindowResult> =>
          Promise.resolve({
            ok: true,
            window: {
              weekKey: "2026-W25",
              timeZone: "Europe/Berlin",
              assignments: [],
              sourceVersion: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", state: "draft" },
              publishedVersionId: null,
              resources: { employees: [], worksites: [] },
            },
          }),
      }),
    )(USER, ORG);

    expect(await adapter.publishedFacts("2026-W25")).toStrictEqual({
      ok: false,
      problem: "PLAN_NOT_PUBLISHED",
    });
  });

  it("liefert bei veroeffentlichtem Wochenstand die vollstaendigen Fakten dieser Version", async () => {
    let versionsgenauGelesen: string | null = null;
    const adapter = planCostFactsFactory(() =>
      planung({
        planningWindow: (): Promise<PlanningWindowResult> =>
          Promise.resolve({
            ok: true,
            window: {
              weekKey: "2026-W25",
              timeZone: "Europe/Berlin",
              assignments: [],
              sourceVersion: { id: VERSION_ID, state: "published" },
              publishedVersionId: VERSION_ID,
              resources: { employees: [], worksites: [] },
            },
          }),
        publishedAssignments: (id: string): Promise<PublishedAssignmentsResult> => {
          versionsgenauGelesen = id;
          return Promise.resolve(veroeffentlicht());
        },
      }),
    )(USER, ORG);

    const ergebnis = await adapter.publishedFacts("2026-W25");

    if (!ergebnis.ok) throw new Error("erwartet: Erfolg");
    // Die Wochenlogik entscheidet WELCHE Version; die Pflichtfelder kommen aus
    // dem versionsgenauen Read. `planningWindow` fuehrt kein `publishedAt`, und
    // einen Zeitpunkt zu erfinden waere eine Tatsachenbehauptung.
    expect(versionsgenauGelesen).toBe(VERSION_ID);
    expect(ergebnis.facts.publishedAt).toStrictEqual(VEROEFFENTLICHT_AM);
    expect(ergebnis.facts.employeeLabels.get(ANNA)).toBe("Anna Bauer");
  });

  it("reicht NO_ORGANISATION unveraendert durch", async () => {
    const adapter = planCostFactsFactory(() =>
      planung({
        planningWindow: (): Promise<PlanningWindowResult> =>
          Promise.resolve({ ok: false, problem: "NO_ORGANISATION" }),
      }),
    )(USER, ORG);

    expect(await adapter.publishedFacts("2026-W25")).toStrictEqual({
      ok: false,
      problem: "NO_ORGANISATION",
    });
  });
});

/**
 * Vollstaendigkeit der Fehlerunion — eine Zusicherung fuer `pnpm typecheck`,
 * nicht fuer vitest.
 *
 * SWC entfernt Typen ohne sie zu pruefen, also faellt diese Zeile im Testlauf
 * NICHT auf. Sie steht trotzdem hier und nicht nur implizit im Adapter: wer
 * einen Ablehnungsgrund am Planungsport hinzufuegt, soll ihn an einer Stelle
 * lesen, die "das Kostenmodul muss ihn kennen" ausspricht. Gegenmutation:
 * `PLAN_VERSION_NOT_FOUND` aus `PLAN_COST_FACTS_PROBLEMS` streichen — dann
 * scheitert `pnpm typecheck` hier UND in `costs-error-type.ts`.
 */
type JederPlanungsgrundIstEinKostenproblem = PublishedReadProblem extends PlanCostFactsProblem
  ? true
  : never;
const _vollstaendig: JederPlanungsgrundIstEinKostenproblem = true;
void _vollstaendig;
