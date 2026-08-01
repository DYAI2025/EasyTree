/**
 * Oeffentlicher Leseport des Workforce-Moduls (EYT-108, ADR-001 Z. 76).
 *
 * Bewusst schmal: Kennung, Anzeigename, Aktivstatus. Andere Module — etwa
 * `costs` fuer die Satzverwaltung — brauchen nicht mehr, und was nicht
 * herausgereicht wird, kann auch nicht anderswo landen (Datensparsamkeit bei
 * personenbezogenen Daten).
 */

export interface EmployeeSummary {
  readonly id: string;
  readonly displayName: string;
  readonly active: boolean;
}

export interface EmployeeDirectory {
  /** Alle Beschaeftigten der Organisationen des Subjekts, aktive zuerst. */
  list(): Promise<readonly EmployeeSummary[]>;
}

/** Je Anfrage eines mit dem Subjekt der Anfrage — nie ein Singleton. */
export type EmployeeDirectoryFactory = (subjectUserId: string) => EmployeeDirectory;

export const EMPLOYEE_DIRECTORY_FACTORY = "WORKFORCE_EMPLOYEE_DIRECTORY_FACTORY";
