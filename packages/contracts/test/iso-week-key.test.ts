/**
 * ISO-Wochenschluessel: jahresabhaengige Gueltigkeit (EYT-88).
 *
 * ## Der Befund
 *
 * `PlanningWindowQuerySchema` erzwingt heute `^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$`.
 * Das haelt `W00`, `W54` und `W99` draussen — aber es laesst `W53` in JEDEM
 * Jahr durch. Die meisten Jahre haben nur 52 ISO-Wochen; `2025-W53` bezeichnet
 * keine reale Woche und darf nicht in `plan_versions` landen.
 *
 * Der Dateikopf von `planning/schemas.ts` haelt das ausdruecklich fest:
 * "Jahrabhaengig ungueltige 53. Wochen bleiben erlaubt: dafuer braeuchte es
 * eine Kalenderrechnung, und die gibt es hier bewusst nicht." Diese Datei ist
 * der Anfang davon.
 *
 * ## Welche Jahre 53 Wochen haben
 *
 * Ein ISO-Jahr hat genau dann 53 Wochen, wenn der 1. Januar ein Donnerstag ist
 * ODER es ein Schaltjahr ist und der 1. Januar ein Mittwoch. Beides folgt aus
 * der Donnerstagsregel: Woche 1 ist die Woche, die den ersten Donnerstag des
 * Jahres enthaelt.
 *
 *   2020  1. Januar Mittwoch, Schaltjahr   -> 53
 *   2021  1. Januar Freitag                -> 52
 *   2025  1. Januar Mittwoch, kein Schaltjahr -> 52
 *   2026  1. Januar Donnerstag             -> 53
 *
 * Diese vier sind die Testvektoren, die auch die SQL-Seite verwenden wird.
 *
 * ## Zustand dieser Datei
 *
 * Geschrieben VOR der Implementierung. Die mit `ROT VOR DER UMSETZUNG`
 * markierten Faelle muessen jetzt fehlschlagen; taeten sie es nicht, waere der
 * Befund keiner und die Aufgabe erledigt.
 */
import { describe, expect, it } from "vitest";

import { PlanningWindowQuerySchema } from "../src/planning/schemas.js";

/** Jahre mit 53 ISO-Wochen. Dieselben Vektoren gelten spaeter fuer SQL. */
const JAHRE_MIT_53 = [2020, 2026] as const;
/** Jahre mit 52 ISO-Wochen — hier ist `W53` ungueltig. */
const JAHRE_MIT_52 = [2021, 2025] as const;

function nimmtAn(weekKey: string): boolean {
  return PlanningWindowQuerySchema.safeParse({ weekKey }).success;
}

describe("Wochenschluessel: was heute schon stimmt", () => {
  it("lehnt W00, W54 und W99 ab", () => {
    for (const schluessel of ["2026-W00", "2026-W54", "2026-W99"]) {
      expect(nimmtAn(schluessel), `${schluessel} wurde angenommen`).toBe(false);
    }
  });

  it("nimmt regulaere Wochen an", () => {
    for (const schluessel of ["2026-W01", "2026-W32", "2026-W52", "2021-W52"]) {
      expect(nimmtAn(schluessel), `${schluessel} wurde abgelehnt`).toBe(true);
    }
  });

  it("lehnt formfremde Werte ab", () => {
    for (const schluessel of ["2026W32", "26-W32", "2026-32", "2026-w32", "", "2026-W3"]) {
      expect(nimmtAn(schluessel), `${schluessel} wurde angenommen`).toBe(false);
    }
  });
});

describe("Wochenschluessel: jahresabhaengige 53. Woche", () => {
  it("nimmt W53 in Jahren mit 53 ISO-Wochen an", () => {
    for (const jahr of JAHRE_MIT_53) {
      expect(nimmtAn(`${jahr}-W53`), `${jahr}-W53 wurde abgelehnt`).toBe(true);
    }
  });

  it("ROT VOR DER UMSETZUNG: lehnt W53 in Jahren mit nur 52 ISO-Wochen ab", () => {
    // Der Kern von EYT-88. Heute nimmt das Muster jede 53 an, weil es keine
    // Kalenderrechnung kennt — der Test muss deshalb jetzt fehlschlagen.
    for (const jahr of JAHRE_MIT_52) {
      expect(nimmtAn(`${jahr}-W53`), `${jahr}-W53 wurde angenommen, hat aber nur 52 Wochen`).toBe(
        false,
      );
    }
  });
});
