/**
 * Mitarbeiterverzeichnis aus `public.employees` (EYT-108).
 *
 * Liegt im WORKFORCE-Modul, weil die Tabelle diesem Modul gehoert
 * (TABLE_OWNERSHIP). Das Kostenmodul bekommt die Liste ueber seinen Port —
 * es liest die Tabelle nie selbst. RLS begrenzt die Sicht ohnehin auf die
 * Organisationen des Subjekts; der Runner setzt den Kontext.
 */
import type {
  TenantQuery,
  TenantQueryRunner,
} from "../../../platform/database/tenant-query-runner";
import type { EmployeeDirectory, EmployeeSummary } from "../application/employee-directory.port";

interface EmployeeRow {
  readonly id: string;
  readonly display_name: string;
  readonly active: boolean;
}

export class PgEmployeeDirectory implements EmployeeDirectory {
  constructor(
    private readonly runner: TenantQueryRunner,
    private readonly subjectUserId: string,
  ) {}

  async list(): Promise<readonly EmployeeSummary[]> {
    const rows = await this.runner.run({ userId: this.subjectUserId }, async (tx: TenantQuery) => {
      const ergebnis = await tx.query<EmployeeRow>(
        `select id, display_name, active
             from public.employees
            order by active desc, display_name`,
      );
      return ergebnis.rows;
    });
    return rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      active: row.active,
    }));
  }
}
