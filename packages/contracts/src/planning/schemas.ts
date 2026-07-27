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

/**
 * Halb-offenes Intervall als Transportform. Entspricht `TimeInterval` der Domain.
 *
 * Die Reihenfolge wird hier geprüft, nicht erst bei der Umwandlung in die
 * Domain: sonst gälte ein Kommando mit `endUtc <= startUtc` als vertragskonform
 * und schlüge erst tief im Server fehl. Genau das war der Prototypfehler
 * (`FIND-004`) — nur eine Schicht höher.
 *
 * **Grenze der Veröffentlichung:** JSON Schema kann „Ende nach Beginn" nicht
 * ausdrücken. Das erzeugte OpenAPI-Dokument trägt die Regel deshalb nicht; ein
 * generierter Client kann ein verkehrtes Intervall senden. Abgelehnt wird es
 * trotzdem — von diesem Schema zur Laufzeit.
 */
export const TimeIntervalDtoSchema = z
  .strictObject({
    startUtc: InstantSchema,
    endUtc: InstantSchema,
  })
  .refine((interval) => interval.endUtc > interval.startUtc, {
    message: "endUtc muss nach startUtc liegen (halb-offenes Intervall)",
    path: ["endUtc"],
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
  /**
   * ISO-Woche, Format `2026-W32`.
   *
   * Das Muster erzwingt 01–53. Zuvor stand hier `\d{2}`, womit auch `W00`,
   * `W54` und `W99` durchgingen — ein Wochenschluessel, den es nicht gibt,
   * haette eine leere Woche geliefert statt einer Ablehnung.
   *
   * OFFENER BEFUND: die Datenbank-Constraint in
   * supabase/migrations/20260727020300_0007_planning.sql traegt weiterhin das
   * schwache Muster. Sie wird hier NICHT editiert (append-only, CLAUDE.md);
   * eine Forward-Migration ist vor dem Schreibpfad faellig, sonst kann ein
   * direkter DB-Schreibvorgang `2026-W99` anlegen.
   *
   * Jahrabhaengig ungueltige 53. Wochen bleiben erlaubt: dafuer braeuchte es
   * eine Kalenderrechnung, und die gibt es hier bewusst nicht.
   */
  weekKey: z
    .string()
    .regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, "Wochenschluessel im Format 2026-W32"),
});

export type PlanningWindowQuery = z.infer<typeof PlanningWindowQuerySchema>;

/**
 * Herkunft der angezeigten Zuweisungen (EYT-50).
 *
 * Ohne diese Angabe konnte das Fenster die Zuweisungen eines ENTWURFS zeigen
 * und daneben `publishedVersionId` einer bereits veroeffentlichten Version —
 * die Oberflaeche zeigte dann "Veroeffentlichte Version X" ueber Daten, die
 * gar nicht zu X gehoeren. Ein Vergleich mit der Mitarbeitersicht (AK9) waere
 * damit ein Vergleich von Aepfeln mit Birnen.
 *
 * `null` heisst: es gibt fuer diese Woche ueberhaupt keine Version.
 */
export const SourceVersionSchema = z.strictObject({
  id: IdSchema,
  state: z.enum(["draft", "published"]),
});

export type SourceVersion = z.infer<typeof SourceVersionSchema>;

export const PlanningWindowSchema = z
  .strictObject({
    weekKey: z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/),
    /** IANA-Zeitzone, nach der die Woche abgegrenzt wurde. Mitgeliefert, damit die
     * UI die Wochengrenze nicht selbst raten muss. */
    timeZone: z.string(),
    assignments: z.array(AssignmentDtoSchema),
    /**
     * Version, ZU DER die `assignments` gehoeren — Entwurf oder veroeffentlicht.
     * Getrennt von `publishedVersionId`, weil beides gleichzeitig gelten kann.
     */
    sourceVersion: SourceVersionSchema.nullable(),
    /**
     * Id der zuletzt veröffentlichten Planversion, `null` solange nichts
     * veröffentlicht ist. Sagt NICHTS darüber, ob die angezeigten Zuweisungen
     * daher stammen — dafür ist `sourceVersion` da.
     */
    publishedVersionId: IdSchema.nullable(),
  })
  .superRefine((fenster, ctx) => {
    // Feldweise Gueltigkeit genuegt hier nicht: die AUSSAGE steckt in der
    // Beziehung der Felder. Ohne diese Regeln waeren formal gueltige, fachlich
    // widerspruechliche Antworten moeglich — und die faenden erst in der
    // Oberflaeche auf, als "Veroeffentlichte Version X" ueber fremden Daten.
    if (fenster.sourceVersion === null) {
      if (fenster.assignments.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["assignments"],
          message:
            "Ohne sourceVersion kann es keine Zuweisungen geben — sie haetten keine Herkunft.",
        });
      }
      if (fenster.publishedVersionId !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["publishedVersionId"],
          message:
            "Eine veroeffentlichte Version existiert, wird aber nicht angezeigt: dann muesste sourceVersion sie nennen.",
        });
      }
      return;
    }

    if (fenster.sourceVersion.state === "published") {
      if (fenster.publishedVersionId !== fenster.sourceVersion.id) {
        ctx.addIssue({
          code: "custom",
          path: ["publishedVersionId"],
          message:
            "Angezeigt wird eine veroeffentlichte Version — dann ist sie auch die zuletzt veroeffentlichte.",
        });
      }
      return;
    }

    // state === "draft"
    if (fenster.publishedVersionId === fenster.sourceVersion.id) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceVersion"],
        message: "Dieselbe Id kann nicht gleichzeitig Entwurf und veroeffentlicht sein.",
      });
    }
  });

export type PlanningWindow = z.infer<typeof PlanningWindowSchema>;

export const CreateAssignmentCommandSchema = z.strictObject({
  employeeId: IdSchema,
  worksiteId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type CreateAssignmentCommand = z.infer<typeof CreateAssignmentCommandSchema>;

export const ValidatePlanCommandSchema = z.strictObject({
  weekKey: z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/),
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
  weekKey: z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/),
  expectedVersionId: IdSchema.nullable(),
});

export type PublishPlanCommand = z.infer<typeof PublishPlanCommandSchema>;

export const PublishedPlanVersionSchema = z.strictObject({
  versionId: IdSchema,
  weekKey: z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/),
  publishedAtUtc: InstantSchema,
  assignmentIds: z.array(IdSchema),
});

export type PublishedPlanVersion = z.infer<typeof PublishedPlanVersionSchema>;
