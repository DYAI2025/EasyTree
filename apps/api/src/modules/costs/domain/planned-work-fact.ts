/**
 * Einlassvokabular des Kostenmoduls fuer veroeffentlichte Planfakten
 * (EYT-105, REQ-001, ADR-003).
 *
 * ## Warum das Kostenmodul eigene Typen fuehrt
 *
 * Die Planung liefert ihre Zeilen in der Form ihrer eigenen Application-API
 * (`AssignmentRow`, `PlanningWindowRow`). Reichte das Kostenmodul diese Form
 * durch, waere jede Aenderung an der Planungsantwort zugleich eine Aenderung am
 * Kostenmodell — die Modulgrenze waere dann eine Verzeichnisgrenze und kein
 * Vertrag. Hier steht deshalb die Form, in der das Kostenmodul Planfakten
 * annimmt; die Abbildung passiert genau einmal, im Adapter der
 * infrastructure-Schicht.
 *
 * ## Framework-frei, und was daraus folgt
 *
 * Diese Schicht darf ausschliesslich relative Pfade innerhalb von `domain/` und
 * `@easytree/domain` importieren (ADR-001 Z. 74; Regel `costs-domain-purity`).
 * Geld, Minor Units, Mengen und Rundung kommen deshalb **vollstaendig** aus
 * `@easytree/domain` (EYT-95) und werden hier nicht nachgebaut — die Regel
 * `costs-single-money-implementation` macht jeden zweiten Anlauf rot.
 *
 * ## Was hier bewusst NICHT steht
 *
 * Tagesallokation, Mitternachtsteilung und Zonenverteilung gehoeren zu EYT-109,
 * die Satzauswahl zu EYT-108. Ein vorgezogener Rumpf davon waere ein Wert, den
 * niemand geprueft hat, und wuerde spaetere Tests zufaellig gruen faerben.
 */
import type { AssignmentId, EmployeeId, PlanVersionId, WorksiteId } from "@easytree/domain";

/**
 * Ein veroeffentlichter Einsatz, so wie das Kostenmodul ihn braucht.
 *
 * Die Bezeichner tragen die Marken aus `@easytree/domain` (EYT-46) und nicht
 * nacktes `string`: zwei vertauschte UUIDs faenden sonst erst dann auf, wenn
 * ein historischer Betrag auf die falsche Person zeigt.
 */
export interface PlannedWorkFact {
  readonly assignmentId: AssignmentId;
  readonly employeeId: EmployeeId;
  readonly worksiteId: WorksiteId;
  /**
   * UTC-Instant, unveraendert aus der Planung uebernommen. Bewusst KEINE
   * lokale Wanduhrzeit: die Umrechnung in Kalendertage der Organisationszone
   * ist Aufgabe von EYT-109 und passiert dort mit expliziter Zone, nicht hier
   * nebenbei (siehe `apps/api/test/no-local-time-construction.test.ts`).
   */
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date;
}

/**
 * Die Faktenlage einer veroeffentlichten Planversion.
 *
 * `weekKey` und `timeZone` bleiben `string`, weil sie genau so aus der
 * Planungs-Application-API kommen. Sie hier auf `PlanningWeek` bzw.
 * `IanaTimeZone` zu heben, hiesse eine Pruefung zu behaupten, die an dieser
 * Stelle niemand ausfuehrt; die Zonenpruefung gehoert in den Use Case, der die
 * Zone tatsaechlich anwendet (EYT-109).
 */
export interface PublishedPlanFacts {
  readonly planVersionId: PlanVersionId;
  readonly weekKey: string;
  /** IANA-Zone der Organisation, wie die Planung sie fuehrt. */
  readonly timeZone: string;
  readonly work: readonly PlannedWorkFact[];
}
