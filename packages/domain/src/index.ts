/**
 * Öffentliche API von `@easytree/domain` (EYT-46, ADR-002 §5).
 *
 * Regeln für dieses Paket:
 * - reine Typen, Invarianten und Zustandsmodelle;
 * - keine Abhängigkeiten — `package.json` führt bewusst weder `dependencies`
 *   noch `peerDependencies`, und `tsconfig` setzt `"types": []`. Damit kann ein
 *   Import von `@nestjs/*`, `kysely`, `pg` oder einem Provider-SDK hier nicht
 *   einmal auflösen: `pnpm typecheck` schlägt fehl, bevor ein Architekturtest
 *   überhaupt greifen müsste (ADR-001 Z. 74);
 * - dies ist NICHT das verbotene `packages/shared` (ADR-001 Z. 77): der Inhalt
 *   ist fachlich benannt und begrenzt, kein Sammelbecken für Hilfsfunktionen.
 */
export type {
  AssignmentId,
  Brand,
  EmployeeId,
  IdentifierBrand,
  OrgId,
  PlanVersionId,
  RateVersionId,
  ResourceId,
  UserId,
  WorksiteId,
} from "./identifiers.js";
export { IDENTIFIER_BRANDS, unsafeIdentifier } from "./identifiers.js";

export type { MaybeInstant, TimeIntervalError, TimeIntervalResult } from "./time-interval.js";
// TimeInterval ist eine Klasse mit privaten Feldern und wird als Wert exportiert:
// nur so ist `TimeInterval.create` erreichbar, und nur die nominale Typisierung
// verhindert, dass ein strukturell gleiches Objekt als geprueftes Intervall gilt.
export {
  durationMinutes,
  durationMs,
  hasAnyOverlap,
  isAdjacent,
  overlaps,
  TIME_INTERVAL_ERRORS,
  TimeInterval,
} from "./time-interval.js";

export type {
  IanaTimeZone,
  LocalBusinessDate,
  LocalWallTime,
  PlanningWeek,
  TimeZoneResult,
  WallTimeResult,
} from "./planning-week.js";
export {
  createTimeZone,
  EUROPE_BERLIN,
  isoWeekOfLocalDate,
  isSameWeek,
  localBusinessDate,
  planningWeekKey,
  planningWeekOf,
  utcInstantOfLocalWallTime,
} from "./planning-week.js";

export type {
  CapacityEntry,
  CapacityFinding,
  CapacityLimit,
  CapacityVerdict,
  WeeklyLoad,
} from "./weekly-capacity.js";
export {
  aggregateWeeklyLoad,
  blocksPublication,
  CAPACITY_VERDICTS,
  evaluateCapacity,
  findCapacityIssues,
  NO_CAPACITY_LIMIT,
  projectWeeks,
} from "./weekly-capacity.js";

// ---------------------------------------------------------------------------
// Kostenvertrag (EYT-95, REQ-004/REQ-005)
//
// Die Tests importieren ausschliesslich ueber diese Datei, nicht ueber die
// Einzelmodule — was hier nicht steht, existiert fuer sie nicht.
// ---------------------------------------------------------------------------

export type {
  CostCurrencyResult,
  Currency,
  HourlyRateAmount,
  HourlyRateAmountError,
  HourlyRateAmountResult,
  Money,
  MoneyError,
  MoneyResult,
  PlanCostAmount,
  PlanCostAmountError,
  PlanCostAmountResult,
} from "./money.js";
export {
  addMoney,
  costCurrencyFromUnknown,
  CURRENCIES,
  HOURLY_RATE_AMOUNT_ERRORS,
  hourlyRateAmount,
  MONEY_ERRORS,
  moneyFromNumber,
  moneyOfMinorUnits,
  PLAN_COST_AMOUNT_ERRORS,
  planCostAmount,
  subtractMoney,
  sumPlanCostAmounts,
} from "./money.js";

export type {
  DurationMilliseconds,
  DurationMillisecondsResult,
  QuantityError,
} from "./duration-milliseconds.js";
export {
  durationMilliseconds,
  QUANTITY_ERRORS,
  toDurationMilliseconds,
} from "./duration-milliseconds.js";

export { compareLocalBusinessDate, dayAfter, dayBefore } from "./local-business-date.js";

export type {
  HourlyRateVersion,
  HourlyRateVersionInput,
  HourlyRateVersionResult,
  RateSelectionError,
  RateSelectionResult,
  RateVersionError,
  RateVersionOverlap,
} from "./rate-version.js";
export {
  findRateVersionOverlaps,
  hourlyRateVersion,
  RATE_SELECTION_ERRORS,
  RATE_VERSION_ERRORS,
  selectRateVersion,
} from "./rate-version.js";

export type {
  CostPosition,
  CostPositionError,
  CostPositionInput,
  CostPositionResult,
  CostSource,
} from "./cost-position.js";
export {
  computeCostPosition,
  COST_RATE_DENOMINATOR,
  COST_RULE_VERSION,
  costOfDuration,
  ROUNDING_MODE,
  ROUNDING_STAGE,
  COST_POSITION_INPUT_ERRORS,
} from "./cost-position.js";
