/**
 * Das Basisdesign v2.0 §2.1 gehoert diesem Paket (EYT-80, EYT-12).
 *
 * Gelesen wird GENAU die Datei, die auch die Anwendung einbindet —
 * `src/basisdesign-v2.css`. Eine zweite Liste von Werten daneben waere
 * wieder die Doppelpflege, die dieses Inkrement abschafft: die Erwartung
 * unten ist die SPEZIFIKATION aus Confluence 8814623, die Quelle ist die
 * CSS-Datei, und der Test vergleicht beide.
 *
 * Nicht ueber `import.meta.url`: unter vitest/jsdom traegt das kein
 * file://-Schema und `fileURLToPath` wirft. `process.cwd()` ist packages/ui.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SCHWELLE_NORMALTEXT, kontrast } from "./helpers/kontrast.js";

const rohCss = readFileSync(join(process.cwd(), "src/basisdesign-v2.css"), "utf8");

/*
 * Kommentare fallen vor jeder Suche weg — sonst genuegte ein auskommentierter
 * Wert, um jede Zusicherung unten zu erfuellen, waehrend die Regel fort ist.
 */
const css = rohCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** Deklarationen (`--eyt-x: #abc`), NICHT Verwendungen (`var(--eyt-x)`). */
function deklarationen(abschnitt: string): Map<string, string> {
  const gefunden = new Map<string, string>();
  for (const treffer of abschnitt.matchAll(/(?:^|[;{])\s*(--eyt-[\w-]+)\s*:\s*([^;}]+)/g)) {
    gefunden.set(treffer[1] ?? "", (treffer[2] ?? "").trim().toLowerCase());
  }
  return gefunden;
}

const grenze = css.indexOf("@media");
const HELL = deklarationen(grenze >= 0 ? css.slice(0, grenze) : css);
const DUNKEL = deklarationen(grenze >= 0 ? css.slice(grenze) : "");

/**
 * Confluence 8814623 §2.1 — die dreizehn genehmigten Rollen.
 * Diese Tabelle ist die Spezifikation und darf nur geaendert werden, wenn die
 * Confluence-Seite sich aendert.
 */
const GENEHMIGT: ReadonlyArray<readonly [string, string, string]> = [
  ["--eyt-bg-canvas", "#f6f4ef", "#161513"],
  ["--eyt-bg-surface", "#ffffff", "#211f1c"],
  ["--eyt-text-primary", "#1d1b18", "#f1efe9"],
  ["--eyt-text-secondary", "#5b564e", "#b0aaa0"],
  ["--eyt-border-default", "#d8d4cb", "#3a3733"],
  ["--eyt-action-primary", "#1e5231", "#8fc7a2"],
  ["--eyt-state-published-bg", "#e1ebe2", "#22352a"],
  ["--eyt-state-draft-text", "#7a5300", "#e3b95b"],
  ["--eyt-state-draft-bg", "#f4e8ce", "#3a2f17"],
  ["--eyt-state-danger-text", "#9b2c1f", "#f0a08f"],
  ["--eyt-state-danger-bg", "#f7e3df", "#41211c"],
  ["--eyt-state-info-text", "#155e75", "#7cc1db"],
  ["--eyt-state-info-bg", "#deedf2", "#1c3540"],
];

/**
 * Zwei Tokens stehen NICHT in der Confluence-Tabelle. Sie sind ABLEITUNGEN und
 * werden hier als solche geprueft — nicht als genehmigte Werte ausgegeben.
 */
const ABGELEITET: ReadonlyArray<readonly [string, string]> = [
  // veroeffentlichter Text traegt dieselbe Farbe wie die Hauptaktion
  ["--eyt-state-published-text", "--eyt-action-primary"],
  // Text AUF der Hauptaktion ist die jeweilige Gegenflaeche
  ["--eyt-action-primary-contrast", ""],
];

/**
 * Die Paare, die als NORMALER KLEINTEXT vorkommen. Bewusst aufgezaehlt statt
 * kombinatorisch erzeugt: nicht jede Kombination ist eine Textkombination, und
 * ein Kreuzprodukt haette Paare gemessen, die niemand rendert — gruen oder rot
 * gleichermassen aussagelos.
 */
const TEXTPAARE: ReadonlyArray<readonly [string, string]> = [
  ["--eyt-text-primary", "--eyt-bg-canvas"],
  ["--eyt-text-primary", "--eyt-bg-surface"],
  ["--eyt-text-secondary", "--eyt-bg-canvas"],
  ["--eyt-text-secondary", "--eyt-bg-surface"],
  ["--eyt-action-primary-contrast", "--eyt-action-primary"],
  ["--eyt-state-published-text", "--eyt-state-published-bg"],
  ["--eyt-state-draft-text", "--eyt-state-draft-bg"],
  ["--eyt-state-danger-text", "--eyt-state-danger-bg"],
  ["--eyt-state-info-text", "--eyt-state-info-bg"],
  ["--eyt-state-published-text", "--eyt-bg-surface"],
  ["--eyt-state-danger-text", "--eyt-bg-surface"],
  ["--eyt-state-info-text", "--eyt-bg-surface"],
];

const MODI = [
  ["hell", HELL],
  ["dunkel", DUNKEL],
] as const;

describe("Basisdesign v2.0 §2.1 — kanonische Tokenquelle (EYT-80)", () => {
  it("liest ueberhaupt eine Stylesheet-Datei", () => {
    // Faengt den leisen Fall: ein Pfad auf eine echte, aber leere oder halb
    // geschriebene Datei. Ein FALSCHER Pfad wirft schon beim Einsammeln
    // (ENOENT) und ist damit lauter, als eine Zusicherung es koennte.
    expect(css.length).toBeGreaterThan(500);
  });

  it("deklariert alle dreizehn genehmigten Rollen in beiden Modi", () => {
    expect([...HELL.keys()].sort()).toEqual([...DUNKEL.keys()].sort());
    for (const [token] of GENEHMIGT) {
      expect(HELL.has(token), `hell: ${token} fehlt`).toBe(true);
      expect(DUNKEL.has(token), `dunkel: ${token} fehlt`).toBe(true);
    }
  });

  it.each(GENEHMIGT)("%s traegt die genehmigten Werte", (token, hell, dunkel) => {
    expect(HELL.get(token), `hell ${token}`).toBe(hell);
    expect(DUNKEL.get(token), `dunkel ${token}`).toBe(dunkel);
  });

  it("fuehrt keine Farbrolle, die die Baseline nicht kennt", () => {
    const erlaubt = new Set([...GENEHMIGT.map(([t]) => t), ...ABGELEITET.map(([t]) => t)]);
    expect([...HELL.keys()].filter((t) => !erlaubt.has(t))).toEqual([]);
  });

  it("haelt die beiden Ableitungen an ihre Herkunft", () => {
    // published.text folgt action.primary — in BEIDEN Modi.
    expect(HELL.get("--eyt-state-published-text")).toBe(HELL.get("--eyt-action-primary"));
    expect(DUNKEL.get("--eyt-state-published-text")).toBe(DUNKEL.get("--eyt-action-primary"));
    // Der Text AUF der Hauptaktion ist die jeweilige Gegenflaeche.
    expect(HELL.get("--eyt-action-primary-contrast")).toBe("#ffffff");
    expect(DUNKEL.get("--eyt-action-primary-contrast")).toBe(DUNKEL.get("--eyt-bg-canvas"));
  });
});

describe("Kontrastgate fuer normalen Kleintext (EYT-80, EYT-12)", () => {
  for (const [modus, tokens] of MODI) {
    it.each(TEXTPAARE)(`${modus}: %s auf %s erreicht 4.5:1`, (vorne, hinten) => {
      const fg = tokens.get(vorne);
      const bg = tokens.get(hinten);
      // Ohne diese zwei Zeilen wuerde ein GELOESCHTES Token zu
      // `kontrast(undefined, …)` und damit zu einem Wurf statt zu einer
      // Aussage — der Fall waere rot, aber aus dem falschen Grund.
      expect(fg, `${modus}: ${vorne} nicht deklariert`).toBeTruthy();
      expect(bg, `${modus}: ${hinten} nicht deklariert`).toBeTruthy();
      const verhaeltnis = kontrast(fg as string, bg as string);
      expect(
        verhaeltnis,
        `${modus}: ${vorne} auf ${hinten} = ${verhaeltnis.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(SCHWELLE_NORMALTEXT);
    });
  }

  it("weist die verworfene Penpot-Kombination #6D786F auf #F0F4EF ab", () => {
    expect(kontrast("#6D786F", "#F0F4EF")).toBeLessThan(SCHWELLE_NORMALTEXT);
  });

  it("weist die verworfene Penpot-Kombination #A86B2B auf #F6E9D8 ab", () => {
    expect(kontrast("#A86B2B", "#F6E9D8")).toBeLessThan(SCHWELLE_NORMALTEXT);
  });

  it("reproduziert die in der Baseline genannten Verhaeltnisse", () => {
    /*
     * DIE Gegenprobe fuer die Rechnung selbst. Confluence 8814623 §2.1
     * beziffert die beiden Ablehnungen mit „ca. 4,14:1" und „ca. 3,66:1".
     * Ohne diese zwei Zeilen waere eine Funktion, die konstant 1 liefert,
     * fuer beide Ablehnungsfaelle oben gruen — und fuer jedes Textpaar rot,
     * was wie ein Palettenfehler aussaehe und keiner waere.
     */
    expect(kontrast("#6D786F", "#F0F4EF")).toBeCloseTo(4.14, 2);
    expect(kontrast("#A86B2B", "#F6E9D8")).toBeCloseTo(3.66, 2);
  });

  it("weist die verworfenen Werte auch dann ab, wenn sie in den Tokens stuenden", () => {
    /*
     * Kein Blacklist-Test: geprueft wird, dass die GRENZE greift, nicht dass
     * genau diese zwei Zeichenketten verboten sind. Ein Sekundaertext im
     * Penpot-Ton auf der Penpot-Flaeche faellt durch dieselbe Schwelle, die
     * oben alle echten Paare bestehen.
     */
    expect(kontrast("#6D786F", "#F0F4EF")).toBeLessThan(kontrast("#5b564e", "#f6f4ef"));
  });
});
