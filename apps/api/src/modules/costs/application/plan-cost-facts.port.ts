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
 * Keine Organisations-Id in einer PORTMETHODE. Ein Parameter `orgId` an
 * `publishedFacts` oder `publishedFactsForVersion` waere die Einladung, ihn aus
 * URL oder Body zu befuellen (REQ-002).
 *
 * Die BINDUNG dagegen steht seit EYT-109 an der Fabrik
 * ({@link PlanCostFactsFactory}) — dort ist sie das Ergebnis von
 * `CostAccessPolicy.authorize`, also serverseitig aus `memberships` aufgeloest
 * und nicht aus einem Header geglaubt. Sie autorisiert nichts: sie verengt nur,
 * was RLS ohnehin sichtbar macht, und eine fremde Organisation liefert null
 * Zeilen statt fremder Daten.
 */
import type { PublishedPlanFacts, PublishedPlanVersionSummary } from "../domain/planned-work-fact";

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
  /**
   * Die benannte Planversion ist im Mandanten nicht sichtbar (EYT-109, Task 8).
   *
   * Deckt bewusst zwei Faelle mit EINER Antwort ab — „gibt es nicht" und
   * „gehoert einem anderen Mandanten". Die Unterscheidung waere ein
   * Existenzleck; RLS macht beide Faelle schon in der Datenbank
   * ununterscheidbar (null Zeilen), und diese Liste gibt das nach aussen
   * weiter, statt es an der Portgrenze wieder aufzutrennen.
   *
   * NICHT mit `PLAN_NOT_PUBLISHED` zusammengelegt: dort existiert die Version
   * und ist ein Entwurf. Die Oberflaeche sagt einmal „veroeffentliche zuerst"
   * und einmal „diese Version kenne ich nicht" — zwei Handlungen, zwei Codes.
   */
  "PLAN_VERSION_NOT_FOUND",
] as const;

export type PlanCostFactsProblem = (typeof PLAN_COST_FACTS_PROBLEMS)[number];

export type PlanCostFactsResult =
  | { readonly ok: true; readonly facts: PublishedPlanFacts }
  | { readonly ok: false; readonly problem: PlanCostFactsProblem };

/**
 * Ablehnungsgruende der AUSWAHLLISTE — bewusst enger als
 * {@link PlanCostFactsProblem}.
 *
 * Eine Liste nennt keine einzelne Planversion, also kann sie weder
 * `PLAN_VERSION_NOT_FOUND` noch `PLAN_NOT_PUBLISHED` ergeben. Der weite Typ
 * waere eine Zusage auf Faelle, die nie eintreten — und jeder Aufrufer muesste
 * sie trotzdem behandeln (gleiche Begruendung wie bei
 * `PublishedVersionsResult` im Planungs-Leseport).
 *
 * `Extract` und keine zweite eingefrorene Liste: eine zweite Liste braeuchte
 * eigene Fehlercodes, obwohl beide Gruende an der HTTP-Naht laengst einen
 * haben — und sie wuerde nur BEHAUPTEN, eine Teilmenge zu sein. So ist es
 * bewiesen. Verschwaende jemand einen der beiden Namen aus
 * `PLAN_COST_FACTS_PROBLEMS`, wird dieser Typ `never` und der Adapter
 * kompiliert nicht mehr — der Verlust faellt an der Zuweisung auf.
 */
export type PlanVersionListProblem = Extract<
  PlanCostFactsProblem,
  "NO_ORGANISATION" | "AMBIGUOUS_ORGANISATION"
>;

export type PublishedVersionsListResult =
  | { readonly ok: true; readonly versions: readonly PublishedPlanVersionSummary[] }
  | { readonly ok: false; readonly problem: PlanVersionListProblem };

export interface PlanCostFactsPort {
  /**
   * Liest die veroeffentlichten Fakten einer ISO-Woche im gesetzten Mandanten.
   *
   * Woche, nicht Version — deshalb NICHT der Einstieg des Kosten-Snapshots
   * (EYT-105 hat die Methode eingefuehrt, als es die versionsgenaue Lesung
   * noch nicht gab). Sie bleibt, weil ihr Wegfall eine eigene Entscheidung
   * waere; heute hat sie keinen Verbraucher.
   */
  publishedFacts(weekKey: string): Promise<PlanCostFactsResult>;

  /**
   * Liest die veroeffentlichten Fakten GENAU DIESER Planversion. Der Einstieg
   * des Kosten-Snapshots (EYT-109).
   *
   * Warum nicht `publishedFacts(weekKey)`: dessen Antwort haengt an der Woche.
   * Entsteht nach dem Veroeffentlichen ein neuer Entwurf derselben Woche,
   * liefert das Planungsfenster dessen Zuweisungen — ein Snapshot darauf fror
   * einen Personalplan ein, den niemand veroeffentlicht hat, und saehe
   * hinterher revisionssicher aus.
   */
  publishedFactsForVersion(planVersionId: string): Promise<PlanCostFactsResult>;

  /**
   * Listet die veroeffentlichten Planversionen eines Wochenbereichs
   * (einschliesslich beider Grenzen) — die Auswahlquelle von `/kosten`.
   *
   * Entwuerfe kommen nicht vor. Die Reihenfolge gehoert der Planung und wird
   * hier nicht neu interpretiert.
   */
  publishedVersions(fromWeekKey: string, toWeekKey: string): Promise<PublishedVersionsListResult>;
}

/** DI-Token. Tests ersetzen ihn, genau wie `DATABASE_PING` und `PLANNING_QUERIES`. */
export const PLAN_COST_FACTS = "PLAN_COST_FACTS";

/**
 * Baut den Faktenport JE SUBJEKT UND ORGANISATION (EYT-109).
 *
 * `organisationId` ist PFLICHT und nicht optional. Der Kostenpfad hat die Id in
 * jedem Erfolgsfall — `CostAccessPolicy.authorize` liefert sie aus
 * `memberships`. Optional waere sie die Einladung, sie in der ersten Route zu
 * vergessen; pflichtig laesst der Compiler das nicht zu.
 *
 * Sie autorisiert nichts. Die Entscheidung ist zu diesem Zeitpunkt bereits
 * gefallen; hier wird sie nur nicht mehr verloren.
 */
export type PlanCostFactsFactory = (
  subjectUserId: string,
  organisationId: string,
) => PlanCostFactsPort;

/**
 * DI-Token der Fabrik — das einzige, das `AppModule` registriert (EYT-109).
 *
 * `PLAN_COST_FACTS` daneben ist heute unbenutzt: es gibt keinen fertigen Port
 * je Prozess, weil es keinen geben DARF. Wer den Port braucht, injiziert diese
 * Fabrik und ruft sie je Anfrage.
 */
export const PLAN_COST_FACTS_FACTORY = "PLAN_COST_FACTS_FACTORY";
