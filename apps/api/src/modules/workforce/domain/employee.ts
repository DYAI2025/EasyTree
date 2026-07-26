import type { EmployeeId, OrgId } from "@easytree/domain";

/**
 * Beschäftigte Person einer Organisation (EYT-46).
 *
 * Framework-frei: dieser Ordner darf ausschliesslich relative Pfade innerhalb
 * von `domain/` und `@easytree/domain` importieren (ADR-001 Z. 74). Der
 * Architekturtest erzwingt das als Allowlist.
 */
export interface Employee {
  readonly id: EmployeeId;
  readonly orgId: OrgId;
  readonly displayName: string;
  /** Inaktive Personen bleiben referenzierbar, sind aber nicht planbar. */
  readonly active: boolean;
}

/** Planbar ist nur, wer aktiv ist. Bewusst als Funktion, nicht als Feldkopie. */
export function isAssignable(employee: Employee): boolean {
  return employee.active;
}
