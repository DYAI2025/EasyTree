/**
 * Serverseitige Planungsautorisierung (EYT-107).
 *
 * ## Was hier gemessen wird — und was ausdruecklich nicht
 *
 * Diese Datei prueft die ANWENDUNGSSEITIGE Haelfte. Die Datenbank entscheidet
 * unabhaengig noch einmal (`app.has_permission` in der Update-Policy von
 * Migration 0015, bewiesen in `supabase/tests/0011_planning_publish.sql`).
 * Beide lesen dieselbe Zuordnung `role_permissions`, aber keine verlaesst sich
 * auf die andere — schaltet man diese Policy auf „immer erlaubt", muss RLS
 * weiterhin ablehnen.
 *
 * ## Der Kern: `planning.write` impliziert `planning.publish` NICHT
 *
 * Das ist keine Stilfrage, sondern die Product-Owner-Entscheidung vom
 * 03.08.2026. Ohne einen Test dafuer waere die Trennung eine Behauptung: eine
 * Implementierung mit `permissions.includes("planning.write")` als
 * Publish-Bedingung waere in jedem anderen Fall gruen.
 *
 * Gegenmutation, die diese Datei rot macht: in `pruefeRecht` die
 * `includes`-Pruefung durch `true` ersetzen — dann fallen alle
 * `PERMISSION_MISSING`-Faelle.
 */
import { describe, expect, it } from "vitest";

import {
  MembershipPlanningAccessPolicy,
  PLANNING_PERMISSIONS,
} from "../src/modules/planning/application/membership-planning-access.policy";
import type { PlanningMembership } from "../src/modules/planning/application/planning-access.port";

const ORG_A = "00000000-0000-4000-8000-0000000000a1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";

const policy = new MembershipPlanningAccessPolicy();

const mitgliedschaft = (
  organisationId: string,
  permissions: readonly string[],
): PlanningMembership => ({ organisationId, permissions });

/** Die Rechte, die owner und manager laut Rollenmatrix tragen. */
const ALLE_PLANUNGSRECHTE = ["planning.read", "planning.write", "planning.publish"];

describe("PLANNING_PERMISSIONS", () => {
  it("besteht aus genau drei atomaren Rechten", () => {
    expect([...PLANNING_PERMISSIONS]).toEqual([
      "planning.read",
      "planning.write",
      "planning.publish",
    ]);
  });
});

describe("MembershipPlanningAccessPolicy — Organisationsaufloesung", () => {
  it("waehlt ohne Header die EINZIGE aktive Organisation", () => {
    const ergebnis = policy.authorize(
      [mitgliedschaft(ORG_A, ALLE_PLANUNGSRECHTE)],
      null,
      "planning.publish",
    );
    expect(ergebnis).toEqual({ ok: true, organisationId: ORG_A });
  });

  it("waehlt bei MEHREREN Mitgliedschaften nichts still aus", () => {
    const ergebnis = policy.authorize(
      [mitgliedschaft(ORG_A, ALLE_PLANUNGSRECHTE), mitgliedschaft(ORG_B, ALLE_PLANUNGSRECHTE)],
      null,
      "planning.publish",
    );
    expect(ergebnis).toEqual({ ok: false, problem: "ORG_CONTEXT_REQUIRED" });
  });

  it("lehnt ohne jede Mitgliedschaft ab", () => {
    expect(policy.authorize([], null, "planning.read")).toEqual({
      ok: false,
      problem: "ORG_CONTEXT_REQUIRED",
    });
  });

  it("lehnt eine Organisation ab, in der das Subjekt nicht Mitglied ist", () => {
    const ergebnis = policy.authorize(
      [mitgliedschaft(ORG_A, ALLE_PLANUNGSRECHTE)],
      ORG_B,
      "planning.publish",
    );
    expect(ergebnis).toEqual({ ok: false, problem: "ORG_NOT_A_MEMBER" });
  });

  it("nimmt die gewaehlte Organisation, wenn das Subjekt dort Mitglied ist", () => {
    const ergebnis = policy.authorize(
      [mitgliedschaft(ORG_A, ALLE_PLANUNGSRECHTE), mitgliedschaft(ORG_B, ALLE_PLANUNGSRECHTE)],
      ORG_B,
      "planning.publish",
    );
    expect(ergebnis).toEqual({ ok: true, organisationId: ORG_B });
  });
});

describe("MembershipPlanningAccessPolicy — atomare Rechte", () => {
  it.each(PLANNING_PERMISSIONS)("laesst %s durch, wenn die Rolle es traegt", (recht) => {
    expect(policy.authorize([mitgliedschaft(ORG_A, ALLE_PLANUNGSRECHTE)], null, recht)).toEqual({
      ok: true,
      organisationId: ORG_A,
    });
  });

  it("lehnt planning.publish ab, wenn NUR read und write vorliegen", () => {
    // Der Kern der PO-Entscheidung: Schreiben impliziert Veroeffentlichen nicht.
    const ergebnis = policy.authorize(
      [mitgliedschaft(ORG_A, ["planning.read", "planning.write"])],
      null,
      "planning.publish",
    );
    expect(ergebnis).toEqual({ ok: false, problem: "PERMISSION_MISSING" });
  });

  it("laesst dieselbe Mitgliedschaft aber schreiben", () => {
    // Gegenprobe zur Zeile darueber: ohne sie waere „lehnt ab" auch dann gruen,
    // wenn die Policy grundsaetzlich nichts durchliesse.
    const ergebnis = policy.authorize(
      [mitgliedschaft(ORG_A, ["planning.read", "planning.write"])],
      null,
      "planning.write",
    );
    expect(ergebnis).toEqual({ ok: true, organisationId: ORG_A });
  });

  it("lehnt jedes Planungsrecht ab, wenn die Mitgliedschaft keines traegt (member)", () => {
    for (const recht of PLANNING_PERMISSIONS) {
      expect(policy.authorize([mitgliedschaft(ORG_A, [])], null, recht)).toEqual({
        ok: false,
        problem: "PERMISSION_MISSING",
      });
    }
  });

  it("laesst ein KOSTENrecht nicht als Planungsrecht gelten", () => {
    // Beide Raeume liegen in derselben Spalte `role_permissions.permission`.
    // Ein Praefixvergleich statt eines exakten waere hier gruen und falsch.
    const ergebnis = policy.authorize(
      [mitgliedschaft(ORG_A, ["costs.read", "costs.export"])],
      null,
      "planning.read",
    );
    expect(ergebnis).toEqual({ ok: false, problem: "PERMISSION_MISSING" });
  });

  it("prueft die Organisation VOR dem Recht", () => {
    // Sonst verriete die Antwort einem Fremden, ob ein Recht existiert.
    const ergebnis = policy.authorize([mitgliedschaft(ORG_A, [])], ORG_B, "planning.publish");
    expect(ergebnis).toEqual({ ok: false, problem: "ORG_NOT_A_MEMBER" });
  });
});
