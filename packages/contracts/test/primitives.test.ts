import { describe, expect, it } from "vitest";

import {
  AssignmentDtoSchema,
  PlanningWindowSchema,
  TimeIntervalDtoSchema,
} from "../src/planning/schemas.js";
import { IdempotencyKeySchema, InstantSchema, ProblemDocumentSchema } from "../src/primitives.js";

describe("InstantSchema — genau eine Schreibweise", () => {
  it("nimmt die kanonische Form an", () => {
    expect(InstantSchema.safeParse("2026-08-03T06:00:00.000Z").success).toBe(true);
  });

  it.each(["2026-08-03T06:00:00Z", "2026-08-03T06:00:00.0Z", "2026-08-03T06:00:00.00Z"])(
    "lehnt die abweichende Schreibweise %s ab",
    (value) => {
      // Alle drei bezeichnen denselben Zeitpunkt. Wuerden sie durchgehen, ergaebe
      // ein legitimer Client-Retry einen anderen Idempotenz-Fingerabdruck und die
      // Schreiboperation liefe zweimal.
      expect(InstantSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each(["2026-08-03T08:00:00.000+02:00", "2026-08-03 06:00:00.000Z", "nicht-ein-datum"])(
    "lehnt %s ab",
    (value) => {
      expect(InstantSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("Antwortschemata sind geschlossen", () => {
  const validAssignment = {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    employeeId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    worksiteId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
    interval: { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T14:00:00.000Z" },
  };

  it("nimmt die vertragskonforme Form an", () => {
    expect(AssignmentDtoSchema.safeParse(validAssignment).success).toBe(true);
  });

  it("lehnt ein undokumentiertes Zusatzfeld ab, statt es still zu entfernen", () => {
    const withLeak = { ...validAssignment, internalCostCents: 4200 };
    expect(AssignmentDtoSchema.safeParse(withLeak).success).toBe(false);
  });

  it("lehnt eine fremde orgId im Planungsfenster ab", () => {
    const window = {
      weekKey: "2026-W32",
      timeZone: "Europe/Berlin",
      assignments: [],
      publishedVersionId: null,
      orgId: "fremde-organisation",
    };
    expect(PlanningWindowSchema.safeParse(window).success).toBe(false);
  });
});

describe("ProblemDocument", () => {
  it("entspricht der Form, die der bestehende Exception-Filter ausgibt", () => {
    const emitted = {
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "Cannot GET /unbekannt",
      correlationId: "b3f1c2d4-1111-2222-3333-444455556666",
    };
    expect(ProblemDocumentSchema.safeParse(emitted).success).toBe(true);
  });

  it("lehnt einen Status ausserhalb des Fehlerbereichs ab", () => {
    const ok = { type: "about:blank", title: "OK", status: 200, detail: "", correlationId: "x" };
    expect(ProblemDocumentSchema.safeParse(ok).success).toBe(false);
  });
});

describe("IdempotencyKey", () => {
  it("nimmt einen URL-sicheren Schluessel an", () => {
    expect(IdempotencyKeySchema.safeParse("publish-2026-W32-abc123").success).toBe(true);
  });

  it.each(["kurz", "hat leerzeichen", "hat/slash"])("lehnt %s ab", (value) => {
    expect(IdempotencyKeySchema.safeParse(value).success).toBe(false);
  });
});

describe("Formgueltig ist nicht zeitgueltig", () => {
  it.each([
    "2026-99-99T06:00:00.000Z",
    "2026-02-30T06:00:00.000Z",
    "2026-08-03T29:61:61.000Z",
    "2026-13-01T06:00:00.000Z",
  ])("lehnt %s ab, obwohl das Muster passt", (value) => {
    expect(InstantSchema.safeParse(value).success).toBe(false);
  });

  it("nimmt den 29. Februar eines Schaltjahres an", () => {
    expect(InstantSchema.safeParse("2028-02-29T06:00:00.000Z").success).toBe(true);
  });
});

describe("TimeIntervalDto erzwingt die Reihenfolge", () => {
  const base = { startUtc: "2026-08-03T14:00:00.000Z", endUtc: "2026-08-03T06:00:00.000Z" };

  it("lehnt ein verkehrtes Intervall ab", () => {
    expect(TimeIntervalDtoSchema.safeParse(base).success).toBe(false);
  });

  it("lehnt ein Nulllaengen-Intervall ab", () => {
    const point = { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T06:00:00.000Z" };
    expect(TimeIntervalDtoSchema.safeParse(point).success).toBe(false);
  });

  it("nimmt ein aufsteigendes Intervall an", () => {
    const ok = { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T14:00:00.000Z" };
    expect(TimeIntervalDtoSchema.safeParse(ok).success).toBe(true);
  });
});
