/**
 * Transportverträge des Kostenbereichs (EYT-108/109/110, Slice-Schritt 3).
 *
 * ## Geld reist als Minor-Unit-String
 *
 * `amountMinorUnits` ist `^\d+$` — niemals eine Gleitkommazahl. JSON-Zahlen
 * verlieren oberhalb von 2^53 still Präzision, und ein Betrag ist in der
 * Domäne ein `bigint` (EYT-95). Die Umwandlung String↔bigint geschieht an
 * den Nähten; kein Float berührt je einen Betrag.
 *
 * ## Versionen sind unveränderlich
 *
 * Es gibt kein Update-Kommando. `CreateRateVersionCommand` legt eine NEUE
 * Version an; `expectedActiveVersionId` erkennt konkurrierende Änderungen
 * (Server antwortet 409 → `STALE_VERSION`), `predecessorId` in der Antwort
 * hält die Kette nachvollziehbar (EYT-108: nie überschreiben).
 */
import { z } from "zod";

import { IsoWeekKeySchema } from "../planning/schemas.js";

import { IdSchema, InstantSchema } from "../primitives.js";

/** Betrag in Minor Units (Cent) als dezimaler String, nie Float. */
export const MinorUnitsSchema = z
  .string()
  .regex(/^\d+$/, "Betrag in Minor Units als dezimale Ziffernfolge")
  .max(18);

/** Lokales Geschäftsdatum (Gültigkeit) — Kalendertag, keine Uhrzeit. */
export const BusinessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Lokales Datum im Format JJJJ-MM-TT");

export const EmployeeForRatesDtoSchema = z.strictObject({
  id: IdSchema,
  displayName: z.string().min(1),
  active: z.boolean(),
});
export type EmployeeForRatesDto = z.infer<typeof EmployeeForRatesDtoSchema>;

export const EmployeesForRatesSchema = z.strictObject({
  employees: z.array(EmployeeForRatesDtoSchema),
});
export type EmployeesForRates = z.infer<typeof EmployeesForRatesSchema>;

export const RATE_VERSION_STATUS = ["aktiv", "kommend", "abgelaufen"] as const;
export const RateVersionStatusSchema = z.enum(RATE_VERSION_STATUS);
export type RateVersionStatus = z.infer<typeof RateVersionStatusSchema>;

export const RateVersionDtoSchema = z.strictObject({
  id: IdSchema,
  employeeId: IdSchema,
  amountMinorUnits: MinorUnitsSchema,
  currency: z.literal("EUR"),
  validFrom: BusinessDateSchema,
  validTo: BusinessDateSchema.nullable(),
  status: RateVersionStatusSchema,
  predecessorId: IdSchema.nullable(),
  reason: z.string().min(1),
  createdAt: InstantSchema,
  createdBy: IdSchema,
});
export type RateVersionDto = z.infer<typeof RateVersionDtoSchema>;

export const RateHistorySchema = z.strictObject({
  employeeId: IdSchema,
  /** Die am heutigen Geschäftsdatum wirksame Version — oder null (Satz fehlt). */
  activeVersionId: IdSchema.nullable(),
  versions: z.array(RateVersionDtoSchema),
});
export type RateHistory = z.infer<typeof RateHistorySchema>;

export const CreateRateVersionCommandSchema = z.strictObject({
  employeeId: IdSchema,
  amountMinorUnits: MinorUnitsSchema,
  currency: z.literal("EUR"),
  validFrom: BusinessDateSchema,
  validTo: BusinessDateSchema.nullable(),
  /** Fachlicher Änderungsgrund — Pflicht, wird auditiert (EYT-108). */
  reason: z.string().min(1).max(500),
  /**
   * Die Version, die der Client beim Ausfüllen als aktiv sah — oder null,
   * wenn es keine gab. Weicht der Serverstand ab, antwortet er 409 und die
   * UI zeigt "konkurrierende Änderung erkannt" statt still zu überschreiben.
   */
  expectedActiveVersionId: IdSchema.nullable(),
});
export type CreateRateVersionCommand = z.infer<typeof CreateRateVersionCommandSchema>;

// ---------------------------------------------------------------------------
// Der gespeicherte Tageskosten-Snapshot (EYT-109) — Positionen, Tagessummen und
// der Kopf, der sie zusammenhält.
//
// Ein Snapshot ist eine Momentaufnahme, kein Bericht: er wird EINMAL aus einer
// veröffentlichten Planversion berechnet und danach nur noch gelesen. Deshalb
// reisen `timeZone` und `ruleVersion` mit — ohne sie wäre später nicht mehr
// entscheidbar, nach welcher Zonen- und Rechenregel die Tagesgrenzen gezogen
// wurden, und ein Export (EYT-110) zeigte Zahlen ohne nachvollziehbare
// Herkunft. Es gibt aus demselben Grund kein Update-Kommando.
// ---------------------------------------------------------------------------

/** Ein Kostenanteil einer Person an einem lokalen Kalendertag. */
export const CostPositionDtoSchema = z.strictObject({
  id: IdSchema,
  assignmentId: IdSchema,
  worksiteId: IdSchema,
  worksiteLabel: z.string().min(1),
  employeeId: IdSchema,
  employeeLabel: z.string().min(1),
  /** Lokaler Leistungstag in der Zone der Organisation. */
  localDate: BusinessDateSchema,
  /**
   * Anteil an diesem lokalen Tag, in Millisekunden — als String, nie als Zahl.
   *
   * Dasselbe Schema wie ein Betrag, weil dieselbe Regel gilt: eine reine
   * Ziffernfolge, die an der Naht zu `bigint` wird. Ein eigener `^\d+$` wäre
   * ein zweiter Ausdruck für dieselbe Aussage.
   */
  durationMilliseconds: MinorUnitsSchema,
  rateVersionId: IdSchema,
  amountMinorUnits: MinorUnitsSchema,
});
export type CostPositionDto = z.infer<typeof CostPositionDtoSchema>;

/** Tagessumme — vorberechnet, damit die UI nicht selbst addiert. */
export const CostDayTotalSchema = z.strictObject({
  localDate: BusinessDateSchema,
  worksiteId: IdSchema,
  amountMinorUnits: MinorUnitsSchema,
});
export type CostDayTotal = z.infer<typeof CostDayTotalSchema>;

export const CostSnapshotSchema = z.strictObject({
  id: IdSchema,
  planVersionId: IdSchema,
  /** Baustellenfilter, mit dem der Snapshot entstand. `null` = alle Baustellen. */
  worksiteId: IdSchema.nullable(),
  /** Siehe {@link IsoWeekKeySchema} — die eine geprüfte Wochenregel (EYT-88). */
  weekKey: IsoWeekKeySchema,
  /** IANA-Zone, nach der die lokalen Tage abgegrenzt wurden. Festgehalten, nicht geraten. */
  timeZone: z.string().min(1),
  currency: z.literal("EUR"),
  /** Rechenregel, nach der die Positionen entstanden — macht den Betrag nachvollziehbar. */
  ruleVersion: z.literal("personnel-plan-cost-v1"),
  createdAt: InstantSchema,
  createdBy: IdSchema,
  correlationId: z.string().min(1),
  totalMinorUnits: MinorUnitsSchema,
  days: z.array(CostDayTotalSchema),
  positions: z.array(CostPositionDtoSchema),
});
export type CostSnapshot = z.infer<typeof CostSnapshotSchema>;

export const CreateCostSnapshotCommandSchema = z.strictObject({
  publishedPlanVersionId: IdSchema,
  /** Optionaler Baustellenfilter desselben Mandanten. `null` = alle Baustellen. */
  worksiteId: IdSchema.nullable(),
});
export type CreateCostSnapshotCommand = z.infer<typeof CreateCostSnapshotCommandSchema>;

export const PublishedPlanVersionDtoSchema = z.strictObject({
  id: IdSchema,
  weekKey: IsoWeekKeySchema,
  publishedAt: InstantSchema,
});
export type PublishedPlanVersionDto = z.infer<typeof PublishedPlanVersionDtoSchema>;

export const PublishedPlanVersionsSchema = z.strictObject({
  versions: z.array(PublishedPlanVersionDtoSchema),
});
export type PublishedPlanVersions = z.infer<typeof PublishedPlanVersionsSchema>;
