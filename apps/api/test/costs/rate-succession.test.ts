/**
 * Die Abloeseregel als reine Domaenenentscheidung (EYT-108, Option A+).
 *
 * Ein offener Stundensatz wird ersetzt: der Vorgaenger wird genau EINMAL
 * geschlossen (`validTo = successor.validFrom`), der Nachfolger verweist auf
 * ihn. Diese Datei prueft nur das WARUM/OB — Sperren, Transaktion und
 * Datenbankrechte gehoeren in die Adapterschicht und werden dort gemessen.
 *
 * Warum eine eigene reine Funktion und nicht "der Adapter prueft schon":
 * die Ablehnungsgruende sind fachliche Aussagen (`STALE_VERSION` ist etwas
 * anderes als `VORGAENGER_BEREITS_GESCHLOSSEN`), und sie muessen ohne
 * laufende Datenbank pruefbar sein. Auf diesem Rechner laeuft kein Supabase;
 * ein Test, der nur im CI etwas misst, ist ein schlechter erster Nachweis.
 */
import { dayAfter } from "@easytree/domain";
import { describe, expect, it } from "vitest";

import { RATE_SUCCESSION_PROBLEMS, pruefeAbloesung } from "../../src/modules/costs";
import type { RateVersion } from "../../src/modules/costs";

/**
 * Ein Kalendertag aus seiner Textform — bewusst HIER und nicht aus dem Modul.
 *
 * Der Test soll die Regel messen, nicht die Umrechnung des Moduls mitbenutzen:
 * teilten sich beide dieselbe Funktion, hoebe ein Fehler darin sich im
 * Vergleich auf und der Fall waere gruen (`net-count-checks-cancel-out`).
 */
function tag(iso: string): { year: number; month: number; day: number } {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}

function alsText(datum: { year: number; month: number; day: number }): string {
  const mm = String(datum.month).padStart(2, "0");
  const dd = String(datum.day).padStart(2, "0");
  return `${String(datum.year).padStart(4, "0")}-${mm}-${dd}`;
}

const VORGAENGER: RateVersion = {
  id: "00000000-0000-4000-8000-0000000000a1",
  employeeId: "00000000-0000-4000-8000-0000000000e1",
  amountMinorUnits: "4200",
  currency: "EUR",
  validFrom: "2026-01-01",
  validTo: null,
  predecessorId: null,
  reason: "Ersteinstellung",
  createdAt: "2026-01-01T08:00:00.000Z",
  createdBy: "00000000-0000-4000-8000-0000000000u1",
};

/** Der Nachfolger, wie ihn der Aufrufer wuenscht — noch ohne Id. */
const NACHFOLGER = {
  employeeId: VORGAENGER.employeeId,
  validFrom: "2026-07-01",
} as const;

describe("Abloesung eines offenen Stundensatzes (EYT-108 Option A+)", () => {
  it("erlaubt die Abloesung und nennt den zu setzenden Endtag", () => {
    const ergebnis = pruefeAbloesung({
      vorgaenger: VORGAENGER,
      nachfolger: NACHFOLGER,
      expectedActiveVersionId: VORGAENGER.id,
    });
    expect(ergebnis.ok).toBe(true);
    // EYT-109 D1: die Regel liefert den FACHLICHEN Endtag. Bei einem
    // Nachfolger ab 01.07. endet der Vorgaenger am 30.06. — lueckenlos und
    // ueberlappungsfrei unter der einschliessenden Lesart von EYT-95. Der
    // gespeicherte DB-Wert bleibt `2026-07-01`; die Umrechnung macht der
    // Adapter (`validToZuDbEnde`). Gegenmutation: `dayBefore` weglassen -> rot.
    if (ergebnis.ok) expect(ergebnis.validToDesVorgaengers).toBe("2026-06-30");
  });

  it("schliesst lueckenlos an: der Tag NACH dem Endtag ist der Beginn des Nachfolgers", () => {
    // Die Eigenschaft, nicht der Einzelwert. Sie haelt ueber Monats-, Jahres-
    // und Schaltjahresraender, an denen eine Subtraktion auf der Tageszahl
    // falsch waere. Gegenmutation: `dayBefore` durch `tag - 1` ersetzen -> am
    // 2028-03-01 kaeme "2028-03-00" heraus, rot.
    for (const validFrom of ["2026-07-01", "2027-01-01", "2028-03-01", "2026-03-01"]) {
      const ergebnis = pruefeAbloesung({
        vorgaenger: VORGAENGER,
        nachfolger: { ...NACHFOLGER, validFrom },
        expectedActiveVersionId: VORGAENGER.id,
      });
      expect(ergebnis.ok, validFrom).toBe(true);
      if (!ergebnis.ok) continue;
      expect(alsText(dayAfter(tag(ergebnis.validToDesVorgaengers))), validFrom).toBe(validFrom);
      // Und der Endtag liegt WIRKLICH davor — ein `dayAfter` in beiden
      // Richtungen erfuellte die Zeile darueber ebenfalls.
      expect(ergebnis.validToDesVorgaengers < validFrom, validFrom).toBe(true);
    }
  });

  it("lehnt einen bereits geschlossenen Vorgaenger ab", () => {
    const geschlossen: RateVersion = { ...VORGAENGER, validTo: "2026-04-01" };
    const ergebnis = pruefeAbloesung({
      vorgaenger: geschlossen,
      nachfolger: NACHFOLGER,
      expectedActiveVersionId: geschlossen.id,
    });
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.problem).toBe("VORGAENGER_BEREITS_GESCHLOSSEN");
  });

  it.each([
    ["gleicher Tag", "2026-01-01"],
    ["frueherer Tag", "2025-12-31"],
  ])("lehnt einen Nachfolger ab, der nicht spaeter beginnt (%s)", (_fall, validFrom) => {
    const ergebnis = pruefeAbloesung({
      vorgaenger: VORGAENGER,
      nachfolger: { ...NACHFOLGER, validFrom },
      expectedActiveVersionId: VORGAENGER.id,
    });
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.problem).toBe("NACHFOLGER_NICHT_SPAETER");
  });

  it("lehnt einen Nachfolger fuer einen anderen Mitarbeiter ab", () => {
    const ergebnis = pruefeAbloesung({
      vorgaenger: VORGAENGER,
      nachfolger: { employeeId: "00000000-0000-4000-8000-0000000000e2", validFrom: "2026-07-01" },
      expectedActiveVersionId: VORGAENGER.id,
    });
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.problem).toBe("FREMDER_MITARBEITER");
  });

  it("lehnt eine veraltete Erwartung ab (STALE_VERSION)", () => {
    const ergebnis = pruefeAbloesung({
      vorgaenger: VORGAENGER,
      nachfolger: NACHFOLGER,
      expectedActiveVersionId: "00000000-0000-4000-8000-0000000000a9",
    });
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.problem).toBe("STALE_ACTIVE_VERSION");
  });

  it("prueft die Erwartung VOR dem Zustand des Vorgaengers", () => {
    // Diskriminierend, und deshalb eigens festgehalten: bei einem
    // geschlossenen Vorgaenger UND falscher Erwartung sind beide Regeln
    // verletzt. Die Antwort muss STALE_VERSION lauten, weil der Aufrufer dann
    // auf einer veralteten Ansicht arbeitet — "bereits geschlossen" wuerde ihn
    // glauben lassen, er kenne die richtige Version und sie sei nur zu spaet.
    const geschlossen: RateVersion = { ...VORGAENGER, validTo: "2026-04-01" };
    const ergebnis = pruefeAbloesung({
      vorgaenger: geschlossen,
      nachfolger: NACHFOLGER,
      expectedActiveVersionId: "00000000-0000-4000-8000-0000000000a9",
    });
    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.problem).toBe("STALE_ACTIVE_VERSION");
  });

  it("nennt genau die vereinbarten Ablehnungsgruende", () => {
    // Koppelt die Liste an den Vertrag. Ein neuer Grund ohne HTTP-Abbildung
    // waere sonst ein 500er statt eines RFC-7807-Problems.
    expect([...RATE_SUCCESSION_PROBLEMS]).toEqual([
      "STALE_ACTIVE_VERSION",
      "VORGAENGER_BEREITS_GESCHLOSSEN",
      "NACHFOLGER_NICHT_SPAETER",
      "FREMDER_MITARBEITER",
    ]);
  });
});
