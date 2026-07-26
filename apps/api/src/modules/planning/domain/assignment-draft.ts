import { overlaps } from "@easytree/domain";
import type { AssignmentId, EmployeeId, OrgId, TimeInterval, WorksiteId } from "@easytree/domain";

/**
 * Entwurf einer Einsatzzuweisung (EYT-46, EYT-73).
 *
 * Bewusst NICHT die veröffentlichte Zuweisung: Entwurf und veröffentlichte
 * Version sind getrennt (EYT-18).
 *
 * `interval` ist ein `TimeInterval`, kein Paar roher Zeitwerte. Instanzen
 * entstehen nur über `TimeInterval.create`, es gibt also keinen Entwurf mit
 * unvalidiertem Intervall. Das erzwingt die Pflichtfelder aus EYT-73 an dieser
 * Stelle — **nicht** aber „fail-closed Publish": ein Publish-Pfad existiert
 * noch nicht, `PlanningCommands` ist bisher eine reine Portdeklaration ohne
 * Implementierung, Controller oder Route.
 */
export interface AssignmentDraft {
  readonly id: AssignmentId;
  readonly orgId: OrgId;
  readonly employeeId: EmployeeId;
  readonly worksiteId: WorksiteId;
  readonly interval: TimeInterval;
}

/**
 * Stabile Konfliktcodes. Der Code ist Teil des API-Vertrags (EYT-47) und darf
 * sich nicht mit der Formulierung der Meldung ändern.
 *
 * Hier stehen ausschliesslich Codes, die von Code in diesem Repository auch
 * **erzeugt** werden. `RESOURCE_DOUBLE_BOOKED` steht bewusst nicht mehr hier:
 * `AssignmentDraft` trägt keine Ressource, es gibt keinen Produzenten, und ein
 * deklarierter Code ohne Produzent liest sich für jeden Downstream-Leser wie
 * „ist behandelt". Er kommt zurück, wenn Ressourcenreservierungen modelliert
 * sind (`FIND-005`, EYT-86).
 */
export const CONFLICT_CODES = [
  "EMPLOYEE_INTERVAL_OVERLAP",
  "EMPLOYEE_INACTIVE",
  "WORKSITE_NOT_PUBLISHABLE",
] as const;

export type ConflictCode = (typeof CONFLICT_CODES)[number];

/** Ein Konflikt blockiert die Veröffentlichung; eine Warnung tut es nicht (EYT-74). */
export interface PlanningConflict {
  readonly code: ConflictCode;
  readonly blocking: boolean;
}

/**
 * Überschneidet sich der Entwurf mit einem bereits geplanten Einsatz derselben
 * Person **in derselben Organisation**? (EYT-73 AK 4)
 *
 * Nutzt `overlaps` aus `@easytree/domain` statt eines eigenen Grenzvergleichs —
 * die zweite Implementierung war im Prototyp die Ursache dafür, dass Dauer und
 * Überlappung unterschiedliche Antworten gaben. Halb-offen: ein
 * Baustellenwechsel um 12:00 ist kein Konflikt.
 *
 * Der Mandantenvergleich ist nicht kosmetisch. Ohne ihn würde eine Zuweisung
 * aus einer fremden Organisation einen Konflikt auslösen oder verdecken —
 * serverseitige Autorisierung ist primär (ADR-001 Z. 84).
 *
 * `excludeId` statt eines Vergleichs `other.id !== draft.id`: ein noch nicht
 * gespeicherter Entwurf müsste sonst eine Id erfinden, und zwei Entwürfe mit
 * demselben Platzhalter schlössen sich gegenseitig von der Prüfung aus — ein
 * echter Konflikt bliebe unentdeckt. Wer eine bestehende Zuweisung bearbeitet,
 * übergibt deren Id ausdrücklich; wer neu anlegt, übergibt `null`.
 *
 * **Keine Absicherung unter Nebenläufigkeit.** Zwei parallele Requests können
 * beide „kein Konflikt" sehen und beide schreiben. Der Schutz dagegen gehört in
 * die Datenbank (Exclusion-Constraint, EYT-49) — dort existiert derzeit weder
 * eine Assignment-Tabelle noch ein Constraint. Diese Funktion liefert die
 * verständliche Meldung im Normalfall, nicht die Garantie.
 */
export function conflictsWithExisting(
  draft: AssignmentDraft,
  existing: readonly AssignmentDraft[],
  excludeId: AssignmentId | null,
): boolean {
  return existing.some(
    (other) =>
      (excludeId === null || other.id !== excludeId) &&
      other.orgId === draft.orgId &&
      other.employeeId === draft.employeeId &&
      overlaps(draft.interval, other.interval),
  );
}
