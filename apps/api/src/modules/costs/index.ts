/**
 * Oeffentliche API des Kostenmoduls (EYT-105, ADR-001 Z. 76, ADR-003).
 *
 * Nur benannte Re-Exporte. `export *` ist hier verboten und wird vom
 * Architekturtest abgelehnt: ein Stern-Re-Export truege das gesamte
 * Domainmodell ueber die Modulgrenze und machte aus elf Modulen ein globales
 * Modell (EYT-46 AK 5). Was hier steht, ist bewusst der Vertrag — nichts sonst.
 *
 * ## Stand des Moduls
 *
 * Heute ist `costs` eine **Grenze**, kein laufendes Feature: keine Route, keine
 * Verdrahtung in `AppModule`, keine eigene Tabelle in `supabase/migrations/`.
 * Das ist der ehrliche Stand von EYT-105 und keine Luecke — Satzpersistenz
 * (EYT-108), Snapshot und Route (EYT-109), XLSX-Adapter (EYT-110) und
 * Autorisierung (EYT-106) sind eigene Tickets mit eigenen Nachweisen.
 */
export type { PlannedWorkFact, PublishedPlanFacts } from "./domain/planned-work-fact";

export type {
  PlanCostFactsPort,
  PlanCostFactsProblem,
  PlanCostFactsResult,
} from "./application/plan-cost-facts.port";
export { PLAN_COST_FACTS, PLAN_COST_FACTS_PROBLEMS } from "./application/plan-cost-facts.port";

export type { CostExportPort, CostExportRendering } from "./application/cost-export.port";
export { COST_EXPORT_PORT } from "./application/cost-export.port";

export { PlanningFactsAdapter } from "./infrastructure/planning-facts.adapter";

export type { CostsErrorType, RateErrorType } from "./interface/http/costs-error-type";
export { COSTS_ERROR_TYPE, RATE_ERROR_TYPE } from "./interface/http/costs-error-type";

// EYT-106/EYT-108: Autorisierung, Satzverwaltung, Route.
export {
  COST_ACCESS_POLICY,
  COST_ACCESS_PROBLEMS,
  COST_PERMISSIONS,
  MembershipCostAccessPolicy,
} from "./application/cost-access.policy";
export type {
  CostAccessPolicy,
  CostAccessProblem,
  CostAccessResult,
  CostPermission,
  MembershipWithPermissions,
} from "./application/cost-access.policy";

// EYT-106 AK9: Zugriffsentscheidungen mit Korrelations-Id, ohne Nutzlast.
export {
  COST_ACCESS_AUDIT,
  COST_ACCESS_DECISION_EVENT,
  COST_ACCESS_DENY_REASONS,
  COST_ACCESS_EVENT_FIELDS,
  pseudonymSubjekt,
  serialisiereZugriffsereignis,
} from "./application/cost-access-audit.port";
export type {
  CostAccessAuditLog,
  CostAccessDecisionEvent,
  CostAccessDenyReason,
} from "./application/cost-access-audit.port";
export { NestCostAccessAuditLog } from "./infrastructure/cost-access-audit.logger";

export { RATE_REPOSITORY_FACTORY, RATE_WRITE_PROBLEMS } from "./application/rate-repository.port";
export type {
  NewRateVersion,
  RateRepository,
  RateRepositoryFactory,
  RateVersionRecord,
  RateWriteProblem,
  RateWriteResult,
} from "./application/rate-repository.port";

export {
  RATE_EFFECTIVITY_PROBLEMS,
  effectiveRateVersion,
  rateVersionStatus,
} from "./domain/rate-effectivity";
export type { EffectiveRateResult, RateEffectivityProblem } from "./domain/rate-effectivity";
export type { RateVersionRecord as RateVersion } from "./domain/rate-version";

export { PgRateRepository } from "./infrastructure/rate-repository.pg";

export { CostsController } from "./interface/http/costs.controller";
export { CostsProblemFilter } from "./interface/http/costs-problem.filter";
export { ConflictProblem } from "./interface/http/conflict-problem";
