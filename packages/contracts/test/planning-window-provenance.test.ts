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

const BASIS = { weekKey: "2026-W32", timeZone: "Europe/Berlin" };

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
