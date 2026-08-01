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
