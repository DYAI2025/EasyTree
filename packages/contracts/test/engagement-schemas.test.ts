/**
 * Das Einsatz-Kommando (EYT-120 Inkrement 1) — die Brief-Faelle 1–7.
 *
 * Alle Regeln unten sind BEZIEHUNGEN zwischen Feldern (Ende nach Beginn, Tage
 * im Zeitraum, Horizont-XOR, Duplikate) oder Striktheit — beides kann das
 * erzeugte OpenAPI-Dokument nicht ausdruecken, und der Drift-Test bleibt gruen,
 * wenn eine davon faellt. Diese Datei ist deshalb der einzige Detektor.
 */
import { describe, expect, it } from "vitest";

import { CreateEngagementCommandSchema } from "../src/planning/schemas.js";

const WORKSITE = "00000000-0000-4000-8000-0000005010a1";
const EMPLOYEE = "00000000-0000-4000-8000-0000004010a1";
const basis = {
  worksiteId: WORKSITE,
  startAt: { date: "2031-01-06", time: "07:00" },
  endAt: { date: "2031-01-10", time: "16:00" },
  planningHorizon: null,
  defaults: { workingTime: { from: "08:00", to: "18:00" } },
  days: [
    { localDate: "2031-01-06" },
    { localDate: "2031-01-07", workingTime: { from: "08:00", to: "12:00" } },
  ],
  team: [EMPLOYEE],
};

describe("CreateEngagementCommandSchema (EYT-120)", () => {
  it("1 verlangt startAt als lokales Datum+Zeit", () => {
    // Rest-Destrukturierung entfernt den Schluessel; das abgetrennte Feld wird
    // nicht gebraucht. `void` statt `_`-Praefix, weil die ESLint-Konfiguration
    // kein `varsIgnorePattern` kennt (Muster wie in planning-facts.adapter.test.ts).
    const { startAt, ...ohne } = basis;
    void startAt;
    expect(CreateEngagementCommandSchema.safeParse(ohne).success).toBe(false);
    expect(
      CreateEngagementCommandSchema.safeParse({ ...basis, startAt: { date: "2031-01-06" } })
        .success,
    ).toBe(false);
    expect(
      CreateEngagementCommandSchema.safeParse({ ...basis, startAt: "2031-01-06T07:00:00.000Z" })
        .success,
    ).toBe(false);
  });

  it("2 erlaubt endAt = null nur mit konkretem Planungshorizont", () => {
    expect(
      CreateEngagementCommandSchema.safeParse({
        ...basis,
        endAt: null,
        planningHorizon: "2031-01-17",
      }).success,
    ).toBe(true);
    expect(
      CreateEngagementCommandSchema.safeParse({ ...basis, endAt: null, planningHorizon: null })
        .success,
    ).toBe(false);
    // bekanntes Ende UND Horizont waeren zwei Wahrheiten
    expect(
      CreateEngagementCommandSchema.safeParse({ ...basis, planningHorizon: "2031-01-17" }).success,
    ).toBe(false);
  });

  it("3 bekanntes Ende liegt nach dem Beginn (lexikografisch auf Datum+Zeit)", () => {
    expect(
      CreateEngagementCommandSchema.safeParse({
        ...basis,
        endAt: { date: "2031-01-06", time: "07:00" },
      }).success,
    ).toBe(false);
    expect(
      CreateEngagementCommandSchema.safeParse({
        ...basis,
        endAt: { date: "2031-01-06", time: "07:01" },
        days: [{ localDate: "2031-01-06" }],
      }).success,
    ).toBe(true);
  });

  it("4 mindestens ein ausgewaehlter Tag", () => {
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, days: [] }).success).toBe(false);
  });

  it("5 doppelte Tage werden abgelehnt", () => {
    expect(
      CreateEngagementCommandSchema.safeParse({
        ...basis,
        days: [{ localDate: "2031-01-06" }, { localDate: "2031-01-06" }],
      }).success,
    ).toBe(false);
  });

  it("6 Tage ausserhalb von [startAt.date, endAt.date | planningHorizon] werden abgelehnt", () => {
    expect(
      CreateEngagementCommandSchema.safeParse({ ...basis, days: [{ localDate: "2031-01-05" }] })
        .success,
    ).toBe(false);
    expect(
      CreateEngagementCommandSchema.safeParse({ ...basis, days: [{ localDate: "2031-01-11" }] })
        .success,
    ).toBe(false);
    expect(
      CreateEngagementCommandSchema.safeParse({
        ...basis,
        endAt: null,
        planningHorizon: "2031-01-17",
        days: [{ localDate: "2031-01-18" }],
      }).success,
    ).toBe(false);
  });

  it("7 unbekannte Schluessel werden strikt abgelehnt; Arbeitszeit to > from; Team nicht leer, ohne Duplikate", () => {
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, extra: 1 }).success).toBe(false);
    expect(
      CreateEngagementCommandSchema.safeParse({
        ...basis,
        defaults: { workingTime: { from: "18:00", to: "08:00" } },
      }).success,
    ).toBe(false);
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, team: [] }).success).toBe(false);
    expect(
      CreateEngagementCommandSchema.safeParse({ ...basis, team: [EMPLOYEE, EMPLOYEE] }).success,
    ).toBe(false);
  });
});
