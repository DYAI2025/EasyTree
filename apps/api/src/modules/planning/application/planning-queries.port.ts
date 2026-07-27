/**
 * Leseport der Planung (EYT-50).
 *
 * Bewusst KEINE Transporttypen: was hier herauskommt, ist der Stand der
 * Datenbank, nicht die Antwortform. Die Abbildung auf `PlanningWindow` aus
 * `@easytree/contracts` gehoert in die interface-Schicht — sonst waere der
 * Vertrag ueber die Anwendungsschicht bis ins Repository durchgereicht, und
 * eine Vertragsaenderung zoege eine Repositoryaenderung nach sich.
 *
 * Die Organisation steht in KEINER Signatur. Sie kommt ausschliesslich aus dem
 * gesetzten Datenbankkontext (`app.user_org_ids()` ueber RLS). Ein Parameter
 * `orgId` waere die Einladung, ihn aus der URL zu befuellen.
 */

/** Eine Zuweisung, so wie sie in der Datenbank steht. */
export interface AssignmentRow {
  readonly id: string;
  readonly employeeId: string;
  readonly worksiteId: string;
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date;
}

export interface PlanningWindowRow {
  readonly weekKey: string;
  /** IANA-Zone der Organisation aus `organizations.time_zone` (Migration 0004). */
  readonly timeZone: string;
  /**
   * Der bearbeitbare Stand: Zuweisungen des Entwurfs, sonst die der zuletzt
   * veroeffentlichten Version, sonst leer.
   * Begruendung in docs/decisions/2026-07-27-eyt-50-lesesemantik-planungsfenster.md.
   */
  readonly assignments: readonly AssignmentRow[];
  /** Zuletzt veroeffentlichte Version derselben Woche, oder `null`. */
  readonly publishedVersionId: string | null;
}

/** Warum eine Leseanfrage nicht beantwortbar ist. */
export type PlanningQueryProblem =
  /** Angemeldet, aber ohne aktive Mitgliedschaft. */
  | "NO_ORGANISATION"
  /**
   * Mehrere aktive Mitgliedschaften. KEINE stille Auswahl: eine davon zu
   * nehmen waere eine erfundene Mandantenentscheidung, die niemandem auffiele,
   * weil das Ergebnis plausibel aussieht. Der Organisationswechsler gehoert zu
   * EYT-14.
   */
  | "AMBIGUOUS_ORGANISATION";

export type PlanningWindowResult =
  | { readonly ok: true; readonly window: PlanningWindowRow }
  | { readonly ok: false; readonly problem: PlanningQueryProblem };

export interface PlanningQueries {
  /** Liest das Fenster einer ISO-Woche im Mandanten des gesetzten Kontexts. */
  planningWindow(weekKey: string): Promise<PlanningWindowResult>;
}

/** DI-Token. Tests ersetzen ihn, genau wie `DATABASE_PING`. */
export const PLANNING_QUERIES = "PLANNING_QUERIES";
