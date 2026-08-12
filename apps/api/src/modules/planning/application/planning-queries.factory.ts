/**
 * Leseport JE SUBJEKT (EYT-50).
 *
 * Warum eine Fabrik und kein einfacher Provider: der Mandantenkontext ist
 * anfragegebunden. Ein einmal gebautes Repository mit fest eingebautem Subjekt
 * waere ein Singleton, das die Identitaet der ERSTEN Anfrage an alle folgenden
 * weiterreicht — dieselbe Klasse von Fehler wie eine Verbindung, die ihren
 * transaktionslokalen Kontext in den Pool zurueckgibt.
 *
 * Nest kennt dafuer auch `Scope.REQUEST`. Eine Fabrik ist hier vorzuziehen,
 * weil sie das Subjekt zu einem sichtbaren Argument macht: wer ein Repository
 * baut, muss sagen, fuer wen. Bei einem request-scoped Provider steht dieselbe
 * Information in einem Injektionsdekorator und ist beim Lesen des Repositories
 * nicht mehr da.
 */
import type { PlanningQueries } from "./planning-queries.port";

/**
 * Baut den Leseport fuer ein verifiziertes Subjekt.
 *
 * `organisationId` ist optional und bewusst das ZWEITE Argument: bestehende
 * Aufrufer mit genau einer Mitgliedschaft rufen unveraendert einstellig auf und
 * behalten ihre Semantik (mehrere Mitgliedschaften ohne Auswahl bleiben
 * `AMBIGUOUS_ORGANISATION`).
 *
 * Wird sie uebergeben, ist sie eine BEREITS SERVERSEITIG AUFGELOESTE Auswahl —
 * etwa das `organisationId` aus `CostAccessPolicy.authorize`, das aus
 * `memberships` stammt und nicht aus dem Header. Sie autorisiert nichts: das
 * Repository verengt damit ausschliesslich die ohnehin RLS-sichtbare Menge.
 * Eine fremde Id liefert deshalb null Zeilen und nicht fremde Daten.
 */
export type PlanningQueriesFactory = (
  subjectUserId: string,
  organisationId?: string | null,
) => PlanningQueries;

export const PLANNING_QUERIES_FACTORY = "PLANNING_QUERIES_FACTORY";
