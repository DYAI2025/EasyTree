/**
 * Transportvertrag des Tageskosten-Snapshots (EYT-109).
 *
 * Die drei Zusicherungen, die hier wirklich etwas kosten:
 *
 * 1. **Kein Betrag und keine Dauer als JSON-Zahl.** Ein Float verliert oberhalb
 *    von 2^53 still Praezision; ein still falscher Kostenbetrag ist schlimmer
 *    als eine abgelehnte Antwort.
 * 2. **`strictObject` ueberall.** Eine mitgeschickte `organisationId` waere eine
 *    zweite, clientgesteuerte Mandantenquelle — der Server nimmt die
 *    Organisation aus der Sitzung, nie aus dem Rumpf.
 * 3. **Der Wochenschluessel hat ueberhaupt eine Regel.** `2026-W54` unten faengt
 *    das MUSTER — mehr behauptet dieser Test nicht. Dass es die geprueften
 *    ISO-Woche ist und nicht bloss ein Bereich, entscheidet sich an `2025-W53`,
 *    und das steht in `iso-week-key.test.ts`: `CostSnapshotSchema` und
 *    `PublishedPlanVersionDtoSchema` sind dort als Stelle 6 und 7 in `STELLEN`
 *    eingetragen. Wer hier eine weitere weekKey-Stelle anlegt, traegt sie dort
 *    ein — sonst hat die Kalenderregel keine Abdeckung (EYT-88).
 *
 * Jeder Negativfall hat hier seinen Positivfall daneben: ein Schema, das ALLES
 * ablehnt, waere sonst gruen.
 */
import { describe, expect, it } from "vitest";

import {
  CostPositionDtoSchema,
  CostSnapshotSchema,
  CreateCostSnapshotCommandSchema,
  PublishedPlanVersionsSchema,
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
});

describe("CostSnapshotSchema", () => {
  it("nimmt einen vollstaendigen Snapshot mit einer Position und einer Tagessumme an", () => {
    const geprueft = CostSnapshotSchema.safeParse({
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
      days: [{ localDate: "2026-08-03", worksiteId: UUID5, amountMinorUnits: "12000" }],
      positions: [position],
    });
    expect(geprueft.success).toBe(true);
  });

  it("laesst keinen Betrag als JSON-Zahl durch", () => {
    const geprueft = CostSnapshotSchema.safeParse({
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
      totalMinorUnits: 123456,
      days: [],
      positions: [],
    });
    expect(geprueft.success).toBe(false);
  });
});

describe("PublishedPlanVersionsSchema", () => {
  it("nimmt eine reale ISO-Woche an", () => {
    expect(
      PublishedPlanVersionsSchema.safeParse({
        versions: [{ id: UUID, weekKey: "2026-W32", publishedAt: "2026-08-01T00:00:00.000Z" }],
      }).success,
    ).toBe(true);
  });

  it("verlangt gueltige ISO-Wochenschluessel", () => {
    expect(
      PublishedPlanVersionsSchema.safeParse({
        versions: [{ id: UUID, weekKey: "2026-W54", publishedAt: "2026-08-01T00:00:00.000Z" }],
      }).success,
    ).toBe(false);
  });
});
