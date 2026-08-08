/**
 * Transportvertrag des Tageskosten-Snapshots (EYT-109).
 *
 * Die Zusicherungen, die hier wirklich etwas kosten:
 *
 * 1. **Kein Betrag und keine Dauer als JSON-Zahl.** Ein Float verliert oberhalb
 *    von 2^53 still Praezision; ein still falscher Kostenbetrag ist schlimmer
 *    als eine abgelehnte Antwort.
 * 2. **`strictObject` bei den ANTWORTEN, nicht nur beim Kommando.** Die Regel
 *    aus `primitives.ts` zielt auf Antworten: `z.object` entfernt ein
 *    undokumentiertes Serverfeld still und meldet Erfolg — "etwa interne Kosten
 *    oder eine fremde `orgId`" kaeme unbemerkt ueber die Leitung. Beim Kommando
 *    ist das Risiko am kleinsten, deshalb steht der Fall hier auch fuer
 *    `CostPositionDtoSchema` und `CostSnapshotSchema`.
 *    `openapi-drift.test.ts` deckt das NICHT ab: es laeuft ueber
 *    `Object.entries(components.schemas)`, also nur die oberste Ebene, und ein
 *    eingebettetes Objekt rutscht durch.
 * 3. **Der Wochenschluessel hat ueberhaupt eine Regel.** `2025-W53` unten
 *    trennt die Kalenderregel vom blossen Bereichsmuster; die vollstaendige
 *    Abdeckung aller weekKey-Stellen liegt in `iso-week-key.test.ts`, wo
 *    `CostSnapshotSchema` und `SelectablePlanVersionSchema` als Zeilen in
 *    `STELLEN` stehen. Wer hier eine weitere weekKey-Stelle anlegt, traegt sie
 *    dort ein (EYT-88).
 * 4. **Struktur statt Arithmetik.** `days` und `positions` muessen zueinander
 *    passen; ob `totalMinorUnits` die Summe ist, prueft dieser Vertrag
 *    ABSICHTLICH nicht — Task 15 braucht eine Antwort, in der beide
 *    auseinanderfallen, um eine nachsummierende Oberflaeche zu ertappen.
 *
 * Jeder Negativfall hat hier seinen Positivfall daneben: ein Schema, das ALLES
 * ablehnt, waere sonst gruen.
 */
import { describe, expect, it } from "vitest";

import {
  CostDayTotalDtoSchema,
  CostPositionDtoSchema,
  CostSnapshotSchema,
  CreateCostSnapshotCommandSchema,
  PublishedPlanVersionsQuerySchema,
  SelectablePlanVersionsSchema,
} from "../src/costs/schemas.js";

const UUID = "3f1c9c2a-5b7e-4d21-9f0a-8c6e2b1d4a77";
const UUID2 = "9a2b7c1d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const UUID3 = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const UUID4 = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const UUID5 = "7e8f9a0b-1c2d-4e3f-a4b5-c6d7e8f9a0b1";
const UUID6 = "5d6e7f80-9a1b-4c2d-b3e4-f5061728394a";

/** Eine vollstaendige, gueltige Kostenposition — Ausgangspunkt der Negativfaelle. */
const position = {
  id: UUID3,
  assignmentId: UUID4,
  worksiteId: UUID5,
  worksiteLabel: "Baustelle Nord",
  employeeId: UUID6,
  employeeLabel: "Mira Baumgart",
  localDate: "2026-08-03",
  durationMilliseconds: "28800000",
  rateVersionId: UUID2,
  amountMinorUnits: "12000",
};

/** Ein vollstaendiger, gueltiger Snapshot — Ausgangspunkt der Negativfaelle. */
const snapshot = {
  id: UUID,
  planVersionId: UUID2,
  worksiteId: null,
  weekKey: "2026-W32",
  timeZone: "Europe/Berlin",
  currency: "EUR",
  ruleVersion: "personnel-plan-cost-v1",
  createdAt: "2026-08-08T10:00:00.000Z",
  createdBy: UUID,
  correlationId: "abc",
  totalMinorUnits: "12000",
  days: [{ localDate: "2026-08-03", amountMinorUnits: "12000" }],
  positions: [position],
};

describe("CreateCostSnapshotCommandSchema", () => {
  it("nimmt eine Planversions-Id ohne Baustellenfilter an", () => {
    const geprueft = CreateCostSnapshotCommandSchema.safeParse({
      publishedPlanVersionId: UUID,
      worksiteId: null,
    });
    expect(geprueft.success).toBe(true);
  });

  it("nimmt einen gesetzten Baustellenfilter an", () => {
    const geprueft = CreateCostSnapshotCommandSchema.safeParse({
      publishedPlanVersionId: UUID,
      worksiteId: UUID5,
    });
    expect(geprueft.success).toBe(true);
  });

  it("verlangt worksiteId ausdruecklich — weglassen ist kein Ersatz fuer null", () => {
    // `.nullable()`, nicht `.optional()`: zwei Schreibweisen desselben Rumpfs
    // ergaeben zwei Idempotenz-Fingerabdruecke, und ein legitimer Retry
    // schriebe einen zweiten Snapshot.
    expect(
      CreateCostSnapshotCommandSchema.safeParse({ publishedPlanVersionId: UUID }).success,
    ).toBe(false);
  });

  it("lehnt eine mitgeschickte Organisations-Id ab — sie ist keine Autoritaetsquelle", () => {
    const geprueft = CreateCostSnapshotCommandSchema.safeParse({
      publishedPlanVersionId: UUID,
      worksiteId: null,
      organisationId: UUID2,
    });
    expect(geprueft.success).toBe(false);
  });
});

describe("CostPositionDtoSchema", () => {
  it("nimmt eine vollstaendige Position an", () => {
    expect(CostPositionDtoSchema.safeParse(position).success).toBe(true);
  });

  it("lehnt ein undokumentiertes Zusatzfeld ab, statt es still zu entfernen", () => {
    expect(
      CostPositionDtoSchema.safeParse({ ...position, internalMarginCents: 4200 }).success,
    ).toBe(false);
  });

  it("lehnt einen negativen Betrag ab — Minor Units sind eine reine Ziffernfolge", () => {
    expect(CostPositionDtoSchema.safeParse({ ...position, amountMinorUnits: "-1" }).success).toBe(
      false,
    );
  });

  it("lehnt eine Dauer als JSON-Zahl ab", () => {
    expect(
      CostPositionDtoSchema.safeParse({ ...position, durationMilliseconds: 28800000 }).success,
    ).toBe(false);
  });

  it("lehnt eine Dauer von null Millisekunden ab — die Tabelle fuehrt check (duration_ms > 0)", () => {
    expect(
      CostPositionDtoSchema.safeParse({ ...position, durationMilliseconds: "0" }).success,
    ).toBe(false);
  });
});

describe("CostDayTotalDtoSchema", () => {
  it("nimmt eine Tagessumme an", () => {
    expect(
      CostDayTotalDtoSchema.safeParse({ localDate: "2026-08-03", amountMinorUnits: "12000" })
        .success,
    ).toBe(true);
  });

  it("lehnt eine Baustellen-Id ab — die Tagessumme gilt fuer den ganzen Tag", () => {
    // Mit `worksiteId` waere dies eine Baustellen-Tages-Teilsumme, und ein
    // ungefilterter Snapshot mit zwei Baustellen an einem Tag haette gar keine
    // Tagessumme. Genau das Nachaddieren soll der Snapshot der UI ersparen.
    expect(
      CostDayTotalDtoSchema.safeParse({
        localDate: "2026-08-03",
        worksiteId: UUID5,
        amountMinorUnits: "12000",
      }).success,
    ).toBe(false);
  });
});

describe("CostSnapshotSchema", () => {
  it("nimmt einen vollstaendigen Snapshot mit einer Position und einer Tagessumme an", () => {
    expect(CostSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("lehnt ein undokumentiertes Zusatzfeld ab, statt es still zu entfernen", () => {
    expect(CostSnapshotSchema.safeParse({ ...snapshot, internalMarginCents: 4200 }).success).toBe(
      false,
    );
  });

  it("laesst keinen Betrag als JSON-Zahl durch", () => {
    expect(CostSnapshotSchema.safeParse({ ...snapshot, totalMinorUnits: 123456 }).success).toBe(
      false,
    );
  });

  it("lehnt denselben lokalen Tag zweimal in days ab", () => {
    expect(
      CostSnapshotSchema.safeParse({
        ...snapshot,
        days: [
          { localDate: "2026-08-03", amountMinorUnits: "12000" },
          { localDate: "2026-08-03", amountMinorUnits: "500" },
        ],
      }).success,
    ).toBe(false);
  });

  it("lehnt Positionen ohne zugehoerige Tagessumme ab", () => {
    expect(CostSnapshotSchema.safeParse({ ...snapshot, days: [] }).success).toBe(false);
  });

  it("nimmt einen leeren Snapshot an — keine Positionen, keine Tage", () => {
    // Gegenprobe zu den beiden Zeilen darueber: ohne sie waere die
    // Strukturregel auch dann gruen, wenn sie jeden Snapshot ablehnte.
    expect(CostSnapshotSchema.safeParse({ ...snapshot, days: [], positions: [] }).success).toBe(
      true,
    );
  });
});

describe("SelectablePlanVersionsSchema", () => {
  it("nimmt eine reale ISO-Woche an", () => {
    expect(
      SelectablePlanVersionsSchema.safeParse({
        versions: [{ id: UUID, weekKey: "2026-W53", publishedAt: "2026-08-01T00:00:00.000Z" }],
      }).success,
    ).toBe(true);
  });

  it("verlangt gueltige ISO-Wochenschluessel", () => {
    // `2025-W53` und nicht `2026-W54`: die 54 faengt schon das Bereichsmuster,
    // die 53 in einem 52-Wochen-Jahr nur die Kalenderregel. Diese Huelle steht
    // nicht in `STELLEN`, also ist dies der einzige Nachweis, dass sie an das
    // echte `IsoWeekKeySchema` durchreicht.
    expect(
      SelectablePlanVersionsSchema.safeParse({
        versions: [{ id: UUID, weekKey: "2025-W53", publishedAt: "2026-08-01T00:00:00.000Z" }],
      }).success,
    ).toBe(false);
  });
});

describe("PublishedPlanVersionsQuerySchema", () => {
  it("nimmt einen aufsteigenden Wochenbereich an", () => {
    expect(
      PublishedPlanVersionsQuerySchema.safeParse({
        fromWeekKey: "2026-W30",
        toWeekKey: "2026-W32",
      }).success,
    ).toBe(true);
  });

  it("nimmt eine einzelne Woche an — from gleich to ist ein gueltiger Bereich", () => {
    expect(
      PublishedPlanVersionsQuerySchema.safeParse({
        fromWeekKey: "2026-W32",
        toWeekKey: "2026-W32",
      }).success,
    ).toBe(true);
  });

  it("lehnt einen verkehrten Bereich ab, statt ihn erst im Server auffallen zu lassen", () => {
    expect(
      PublishedPlanVersionsQuerySchema.safeParse({
        fromWeekKey: "2026-W32",
        toWeekKey: "2026-W30",
      }).success,
    ).toBe(false);
  });

  it("lehnt einen verkehrten Bereich auch ueber die Jahresgrenze ab", () => {
    // Beweist, dass der lexikographische Vergleich das Jahr zuerst wertet und
    // nicht nur die Wochennummer.
    expect(
      PublishedPlanVersionsQuerySchema.safeParse({
        fromWeekKey: "2026-W02",
        toWeekKey: "2025-W50",
      }).success,
    ).toBe(false);
  });
});
