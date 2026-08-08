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

/**
 * Nichtnegative Ziffernfolge — die gemeinsame Regel von Beträgen und Dauern.
 *
 * EINE Regel, aber ZWEI Meldungen. Beide Grössen sind dasselbe: ein Wert, der
 * an der Naht zu `bigint` wird und deshalb nicht als JSON-Zahl reisen darf. Der
 * Ausdruck steht darum nur einmal hier. Die Fehlermeldung darf trotzdem nicht
 * geteilt werden: eine kaputte Dauer mit „Betrag in Minor Units" zu melden
 * schickt den Leser an die falsche Stelle.
 */
const nichtnegativeZiffernfolge = (meldung: string) => z.string().regex(/^\d+$/, meldung).max(18);

/** Betrag in Minor Units (Cent) als dezimaler String, nie Float. */
export const MinorUnitsSchema = nichtnegativeZiffernfolge(
  "Betrag in Minor Units als dezimale Ziffernfolge",
);

/**
 * Dauer in Millisekunden als dezimaler String — dieselbe Regel, eigene Meldung.
 *
 * Zusätzlich echt positiv: eine Kostenposition über null Millisekunden gibt es
 * fachlich nicht, und die Tabelle führt `check (duration_ms > 0)`. Ohne diese
 * Bedingung wäre der Vertrag nachsichtiger als der Speicher — eine Antwort
 * könnte vertragskonform sein und trotzdem nie aus der Datenbank stammen. Wer
 * die Prüfung in der Migration lockert, lockert sie auch hier, nicht nur dort.
 */
export const DurationMillisecondsSchema = nichtnegativeZiffernfolge(
  "Dauer in Millisekunden als dezimale Ziffernfolge",
).refine((wert) => BigInt(wert) > 0n, "Dauer muss grösser als null sein");

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
   * Siehe {@link DurationMillisecondsSchema}: dieselbe Ziffernfolgeregel wie ein
   * Betrag, aber eigene Meldung und echt positiv.
   */
  durationMilliseconds: DurationMillisecondsSchema,
  rateVersionId: IdSchema,
  amountMinorUnits: MinorUnitsSchema,
});
export type CostPositionDto = z.infer<typeof CostPositionDtoSchema>;

/**
 * Summe EINES lokalen Kalendertages über alle Baustellen des Snapshots.
 *
 * Kein Baustellenschlüssel, und das ist die Aussage: mit `worksiteId` wäre dies
 * eine Baustellen-Tages-Teilsumme, und für einen ungefilterten Snapshot mit
 * zwei Baustellen an einem Tag gäbe es dann überhaupt keine Tagessumme im
 * Rumpf — die Oberfläche müsste zwei Zeilen addieren. Genau das Rechnen im
 * Client soll der Snapshot ersparen. Eine Aufschlüsselung nach Baustelle wäre
 * ein eigenes Feld und eine eigene Entscheidung, kein Nebeneffekt dieses.
 *
 * `days` wird beim Lesen aus den Positionen abgeleitet; gespeichert ist nur
 * `totalMinorUnits` im Kopf. „Vorberechnet" gilt also für die Gesamtsumme, für
 * die Tage heisst es „nicht vom Client zu berechnen".
 */
export const CostDayTotalDtoSchema = z.strictObject({
  localDate: BusinessDateSchema,
  amountMinorUnits: MinorUnitsSchema,
});
export type CostDayTotalDto = z.infer<typeof CostDayTotalDtoSchema>;

export const CostSnapshotSchema = z
  .strictObject({
    id: IdSchema,
    planVersionId: IdSchema,
    /** Baustellenfilter, mit dem der Snapshot entstand. `null` = alle Baustellen. */
    worksiteId: IdSchema.nullable(),
    /** Siehe {@link IsoWeekKeySchema} — die eine geprüfte Wochenregel (EYT-88). */
    weekKey: IsoWeekKeySchema,
    /** IANA-Zone, nach der die lokalen Tage abgegrenzt wurden. Festgehalten, nicht geraten. */
    timeZone: z.string().min(1),
    currency: z.literal("EUR"),
    /**
     * Rechenregel, nach der die Positionen entstanden — macht den Betrag
     * nachvollziehbar.
     *
     * Wenn V2 kommt, wird daraus `z.enum(["…-v1", "…-v2"])` und NICHT ein
     * ersetztes Literal. Snapshots sind unveränderliche historische Dokumente:
     * die nach V1 gerechneten bleiben liegen und werden weiter gelesen. Ein
     * ausgetauschtes Literal machte jeden bestehenden Snapshot unlesbar — die
     * Leseroute antwortete `CONTRACT_VIOLATION` auf korrekt gespeicherte Daten.
     */
    ruleVersion: z.literal("personnel-plan-cost-v1"),
    createdAt: InstantSchema,
    createdBy: IdSchema,
    correlationId: z.string().min(1),
    totalMinorUnits: MinorUnitsSchema,
    days: z.array(CostDayTotalDtoSchema),
    /**
     * Reihenfolge ist Teil des Vertrags, nicht Zufall.
     *
     * In der Datenbank hängt sie an `ordinal` mit `unique (snapshot_id,
     * ordinal)`; die Reihenfolge dieses Arrays IST diese eingefrorene Ordnung.
     * Wer das Repository schreibt, liest `order by ordinal`; wer die Liste
     * anzeigt oder exportiert, sortiert sie nicht um. Der Export (EYT-110) und
     * der Vergleich zweier Snapshots verlassen sich darauf.
     */
    positions: z.array(CostPositionDtoSchema),
  })
  .superRefine((snapshot, ctx) => {
    // Feldweise Gültigkeit genügt nicht: die Aussage steckt in der Beziehung
    // von `days` und `positions`. Ohne diese Regeln wäre `{ days: [],
    // positions: [fünf Zeilen] }` vertragskonform, und die Oberfläche zeigte
    // eine Woche mit Positionen, aber ohne einen einzigen Tagesbetrag.
    //
    // BEWUSST KEINE Betragsprüfung. Ein `totalMinorUnits === Σ positions` wäre
    // hier falsch: EYT-109 Task 15 braucht eine Antwort, in der beide absichtlich
    // auseinanderfallen, um eine Oberfläche zu ertappen, die selbst nachsummiert.
    // Geprüft wird die STRUKTUR, nicht die Arithmetik.
    const tage = snapshot.days.map((tag) => tag.localDate);
    if (new Set(tage).size !== tage.length) {
      ctx.addIssue({
        code: "custom",
        path: ["days"],
        message:
          "Derselbe lokale Tag erscheint zweimal in days — eine Tagessumme je Tag, sonst ist unklar, welche gilt.",
      });
    }
    for (const tag of new Set(snapshot.positions.map((position) => position.localDate))) {
      if (!tage.includes(tag)) {
        ctx.addIssue({
          code: "custom",
          path: ["days"],
          message: `Positionen am ${tag} haben keine Tagessumme — die Oberflaeche muesste sie selbst addieren.`,
        });
      }
    }
  });
export type CostSnapshot = z.infer<typeof CostSnapshotSchema>;

export const CreateCostSnapshotCommandSchema = z.strictObject({
  publishedPlanVersionId: IdSchema,
  /**
   * Optionaler Baustellenfilter desselben Mandanten. `null` = alle Baustellen.
   *
   * `.nullable()` und ausdrücklich NICHT `.optional()`. Der Idempotenzschlüssel
   * bildet seinen Fingerabdruck über den kanonischen Rumpf (siehe
   * `primitives.ts`); wäre das Feld weglassbar, wären `{publishedPlanVersionId}`
   * und `{publishedPlanVersionId, worksiteId: null}` zwei Schreibweisen
   * desselben Vorgangs und damit zwei Fingerabdrücke. Ein legitimer Retry
   * zählte als neue Anfrage — und schriebe einen zweiten Snapshot.
   */
  worksiteId: IdSchema.nullable(),
});
export type CreateCostSnapshotCommand = z.infer<typeof CreateCostSnapshotCommandSchema>;

/**
 * Eine auswählbare Planversion — eine Zeile der Auswahlliste von `/kosten`.
 *
 * Benannt nach ihrer ROLLE, wie `PlanningResourceSchema` („Auswaehlbare
 * Ressource"), und nicht nach ihrem Zustand. `PublishedPlanVersion…` wäre vom
 * gleichnamigen Planungstyp nur durch ein angehängtes `s` zu unterscheiden
 * gewesen — zwei unverwandte Dinge, die die Autovervollständigung nebeneinander
 * anbietet. Dass ausschliesslich veröffentlichte Versionen erscheinen, bleibt
 * die Zusicherung: über einen Entwurf lässt sich kein Snapshot rechnen.
 */
export const SelectablePlanVersionSchema = z.strictObject({
  id: IdSchema,
  weekKey: IsoWeekKeySchema,
  /**
   * Ohne `Utc`-Suffix, anders als `PublishedPlanVersion.publishedAtUtc` in der
   * Planung. Bewusst: hier gilt die Schreibweise der Nachbarschaft
   * (`RateVersionDto.createdAt`, `CostSnapshot.createdAt`), und `InstantSchema`
   * lässt ohnehin nur UTC zu — das Suffix trüge keine zusätzliche Information.
   */
  publishedAt: InstantSchema,
});
export type SelectablePlanVersion = z.infer<typeof SelectablePlanVersionSchema>;

export const SelectablePlanVersionsSchema = z.strictObject({
  versions: z.array(SelectablePlanVersionSchema),
});
export type SelectablePlanVersions = z.infer<typeof SelectablePlanVersionsSchema>;

/**
 * Wochenbereich der Auswahlliste — ein Objekt, kein Paar nackter Strings.
 *
 * Zwei gleichtypige Positionsparameter lassen sich vertauschen, ohne dass etwas
 * auffällt. Das Paket hat das zweimal anders entschieden:
 * `getPlanningWindow(input: PlanningWindowQuery)` nimmt schon für EINEN
 * Wochenschlüssel ein Objekt, und `TimeIntervalDtoSchema` legt die
 * Reihenfolgeregel ins Schema, damit ein verkehrtes Intervall nicht erst tief
 * im Server auffällt. Ein verkehrter Wochenbereich ist derselbe Fehler in einer
 * anderen Einheit.
 *
 * `<=` genügt als Vergleich, weil ISO-Wochenschlüssel in der Form `JJJJ-Www`
 * lexikographisch in Kalenderreihenfolge sortieren: festes Jahr voran, Woche
 * zweistellig mit führender Null. Gleichheit ist erlaubt — eine einzelne Woche
 * ist ein gültiger Bereich.
 */
export const PublishedPlanVersionsQuerySchema = z
  .strictObject({
    fromWeekKey: IsoWeekKeySchema,
    toWeekKey: IsoWeekKeySchema,
  })
  .refine((bereich) => bereich.fromWeekKey <= bereich.toWeekKey, {
    message: "fromWeekKey muss vor oder gleich toWeekKey liegen",
    path: ["toWeekKey"],
  });
export type PublishedPlanVersionsQuery = z.infer<typeof PublishedPlanVersionsQuerySchema>;
