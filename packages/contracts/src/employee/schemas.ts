/**
 * Transportschemata der Mitarbeiteransicht (EYT-79).
 *
 * **Ehrlichkeitshinweis.** Für Bestätigung, Ablehnung und Zeiterfassung gibt es
 * im Repository noch kein Domainmodell, kein Modul, keine Tabelle und keine
 * Route. Diese Schemata sind der vereinbarte Vertrag, damit die Mitarbeiter-
 * Shell und die spätere API dieselbe Form verwenden — sie sind **kein**
 * Nachweis, dass die Fachlogik existiert. Ein Contract-Test dagegen prueft die
 * Form, nicht das Verhalten.
 */
import { z } from "zod";

import { IdSchema, InstantSchema } from "../primitives.js";
import { AssignmentDtoSchema } from "../planning/schemas.js";

export const EmployeeScheduleSchema = z.strictObject({
  weekKey: z.string().regex(/^\d{4}-W\d{2}$/),
  timeZone: z.string(),
  /** Genau die veroeffentlichte Version, die der Mitarbeiter sieht. */
  publishedVersionId: IdSchema.nullable(),
  assignments: z.array(AssignmentDtoSchema),
  /** `true`, wenn diese Version noch bestaetigt werden muss. */
  confirmationRequired: z.boolean(),
});

export type EmployeeSchedule = z.infer<typeof EmployeeScheduleSchema>;

export const MyScheduleQuerySchema = z.strictObject({
  weekKey: z.string().regex(/^\d{4}-W\d{2}$/),
});

export type MyScheduleQuery = z.infer<typeof MyScheduleQuerySchema>;

export const ConfirmPlanCommandSchema = z.strictObject({
  versionId: IdSchema,
});

export type ConfirmPlanCommand = z.infer<typeof ConfirmPlanCommandSchema>;

export const ConfirmationSchema = z.strictObject({
  versionId: IdSchema,
  confirmedAtUtc: InstantSchema,
});

export type Confirmation = z.infer<typeof ConfirmationSchema>;

/** Ablehnung verlangt eine Begruendung — sonst ist sie fuer die Planung wertlos. */
export const RejectAssignmentCommandSchema = z.strictObject({
  assignmentId: IdSchema,
  reason: z.string().min(3).max(500),
});

export type RejectAssignmentCommand = z.infer<typeof RejectAssignmentCommandSchema>;

export const RejectionSchema = z.strictObject({
  assignmentId: IdSchema,
  reason: z.string(),
  rejectedAtUtc: InstantSchema,
});

export type Rejection = z.infer<typeof RejectionSchema>;

export const StartTimeCommandSchema = z.strictObject({
  assignmentId: IdSchema,
});

export type StartTimeCommand = z.infer<typeof StartTimeCommandSchema>;

/**
 * Laufende Zeitbuchung.
 *
 * `startedAtUtc` ist ein Serverzeitpunkt, kein Client-Zeitpunkt. `FIND-006`
 * (Extreme) beschreibt genau den Gegenfall: der Prototyp zaehlte per
 * `setInterval` im Browser und speicherte eine lokalisierte Anzeigezeit, was
 * nach Hintergrund oder Neustart falsche Arbeitszeit ergab.
 */
export const ActiveTimeEntrySchema = z.strictObject({
  entryId: IdSchema,
  assignmentId: IdSchema,
  startedAtUtc: InstantSchema,
});

export type ActiveTimeEntry = z.infer<typeof ActiveTimeEntrySchema>;

export const StopTimeCommandSchema = z.strictObject({
  entryId: IdSchema,
});

export type StopTimeCommand = z.infer<typeof StopTimeCommandSchema>;

export const SubmittedTimeEntrySchema = z.strictObject({
  entryId: IdSchema,
  assignmentId: IdSchema,
  startedAtUtc: InstantSchema,
  stoppedAtUtc: InstantSchema,
  /** Vom Server gerechnet. Der Client rechnet Dauer nicht selbst nach. */
  durationMinutes: z.number().nonnegative(),
});

export type SubmittedTimeEntry = z.infer<typeof SubmittedTimeEntrySchema>;
