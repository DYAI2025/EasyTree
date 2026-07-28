/**
 * OpenAPI-v1-Dokument (EYT-47 AK 1).
 *
 * Das Dokument wird aus **denselben** Zod-Schemata erzeugt, die zur Laufzeit
 * validieren. Damit gibt es keinen zweiten Typenbestand, der abdriften koennte —
 * genau das meint TASK-012 mit „kein manueller API-Typenfork".
 *
 * `z.toJSONSchema(..., { target: "openapi-3.0" })` laeuft offline mit dem
 * bereits vorhandenen zod@4; es kommt keine neue Abhaengigkeit dazu.
 *
 * ## Ehrlichkeitshinweis
 *
 * Dieses Dokument beschreibt den vereinbarten Vertrag. **Es gibt noch keinen
 * Server, der ihn VOLLSTAENDIG bedient**: seit EYT-50 existiert die erste
 * Fachroute (`GET /planung/fenster`); welche Operationen noch offen sind,
 * fuehrt `apps/api/test/openapi-route-conformance.test.ts` namentlich.
 * Der Konformitaetsnachweis (Route-Tabelle gegen Dokument, Antwortpruefung
 * gegen Schema) gehoert zu EYT-50 und ist hier ausdruecklich nicht erbracht.
 */
import { z } from "zod";

import { API_BASE_PATH } from "../api-metadata.js";

import {
  ActiveTimeEntrySchema,
  ConfirmPlanCommandSchema,
  ConfirmationSchema,
  EmployeeScheduleSchema,
  RejectAssignmentCommandSchema,
  RejectionSchema,
  StartTimeCommandSchema,
  StopTimeCommandSchema,
  SubmittedTimeEntrySchema,
} from "../employee/schemas.js";
import {
  AssignmentDtoSchema,
  CreateAssignmentCommandSchema,
  PlanValidationResultSchema,
  PlanningConflictDtoSchema,
  PlanningResourceSchema,
  PlanningWindowSchema,
  PublishPlanCommandSchema,
  PublishedPlanVersionSchema,
  TimeIntervalDtoSchema,
  ValidatePlanCommandSchema,
} from "../planning/schemas.js";
import { IDEMPOTENCY_HEADER, IdempotencyKeySchema, ProblemDocumentSchema } from "../primitives.js";

/** Vertragsversion. Aenderungen hier sind eine bewusste Entscheidung, kein Nebeneffekt. */
export const API_VERSION = "1.0.0";
// API_BASE_PATH lebt in ../api-metadata.js — dieses Modul laedt alle Schemata,
// und wer nur den Pfad braucht, soll den Generator nicht mitziehen.
export { API_BASE_PATH };

const NAMED_SCHEMAS = {
  ProblemDocument: ProblemDocumentSchema,
  TimeIntervalDto: TimeIntervalDtoSchema,
  PlanningConflictDto: PlanningConflictDtoSchema,
  AssignmentDto: AssignmentDtoSchema,
  // Benannt, damit ein generierter Client EINEN Ressourcentyp bekommt statt
  // zweier strukturgleicher Inline-Objekte fuer `employees` und `worksites`.
  PlanningResource: PlanningResourceSchema,
  PlanningWindow: PlanningWindowSchema,
  CreateAssignmentCommand: CreateAssignmentCommandSchema,
  ValidatePlanCommand: ValidatePlanCommandSchema,
  PlanValidationResult: PlanValidationResultSchema,
  PublishPlanCommand: PublishPlanCommandSchema,
  PublishedPlanVersion: PublishedPlanVersionSchema,
  EmployeeSchedule: EmployeeScheduleSchema,
  ConfirmPlanCommand: ConfirmPlanCommandSchema,
  Confirmation: ConfirmationSchema,
  RejectAssignmentCommand: RejectAssignmentCommandSchema,
  Rejection: RejectionSchema,
  StartTimeCommand: StartTimeCommandSchema,
  ActiveTimeEntry: ActiveTimeEntrySchema,
  StopTimeCommand: StopTimeCommandSchema,
  SubmittedTimeEntry: SubmittedTimeEntrySchema,
} as const satisfies Record<string, z.ZodType>;

export type NamedSchema = keyof typeof NAMED_SCHEMAS;

const ref = (name: NamedSchema): { $ref: string } => ({
  $ref: `#/components/schemas/${name}`,
});

/** Jede Nicht-2xx-Antwort verweist auf dasselbe Fehlerschema (EYT-47 AK 2). */
const problemResponses = {
  "400": {
    description: "Ungueltige Anfrage",
    content: { "application/json": { schema: ref("ProblemDocument") } },
  },
  "401": {
    description: "Nicht angemeldet",
    content: { "application/json": { schema: ref("ProblemDocument") } },
  },
  "403": {
    description: "Nicht berechtigt",
    content: { "application/json": { schema: ref("ProblemDocument") } },
  },
  "409": {
    description: "Konflikt oder veralteter Planstand",
    content: { "application/json": { schema: ref("ProblemDocument") } },
  },
} as const;

const idempotencyHeader = {
  name: IDEMPOTENCY_HEADER,
  in: "header",
  required: true,
  description:
    "Mandantengebundener Idempotenzschluessel. Ein Wiederholungsaufruf liefert dieselbe Antwort, ohne den Effekt zu verdoppeln.",
  schema: z.toJSONSchema(IdempotencyKeySchema, { target: "openapi-3.0" }),
} as const;

/**
 * Der veroeffentlichte Wochenschluessel — und was er NICHT leisten kann.
 *
 * Zwei Befunde aus EYT-88, beide hier behoben beziehungsweise benannt:
 *
 * 1. Das Muster stand auf `^\d{4}-W\d{2}$` und war damit sogar schwaecher als
 *    die Laufzeitpruefung: `W00`, `W54` und `W99` gingen im veroeffentlichten
 *    Vertrag durch. Jetzt steht hier dieselbe Bereichsgrenze wie im Schema.
 *
 * 2. Die jahresabhaengige Regel — `W53` gilt nur in Jahren mit 53 ISO-Wochen —
 *    laesst sich in JSON Schema nicht ausdruecken. Ein regulaerer Ausdruck kann
 *    keinen Kalender rechnen. Die `.refine()`-Pruefung des Zod-Schemas taucht im
 *    erzeugten Dokument deshalb nicht auf; der Drift-Test bestaetigt das, indem
 *    er trotz der neuen Regel gruen bleibt.
 *
 *    Die Beschreibung sagt das ausdruecklich, statt die Luecke zu verschweigen.
 *    Ein generierter Client kann `2025-W53` senden — abgelehnt wird es
 *    trotzdem, aber vom Server zur Laufzeit und nicht vom Schema. Dieselbe
 *    ehrliche Grenzziehung wie bei `TimeIntervalDtoSchema` ("Ende nach Beginn").
 */
const weekKeyParam = {
  name: "weekKey",
  in: "query",
  required: true,
  description:
    "ISO-Woche im Format 2026-W32. Woche 01-53. Eine 53. Woche ist nur in ISO-Jahren gueltig, die tatsaechlich 53 Wochen haben (etwa 2020 und 2026, nicht 2021 oder 2025). Diese Kalenderregel kann JSON Schema nicht ausdruecken und wird hier NICHT erzwungen - der Server lehnt einen ungueltigen Schluessel zur Laufzeit ab.",
  schema: { type: "string", pattern: "^\\d{4}-W(0[1-9]|[1-4]\\d|5[0-3])$" },
} as const;

function jsonBody(name: NamedSchema): unknown {
  return { required: true, content: { "application/json": { schema: ref(name) } } };
}

function jsonOk(name: NamedSchema, description: string): unknown {
  return { description, content: { "application/json": { schema: ref(name) } } };
}

/** Erzeugt das vollstaendige Dokument. Rein, synchron, ohne Dateizugriff. */
export function buildOpenApiDocument(): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(NAMED_SCHEMAS)) {
    const jsonSchema = z.toJSONSchema(schema, { target: "openapi-3.0" }) as Record<string, unknown>;
    // `$schema` und `id` sind Artefakte der Erzeugung, kein Teil des Vertrags.
    delete jsonSchema["$schema"];
    delete jsonSchema["id"];
    schemas[name] = jsonSchema;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "easyTree API",
      version: API_VERSION,
      description:
        "Vertrag zwischen Web-Shells und Backend. Erzeugt aus den Zod-Schemata in @easytree/contracts; nicht von Hand bearbeiten.",
    },
    servers: [{ url: API_BASE_PATH }],
    paths: {
      "/planung/fenster": {
        get: {
          operationId: "getPlanningWindow",
          summary: "Planungsfenster einer Woche lesen",
          parameters: [weekKeyParam],
          responses: { "200": jsonOk("PlanningWindow", "Planungsfenster"), ...problemResponses },
        },
      },
      "/planung/entwuerfe/validierung": {
        post: {
          operationId: "validateDraft",
          summary: "Entwurf gegen den Bestand pruefen",
          requestBody: jsonBody("ValidatePlanCommand"),
          responses: {
            "200": jsonOk("PlanValidationResult", "Pruefergebnis"),
            ...problemResponses,
          },
        },
      },
      "/planung/einsaetze": {
        post: {
          operationId: "createAssignment",
          summary: "Einsatz anlegen",
          parameters: [idempotencyHeader],
          requestBody: jsonBody("CreateAssignmentCommand"),
          responses: { "201": jsonOk("AssignmentDto", "Angelegter Einsatz"), ...problemResponses },
        },
      },
      "/planung/versionen": {
        post: {
          operationId: "publishPlan",
          summary: "Planversion veroeffentlichen",
          parameters: [idempotencyHeader],
          requestBody: jsonBody("PublishPlanCommand"),
          responses: {
            "201": jsonOk("PublishedPlanVersion", "Veroeffentlichte Version"),
            ...problemResponses,
          },
        },
      },
      "/einsatz/plan": {
        get: {
          operationId: "getMySchedule",
          summary: "Eigenen veroeffentlichten Plan lesen",
          parameters: [weekKeyParam],
          responses: { "200": jsonOk("EmployeeSchedule", "Eigener Plan"), ...problemResponses },
        },
      },
      "/einsatz/bestaetigungen": {
        post: {
          operationId: "confirmPlan",
          summary: "Planversion bestaetigen",
          parameters: [idempotencyHeader],
          requestBody: jsonBody("ConfirmPlanCommand"),
          responses: { "201": jsonOk("Confirmation", "Bestaetigung"), ...problemResponses },
        },
      },
      "/einsatz/ablehnungen": {
        post: {
          operationId: "rejectAssignment",
          summary: "Einsatz begruendet ablehnen",
          parameters: [idempotencyHeader],
          requestBody: jsonBody("RejectAssignmentCommand"),
          responses: { "201": jsonOk("Rejection", "Ablehnung"), ...problemResponses },
        },
      },
      "/einsatz/zeiten/start": {
        post: {
          operationId: "startTime",
          summary: "Arbeitszeit starten",
          parameters: [idempotencyHeader],
          requestBody: jsonBody("StartTimeCommand"),
          responses: { "201": jsonOk("ActiveTimeEntry", "Laufende Buchung"), ...problemResponses },
        },
      },
      "/einsatz/zeiten/stopp": {
        post: {
          operationId: "stopTime",
          summary: "Arbeitszeit stoppen",
          parameters: [idempotencyHeader],
          requestBody: jsonBody("StopTimeCommand"),
          responses: {
            "201": jsonOk("SubmittedTimeEntry", "Eingereichte Buchung"),
            ...problemResponses,
          },
        },
      },
    },
    components: { schemas },
  };
}

/** Kanonische Serialisierung. Byte-identisch reproduzierbar, damit die Drift-Pruefung greift. */
export function serializeOpenApiDocument(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}
