/**
 * Die elf Klassen der geteilten Bausteine haben eine Regel (EYT-80).
 *
 * Bewacht werden zwei Bausteine aus `@easytree/ui`: der Rahmen `AppShell`
 * (sechs Klassen) und die Bedienleiste `DateRangeControl` (fuenf Klassen mit
 * Regel, siehe unten).
 *
 * Ohne diese Zusicherung ist die Umbenennung in `globals.css` ungedeckt: kein
 * Test und kein e2e-Nachweis nennt einen Klassennamen, und jede der elf
 * Regeln koennte beim Umbenennen verlorengehen, ohne dass einer der elf
 * Pflichtjobs rot wird. Der teuerste Einzelfall waere
 * `.eyt-app-shell__skip-link` — ohne `position: absolute; top: -100%` stuende
 * der Sprunganker dauerhaft sichtbar auf jeder Seite, und alle bestehenden
 * Sprunganker-Zusicherungen pruefen Existenz, Reihenfolge und Fokus, nie
 * Sichtbarkeit. Bei der Bedienleiste ist es `.eyt-date-range__action`: ohne
 * `min-height: 2.5rem` faellt jedes Bedienelement der Wochennavigation unter
 * das 40-px-Beruehrziel (Basisdesign v2.0 §2.3). DIESE eine Regel ist
 * zusaetzlich im echten Browser vermessen — „Wochenwechsel erreicht das
 * 40-px-Beruehrziel" in `apps/web/e2e/shell-smoke.spec.ts`; die anderen zehn
 * sind es nicht.
 *
 * Diese Datei deckt AUSSCHLIESSLICH die Stylesheet-Seite der Kopplung ab: dass
 * `globals.css` zu jedem Namen eine Regel traegt. Dass die Pakete diese Namen
 * ueberhaupt AUSGEBEN — die Emitter-Seite — halten der Fall „gibt alle sechs
 * Klassennamen des Rahmens aus" in `packages/ui/test/app-shell.test.tsx` und
 * „gibt alle sieben Klassennamen des Bedienbereichs aus" in
 * `packages/ui/test/date-range-control.test.tsx`; eine Umbenennung dort laesst
 * jede Regel hier unberuehrt stehen und faellt hier nicht auf. Beide
 * Gegenmutationen sind fuer die Bedienleiste ausgefuehrt worden (27.08.2026)
 * und machen je genau EINE der beiden Haelften rot.
 *
 * Bewusst auf diese elf eingegrenzt: die allgemeine Fassung „jede von
 * packages/ui emittierte Klasse hat eine Regel" waere HEUTE rot und braeuchte
 * zuerst eine begruendete Ausnahmeliste. Gemessen 27.08.2026: von 31
 * emittierten `eyt-`-Klassen haben 10 keine Regel — darunter die beiden
 * uebrigen des Bedienbereichs, `.eyt-date-range__range-text` und
 * `.eyt-date-range__range-key`. Beide sind hier ABSICHTLICH nicht gelistet:
 * sie hatten unter ihren Vorgaengernamen (`.wochennavigation__woche-text`,
 * `.wochennavigation__woche-schluessel`) ebenfalls nie eine Regel, und der
 * Schluessel wird ohnehin von `VisuallyHidden` per Inline-Stil versteckt, nicht
 * vom Stylesheet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Nicht ueber `import.meta.url`: unter vitest/jsdom traegt das kein
// file://-Schema und `fileURLToPath` wirft. `process.cwd()` ist apps/web.
const rohCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/*
 * Kommentare fallen VOR jeder Suche weg. Sonst genuegte ein Klassenname, der
 * nur noch in einem CSS-Kommentar steht — etwa als Notiz „frueher
 * .eyt-app-shell__footer" ueber der geloeschten Regel —, um jede Zusicherung
 * unten zu erfuellen. Die Regel waere fort und der Waechter bliebe gruen.
 */
const css = rohCss.replace(/\/\*[\s\S]*?\*\//g, "");

const KLASSEN = [
  "eyt-app-shell__skip-link",
  "eyt-app-shell__header",
  "eyt-app-shell__brand",
  "eyt-app-shell__session",
  "eyt-app-shell__main",
  "eyt-app-shell__footer",
  "eyt-date-range",
  "eyt-date-range__range",
  "eyt-date-range__detail",
  "eyt-date-range__marker",
  "eyt-date-range__action",
] as const;

/**
 * Eine echte Regel, kein Praefix.
 *
 * `expect(css).toContain(".eyt-app-shell__brand")` war von einem Stylesheet
 * erfuellt, das nur `.eyt-app-shell__brandX { color: red }` enthielt (gemessen
 * 27.08.2026) — fuer die echte Klasse existierte keine einzige Regel. Eine
 * VERLAENGERNDE Umbenennung ist genau die Handbewegung, die hier auffallen
 * soll, und der Teilstringvergleich war dagegen blind.
 *
 * Verlangt wird deshalb: der Name, danach kein Namenszeichen mehr
 * (`(?![\w-])`), und dann das, was einen Selektor wirklich beendet — ein Komma
 * oder die oeffnende Klammer. `.eyt-app-shell__skip-link:focus` erfuellt das
 * absichtlich NICHT: eine Pseudoklassenregel allein ist kein Ersatz fuer die
 * Grundregel.
 */
function regelFuer(klasse: string): RegExp {
  return new RegExp(`\\.${klasse}(?![\\w-])\\s*[,{]`);
}

/** Selektorrest und Rumpf jedes Blocks, der diese Klasse nennt — in Dateireihenfolge. */
function bloeckeFuer(klasse: string): { selektorRest: string; rumpf: string }[] {
  const muster = new RegExp(`\\.${klasse}(?![\\w-])([^{]*)\\{([^}]*)\\}`, "g");
  return [...css.matchAll(muster)].map((treffer) => ({
    selektorRest: treffer[1] ?? "",
    rumpf: treffer[2] ?? "",
  }));
}

/**
 * Der zuletzt deklarierte Wert einer Eigenschaft ueber alle uebergebenen
 * Bloecke hinweg — denn bei gleicher Spezifitaet gewinnt im Browser die
 * SPAETERE Deklaration, nicht die erste.
 *
 * Die Lookbehind-Grenze ist noetig, weil `top:` sonst auch in `border-top:`
 * steckt und die Trennlinie der Fusszeile als Lageangabe gelesen wuerde.
 */
function letzterWert(bloecke: { rumpf: string }[], eigenschaft: string): string {
  const rumpf = bloecke.map((block) => block.rumpf).join("\n");
  const treffer = [...rumpf.matchAll(new RegExp(`(?<![\\w-])${eigenschaft}:\\s*([^;\\n}]+)`, "g"))];
  return (treffer[treffer.length - 1]?.[1] ?? "").trim();
}

describe("EYT-80 — die geteilten Bausteine sind gestaltet", () => {
  it("liest ueberhaupt eine Stylesheet-Datei", () => {
    /*
     * Was diese Zeile NICHT faengt: einen falschen Pfad. `readFileSync` wirft
     * darauf `ENOENT` (nachgemessen 27.08.2026), und weil der Lesevorgang auf
     * Modulebene steht, scheitert die Datei schon beim Einsammeln — lauter,
     * als eine Zusicherung es koennte.
     *
     * Was sie faengt, ist der leise Fall: ein Pfad, der auf eine ECHTE, aber
     * falsche oder abgeschnittene Datei zeigt — ein verschobenes Stylesheet,
     * ein leerer Platzhalter, ein halb geschriebener Build. Dann faende jede
     * Zusicherung darunter „kein Treffer" und meldete einen Regelverlust, wo
     * in Wahrheit die falsche Datei gelesen wurde.
     */
    expect(css.length).toBeGreaterThan(1000);
  });

  it.each(KLASSEN)("hat eine Regel fuer .%s", (klasse) => {
    expect(regelFuer(klasse).test(css), `keine Regel fuer .${klasse}`).toBe(true);
  });

  it("versteckt den Sprunganker, bis er den Fokus hat", () => {
    /*
     * ALLE Bloecke, nicht der erste. Die fruehere Fassung las
     * `/\.eyt-app-shell__skip-link\s*\{[^}]*\}/.exec(css)?.[0]` — den ERSTEN
     * Treffer. Ein ans Dateiende angehaengter Block
     * `.eyt-app-shell__skip-link { position: static; top: auto }` liess diese
     * Suite bei `8 passed (8)` und machte `shell-smoke` im Browser rot mit
     * `bottom=40` (gemessen 27.08.2026). Konstruiert ist das nicht:
     * `globals.css` traegt fuer `.eyt-app-shell__header` selbst zwei Bloecke,
     * der zweite ergaenzt den ersten. Ein spaeterer Block ist die Idiomatik
     * dieser Datei.
     *
     * GESCHLOSSEN ist damit: ein zweiter Block ohne Pseudoklasse (die
     * gemessene Mutation), ein spaeterer `:focus`-Block, der `top` wieder aus
     * dem Bild schiebt, und ein Name, der nur noch im Kommentar steht.
     *
     * NICHT geschlossen ist: eine Regel unter einem FREMDEN Selektor, die die
     * Klasse gar nicht nennt (`header > a:first-child { position: static }`),
     * Spezifitaet und `!important` — verglichen wird reine Dateireihenfolge —
     * und ein `@media`-Kontext, in dem ein Block nur manchmal gilt. Gegen all
     * das steht die Messung im echten Browser: `shell-smoke` prueft die LAGE
     * des Ankers, nicht seine Schreibweise.
     */
    const bloecke = bloeckeFuer("eyt-app-shell__skip-link");
    const grund = bloecke.filter((block) => !block.selektorRest.includes(":"));
    const fokus = bloecke.filter((block) => block.selektorRest.includes(":"));

    expect(grund, `Bloecke ohne Pseudoklasse: ${grund.length}`).toHaveLength(1);
    expect(grund[0]?.rumpf).toContain("position: absolute");
    expect(letzterWert(grund, "top"), "top im Grundzustand").toMatch(/^-/);

    expect(fokus.length, "Bloecke mit Pseudoklasse").toBeGreaterThan(0);
    expect(letzterWert(fokus, "top"), "top im Fokus").toMatch(/^0/);
  });
});
