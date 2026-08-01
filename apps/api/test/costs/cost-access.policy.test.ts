/**
 * AK3 — die Rechtematrix vollstaendig, jeder Fall einzeln benannt (EYT-106).
 *
 * Drei Rollen x vier Rechte = zwoelf Faelle. Nicht als Schleife unter EINER
 * Zusicherung: eine gemeinsame Assertion kann nicht sagen, welcher der zwoelf
 * durchrutschte — derselbe Grund wie bei den Tokenablehnungen.
 *
 * Dazu die Organisationsaufloesung: der Header waehlt aus, er autorisiert
 * nichts.
 */
import { describe, expect, it } from "vitest";

import {
  COST_PERMISSIONS,
  MembershipCostAccessPolicy,
  type CostPermission,
  type MembershipWithPermissions,
} from "../../src/modules/costs";

const ORG_A = "00000000-0000-4000-8000-0000000000a1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";

/**
 * Die Matrix aus der PO-Entscheidung, hier HART kodiert.
 *
 * Bewusst nicht aus `role_permissions` gelesen und auch nicht aus einer
 * geteilten Konstante: dieser Test ist die unabhaengige zweite Meinung zur
 * Migration. Lesen beide dieselbe Quelle, pruefen sie sich gegenseitig nicht.
 */
const MATRIX: Record<string, readonly CostPermission[]> = {
  owner: ["costs.read", "costs.calculate", "costs.export", "costs.manage_rates"],
  manager: ["costs.read", "costs.calculate", "costs.export"],
  member: [],
};

const policy = new MembershipCostAccessPolicy();

function mitgliedschaft(rolle: keyof typeof MATRIX): MembershipWithPermissions {
  return { organisationId: ORG_A, permissions: MATRIX[rolle] ?? [] };
}

describe("CostAccessPolicy — Matrix, zwoelf einzeln benannte Faelle", () => {
  for (const rolle of ["owner", "manager", "member"] as const) {
    for (const recht of COST_PERMISSIONS) {
      const erlaubt = (MATRIX[rolle] ?? []).includes(recht);
      it(`${rolle} ${erlaubt ? "darf" : "darf NICHT"} ${recht}`, () => {
        const ergebnis = policy.authorize([mitgliedschaft(rolle)], ORG_A, recht);
        expect(ergebnis.ok).toBe(erlaubt);
        if (!ergebnis.ok) expect(ergebnis.problem).toBe("PERMISSION_MISSING");
      });
    }
  }

  it("deckt genau vier Rechte ab — ein neues Recht ohne Matrixzeile faellt auf", () => {
    // Vollstaendigkeitszusicherung: waechst COST_PERMISSIONS, ohne dass die
    // Matrix oben mitwaechst, laeuft die Schleife stillschweigend an dem
    // neuen Recht vorbei. Dieselbe Luecke wie bei den *_ERRORS-Listen (EYT-95).
    expect([...COST_PERMISSIONS].sort()).toEqual([
      "costs.calculate",
      "costs.export",
      "costs.manage_rates",
      "costs.read",
    ]);
  });
});

describe("CostAccessPolicy — Organisationsaufloesung", () => {
  it("loest ohne Header auf, wenn es GENAU eine aktive Organisation gibt", () => {
    const ergebnis = policy.authorize([mitgliedschaft("owner")], null, "costs.read");
    expect(ergebnis).toEqual({ ok: true, organisationId: ORG_A });
  });

  it("verlangt bei mehreren aktiven Organisationen eine Auswahl (ORG_CONTEXT_REQUIRED)", () => {
    // PO-Entscheidung: keine stille Aufloesung.
    // Gegenmutation: bei mehreren die erste nehmen -> rot.
    const ergebnis = policy.authorize(
      [mitgliedschaft("owner"), { organisationId: ORG_B, permissions: ["costs.read"] }],
      null,
      "costs.read",
    );
    expect(ergebnis).toEqual({ ok: false, problem: "ORG_CONTEXT_REQUIRED" });
  });

  it("lehnt ohne jede Mitgliedschaft ab, statt irgendetwas zu waehlen", () => {
    expect(policy.authorize([], null, "costs.read")).toEqual({
      ok: false,
      problem: "ORG_CONTEXT_REQUIRED",
    });
  });

  it("lehnt eine Organisation ab, in der das Subjekt nicht Mitglied ist", () => {
    // Der Kern von "der Header waehlt nur aus": eine erfundene oder fremde
    // Organisations-ID veraendert das Ergebnis NICHT zugunsten des Aufrufers.
    // Gegenmutation: die angeforderte Organisation uebernehmen, statt sie
    // gegen die Mitgliedschaft zu pruefen -> rot.
    const ergebnis = policy.authorize([mitgliedschaft("owner")], ORG_B, "costs.read");
    expect(ergebnis).toEqual({ ok: false, problem: "ORG_NOT_A_MEMBER" });
  });

  it("waehlt bei mehreren Organisationen genau die angeforderte — mit DEREN Rechten", () => {
    // Wichtig: die Rechte der EINEN Organisation duerfen nicht auf die andere
    // durchschlagen. Owner in A, blosses Mitglied in B.
    const mitgliedschaften = [
      mitgliedschaft("owner"),
      { organisationId: ORG_B, permissions: [] as readonly string[] },
    ];
    expect(policy.authorize(mitgliedschaften, ORG_A, "costs.manage_rates")).toEqual({
      ok: true,
      organisationId: ORG_A,
    });
    expect(policy.authorize(mitgliedschaften, ORG_B, "costs.manage_rates")).toEqual({
      ok: false,
      problem: "PERMISSION_MISSING",
    });
  });
});
