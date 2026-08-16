/**
 * Die EINE Naht zwischen halboffener Datenbank und einschliessender Fachwelt
 * (EYT-109 D1).
 *
 * Oberhalb dieser Naht bedeutet `validTo` ueberall dasselbe: den LETZTEN
 * wirksamen Tag (EYT-95, Jira-Kommentar 11425). Darunter fuehrt PostgreSQL
 * unveraendert `[valid_from, valid_to)` (Migration 0013).
 *
 * Der Import laeuft ueber die oeffentliche Modul-API und nicht ueber einen
 * tiefen Pfad nach `infrastructure/`: der Waechter
 * `costs-cross-module-public-api-only` faellt sonst rot, auch aus Tests.
 */
import { describe, expect, it } from "vitest";

import { dbEndeZuValidTo, validToZuDbEnde } from "../../src/modules/costs";

describe("rate-interval-boundary — die eine Umrechnung (EYT-109 D1)", () => {
  it("liest das exklusive DB-Ende als letzten wirksamen Tag", () => {
    // Gegenmutation: `dbEndeZuValidTo` die Eingabe durchreichen lassen -> rot.
    expect(dbEndeZuValidTo("2026-07-01")).toBe("2026-06-30");
    // Jahresrand: eine Subtraktion auf der Tageszahl ergaebe den "0. Januar".
    expect(dbEndeZuValidTo("2026-01-01")).toBe("2025-12-31");
    // Schaltjahr: nur ein echter Kalenderschritt kennt den 29.02.2028.
    expect(dbEndeZuValidTo("2028-03-01")).toBe("2028-02-29");
    // Gemeinjahr — dieselbe Stelle, anderes Ergebnis. Ohne beide Faelle waere
    // eine fest verdrahtete "28" oder "29" nicht zu unterscheiden.
    expect(dbEndeZuValidTo("2026-03-01")).toBe("2026-02-28");
  });

  it("schreibt den letzten wirksamen Tag als exklusives DB-Ende", () => {
    // Gegenmutation: `validToZuDbEnde` die Eingabe durchreichen lassen -> rot.
    expect(validToZuDbEnde("2026-06-30")).toBe("2026-07-01");
    expect(validToZuDbEnde("2025-12-31")).toBe("2026-01-01");
    expect(validToZuDbEnde("2028-02-29")).toBe("2028-03-01");
    expect(validToZuDbEnde("2026-02-28")).toBe("2026-03-01");
  });

  it("laesst `null` in beide Richtungen `null`", () => {
    // Gegenmutation: `null` auf ein Datum abbilden -> rot. Ohne diesen Fall
    // koennte die unbegrenzte Version still ein Ende bekommen — und genau die
    // eine Zeile, die heute in Produktion steht, traegt `valid_to = NULL`.
    expect(dbEndeZuValidTo(null)).toBeNull();
    expect(validToZuDbEnde(null)).toBeNull();
  });

  it("ist in beide Richtungen verlustfrei — ueber Monat, Jahr und Schaltjahr", () => {
    // Gegenmutation: eine der beiden Richtungen auf `dayAfter` umstellen -> rot.
    for (const tag of [
      "2026-06-30",
      "2026-12-31",
      "2028-02-29",
      "2026-02-28",
      "2026-01-01",
      "2027-02-28",
    ]) {
      expect(dbEndeZuValidTo(validToZuDbEnde(tag))).toBe(tag);
      expect(validToZuDbEnde(dbEndeZuValidTo(tag))).toBe(tag);
    }
  });

  it("ein Ein-Tages-Satz ist ausdrueckbar und verletzt den DB-Check nicht", () => {
    // EYT-95 erlaubt `validTo === validFrom` (`rate-version.ts:135`), Migration
    // 0013 verlangt `valid_to > valid_from`. Beides gilt nur zusammen, wenn
    // hier ein Kalenderschritt vorwaerts steht. Gegenmutation: Identitaet ->
    // `validToZuDbEnde` liefert den Starttag, der DB-Check schluege zu, und
    // dieser Test wird rot.
    expect(validToZuDbEnde("2026-06-01")).toBe("2026-06-02");
  });

  it("rechnet niemals ueber `Date` — der Monatsrand beweist es", () => {
    // Eine Millisekundensubtraktion auf einem `Date` traefe an einer
    // Sommerzeitgrenze den falschen Kalendertag. Der 29.03.2026 ist in
    // Europe/Berlin der Umstellungstag; ein Kalenderschritt kennt keine Zonen
    // und liefert hier dasselbe wie ueberall.
    expect(dbEndeZuValidTo("2026-03-30")).toBe("2026-03-29");
    expect(validToZuDbEnde("2026-03-29")).toBe("2026-03-30");
  });
});
