import type { EmployeeId } from "@easytree/domain";

import type { Employee } from "../domain/employee";

/** Öffentlicher Anwendungs-Port des Workforce-Moduls (EYT-46, ADR-001 Z. 76). */
export interface WorkforceQueries {
  findAssignable(id: EmployeeId): Promise<Employee | null>;
}
