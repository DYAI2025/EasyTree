/**
 * Öffentliche API des Workforce-Moduls (EYT-46, ADR-001 Z. 76).
 * Nur benannte Re-Exporte — siehe Kommentar in `modules/planning/index.ts`.
 */
export type { WorkforceQueries } from "./application/workforce-queries.port";
export type { Employee } from "./domain/employee";
export { isAssignable } from "./domain/employee";
