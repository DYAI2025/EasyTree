/**
 * Weitergabe des serverseitig aufgeloesten Organisationskontexts vom Kostenpfad
 * an die Planungsfakten (EYT-109).
 *
 * ## Warum zwei Faelle
 *
 * Der erste prueft die Fabrikfunktion selbst. Der zweite holt das Token aus der
 * ECHTEN `AppModule` — sonst koennte die Wurzel eine zweite, abweichende
 * Baustelle bauen und dieser Test bliebe gruen. Dasselbe Muster wie bei
 * `lib/planning-gateway-factory.ts` im Web: der Test ruft die Funktion, die
 * auch die Produktion ruft.
 */
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import { DATABASE_PING, type DatabasePing } from "../../src/health/readiness";
// Ueber die oeffentliche `index.ts` und NICHT ueber den tiefen Pfad
// `costs/infrastructure/plan-cost-facts.factory`: der Waechter
// `costs-cross-module-public-api-only` prueft die Modulgrenze in BEIDE
// Richtungen und laesst auch Testdateien nur hier hinein. Der Nachweis
// verliert nichts — `index.ts` re-exportiert dieselbe Bindung aus derselben
// Datei, und `AppModule` importiert sie ueber genau diesen Pfad. Test und
// Produktion rufen damit nachweislich dieselbe Funktion.
import {
  PLAN_COST_FACTS_FACTORY,
  planCostFactsFactory,
  type PlanCostFactsFactory,
} from "../../src/modules/costs";
import {
  PLANNING_QUERIES_FACTORY,
  type PlanningQueries,
  type PlanningQueriesFactory,
} from "../../src/modules/planning";

const USER = "00000000-0000-4000-8000-00000000aaa1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";

interface Aufruf {
  readonly subjectUserId: string;
  readonly organisationId: string | null | undefined;
}

/**
 * Eine Planungsfabrik, die jeden Bau mitschreibt.
 *
 * Die nicht benoetigten Methoden WERFEN statt leer zu antworten: eine Attrappe,
 * die `[]` liefert, faerbt einen Test gruen, der versehentlich den falschen Weg
 * nimmt.
 */
function spionierendeFabrik(aufrufe: Aufruf[]): PlanningQueriesFactory {
  return (subjectUserId, organisationId) => {
    aufrufe.push({ subjectUserId, organisationId });
    return {
      planningWindow: () => {
        throw new Error("planningWindow ist hier nicht gestellt (EYT-109).");
      },
      publishedVersions: () => Promise.resolve({ ok: true as const, versions: [] }),
      publishedAssignments: () => {
        throw new Error("publishedAssignments ist hier nicht gestellt (EYT-109).");
      },
    } satisfies PlanningQueries;
  };
}

describe("planCostFactsFactory — Organisationsweitergabe (EYT-109)", () => {
  it("reicht Subjekt UND Organisation an die Planungsfabrik weiter", async () => {
    const aufrufe: Aufruf[] = [];
    const port = planCostFactsFactory(spionierendeFabrik(aufrufe))(USER, ORG_B);

    // Der Bau allein genuegt nicht als Nachweis — erst der Aufruf beweist, dass
    // der gebaute Port auch der ist, der benutzt wird.
    const ergebnis = await port.publishedVersions("2026-W02", "2026-W03");
    expect(ergebnis.ok).toBe(true);

    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0]?.subjectUserId).toBe(USER);
    expect(aufrufe[0]?.organisationId).toBe(ORG_B);
  });

  it("wird von AppModule aus derselben Funktion gebaut", async () => {
    const aufrufe: Aufruf[] = [];
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_PING)
      .useValue({ ping: (): Promise<boolean> => Promise.resolve(true) } satisfies DatabasePing)
      .overrideProvider(PLANNING_QUERIES_FACTORY)
      .useValue(spionierendeFabrik(aufrufe))
      .compile();

    const fabrik = moduleRef.get<PlanCostFactsFactory>(PLAN_COST_FACTS_FACTORY);
    await fabrik(USER, ORG_B).publishedVersions("2026-W02", "2026-W03");

    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0]?.organisationId).toBe(ORG_B);

    await moduleRef.close();
  });
});
