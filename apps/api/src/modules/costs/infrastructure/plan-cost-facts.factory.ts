/**
 * Die EINE Baustelle des Faktenports (EYT-109).
 *
 * ## Warum eine benannte Funktion und kein Closure in `AppModule`
 *
 * Weil ein Test, der die Verdrahtung prueft, dieselbe Funktion rufen koennen
 * muss, die auch die Produktion ruft. Baute `AppModule` das Objekt inline,
 * baute der Test eine zweite Fassung — und bliebe gruen, was immer die Wurzel
 * taete. Dieselbe Begruendung wie bei `lib/planning-gateway-factory.ts` im Web.
 *
 * ## Warum hier und nicht in `application/`
 *
 * Die Kenntnis, dass die Fakten aus dem Planungsmodul kommen, ist eine
 * Fremdsystemkenntnis — genau wie im Adapter darunter. Sie gehoert nach aussen.
 *
 * ## Was hier NICHT passiert
 *
 * Keine Autorisierung. `organisationId` ist bereits entschieden
 * (`CostAccessPolicy.authorize`); diese Funktion verhindert nur, dass die
 * Entscheidung auf dem Weg zur Planung verloren geht. RLS bleibt unabhaengig
 * davon die Grenze: eine Organisation, die das Subjekt nicht sieht, liefert
 * null Zeilen.
 */
import type { PlanningQueriesFactory } from "../../planning";
import type { PlanCostFactsFactory } from "../application/plan-cost-facts.port";
import { PlanningFactsAdapter } from "./planning-facts.adapter";

export function planCostFactsFactory(queriesFor: PlanningQueriesFactory): PlanCostFactsFactory {
  return (subjectUserId, organisationId) =>
    new PlanningFactsAdapter(queriesFor(subjectUserId, organisationId));
}
