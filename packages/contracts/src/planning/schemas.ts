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

import { isValidIsoWeekKey } from "./iso-week.js";

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
 * Der ISO-Wochenschluessel als EIN Schema fuer alle oeffentlichen Felder (EYT-88).
 *
 * Zuvor stand an fuenf Stellen ein eigener regulaerer Ausdruck. Vier davon
 * kannten nur das Muster; die Kalenderregel hing allein an der Leseabfrage.
 * Damit haetten Leseroute, Validierungsroute, Publish-Kommando und
 * Antwortvertrag unterschiedliche Regeln getragen — `2025-W53` waere ueber die
 * Abfrage abgelehnt und ueber das Publish-Kommando angenommen worden.
 *
 * Ein Schema, viele Verwendungen — inzwischen auch im Kostenbereich. Wer eine
 * weitere Stelle hinzufuegt, nimmt dieses hier und nicht wieder einen eigenen
 * Ausdruck, und traegt sie als Zeile in `STELLEN` (`test/iso-week-key.test.ts`)
 * ein — der Waechter merkt eine ausgelassene Zeile nicht von selbst.
 *
 * Das Muster bleibt vorgeschaltet, obwohl `isValidIsoWeekKey` die Form selbst
 * prueft: es liefert die praezisere Meldung fuer den haeufigen Tippfehler,
 * bevor die Kalenderrechnung ueberhaupt anlaeuft.
 */
export const IsoWeekKeySchema = z
  .string()
  .regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, "Wochenschluessel im Format 2026-W32")
  .refine(isValidIsoWeekKey, {
    message:
      "Wochenschluessel bezeichnet keine reale ISO-Woche (etwa W53 in einem Jahr mit 52 Wochen)",
  })
  .describe(
    "ISO-Woche im Format 2026-W32. Eine 53. Woche ist nur in ISO-Jahren gueltig, die tatsaechlich 53 Wochen haben.",
  );

/**
 * Abfrage eines Planungsfensters.
 *
 * `weekKey` statt Datumsbereich: die Woche ist bereits eine fachliche Einheit
 * mit dokumentierter Zeitzonen- und Wochenregel (EYT-74). Ein freier
 * Datumsbereich würde die Wochenlogik erneut auf den Client verlagern — genau
 * die Doppelimplementierung, die `FIND-003` verursacht hat.
 */
export const PlanningWindowQuerySchema = z.strictObject({
  /** Siehe {@link IsoWeekKeySchema} — Muster plus jahresabhaengige Kalenderregel. */
  weekKey: IsoWeekKeySchema,
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

/**
 * Auswaehlbare Ressource einer Planungswoche — Beschaeftigte oder Baustelle.
 *
 * Bewusst drei Felder und keines mehr. Die Planerin braucht zum Auswaehlen
 * einen Namen, zum Absenden eine Id und zum Unterscheiden den Aktivstatus.
 * `employees` traegt Personenbezug (Migration `0005`); alles darueber hinaus —
 * Rolle, Qualifikation, Kontaktdaten, Adresse der Baustelle — bleibt draussen,
 * weil kein Nutzerschritt es braucht. Ein Feld, das niemand liest, ist hier
 * kein Komfort, sondern eine unnoetig veroeffentlichte Personeneigenschaft.
 */
export const PlanningResourceSchema = z.strictObject({
  id: IdSchema,
  /** Anzeigename. In der Datenbank `employees.display_name` bzw. `worksites.name`. */
  label: z.string().min(1),
  /**
   * Steuert die **Auswaehlbarkeit**, nicht die Sichtbarkeit.
   *
   * Geliefert werden alle tenant-sichtbaren Eintraege, auch inaktive: ein
   * bestehender Einsatz auf eine inaktive Person muss weiterhin ihren Namen
   * zeigen statt einer nackten Uuid. Neue Einsaetze duerfen nur auf `active:
   * true` zeigen — diese Regel setzt die Oberflaeche durch, und der Server
   * pruefen wird sie erneut, sobald der Schreibpfad existiert.
   */
  active: z.boolean(),
});

export type PlanningResource = z.infer<typeof PlanningResourceSchema>;

/**
 * Die auswaehlbaren Stammdaten der Woche.
 *
 * Sie reisen mit dem Planungsfenster, statt ueber eigene Listenrouten: die
 * Planerin oeffnet eine Woche und braucht dieselbe Mandantengrenze, dieselbe
 * Transaktionsklammer und denselben Zeitpunkt wie fuer Versionen und
 * Zuweisungen. Zwei getrennte Routen koennten zwei verschiedene Zustaende
 * liefern — eine Zuweisung auf eine Person, die die zweite Antwort nicht mehr
 * kennt. Ein Roundtrip, eine Wahrheit.
 */
export const PlanningResourcesSchema = z.strictObject({
  employees: z.array(PlanningResourceSchema),
  worksites: z.array(PlanningResourceSchema),
});

export type PlanningResources = z.infer<typeof PlanningResourcesSchema>;

export const PlanningWindowSchema = z
  .strictObject({
    weekKey: IsoWeekKeySchema,
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
    /**
     * Auswaehlbare Beschaeftigte und Baustellen dieses Mandanten. Siehe
     * {@link PlanningResourcesSchema} — mitgeliefert, nicht nachgeladen.
     */
    resources: PlanningResourcesSchema,
  })
  .superRefine((fenster, ctx) => {
    // Feldweise Gueltigkeit genuegt hier nicht: die AUSSAGE steckt in der
    // Beziehung der Felder. Ohne diese Regeln waeren formal gueltige, fachlich
    // widerspruechliche Antworten moeglich — und die faenden erst in der
    // Oberflaeche auf, als "Veroeffentlichte Version X" ueber fremden Daten.

    // Jede angezeigte Zuweisung muss aufloesbar sein. Zeigt eine Zuweisung auf
    // eine Person oder Baustelle, die `resources` nicht kennt, kann die
    // Oberflaeche nur eine nackte Uuid rendern — und ein Mandantenleck saehe
    // genau so aus: eine fremde Id, zu der es lokal keinen Namen gibt. Die
    // Antwort wird deshalb hier verworfen, nicht in der Oberflaeche kaschiert.
    const bekannteBeschaeftigte = new Set(fenster.resources.employees.map((e) => e.id));
    const bekannteBaustellen = new Set(fenster.resources.worksites.map((w) => w.id));
    fenster.assignments.forEach((einsatz, index) => {
      if (!bekannteBeschaeftigte.has(einsatz.employeeId)) {
        ctx.addIssue({
          code: "custom",
          path: ["assignments", index, "employeeId"],
          message:
            "Zuweisung verweist auf eine Beschaeftigte, die nicht in resources.employees steht — nicht aufloesbar.",
        });
      }
      if (!bekannteBaustellen.has(einsatz.worksiteId)) {
        ctx.addIssue({
          code: "custom",
          path: ["assignments", index, "worksiteId"],
          message:
            "Zuweisung verweist auf eine Baustelle, die nicht in resources.worksites steht — nicht aufloesbar.",
        });
      }
    });

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

/**
 * Der Einsatz selbst — ohne Woche.
 *
 * Eigenes Schema, weil `ValidatePlanCommand` denselben Entwurf traegt und die
 * Woche dort bereits eine Ebene hoeher steht. Sie ein zweites Mal darin zu
 * fuehren waere ein Feld, das mit sich selbst uneins sein kann.
 */
export const AssignmentDraftSchema = z.strictObject({
  employeeId: IdSchema,
  worksiteId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type AssignmentDraftDto = z.infer<typeof AssignmentDraftSchema>;

export const CreateAssignmentCommandSchema = z.strictObject({
  /**
   * Die Woche, die die Planerin GEOEFFNET hat.
   *
   * Redundant zum Intervall — und genau darum steht sie hier. Die Woche eines
   * Einsatzes ergibt sich aus seinem Beginn in der Zone der Organisation; der
   * Server rechnet sie selbst aus und vergleicht. Weichen beide ab, hat die
   * Planerin ein Datum ausserhalb der offenen Woche erwischt, und der Einsatz
   * waere in einer Woche gelandet, die sie gar nicht ansieht. Ohne dieses Feld
   * gaebe es dafuer keine Meldung, sondern nur eine Zuweisung, die nach dem
   * Speichern spurlos verschwindet.
   *
   * Es ist ausdruecklich KEINE Mandanten- oder Berechtigungsangabe: der Server
   * uebernimmt daraus nichts, er prueft nur auf Uebereinstimmung.
   */
  weekKey: IsoWeekKeySchema,
  employeeId: IdSchema,
  worksiteId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type CreateAssignmentCommand = z.infer<typeof CreateAssignmentCommandSchema>;

export const ValidatePlanCommandSchema = z.strictObject({
  weekKey: IsoWeekKeySchema,
  draft: AssignmentDraftSchema,
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
  weekKey: IsoWeekKeySchema,
  expectedVersionId: IdSchema.nullable(),
});

export type PublishPlanCommand = z.infer<typeof PublishPlanCommandSchema>;

export const PublishedPlanVersionSchema = z.strictObject({
  versionId: IdSchema,
  weekKey: IsoWeekKeySchema,
  publishedAtUtc: InstantSchema,
  assignmentIds: z.array(IdSchema),
});

export type PublishedPlanVersion = z.infer<typeof PublishedPlanVersionSchema>;
