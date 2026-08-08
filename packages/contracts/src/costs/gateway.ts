/**
 * Port des Kostenbereichs Richtung Web (EYT-108 ff.).
 *
 * Reads ohne Optionen, Writes mit Pflicht-Idempotenzschlüssel — dieselbe
 * Bauart wie `planning/gateway.ts`. Der Header `X-EasyTree-Organization-Id`
 * WÄHLT die Organisation nur aus, er autorisiert nichts; gesetzt wird er vom
 * HTTP-Client aus einer injizierten Funktion, nie aus Komponenten.
 */
import type { GatewayResult } from "../gateway.js";
import type { WriteOptions } from "../planning/gateway.js";
import type {
  CostSnapshot,
  CreateCostSnapshotCommand,
  CreateRateVersionCommand,
  EmployeesForRates,
  PublishedPlanVersions,
  RateHistory,
  RateVersionDto,
} from "./schemas.js";

export interface CostsGateway {
  /** Mitarbeiterliste für die Satzverwaltung (aktive zuerst). */
  listEmployees(): Promise<GatewayResult<EmployeesForRates>>;
  /** Aktive Version plus vollständige Historie eines Mitarbeiters. */
  rateHistory(employeeId: string): Promise<GatewayResult<RateHistory>>;
  /** Legt eine NEUE unveränderliche Satzversion an — nie ein Update. */
  createRateVersion(
    command: CreateRateVersionCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<RateVersionDto>>;
  /** Veroeffentlichte Planversionen im Wochenbereich — die Auswahlliste von `/kosten`. */
  publishedPlanVersions(
    fromWeekKey: string,
    toWeekKey: string,
  ): Promise<GatewayResult<PublishedPlanVersions>>;
  /** Erzeugt einen unveraenderlichen Snapshot. Pflicht-Idempotenzschluessel wie jeder Write. */
  createSnapshot(
    command: CreateCostSnapshotCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<CostSnapshot>>;
  /** Liest einen GESPEICHERTEN Snapshot. Rechnet nichts neu. */
  snapshot(snapshotId: string): Promise<GatewayResult<CostSnapshot>>;
}
