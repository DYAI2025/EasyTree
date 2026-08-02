/**
 * Ports der Satzverwaltung (EYT-108).
 *
 * Bewusst OHNE `orgId` in den Signaturen: der Mandant kommt aus dem
 * Datenbankkontext, den der TenantQueryRunner setzt — dieselbe Entscheidung
 * wie bei `PlanCostFactsPort`. Ein Parameter waere die Einladung, ihn eines
 * Tages aus einem Header zu fuellen.
 */

import type { RateVersionRecord } from "../domain/rate-version";

export type { RateVersionRecord };

export const RATE_WRITE_PROBLEMS = [
  "RATE_INTERVAL_OVERLAP",
  "STALE_ACTIVE_VERSION",
  "EMPLOYEE_UNKNOWN",
  // EYT-108 Option A+: die Abloesung eines offenen Vorgaengers. Jeder dieser
  // Gruende braucht eine eigene HTTP-Abbildung in `problemFor` und einen
  // eigenen URN in RATE_ERROR_TYPE — sonst wird daraus ein 500er statt eines
  // RFC-7807-Dokuments.
  "VORGAENGER_BEREITS_GESCHLOSSEN",
  "NACHFOLGER_NICHT_SPAETER",
  "FREMDER_MITARBEITER",
] as const;
export type RateWriteProblem = (typeof RATE_WRITE_PROBLEMS)[number];

export type RateWriteResult =
  | { readonly ok: true; readonly version: RateVersionRecord }
  | { readonly ok: false; readonly problem: RateWriteProblem };

export interface NewRateVersion {
  /**
   * Die von der `CostAccessPolicy` bereits AUFGELOESTE Organisation.
   *
   * Sie kommt hier herein, statt aus `public.employees` abgeleitet zu werden:
   * die Tabelle gehoert `workforce`, und das Kostenmodul liest ausschliesslich
   * eigene Tabellen (Wächter `costs-touches-only-own-tables`). RLS prueft den
   * Wert ohnehin gegen `app.user_org_ids()` — eine erfundene Organisation
   * kommt nicht durch.
   */
  readonly organisationId: string;
  readonly employeeId: string;
  readonly amountMinorUnits: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly reason: string;
  readonly expectedActiveVersionId: string | null;
  readonly correlationId: string;
}

export interface RateRepository {
  versionsFor(employeeId: string): Promise<readonly RateVersionRecord[]>;
  append(version: NewRateVersion): Promise<RateWriteResult>;
}

/** Je Anfrage ein Repository mit dem Subjekt der Anfrage — nie ein Singleton. */
export type RateRepositoryFactory = (subjectUserId: string) => RateRepository;

export const RATE_REPOSITORY_FACTORY = "COSTS_RATE_REPOSITORY_FACTORY";
