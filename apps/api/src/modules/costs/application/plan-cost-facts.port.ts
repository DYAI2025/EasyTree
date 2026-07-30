/**
 * Leseport fuer veroeffentlichte Planfakten (EYT-105, REQ-001, ADR-003).
 *
 * ## Warum es diesen Port gibt
 *
 * EYT-105 AK: modulfremde Planfakten werden „nur ueber eine oeffentliche
 * Planning-Application-API beziehungsweise einen expliziten Port **gelesen**".
 * Der Port ist die Naht, an der das gilt: die Anwendungsschicht des
 * Kostenmoduls kennt nur ihn, nicht die Planung. Wer die Planungstabellen
 * stattdessen direkt selektiert, wird von der Regel
 * `costs-touches-only-own-tables` rot gemeldet — die deckt lesend UND
 * schreibend ab, weil ein reines Schreibverbot spaeter als „Lesen ist erlaubt"
 * gelesen wuerde.
 *
 * ## Warum der Fehler im Rueckgabetyp steht
 *
 * Gleiches Muster wie `PlanningQueries` und `GatewayResult`: eine Ausnahme
 * zwaenge jeden Aufrufer, sie einzeln zu fangen, und der haeufigste Fehler
 * waere, sie gar nicht zu fangen. „Nicht veroeffentlicht" ist ausserdem kein
 * Ausnahmefall, sondern eine erwartete Antwort (FMC-001).
 *
 * ## Was hier bewusst NICHT steht
 *
 * Keine Organisations-Id in irgendeiner Signatur. Sie kommt ausschliesslich aus
 * dem gesetzten Datenbankkontext (`app.user_org_ids()` ueber RLS) — ein
 * Parameter `orgId` waere die Einladung, ihn aus URL oder Body zu befuellen
 * (REQ-002). Und keine Subjektbindung: die Verdrahtung folgt dem
 * Factory-Muster der Planung (`PLANNING_QUERIES_FACTORY`, ein Repository je
 * Subjekt) und entsteht mit der ersten Route in EYT-109.
 */
import type { PublishedPlanFacts } from "../domain/planned-work-fact";

/**
 * Warum eine Faktenanfrage nicht beantwortbar ist.
 *
 * Als eingefrorene Liste und nicht als lose Union: die HTTP-Naht bildet jeden
 * Eintrag auf genau einen stabilen Fehlercode ab, und diese Abbildung soll
 * unvollstaendig nicht kompilieren (`interface/http/costs-error-type.ts`).
 */
export const PLAN_COST_FACTS_PROBLEMS = [
  /** Angemeldet, aber ohne aktive Mitgliedschaft. */
  "NO_ORGANISATION",
  /**
   * Mehrere aktive Mitgliedschaften. KEINE stille Auswahl — eine davon zu
   * nehmen waere eine erfundene Mandantenentscheidung, deren Ergebnis
   * plausibel aussieht (gleiche Begruendung wie im Planungs-Leseport).
   */
  "AMBIGUOUS_ORGANISATION",
  /**
   * Die angefragte Woche traegt keinen veroeffentlichten Stand. Kosten duerfen
   * ausschliesslich aus einer veroeffentlichten Planversion entstehen
   * (REQ-003/REQ-005, FMC-001); ein Entwurf ist keine Kostenquelle.
   */
  "PLAN_NOT_PUBLISHED",
] as const;

export type PlanCostFactsProblem = (typeof PLAN_COST_FACTS_PROBLEMS)[number];

export type PlanCostFactsResult =
  | { readonly ok: true; readonly facts: PublishedPlanFacts }
  | { readonly ok: false; readonly problem: PlanCostFactsProblem };

export interface PlanCostFactsPort {
  /** Liest die veroeffentlichten Fakten einer ISO-Woche im gesetzten Mandanten. */
  publishedFacts(weekKey: string): Promise<PlanCostFactsResult>;
}

/** DI-Token. Tests ersetzen ihn, genau wie `DATABASE_PING` und `PLANNING_QUERIES`. */
export const PLAN_COST_FACTS = "PLAN_COST_FACTS";
