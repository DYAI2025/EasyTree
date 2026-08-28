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

  describe("fuehrt ausser den beiden Fokusfarben keine eigene Farbquelle mehr", () => {
    /*
     * `--color-focus` ist bewusst KEINE §2.1-Rolle: die Baseline kennt keine
     * Fokusfarbe, sie fordert nur 3:1 zur angrenzenden Flaeche (EYT-12). Sie
     * bleibt darum anwendungseigen — aber sie ist die EINZIGE Ausnahme.
     *
     * Der Vertrag lautet „keine eigene Palette", nicht „kein Hex": ein reines
     * Hex-Muster liess rgb(), hsl(), oklch() und Farbnamen durch (PO-Review
     * PR #96). Drei Schichten schliessen das, ohne eine handgepflegte Liste
     * aller ~148 CSS-Farbnamen: (1) Hex-Literale bleiben exakt die zwei
     * Fokusfarben; (2) die geschlossene Menge der CSS-Farbfunktionen darf
     * nicht vorkommen; (3) jedes nackte Wort aus einem Deklarationswert wird
     * dem CSS-Parser von jsdom als `color` angeboten — nimmt er es an, ist es
     * ein Farbwort. `var(--…)` zerfaellt beim Zerlegen in „var" und den
     * Tokennamen, beides keine Farbwoerter; ein Farbname im var()-Fallback
     * bleibt dadurch sichtbar.
     */
    const deklarationswerte = [...css.matchAll(/[{;]\s*[-\w]+\s*:\s*([^;{}]+)/g)].map((t) =>
      (t[1] ?? "").trim(),
    );

    it("liest ueberhaupt Deklarationswerte — sonst waeren die Schichten leer und trivial gruen", () => {
      expect(deklarationswerte.length).toBeGreaterThan(50);
    });

    it("Hex-Literale: exakt die zwei Fokusfarben", () => {
      const literale = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((t) => t[0].toLowerCase());
      expect([...new Set(literale)].sort()).toEqual(["#1d4ed8", "#7cc1db"]);
    });

    it("keine funktionale Farbnotation (rgb, hsl, oklch, color-mix, …)", () => {
      const farbfunktionen = deklarationswerte.flatMap((wert) =>
        [
          ...wert.matchAll(
            /(?:^|[^\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color|light-dark|device-cmyk)\s*\(/g,
          ),
        ].map((t) => `${t[1] ?? ""}(…) in "${wert.slice(0, 60)}"`),
      );
      expect(farbfunktionen).toEqual([]);
    });

    it("kein CSS-Farbname in einem Deklarationswert", () => {
      /*
       * CSS-weite Schluesselwoerter und die zwei neutralen Farbwoerter sind
       * keine eigene Palette — sie verweisen auf die Kaskade, nicht auf einen
       * Farbwert.
       */
      const neutral = new Set([
        "transparent",
        "currentcolor",
        "inherit",
        "initial",
        "unset",
        "revert",
      ]);
      const sonde = document.createElement("span");
      const istFarbwort = (wort: string): boolean => {
        sonde.style.color = "";
        sonde.style.color = wort;
        return sonde.style.color !== "";
      };
      // Die Sonde erkennt Farben — sonst misst der Filter darunter nichts.
      expect(istFarbwort("tomato")).toBe(true);
      expect(istFarbwort("solid")).toBe(false);

      const farbwoerter = [
        ...new Set(
          deklarationswerte
            .flatMap((wert) => wert.split(/[\s,()/"']+/))
            .filter((token) => /^[a-zA-Z]+$/.test(token))
            .map((token) => token.toLowerCase()),
        ),
      ].filter((wort) => !neutral.has(wort) && istFarbwort(wort));
      expect(farbwoerter, `Farbnamen in Deklarationswerten: ${farbwoerter.join(", ")}`).toEqual([]);
    });
  });
});
