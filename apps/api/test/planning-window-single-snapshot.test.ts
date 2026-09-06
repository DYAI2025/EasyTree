/**
 * EYT-158 — der Planstand einer Version kommt aus EINEM Statement.
 *
 * `PgTenantQueryRunner` oeffnet die Transaktion mit einem nackten `begin`, also
 * READ COMMITTED: jedes Statement sieht seinen eigenen Snapshot. Wuerden
 * Zuweisungen und Baustellentage in zwei Statements gelesen, koennte ein
 * dazwischen committeter `planWorksiteDay` einen Tag liefern, dessen
 * Teammitglieder in `assignments` noch fehlen — und `PlanningWindowSchema`
 * verwirft genau diese Antwort („Teammitglied verweist auf eine Zuweisung,
 * die nicht unter assignments steht"): aus einem gueltigen Serverstand wuerde
 * ein 500 und im Readback nach dem Speichern ein falscher Fehler.
 *
 * Statischer Waechter: gezaehlt werden die Statements, die `public.assignments`
 * lesen. Gegenmutation: Zuweisungen und Tage wieder getrennt lesen → zwei
 * Treffer, rot. Die fachliche Richtigkeit der Abfrage misst
 * `planning-write.integration.test.ts` gegen echtes PostgreSQL.
 */
import { describe, expect, it } from "vitest";

import { PlanningWindowRepository } from "../src/modules/planning";
import type {
  QueryResult,
  TenantQuery,
  TenantQueryRunner,
} from "../src/platform/database/tenant-query-runner";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const USER = "00000000-0000-4000-8000-00000000aaa1";
const VERSION = "aaaa3333-3333-4333-8333-333333333333";

function antwort<TRow>(rows: TRow[]): QueryResult<TRow> {
  return { rows, rowCount: rows.length };
}

describe("EYT-158 — Planstand in EINEM Snapshot", () => {
  it("liest Zuweisungen und Baustellentage einer Version mit genau einem Statement", async () => {
    const statements: string[] = [];
    const tx: TenantQuery = {
      query: <TRow>(sql: string): Promise<QueryResult<TRow>> => {
        statements.push(sql);
        if (/from public\.organizations/.test(sql)) {
          return Promise.resolve(
            antwort([{ id: ORG, time_zone: "Europe/Berlin" }] as unknown as TRow[]),
          );
        }
        if (/from public\.plan_versions/.test(sql)) {
          return Promise.resolve(
            antwort([
              { id: VERSION, published_at: null, created_at: new Date("2028-01-01T00:00:00Z") },
            ] as unknown as TRow[]),
          );
        }
        return Promise.resolve(antwort<TRow>([]));
      },
    };
    const runner: TenantQueryRunner = { run: (_context, work) => work(tx) };

    const ergebnis = await new PlanningWindowRepository(runner, USER).planningWindow("2028-W02");
    expect(ergebnis.ok).toBe(true);

    const planstand = statements.filter((sql) => /public\.assignments/.test(sql));
    expect(planstand, "Statements, die public.assignments lesen").toHaveLength(1);
    expect(planstand[0]).toMatch(/public\.worksite_day_configurations/);
    expect(planstand[0]).toMatch(/public\.worksite_days/);
  });
});
