/**
 * Die EINE fachliche Satzauswahl und der Anzeigezustand (EYT-108, EYT-109 D1).
 *
 * ## Warum es diese Datei erst jetzt gibt
 *
 * Gemessen am 15.08.2026: `effectiveRateVersion` und `rateVersionStatus`
 * hatten bis EYT-109 D1 KEINEN Unit-Test — beide Namen erschienen unter
 * `apps/api/test/` ausschliesslich in `snapshot-immutability.integration.test.ts`,
 * die nur mit laufender Datenbank laeuft. Die Funktion, deren Semantik D1
 * umlegt, waere sonst allein im CI-Job `db-gates` abgesichert gewesen.
 *
 * ## Was hier gemessen wird
 *
 * Genau die Grenzfaelle, an denen alte (halboffene) und neue (einschliessende)
 * Lesart auseinandergehen. Alle `validTo` unten sind FACHLICHE Werte: der
 * letzte wirksame Tag. Was in der Datenbank steht, geht dieser Datei nichts an.
 */
import { describe, expect, it } from "vitest";

import { effectiveRateVersion, rateVersionStatus } from "../../src/modules/costs";
import type { RateVersion } from "../../src/modules/costs";

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ID_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function satz(teil: Partial<RateVersion> & Pick<RateVersion, "id">): RateVersion {
  return {
    employeeId: "22222222-2222-4222-8222-222222222222",
    amountMinorUnits: "2500",
    currency: "EUR",
    validFrom: "2026-01-01",
    validTo: null,
    predecessorId: null,
    reason: "Fixtur",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "66666666-6666-4666-8666-666666666666",
    ...teil,
  };
}

/** Fachlich: A [2026-06-01, 2026-06-30], B [2026-07-01, offen]. */
const A = satz({ id: ID_A, validFrom: "2026-06-01", validTo: "2026-06-30" });
const B = satz({ id: ID_B, validFrom: "2026-07-01", validTo: null, amountMinorUnits: "3000" });

describe("effectiveRateVersion — die eine Auswahl (EYT-109 D1)", () => {
  it("waehlt am LETZTEN wirksamen Tag noch den Vorgaenger", () => {
    // Gegenmutation: das alte `businessDate < validTo` zurueckholen ->
    // RATE_NOT_FOUND am 30.06., rot.
    const e = effectiveRateVersion([A, B], "2026-06-30");
    expect(e.ok && e.version.id).toBe(ID_A);
  });

  it("waehlt am Nahtstellentag den Nachfolger", () => {
    // Gegenmutation: `A.validTo` auf `"2026-07-01"` setzen (= der alte DB-Wert)
    // -> beide decken den 01.07. -> RATE_AMBIGUOUS, rot. Das ist genau der
    // Widerspruch, den D1 beschreibt.
    const e = effectiveRateVersion([A, B], "2026-07-01");
    expect(e.ok && e.version.id).toBe(ID_B);
  });

  it("liefert die gepruefte Version mit — und zwar dieselbe", () => {
    // Ohne `checked` muesste die Montage ein zweites Mal konvertieren, und
    // eine zweite Konvertierung ist eine zweite Gelegenheit fuer den
    // Ein-Tages-Fehler. Gegenmutation: `checked` aus der Bruecke entfernen ->
    // die Montage kompiliert nicht mehr.
    const e = effectiveRateVersion([A, B], "2026-06-30");
    expect(e.ok && e.checked.rateVersionId).toBe(ID_A);
    // EINSCHLIESSEND, ohne zweite Umrechnung: der geprueften Version steht
    // derselbe letzte Tag, den der Record traegt.
    expect(e.ok && e.checked.validTo).toEqual({ year: 2026, month: 6, day: 30 });
    expect(e.ok && e.checked.validFrom).toEqual({ year: 2026, month: 6, day: 1 });
  });

  it("die unbegrenzte Version bleibt unbegrenzt", () => {
    // Gegenmutation: `null` in der Bruecke auf ein Datum abbilden -> rot.
    const e = effectiveRateVersion([A, B], "2027-12-31");
    expect(e.ok && e.version.id).toBe(ID_B);
    expect(e.ok && e.checked.validTo).toBeNull();
  });

  it("blockiert statt zu waehlen — RATE_NOT_FOUND und RATE_AMBIGUOUS", () => {
    // Gegenmutation: auf `versions.find(...)` umstellen -> der ueberlappende
    // Fall liefert klaglos den erstbesten, rot.
    expect(effectiveRateVersion([A, B], "2026-05-31")).toEqual({
      ok: false,
      problem: "RATE_NOT_FOUND",
    });
    const ueberlappend = satz({ id: ID_C, validFrom: "2026-06-15", validTo: null });
    expect(effectiveRateVersion([A, ueberlappend], "2026-06-20")).toEqual({
      ok: false,
      problem: "RATE_AMBIGUOUS",
    });
  });

  it("nennt eine unbrauchbare Nachbarzeile RATE_INVALID, statt sie zu ignorieren", () => {
    // Die bewusste Ausweitung aus Risiko R8, ausdruecklich festgehalten: seit
    // D1 laufen ALLE Zeilen durch die Domaenenfactory, nicht nur die gewaehlte.
    // Gegenmutation: den `RATE_INVALID`-Zweig auf `continue` aendern -> die
    // kaputte Zeile verschwaende still und Mehrdeutigkeit bliebe unentdeckt.
    const kaputt = satz({ id: ID_D, validFrom: "2026-08-01", validTo: "2026-07-01" });
    expect(effectiveRateVersion([A, kaputt], "2026-06-30")).toEqual({
      ok: false,
      problem: "RATE_INVALID",
    });
  });

  it("nennt einen negativen Betrag RATE_INVALID, statt ihn zu bepreisen", () => {
    // Der zweite Weg in denselben Zweig — ueber `hourlyRateAmount`. Ohne
    // diesen Fall bewiese der Test nur den Intervallpfad.
    const negativ = satz({ id: ID_D, amountMinorUnits: "-1", validFrom: "2026-06-01" });
    expect(effectiveRateVersion([negativ], "2026-06-30")).toEqual({
      ok: false,
      problem: "RATE_INVALID",
    });
  });

  it("meldet auf einem leeren Katalog RATE_NOT_FOUND und nicht 0,00 EUR", () => {
    expect(effectiveRateVersion([], "2026-06-30")).toEqual({
      ok: false,
      problem: "RATE_NOT_FOUND",
    });
  });
});

describe("rateVersionStatus — einschliessend (EYT-109 D1)", () => {
  it("ist am letzten Gueltigkeitstag noch `aktiv`", () => {
    // Gegenmutation: `<` zurueck auf `<=` -> "abgelaufen" am 30.06., rot.
    // Das ist Risiko R2: die Anzeige waere wieder um einen Tag daneben, nur
    // andersherum als vor D1.
    expect(rateVersionStatus(A, "2026-06-30")).toBe("aktiv");
    expect(rateVersionStatus(A, "2026-07-01")).toBe("abgelaufen");
    expect(rateVersionStatus(A, "2026-06-01")).toBe("aktiv");
    expect(rateVersionStatus(A, "2026-05-31")).toBe("kommend");
    expect(rateVersionStatus(B, "2026-06-30")).toBe("kommend");
    expect(rateVersionStatus(B, "2026-07-01")).toBe("aktiv");
  });

  it("laesst die unbegrenzte Version nie ablaufen", () => {
    expect(rateVersionStatus(B, "2999-12-31")).toBe("aktiv");
  });

  it("ein Ein-Tages-Satz ist an genau diesem Tag aktiv", () => {
    // EYT-95 erlaubt `validTo === validFrom`. Unter der alten `<=`-Regel waere
    // ein solcher Satz an keinem einzigen Tag aktiv gewesen.
    const einTag = satz({ id: ID_C, validFrom: "2026-06-01", validTo: "2026-06-01" });
    expect(rateVersionStatus(einTag, "2026-05-31")).toBe("kommend");
    expect(rateVersionStatus(einTag, "2026-06-01")).toBe("aktiv");
    expect(rateVersionStatus(einTag, "2026-06-02")).toBe("abgelaufen");
    // Und die Auswahl findet ihn auch.
    expect(effectiveRateVersion([einTag], "2026-06-01").ok).toBe(true);
  });
});
