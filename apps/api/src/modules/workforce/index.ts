/**
 * Öffentliche API des Workforce-Moduls (EYT-46, ADR-001 Z. 76).
 * Nur benannte Re-Exporte — siehe Kommentar in `modules/planning/index.ts`.
 */
export type { WorkforceQueries } from "./application/workforce-queries.port";
export type { Employee } from "./domain/employee";
export { isAssignable } from "./domain/employee";

// EYT-108: Leseport fuer andere Module. `public.employees` gehoert diesem
// Modul; wer die Liste braucht, bekommt sie hierueber und liest die Tabelle
// nicht selbst (Wächter `costs-touches-only-own-tables`).
export { EMPLOYEE_DIRECTORY_FACTORY } from "./application/employee-directory.port";
export type {
  EmployeeDirectory,
  EmployeeDirectoryFactory,
  EmployeeSummary,
} from "./application/employee-directory.port";
export { PgEmployeeDirectory } from "./infrastructure/employee-directory.repository";
