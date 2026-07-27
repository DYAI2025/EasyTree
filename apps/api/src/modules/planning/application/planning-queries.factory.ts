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

/** Baut den Leseport fuer ein verifiziertes Subjekt. */
export type PlanningQueriesFactory = (subjectUserId: string) => PlanningQueries;

export const PLANNING_QUERIES_FACTORY = "PLANNING_QUERIES_FACTORY";
