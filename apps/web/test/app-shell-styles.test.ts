/**
 * Die sechs Klassen des geteilten Rahmens haben eine Regel (EYT-80).
 *
 * Ohne diese Zusicherung ist die Umbenennung in `globals.css` ungedeckt: kein
 * Test und kein e2e-Nachweis nennt einen Klassennamen, und jede der sechs
 * Regeln koennte beim Umbenennen verlorengehen, ohne dass einer der elf
 * Pflichtjobs rot wird. Der teuerste Einzelfall waere
 * `.eyt-app-shell__skip-link` — ohne `position: absolute; top: -100%` stuende
 * der Sprunganker dauerhaft sichtbar auf jeder Seite, und alle bestehenden
 * Sprunganker-Zusicherungen pruefen Existenz, Reihenfolge und Fokus, nie
 * Sichtbarkeit.
 *
 * Bewusst auf diese sechs eingegrenzt: die allgemeine Fassung „jede von
 * packages/ui emittierte Klasse hat eine Regel" waere HEUTE rot (acht Klassen
 * ohne Regel, gemessen 27.08.2026) und braeuchte zuerst eine begruendete
 * Ausnahmeliste.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Nicht ueber `import.meta.url`: unter vitest/jsdom traegt das kein
// file://-Schema und `fileURLToPath` wirft. `process.cwd()` ist apps/web.
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

const KLASSEN = [
  "eyt-app-shell__skip-link",
  "eyt-app-shell__header",
  "eyt-app-shell__brand",
  "eyt-app-shell__session",
  "eyt-app-shell__main",
  "eyt-app-shell__footer",
] as const;

describe("EYT-80 — der geteilte Rahmen ist gestaltet", () => {
  it("liest ueberhaupt eine Stylesheet-Datei", () => {
    // Ohne diese Zeile waere ein falscher Pfad ein leerer String, und jede
    // Zusicherung darunter fiele auf „kein Treffer" statt auf „nicht gelesen".
    expect(css.length).toBeGreaterThan(1000);
  });

  it.each(KLASSEN)("hat eine Regel fuer .%s", (klasse) => {
    expect(css).toContain(`.${klasse}`);
  });

  it("versteckt den Sprunganker, bis er den Fokus hat", () => {
    // Die eine Regel, deren Verlust sichtbar waere und die kein anderer
    // Waechter sieht. Geprueft wird der Mechanismus, nicht der Zahlenwert.
    const block = /\.eyt-app-shell__skip-link\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(block).toContain("position: absolute");
    expect(block).toMatch(/top:\s*-/);
    expect(css).toMatch(/\.eyt-app-shell__skip-link:focus[^{]*\{[^}]*top:\s*0/);
  });
});
