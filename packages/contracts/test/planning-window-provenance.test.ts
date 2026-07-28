/**
 * Provenienz als Invariante, nicht als Feldsammlung (EYT-50).
 *
 * `PlanningWindowSchema` prueft die Felder auch einzeln — aber die AUSSAGE
 * steckt in ihrer Beziehung. Ohne Cross-Field-Regeln waeren formal gueltige,
 * fachlich widerspruechliche Antworten moeglich, und sie fielen erst in der
 * Oberflaeche auf: "Veroeffentlichte Version X" ueber Daten, die nicht zu X
 * gehoeren.
 */
import { describe, expect, it } from "vitest";

import { PlanningWindowSchema } from "../src/planning/schemas.js";

const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const PUBLISHED_ID = "44444444-4444-4444-8444-444444444444";

const ASSIGNMENT = {
  id: "11111111-1111-4111-8111-111111111111",
  employeeId: "22222222-2222-4222-8222-222222222222",
  worksiteId: "33333333-3333-4333-8333-333333333333",
  interval: { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T14:00:00.000Z" },
};

const BASIS = {
  weekKey: "2026-W32",
  timeZone: "Europe/Berlin",
  // Genau die beiden Ids aus ASSIGNMENT. Jede angezeigte Zuweisung muss ueber
  // `resources` auf einen Namen aufloesbar sein — sonst kann die Oberflaeche
  // nur eine nackte Uuid rendern, und ein Mandantenleck saehe identisch aus.
  resources: {
    employees: [{ id: ASSIGNMENT.employeeId, label: "Beschaeftigte A", active: true }],
    worksites: [{ id: ASSIGNMENT.worksiteId, label: "Baustelle A", active: true }],
  },
};

describe("PlanningWindow — erlaubte Staende", () => {
  it("akzeptiert die leere Woche ohne jede Version", () => {
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      assignments: [],
      sourceVersion: null,
      publishedVersionId: null,
    });
    expect(r.success).toBe(true);
  });

  it("akzeptiert einen Entwurf ohne Veroeffentlichung", () => {
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      assignments: [ASSIGNMENT],
      sourceVersion: { id: DRAFT_ID, state: "draft" },
      publishedVersionId: null,
    });
    expect(r.success).toBe(true);
  });

  it("akzeptiert einen veroeffentlichten Stand", () => {
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      assignments: [ASSIGNMENT],
      sourceVersion: { id: PUBLISHED_ID, state: "published" },
      publishedVersionId: PUBLISHED_ID,
    });
    expect(r.success).toBe(true);
  });

  it("akzeptiert einen Entwurf UEBER einer Veroeffentlichung", () => {
    // Der Normalfall beim Umplanen — und der Grund, aus dem beide Felder
    // getrennt existieren.
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      assignments: [ASSIGNMENT],
      sourceVersion: { id: DRAFT_ID, state: "draft" },
      publishedVersionId: PUBLISHED_ID,
    });
    expect(r.success).toBe(true);
  });
});

describe("PlanningWindow — widerspruechliche Staende", () => {
  it("lehnt Zuweisungen ohne Herkunft ab", () => {
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      assignments: [ASSIGNMENT],
      sourceVersion: null,
      publishedVersionId: null,
    });
    expect(r.success).toBe(false);
  });

  it("lehnt eine gemeldete Veroeffentlichung ohne angezeigte Version ab", () => {
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      assignments: [],
      sourceVersion: null,
      publishedVersionId: PUBLISHED_ID,
    });
    expect(r.success).toBe(false);
  });

  it("lehnt einen veroeffentlichten Stand ohne publishedVersionId ab", () => {
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      assignments: [ASSIGNMENT],
      sourceVersion: { id: PUBLISHED_ID, state: "published" },
      publishedVersionId: null,
    });
    expect(r.success).toBe(false);
  });

  it("lehnt eine veroeffentlichte Quelle ab, die nicht die zuletzt veroeffentlichte ist", () => {
    // Genau der Fall, in dem die Oberflaeche eine Id zeigt und eine andere
    // meint — und der Mitarbeitervergleich aus AK9 unbrauchbar wird.
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      assignments: [ASSIGNMENT],
      sourceVersion: { id: DRAFT_ID, state: "published" },
      publishedVersionId: PUBLISHED_ID,
    });
    expect(r.success).toBe(false);
  });

  it("lehnt dieselbe Id als Entwurf UND Veroeffentlichung ab", () => {
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      assignments: [ASSIGNMENT],
      sourceVersion: { id: PUBLISHED_ID, state: "draft" },
      publishedVersionId: PUBLISHED_ID,
    });
    expect(r.success).toBe(false);
  });
});

/**
 * Aufloesbarkeit als Invariante (EYT-92).
 *
 * **Gegenmutation:** Entfernt man den `bekannteBeschaeftigte`-Block aus
 * `PlanningWindowSchema.superRefine`, wird der erste Fall gruen — eine
 * Zuweisung auf eine Person, die die Auswahlliste nicht kennt, ginge durch.
 * Analog fuer `bekannteBaustellen` und den zweiten Fall. Beide Faelle sind
 * dauerhaft in der Suite und nicht an eine zurueckgenommene Quelltextaenderung
 * gebunden.
 */
describe("PlanningWindow — Zuweisungen muessen aufloesbar sein", () => {
  it("lehnt eine Zuweisung auf eine unbekannte Beschaeftigte ab", () => {
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      resources: { ...BASIS.resources, employees: [] },
      assignments: [ASSIGNMENT],
      sourceVersion: { id: DRAFT_ID, state: "draft" },
      publishedVersionId: null,
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("resources.employees");
  });

  it("lehnt eine Zuweisung auf eine unbekannte Baustelle ab", () => {
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      resources: { ...BASIS.resources, worksites: [] },
      assignments: [ASSIGNMENT],
      sourceVersion: { id: DRAFT_ID, state: "draft" },
      publishedVersionId: null,
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("resources.worksites");
  });

  it("akzeptiert eine Zuweisung auf eine INAKTIVE Beschaeftigte", () => {
    // Kernregel: `active` steuert die Auswaehlbarkeit neuer Einsaetze, nicht
    // die Sichtbarkeit bestehender. Wuerde der Vertrag inaktive Eintraege
    // verwerfen, verloere ein bestehender Einsatz seinen Namen, sobald jemand
    // die Person deaktiviert.
    const r = PlanningWindowSchema.safeParse({
      ...BASIS,
      resources: {
        employees: [{ id: ASSIGNMENT.employeeId, label: "Ausgeschieden", active: false }],
        worksites: BASIS.resources.worksites,
      },
      assignments: [ASSIGNMENT],
      sourceVersion: { id: DRAFT_ID, state: "draft" },
      publishedVersionId: null,
    });
    expect(r.success).toBe(true);
  });
});
