import { describe, expect, it } from "vitest";

import type { SessionDto } from "@easytree/contracts";

import { startShellFuer } from "../lib/feld/start-shell";

/**
 * Start-Shell-Ableitung (EYT-113): Welche Shell einem Nutzer beim Einstieg
 * gehoert, folgt aus der serverseitig verifizierten Session — konkret aus den
 * Rollen seiner Mitgliedschaften. Die Funktion ist rein und damit die eine
 * testbare Wahrheit; Route oder Client-State verleihen kein Recht.
 *
 * Gegenmutation, die diese Suite rot macht: `every` durch `some` ersetzen
 * (dann schickte eine einzige member-Mitgliedschaft auch Leitungen ins Feld)
 * oder die Rolle "manager" als Feld-Rolle einstufen.
 */
function sitzung(rollen: ReadonlyArray<"owner" | "manager" | "member">): SessionDto {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    organisations: rollen.map((role, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 2}`,
      name: `Org ${index + 1}`,
      role,
      permissions: [],
    })),
  };
}

describe("startShellFuer (EYT-113)", () => {
  it("schickt eine reine member-Mitgliedschaft in die Feld-Shell", () => {
    expect(startShellFuer(sitzung(["member"]))).toBe("feld");
  });

  it("schickt einen owner in die Werkbank", () => {
    expect(startShellFuer(sitzung(["owner"]))).toBe("werkbank");
  });

  it("schickt einen manager in die Werkbank", () => {
    expect(startShellFuer(sitzung(["manager"]))).toBe("werkbank");
  });

  it("gemischte Mitgliedschaften: eine Leitungsrolle genuegt fuer die Werkbank", () => {
    expect(startShellFuer(sitzung(["member", "manager"]))).toBe("werkbank");
  });

  it("mehrere reine member-Mitgliedschaften bleiben Feld", () => {
    expect(startShellFuer(sitzung(["member", "member"]))).toBe("feld");
  });

  it("ohne jede Mitgliedschaft gilt die Feld-Shell (kleinste Flaeche)", () => {
    // Ein authentifizierter Nutzer ohne Organisation (Reisender-B-Fall) hat
    // in der Werkbank nichts zu suchen: dort waere jede Flaeche verboten.
    expect(startShellFuer(sitzung([]))).toBe("feld");
  });
});
