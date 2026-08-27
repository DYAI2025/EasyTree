/**
 * `apps/web` FUEHRT keine eigene Palette mehr (EYT-80 Inkrement 2).
 *
 * Zwei Haelften, beide noetig:
 *   1. `globals.css` bindet die kanonische Datei aus `@easytree/ui` ein — und
 *      zwar als ERSTE Anweisung, weil `@import` in CSS nur vor jeder Regel
 *      gilt und ein spaeteres schweigend ignoriert wird.
 *   2. `globals.css` DEKLARIERT keine `--eyt-*`-Rolle mehr. Verwendungen
 *      (`var(--eyt-…)`) bleiben ausdruecklich erlaubt und sind der Normalfall
 *      — geprueft wird die linke Seite eines Doppelpunkts, nicht das Wort.
 *
 * Die dritte Haelfte — dass die Werte im GEBAUTEN Browser wirklich ankommen —
 * kann eine Datei-Lesung nicht leisten und steht in
 * `apps/web/e2e/shell-smoke.spec.ts`.
 *
 * Nicht ueber `import.meta.url`: unter vitest/jsdom kein file://-Schema.
 * `process.cwd()` ist apps/web.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const rohCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const css = rohCss.replace(/\/\*[\s\S]*?\*\//g, "");

describe("Basisdesign-Tokens kommen aus @easytree/ui (EYT-80)", () => {
  it("bindet die kanonische Tokendatei als erste Anweisung ein", () => {
    const ersteAnweisung = css.trim().split(";")[0]?.trim();
    expect(ersteAnweisung).toBe('@import "@easytree/ui/basisdesign-v2.css"');
  });

  it("deklariert selbst keine einzige --eyt-Rolle mehr", () => {
    const eigene = [...css.matchAll(/(?:^|[;{])\s*(--eyt-[\w-]+)\s*:/g)].map((t) => t[1]);
    expect(eigene, `eigene Tokendeklarationen: ${eigene.join(", ")}`).toEqual([]);
  });

  it("benutzt die Rollen weiterhin — sonst waere die Abwesenheit oben trivial", () => {
    /*
     * Ohne diesen Fall waere ein `globals.css` ohne JEDE Farbe gruen: keine
     * Deklaration, kein Befund. Die Zahl ist bewusst grosszuegig; sie soll den
     * Totalverlust fangen, nicht jede Umbenennung. Gemessen 27.08.2026: 58
     * Verwendungen.
     */
    const verwendungen = [...css.matchAll(/var\(\s*--eyt-[\w-]+/g)];
    expect(verwendungen.length).toBeGreaterThan(20);
  });

  it("fuehrt ausser den beiden Fokusfarben kein Farbliteral mehr", () => {
    /*
     * `--color-focus` ist bewusst KEINE §2.1-Rolle: die Baseline kennt keine
     * Fokusfarbe, sie fordert nur 3:1 zur angrenzenden Flaeche (EYT-12). Sie
     * bleibt darum anwendungseigen — aber sie ist die EINZIGE Ausnahme, und
     * dieser Fall haelt die Liste kurz.
     */
    const literale = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((t) => t[0].toLowerCase());
    expect([...new Set(literale)].sort()).toEqual(["#1d4ed8", "#7cc1db"]);
  });
});
