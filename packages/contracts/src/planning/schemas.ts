/**
 * Transportschemata der Planung (EYT-47, EYT-79).
 *
 * ## Warum hier keine Domaintypen stehen
 *
 * `@easytree/domain` exportiert `TimeInterval` als Klasse mit privaten Feldern
 * und die Bezeichner als nominal gebrandete Strings. Beides **kann** nicht über
 * die Leitung: `JSON.stringify` einer Klasse mit privatem Zustand ergibt ohne
 * `toJSON` ein leeres Objekt, und der Rückweg müsste durch
 * `TimeInterval.create` laufen, was ein deserialisiertes Objekt nie tut.
 *
 * Damit ist EYT-47 AK 5 („Domainentitäten werden nicht direkt als
 * Transportobjekte veröffentlicht") keine Stilfrage, sondern eine
 * Typeigenschaft. `packages/contracts` führt `@easytree/domain` deshalb weder
 * als Abhängigkeit noch als Import — der Architekturtest prüft das.
 *
 * Die Umwandlung DTO ↔ Domain gehört an die HTTP-Naht in
 * `apps/api/src/modules/<modul>/interface/http` und kommt mit EYT-50. Bis dahin gibt
 * es sie nicht, und dieses Paket behauptet auch nicht, sie zu haben.
 */
import { z } from "zod";

import { IdSchema, InstantSchema } from "../primitives.js";

/** Halb-offenes Intervall als Transportform. Entspricht `TimeInterval` der Domain. */
export const TimeIntervalDtoSchema = z.strictObject({
  startUtc: InstantSchema,
  endUtc: InstantSchema,
});

export type TimeIntervalDto = z.infer<typeof TimeIntervalDtoSchema>;

/**
 * Konfliktcodes des Transports.
 *
 * Absichtlich als eigene Liste und nicht aus dem Planungsmodul importiert: der
 * Vertrag ist versioniert und darf sich nicht ändern, nur weil ein internes
 * Enum wächst. Ein Test in `apps/api` prüft, dass jeder Domaincode hier eine
 * Entsprechung hat — die Richtung „Domain ⊆ Transport" ist die, die zählt.
 */
export const CONFLICT_CODE_VALUES = [
  "EMPLOYEE_INTERVAL_OVERLAP",
  "EMPLOYEE_WEEKLY_CAPACITY",
  "EMPLOYEE_INACTIVE",
  "WORKSITE_NOT_PUBLISHABLE",
] as const;

export const ConflictCodeSchema = z.enum(CONFLICT_CODE_VALUES);

export const PlanningConflictDtoSchema = z.strictObject({
  code: ConflictCodeSchema,
  /** `true` verhindert die Veröffentlichung, `false` ist eine Warnung (EYT-74). */
  blocking: z.boolean(),
  /** Menschenlesbare Begründung. Nie der einzige Träger der Bedeutung — dafür ist `code` da. */
  message: z.string(),
});

export type PlanningConflictDto = z.infer<typeof PlanningConflictDtoSchema>;

export const AssignmentDtoSchema = z.strictObject({
  id: IdSchema,
  employeeId: IdSchema,
  worksiteId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type AssignmentDto = z.infer<typeof AssignmentDtoSchema>;

/**
 * Abfrage eines Planungsfensters.
 *
 * `weekKey` statt Datumsbereich: die Woche ist bereits eine fachliche Einheit
 * mit dokumentierter Zeitzonen- und Wochenregel (EYT-74). Ein freier
 * Datumsbereich würde die Wochenlogik erneut auf den Client verlagern — genau
 * die Doppelimplementierung, die `FIND-003` verursacht hat.
 */
export const PlanningWindowQuerySchema = z.strictObject({
  /** ISO-Woche, Format `2026-W32`. */
  weekKey: z.string().regex(/^\d{4}-W\d{2}$/, "Wochenschluessel im Format 2026-W32"),
});

export type PlanningWindowQuery = z.infer<typeof PlanningWindowQuerySchema>;

export const PlanningWindowSchema = z.strictObject({
  weekKey: z.string().regex(/^\d{4}-W\d{2}$/),
  /** IANA-Zeitzone, nach der die Woche abgegrenzt wurde. Mitgeliefert, damit die
   * UI die Wochengrenze nicht selbst raten muss. */
  timeZone: z.string(),
  assignments: z.array(AssignmentDtoSchema),
  /** Id der zuletzt veröffentlichten Planversion, `null` solange nichts veröffentlicht ist. */
  publishedVersionId: IdSchema.nullable(),
});

export type PlanningWindow = z.infer<typeof PlanningWindowSchema>;

export const CreateAssignmentCommandSchema = z.strictObject({
  employeeId: IdSchema,
  worksiteId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type CreateAssignmentCommand = z.infer<typeof CreateAssignmentCommandSchema>;

export const ValidatePlanCommandSchema = z.strictObject({
  weekKey: z.string().regex(/^\d{4}-W\d{2}$/),
  draft: CreateAssignmentCommandSchema,
});

export type ValidatePlanCommand = z.infer<typeof ValidatePlanCommandSchema>;

export const PlanValidationResultSchema = z.strictObject({
  conflicts: z.array(PlanningConflictDtoSchema),
  /** Abgeleitet, aber mitgeliefert: der Client soll `blocking` nicht selbst falten. */
  publishable: z.boolean(),
});

export type PlanValidationResult = z.infer<typeof PlanValidationResultSchema>;

/**
 * Veröffentlichungskommando.
 *
 * `expectedVersionId` ist die Stale-Version-Erkennung: der Client sagt, auf
 * welchem Stand er arbeitet. Weicht der Server ab, wurde zwischenzeitlich
 * veröffentlicht und das Kommando wird abgelehnt, statt fremde Änderungen zu
 * überschreiben. `null` heisst „ich erwarte, dass noch nichts veröffentlicht ist".
 */
export const PublishPlanCommandSchema = z.strictObject({
  weekKey: z.string().regex(/^\d{4}-W\d{2}$/),
  expectedVersionId: IdSchema.nullable(),
});

export type PublishPlanCommand = z.infer<typeof PublishPlanCommandSchema>;

export const PublishedPlanVersionSchema = z.strictObject({
  versionId: IdSchema,
  weekKey: z.string().regex(/^\d{4}-W\d{2}$/),
  publishedAtUtc: InstantSchema,
  assignmentIds: z.array(IdSchema),
});

export type PublishedPlanVersion = z.infer<typeof PublishedPlanVersionSchema>;
