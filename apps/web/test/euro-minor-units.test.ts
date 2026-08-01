/**
 * EUR-Eingabegrenze der Satzmaske (EYT-108): reine Stringarbeit, kein Float.
 * Gegenmutation: euroToMinorUnits auf parseFloat umstellen -> der
 * Praezisionsfall unten wird rot.
 */
import { describe, expect, it } from "vitest";

import { euroToMinorUnits, minorUnitsToEuro } from "../lib/euro-minor-units";

describe("euroToMinorUnits", () => {
  it("wandelt gaengige Eingaben korrekt", () => {
    expect(euroToMinorUnits("38,50")).toBe("3850");
    expect(euroToMinorUnits("38")).toBe("3800");
    expect(euroToMinorUnits("38,5")).toBe("3850");
    expect(euroToMinorUnits("0")).toBe("0");
    expect(euroToMinorUnits("0,01")).toBe("1");
    expect(euroToMinorUnits("1.234,56")).toBe("123456");
  });

  it("bleibt jenseits der Float-Praezision exakt (kein parseFloat)", () => {
    // 90071992547409,93 EUR — als Float nicht mehr exakt darstellbar.
    expect(euroToMinorUnits("90.071.992.547.409,93")).toBe("9007199254740993");
  });

  it("lehnt Unlesbares ab statt zu raten", () => {
    expect(euroToMinorUnits("")).toBeNull();
    expect(euroToMinorUnits("-5")).toBeNull();
    expect(euroToMinorUnits("38,505")).toBeNull();
    expect(euroToMinorUnits("abc")).toBeNull();
    expect(euroToMinorUnits("38.50")).toBeNull();
  });
});

describe("minorUnitsToEuro", () => {
  it("formatiert fuer die Anzeige mit Tausenderpunkt und Komma", () => {
    expect(minorUnitsToEuro("3850")).toBe("38,50");
    expect(minorUnitsToEuro("0")).toBe("0,00");
    expect(minorUnitsToEuro("1")).toBe("0,01");
    expect(minorUnitsToEuro("123456")).toBe("1.234,56");
  });
});
