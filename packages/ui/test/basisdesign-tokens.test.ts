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

/*
 * Frueher wurde die Datei am ERSTEN `@media` geteilt und jede
 * `--eyt-`-Deklaration selektorblind eingesammelt. Beides war strukturell
 * unsicher (PO-Review PR #96): ein spaeter `:root`-Block NACH dem Dunkelblock
 * ueberschreibt im echten Browser den Hellmodus, landete hier aber im
 * DUNKEL-Abschnitt und blieb gruen; und eine Deklaration unter einem fremden
 * Selektor (`.dunkel { … }`) zaehlte, als stuende sie in `:root`. Deshalb wird
 * die Struktur jetzt VOLLSTAENDIG zerlegt statt geteilt: die kanonische Datei
 * besteht aus genau einem hellen `:root`-Block, gefolgt von genau einem
 * `@media (prefers-color-scheme: dark)`-Block mit genau einem inneren `:root`
 * — und aus nichts anderem. Jede Abweichung bekommt einen benannten Eintrag in
 * STRUKTURFEHLER. Kein allgemeiner CSS-Parser als Abhaengigkeit: die erlaubte
 * Form ist endlich, und ein Klammerzaehler prueft sie deterministisch.
 */
interface Block {
  prelude: string;
  koerper: string;
}

function zerlegeTopLevel(quelle: string): { bloecke: Block[]; rest: string } {
  const bloecke: Block[] = [];
  let ausserhalb = "";
  let i = 0;
  while (i < quelle.length) {
    if (quelle[i] === "{") {
      let tiefe = 1;
      let j = i + 1;
      while (j < quelle.length && tiefe > 0) {
        if (quelle[j] === "{") tiefe += 1;
        if (quelle[j] === "}") tiefe -= 1;
        j += 1;
      }
      if (tiefe > 0) {
        // Unbalancierte Klammer: alles ab hier wird als Rest sichtbar.
        ausserhalb += quelle.slice(i);
        break;
      }
      bloecke.push({
        prelude: ausserhalb.replace(/\s+/g, " ").trim(),
        koerper: quelle.slice(i + 1, j - 1),
      });
      ausserhalb = "";
      i = j;
    } else {
      ausserhalb += quelle[i];
      i += 1;
    }
  }
  return { bloecke, rest: ausserhalb.trim() };
}

const STRUKTURFEHLER: string[] = [];

/** Ein reiner Tokenblock: nur `--eyt-*`-Deklarationen, jede genau einmal. */
function tokenzeilen(koerper: string, kontext: string): Map<string, string> {
  const gefunden = new Map<string, string>();
  for (const roh of koerper.split(";")) {
    const anweisung = roh.trim();
    if (anweisung === "") continue;
    // Ein verschachtelter Selektor im :root traegt Klammern und faellt hier
    // durch — CSS-Nesting kann eine Deklaration also nicht mehr einschleusen.
    const treffer = /^(--eyt-[\w-]+)\s*:\s*([^;{}]+)$/.exec(anweisung);
    if (treffer === null) {
      STRUKTURFEHLER.push(`${kontext}: keine reine --eyt-Deklaration: "${anweisung.slice(0, 60)}"`);
      continue;
    }
    const name = treffer[1] ?? "";
    if (gefunden.has(name)) {
      // Doppelt im selben Block: die letzte gewaenne leise.
      STRUKTURFEHLER.push(`${kontext}: ${name} doppelt deklariert`);
    }
    gefunden.set(name, (treffer[2] ?? "").trim().toLowerCase());
  }
  return gefunden;
}

const { bloecke, rest } = zerlegeTopLevel(css);
if (rest !== "") {
  STRUKTURFEHLER.push(`Text ausserhalb der beiden Bloecke: "${rest.slice(0, 60)}"`);
}
if (bloecke.length !== 2) {
  STRUKTURFEHLER.push(
    `${bloecke.length} Top-Level-Bloecke statt 2: ${bloecke
      .map((b) => b.prelude || "(leer)")
      .join(" · ")}`,
  );
}

const hellBlock = bloecke[0];
if (hellBlock !== undefined && hellBlock.prelude !== ":root") {
  STRUKTURFEHLER.push(`erster Block ist "${hellBlock.prelude}" statt ":root"`);
}

let dunkelKoerper: string | undefined;
const dunkelAussen = bloecke[1];
if (dunkelAussen !== undefined) {
  if (dunkelAussen.prelude !== "@media (prefers-color-scheme: dark)") {
    STRUKTURFEHLER.push(
      `zweiter Block ist "${dunkelAussen.prelude}" statt "@media (prefers-color-scheme: dark)"`,
    );
  } else {
    const innen = zerlegeTopLevel(dunkelAussen.koerper);
    if (innen.rest !== "") {
      STRUKTURFEHLER.push(`Text im Medienblock ausserhalb von :root: "${innen.rest.slice(0, 60)}"`);
    }
    const innerer = innen.bloecke[0];
    if (innen.bloecke.length === 1 && innerer !== undefined && innerer.prelude === ":root") {
      dunkelKoerper = innerer.koerper;
    } else {
      STRUKTURFEHLER.push(
        `der Medienblock traegt ${innen.bloecke.length} innere Bloecke (${innen.bloecke
          .map((b) => b.prelude || "(leer)")
          .join(" · ")}) statt genau einem :root`,
      );
    }
  }
}

/*
 * HELL/DUNKEL entstehen NUR aus den beiden korrekt aufgehaengten
 * :root-Koerpern. Eine Deklaration unter einem fremden Selektor kann die
 * Karten also nicht mehr erreichen — sie steht stattdessen namentlich in
 * STRUKTURFEHLER.
 */
const HELL =
  hellBlock !== undefined && hellBlock.prelude === ":root"
    ? tokenzeilen(hellBlock.koerper, "hell")
    : new Map<string, string>();
const DUNKEL =
  dunkelKoerper === undefined ? new Map<string, string>() : tokenzeilen(dunkelKoerper, "dunkel");

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
 * Zwei Rollen stehen NICHT in der Confluence-Tabelle §2.1 — aus verschiedenen
 * Gruenden, und deshalb in zwei Listen.
 *
 * `--eyt-state-published-text` ist eine echte ABLEITUNG: es traegt in beiden
 * Modi die Farbe der Hauptaktion. Die Quelle steht in der Liste und wird
 * benutzt.
 *
 * `--eyt-action-primary-contrast` ist KEINE Ableitung. Es ist repo-eigen
 * gewaehlt und nur zufaellig in Hell gleich `bg.surface` und in Dunkel gleich
 * `bg.canvas` — zwei verschiedene Rollen. Diese Gleichheit als Herkunft zu
 * behaupten haette eine Kopplung erfunden, die es nicht gibt: eine Aenderung
 * an `bg.surface` verlangte dann eine Aenderung hier, obwohl der Wert davon
 * nicht abhaengt. Zugesagt ist nicht die Herkunft, sondern der KONTRAST auf
 * der Hauptaktion — und der steht in `TEXTPAARE`.
 */
const ABGELEITET: ReadonlyArray<readonly [string, string]> = [
  ["--eyt-state-published-text", "--eyt-action-primary"],
];

const REPO_EIGEN: ReadonlyArray<readonly [string, string, string]> = [
  ["--eyt-action-primary-contrast", "#ffffff", "#161513"],
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
  it("deklariert in beiden Modi genau so viele Rollen wie bekannt", () => {
    /*
     * Faengt zwei Faelle auf einmal: eine abgeschnittene oder halb
     * geschriebene Datei, und eine Rolle, die still dazukommt oder
     * verschwindet. Eine Byte-Zahl (frueher `css.length > 500`) tat das
     * nicht — die geplante Datei misst 1116 Zeichen, eine um 55 % gekuerzte
     * waere durchgekommen.
     */
    const erwartet = GENEHMIGT.length + ABGELEITET.length + REPO_EIGEN.length;
    expect(HELL.size, "hell").toBe(erwartet);
    expect(DUNKEL.size, "dunkel").toBe(erwartet);
  });

  it("besteht aus genau zwei Bloecken: :root, dann @media (prefers-color-scheme: dark) > :root", () => {
    /*
     * DIE strukturelle Zusage, auf der alle Karten oben stehen. Der leise
     * Fall ist nicht der fehlende Dunkelblock — der faellt beim Zaehlen auf —,
     * sondern JEDER Weg, auf dem eine Deklaration ausserhalb der beiden
     * :root-Koerper die echte Kaskade aendert, waehrend die Karten sie anders
     * oder gar nicht sehen: ein spaeter :root-Ueberschreiber NACH dem
     * Medienblock (wirkt im echten Hellmodus, landete frueher im
     * DUNKEL-Abschnitt), ein zweiter Medienblock, Tokens unter einem fremden
     * Selektor, ein verschachtelter Selektor im :root, eine doppelte
     * Deklaration. Jede dieser Formen steht namentlich in STRUKTURFEHLER,
     * und die Reihenfolge hell → dunkel ist mitbewacht — nur so gewinnt der
     * Dunkelblock die Kaskade bei gleicher Spezifitaet.
     */
    expect(STRUKTURFEHLER).toEqual([]);
  });

  it("deklariert beide Modi deckungsgleich und alle genehmigten Rollen", () => {
    // Zwei Aussagen, absichtlich zusammen: die Schluesselmengen sind
    // deckungsgleich (das betrifft ALLE Rollen, auch die repo-eigenen), und
    // jede der dreizehn genehmigten ist einzeln da — letzteres nur, damit ein
    // Fehlschlag den NAMEN der fehlenden Rolle nennt statt einer Mengendifferenz.
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
    const erlaubt = new Set([
      ...GENEHMIGT.map(([t]) => t),
      ...ABGELEITET.map(([t]) => t),
      ...REPO_EIGEN.map(([t]) => t),
    ]);
    // Beide Modi einzeln: die Schluesselgleichheit oben ist eine ANDERE
    // Zusicherung, und eine unbekannte Rolle nur im Dunkelblock waere sonst
    // bloss transitiv gefangen.
    expect(
      [...HELL.keys()].filter((t) => !erlaubt.has(t)),
      "hell",
    ).toEqual([]);
    expect(
      [...DUNKEL.keys()].filter((t) => !erlaubt.has(t)),
      "dunkel",
    ).toEqual([]);
  });

  it.each(ABGELEITET)("%s folgt seiner Herkunft %s", (token, quelle) => {
    expect(HELL.get(token), `hell ${token}`).toBe(HELL.get(quelle));
    expect(DUNKEL.get(token), `dunkel ${token}`).toBe(DUNKEL.get(quelle));
  });

  it.each(REPO_EIGEN)("%s traegt seine repo-eigenen Werte", (token, hell, dunkel) => {
    expect(HELL.get(token), `hell ${token}`).toBe(hell);
    expect(DUNKEL.get(token), `dunkel ${token}`).toBe(dunkel);
  });
});

describe("Kontrastgate fuer normalen Kleintext (EYT-80, EYT-12)", () => {
  for (const [modus, tokens] of MODI) {
    it.each(TEXTPAARE)(`${modus}: %s auf %s erreicht 4.5:1`, (vorne, hinten) => {
      const fg = tokens.get(vorne);
      const bg = tokens.get(hinten);
      // Kein `as`-Cast: der ist zur Laufzeit nichts (CLAUDE.md, „ein `as` unter
      // ‚validiert' ist zur Compilezeit geloescht"). Ein geloeschtes Token soll
      // mit seinem NAMEN scheitern, nicht als TypeError aus `.trim()`.
      if (fg === undefined || bg === undefined) {
        throw new Error(`${modus}: ${vorne} oder ${hinten} nicht deklariert`);
      }
      const verhaeltnis = kontrast(fg, bg);
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
});
