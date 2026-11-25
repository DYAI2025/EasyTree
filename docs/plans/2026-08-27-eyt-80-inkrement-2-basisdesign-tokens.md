# EYT-80 Increment 2 — Central Basisdesign-v2 Tokens + Contrast Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `packages/ui` the single owner of the semantic Basisdesign-v2 colour tokens as a real
CSS file that the built `apps/web` application imports, and add an executable contrast gate that
turns red both for the two rejected Penpot combinations and for any accepted normal-text pair that
is weakened below 4.5:1.

**Architecture:** The canonical token source is **one CSS file inside `packages/ui`**
(`src/basisdesign-v2.css`), exposed through a new `exports` subpath and copied into `dist` by the
package build. `apps/web/app/globals.css` drops its own `--eyt-*` declarations and pulls the file in
with a single bare-specifier `@import` on line 1. There is then no second copy of the palette to
drift against — the duplication is removed rather than policed. The tests parse that one CSS file:
one suite pins its values against the Confluence §2.1 table, one computes WCAG contrast for every
declared normal-text pair, and a browser test reads the *computed* custom properties off the real
built pages `/`, `/planung` and `/kosten`.

**Tech Stack:** TypeScript 5.9 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`, `module: NodeNext`), React 19, Next.js 16 App Router (Turbopack CSS
pipeline), Vitest 4 + jsdom, Playwright/Chromium, pnpm 10.28 + Turborepo. **No new dependency.**

---

## Verified baseline (tool-observed, 2026-08-27, before any edit)

| Fact                                                        | Value / command                                                                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin/master`                                             | `3f98d769662b4dbbbe5dee879cc2dfdecaabb22a` — identical to the SHA in the brief                                                                                                                |
| Open pull requests                                          | `gh pr list --state open` → `[]`                                                                                                                                                             |
| EYT-80 status                                               | `In Arbeit` (Jira, read 2026-08-27)                                                                                                                                                          |
| `packages/ui` exports                                       | 12 primitives incl. `AppShell` **and** `DateRangeControl` (both present at `origin/master`; they are absent from the stale `feat/eyt-126-container-staging` worktree — plan against `origin/master`) |
| Colour literals in `packages/ui`                            | **zero.** `for f in $(git ls-tree -r --name-only origin/master -- packages/ui); do git show "origin/master:$f" \| grep -nE '#[0-9a-fA-F]{3,8}\b'; done` → no output                            |
| Colour literals in `apps/web` outside `globals.css`         | **zero.** `git grep -nE '#[0-9a-fA-F]{6}\b' -- apps/web ':!apps/web/app/globals.css' ':!apps/web/public'` → no output                                                                          |
| `--eyt-*` usages outside `globals.css`                      | **none in code** — only three `docs/` files                                                                                                                                                  |
| `packages/ui` build                                         | `tsc -p tsconfig.build.json`, `include: ["src"]` — a `.css` file in `src` is **not** emitted to `dist` by tsc; an explicit copy step is required                                              |
| `packages/ui/package.json`                                  | `"sideEffects": false`, `exports` has only `"."`                                                                                                                                             |
| `packages/ui/tsconfig.json`                                 | `"types": ["node"]`, `include: ["src","test",…]` → a `node:fs`-reading test typechecks                                                                                                        |
| `turbo.json` `build.outputs`                                | includes `dist/**` → a copied CSS file is cached/restored correctly                                                                                                                          |
| CI job `build-web`                                          | `pnpm --filter @easytree/web... build` **and** `pnpm --filter @easytree/web run build:cf` + `cf:dry-run`                                                                                      |
| CI job `web-smoke`                                          | runs `playwright test` over `apps/web/e2e/` minus `read-through.spec.ts` → `shell-smoke.spec.ts` **is a required check**                                                                      |
| `apps/web/test/app-shell-styles.test.ts`                    | asserts CSS **class rules** and `css.length > 1000` only — it does **not** read any `--eyt-*` value                                                                                           |
| `apps/web/test/a11y.test.tsx`                               | disables axe `color-contrast` in three places (jsdom has no layout engine) — this is the gap this increment closes deterministically                                                          |

### Measured spike — the token-ownership decision is **not** a preference (2026-08-27)

Executed in `/Users/benjaminpoersch/EasyTree-worktrees/eyt-80-werkbank-foundation`, whose tree is
byte-identical to `origin/master` (`git rev-parse 'HEAD^{tree}'` == `git rev-parse 'origin/master^{tree}'`
== `eba7b6fec41d3993d2705e9fec5f552f999b3011`), then **fully reverted** (`git status --porcelain`
scoped to `packages/ui apps/web` → empty).

A marker token `--eyt-spike-marker: #abcdef` was put in `packages/ui/src/basisdesign.css`, exposed
via `exports["./basisdesign.css"] = "./dist/basisdesign.css"`, copied in the build script, and
imported from `globals.css` as `@import "@easytree/ui/basisdesign.css";`.

| Question                                        | Measured answer                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Does Next resolve a bare-specifier CSS `@import`? | **Yes.** `apps/web/.next/static/chunks/0s8_9s5zfm5zg.css` contains `:root{--eyt-spike-marker:#abcdef}`                    |
| Is the `@import` inlined or left dangling?       | **Inlined.** `grep -c '@import' <chunk>` → `0`                                                                           |
| Do the existing app tokens survive alongside it?  | Yes — `eyt-bg-canvas`, `eyt-action-primary`, `eyt-app-shell__skip-link` all present in the same chunk                     |
| Does the OpenNext/Cloudflare build still pass?    | **Yes**, exit 0; marker present in `apps/web/.open-next/assets/_next/static/chunks/0s8_9s5zfm5zg.css`                     |
| Do `/planung` and `/kosten` render without an API? | **Yes** — `next start` on :3007 with no API: `/`, `/planung`, `/kosten`, `/kosten/stundensaetze` all HTTP **200**, all reference the **same** CSS chunk, all carry `id="hauptinhalt"` |

**Option A (canonical CSS owned by `packages/ui`) is therefore chosen — because it was measured to
work end to end, not because it is tidier.**

Rejected alternatives, with the reason each loses **on this repository's behaviour**:

- **B — canonical typed token data + projection into `apps/web` CSS.** Would leave the palette
  literals physically in `apps/web/app/globals.css` and reduce the contract to a drift *test*. The
  brief's requirement 2 ("consumes the canonical source rather than maintaining an independent
  semantic palette") would then be satisfied only by policing, not by structure. It also needs a
  generator or a hand-maintained mirror — both explicitly discouraged. **Only correct if A had
  failed the build measurement above; it did not.**
- **C — leave the tokens in `apps/web` and add a lint rule against palette literals in
  `packages/ui`.** Vacuous today: `packages/ui` already contains zero colour literals (measured
  above), so the rule would have nothing to catch and `packages/ui` would still not *own* anything.
- **D — a CSS-in-JS or PostCSS token layer.** New dependency and a multi-stage pipeline; ruled out
  by the brief and unnecessary given A works.

### Measured contrast (2026-08-27) — no design-decision STOP is triggered

WCAG 2.x relative-luminance formula, all values from Confluence §2.1:

| Pair (light / dark)                             | Light      | Dark       |
| ----------------------------------------------- | ---------- | ---------- |
| `text.primary` on `bg.canvas`                   | 15.63:1    | 15.87:1    |
| `text.primary` on `bg.surface`                  | 17.18:1    | 14.30:1    |
| `text.secondary` on `bg.canvas`                 | 6.62:1     | 7.91:1     |
| `text.secondary` on `bg.surface`                | 7.28:1     | 7.13:1     |
| `action.primary.contrast` on `action.primary`   | 9.10:1     | 9.44:1     |
| `state.published.text` on `state.published.bg`  | 7.45:1     | 6.74:1     |
| `state.draft.text` on `state.draft.bg`          | 5.64:1     | 7.10:1     |
| `state.danger.text` on `state.danger.bg`        | 6.13:1     | 6.94:1     |
| `state.info.text` on `state.info.bg`            | 6.06:1     | 6.44:1     |
| `state.published.text` on `bg.surface`          | 9.10:1     | 8.50:1     |
| `state.danger.text` on `bg.surface`             | 7.57:1     | 7.93:1     |
| `state.info.text` on `bg.surface`               | 7.27:1     | 8.23:1     |

**Every accepted normal-text pair clears 4.5:1 in both modes.** The two rejected combinations
compute to `#6D786F` on `#F0F4EF` → **4.14**, `#A86B2B` on `#F6E9D8` → **3.66** — which reproduces
Confluence's own published figures ("ca. 4,14:1", "ca. 3,66:1") to two decimals. That agreement is
what makes the rejected-pair cases a **correctness canary for the ratio function itself**, not just
a blacklist.

### Re-verify before Task 1 — the plan is only valid on this baseline

```bash
git fetch origin --quiet
test "$(git rev-parse origin/master)" = 3f98d769662b4dbbbe5dee879cc2dfdecaabb22a \
  && echo BASELINE_OK || echo BASELINE_MOVED
gh pr list --state open --json number,headRefName
```

`BASELINE_MOVED`, or any open PR touching `packages/ui` / `apps/web/app/globals.css` → **STOP and
report** (brief stop conditions 1 and 6).

---

## Findings recorded during planning (do **not** fix in this slice)

1. **Two `--eyt-*` tokens are repo-local, not Confluence-approved.** `--eyt-action-primary-contrast`
   and `--eyt-state-published-text` do not appear in the §2.1 table. They are legitimate
   *derivations* (`published.text` = `action.primary`; `action.primary.contrast` = white / dark
   canvas). This plan keeps them and **machine-checks the derivation** rather than claiming they are
   approved values. Never report "exactly the approved values" without this qualifier.
2. **`apps/web/app/layout.tsx:22` sets `themeColor: "#166534"`** — a colour literal in no token role
   and not equal to `action.primary` (`#1E5231`). Out of scope; report it.
3. **`--color-focus` (`#1d4ed8` light / `#7cc1db` dark) is an app-level token, not §2.1.** It stays
   in `apps/web`. Its 3:1 non-text requirement (EYT-12) measures 6.10:1 / 9.13:1 today, but this
   slice adds **no** assertion for it — non-text contrast is a separate contract.
4. **`.eyt-table__caption` uses `var(--eyt-color-text-muted, #555)`** — a fallback to a literal for a
   custom property that is **never declared**, i.e. `#555` is what actually renders. Task 4 replaces
   it with `var(--eyt-text-secondary)`. This is a visible change (`#555` → `#5b564e`), deliberately
   small, and it is the one thing in this slice that alters a rendered colour. Name it in the PR.

---

## Task 0: Branch and clean starting point

**Files:** none (git only)

**Step 1: Choose the worktree**

`/Users/benjaminpoersch/EasyTree` is on `feat/eyt-126-container-staging` and is **stale** — it does
not contain `packages/ui/src/app-shell.tsx`. Do not work there.

`/Users/benjaminpoersch/EasyTree-worktrees/eyt-80-werkbank-foundation` has a tree identical to
`origin/master`, and already has `node_modules` installed. Prefer it.

```bash
cd /Users/benjaminpoersch/EasyTree-worktrees/eyt-80-werkbank-foundation
git status --porcelain
```

Expected: only `?? docs/plans/2026-08-27-eyt-80-werkbank-ui-foundation.md`. Anything else → stop and
ask.

**Step 2: Create the branch from the verified master**

```bash
git fetch origin --quiet
git checkout -b feat/eyt-80-basisdesign-tokens 3f98d769662b4dbbbe5dee879cc2dfdecaabb22a
git rev-parse HEAD   # must print 3f98d769662b4dbbbe5dee879cc2dfdecaabb22a
```

**Step 3: Copy this plan into the worktree**

```bash
mkdir -p docs/plans
cp /Users/benjaminpoersch/EasyTree/docs/plans/2026-08-27-eyt-80-inkrement-2-basisdesign-tokens.md docs/plans/
```

**Step 4: Confirm Playwright's browser is installed** (a fresh worktree has none; that produces a
100 % red Playwright run that looks like a regression and is not one)

```bash
pnpm --filter @easytree/web exec playwright install chromium
```

**Step 5: Commit the plan**

```bash
git add docs/plans/2026-08-27-eyt-80-inkrement-2-basisdesign-tokens.md
git diff --cached --name-only     # exactly one path
git commit -m "docs(EYT-80): Inkrement 2 — Plan fuer zentrale Basisdesign-Tokens und Kontrastgate"
```

---

## Task 1: The failing proof — contrast gate before any token moves

This is the red TDD step. The gate is written **first**, against a canonical source file that does
not exist yet, so the suite fails for the right reason.

**Files:**

- Create: `packages/ui/test/helpers/kontrast.ts`
- Create: `packages/ui/test/basisdesign-tokens.test.ts`

**Step 1: Write the contrast helper**

`packages/ui/test/helpers/kontrast.ts`:

```ts
/**
 * WCAG-2.x-Kontrast, lokal gerechnet — bewusst OHNE Abhaengigkeit.
 *
 * Die Formel ist kurz und stabil (relative Leuchtdichte nach WCAG 2.1,
 * Definition „relative luminance"); eine Bibliothek dafuer waere eine
 * Abhaengigkeit, die genau diese zehn Zeilen mitbringt.
 *
 * Dass sie STIMMT, ist nicht behauptet, sondern gemessen: die beiden von
 * Confluence 8814623 §2.1 ausdruecklich verworfenen Kombinationen sind dort
 * mit „ca. 4,14:1" und „ca. 3,66:1" beziffert, und diese Funktion
 * reproduziert beide Zahlen auf zwei Nachkommastellen (Fall „reproduziert die
 * in der Baseline genannten Verhaeltnisse" in basisdesign-tokens.test.ts).
 * Das ist die Gegenprobe gegen eine kaputte Implementierung — ohne sie waere
 * eine Funktion, die immer 1 zurueckgibt, fuer die Ablehnungsfaelle gruen.
 */

/** #rrggbb (auch verkuerzt #rgb) → [r, g, b] in 0..255. */
export function kanaele(hex: string): [number, number, number] {
  const roh = hex.trim().replace(/^#/, "");
  const voll =
    roh.length === 3
      ? roh
          .split("")
          .map((z) => z + z)
          .join("")
      : roh;
  if (!/^[0-9a-fA-F]{6}$/.test(voll)) {
    throw new Error(`kein 6-stelliger Hexwert: ${hex}`);
  }
  const teil = (i: number): number => Number.parseInt(voll.slice(i, i + 2), 16);
  return [teil(0), teil(2), teil(4)];
}

/** Relative Leuchtdichte nach WCAG 2.1. */
export function leuchtdichte(hex: string): number {
  const linear = (wert: number): number => {
    const anteil = wert / 255;
    return anteil <= 0.04045 ? anteil / 12.92 : Math.pow((anteil + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = kanaele(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Kontrastverhaeltnis zweier Farben, immer >= 1. */
export function kontrast(vordergrund: string, hintergrund: string): number {
  const a = leuchtdichte(vordergrund);
  const b = leuchtdichte(hintergrund);
  const [hell, dunkel] = a > b ? [a, b] : [b, a];
  return (hell + 0.05) / (dunkel + 0.05);
}

/** WCAG 2.1 AA fuer normalen Kleintext. */
export const SCHWELLE_NORMALTEXT = 4.5;
```

**Step 2: Write the token + contrast suite**

`packages/ui/test/basisdesign-tokens.test.ts`:

```ts
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
 * werden hier als solche gepruft — nicht als genehmigte Werte ausgegeben.
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
      expect(verhaeltnis, `${modus}: ${vorne} auf ${hinten} = ${verhaeltnis.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(SCHWELLE_NORMALTEXT);
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
```

**Step 3: Run it and verify it fails for the right reason**

```bash
pnpm --filter @easytree/ui exec vitest run test/basisdesign-tokens.test.ts
```

Expected: **FAIL** at collection with
`ENOENT: no such file or directory, open '.../packages/ui/src/basisdesign-v2.css'`.

Read the printed **file count** — a vitest path filter that matches nothing exits 0 without checking
anything (`vitest-path-filter-is-substring`, `vitest-silently-skips-missing-files`).

**Step 4: Commit the red proof**

```bash
git add packages/ui/test/helpers/kontrast.ts packages/ui/test/basisdesign-tokens.test.ts
git diff --cached --name-only     # exactly those two paths
git commit -m "test(ui): EYT-80 Kontrastgate und Tokenvertrag vor der Quelle (rot)"
```

---

## Task 2: The canonical token source in `packages/ui`

**Files:**

- Create: `packages/ui/src/basisdesign-v2.css`
- Modify: `packages/ui/package.json`

**Step 1: Write the canonical CSS**

`packages/ui/src/basisdesign-v2.css` — **the values are byte-for-byte the ones already live in
`apps/web/app/globals.css`**, so this task changes no rendered colour:

```css
/*
 * Basisdesign v2.0 §2.1 — die verbindliche Tokenbasis (Confluence 8814623).
 *
 * DIESE Datei ist die einzige Quelle der semantischen Farbrollen. `apps/web`
 * haelt keine zweite Fassung mehr, sondern bindet diese hier ein; damit gibt es
 * keine Abweichung mehr zu bewachen, weil es keine zweite Liste mehr gibt.
 *
 * Bewacht wird sie von `test/basisdesign-tokens.test.ts`: dort steht die
 * Confluence-Tabelle als ERWARTUNG, hier stehen die Werte, und jedes Paar, das
 * als normaler Kleintext vorkommt, muss 4.5:1 erreichen.
 *
 * Zwei Tokens stehen NICHT in §2.1 und sind Ableitungen:
 *   --eyt-state-published-text  == --eyt-action-primary
 *   --eyt-action-primary-contrast  = die jeweilige Gegenflaeche
 * Der Test haelt beide Ableitungen fest; ausgegeben werden sie nie als
 * „genehmigte Werte".
 *
 * Kein Layout, keine Klassen, keine Schrift: das Paket besitzt die WERTE, die
 * Anwendung besitzt die Gestaltung (`apps/web/app/globals.css`).
 */

:root {
  --eyt-bg-canvas: #f6f4ef;
  --eyt-bg-surface: #ffffff;
  --eyt-text-primary: #1d1b18;
  --eyt-text-secondary: #5b564e;
  --eyt-border-default: #d8d4cb;
  --eyt-action-primary: #1e5231;
  --eyt-action-primary-contrast: #ffffff;
  --eyt-state-published-bg: #e1ebe2;
  --eyt-state-published-text: #1e5231;
  --eyt-state-draft-text: #7a5300;
  --eyt-state-draft-bg: #f4e8ce;
  --eyt-state-danger-text: #9b2c1f;
  --eyt-state-danger-bg: #f7e3df;
  --eyt-state-info-text: #155e75;
  --eyt-state-info-bg: #deedf2;
}

/*
 * Dunkelmodus folgt dem SYSTEM (Basisdesign §7: „Dark Mode folgt System oder
 * expliziter Nutzereinstellung, nicht einer ungeprueften automatischen
 * Annahme"). Jede Rolle wird vollstaendig neu gesetzt — kein Teilsatz, damit
 * keine Rolle unbemerkt im Hellwert stehen bleibt.
 */
@media (prefers-color-scheme: dark) {
  :root {
    --eyt-bg-canvas: #161513;
    --eyt-bg-surface: #211f1c;
    --eyt-text-primary: #f1efe9;
    --eyt-text-secondary: #b0aaa0;
    --eyt-border-default: #3a3733;
    --eyt-action-primary: #8fc7a2;
    --eyt-action-primary-contrast: #161513;
    --eyt-state-published-bg: #22352a;
    --eyt-state-published-text: #8fc7a2;
    --eyt-state-draft-text: #7a5300;
    --eyt-state-draft-bg: #3a2f17;
    --eyt-state-danger-text: #f0a08f;
    --eyt-state-danger-bg: #41211c;
    --eyt-state-info-text: #155e75;
    --eyt-state-info-bg: #1c3540;
  }
}
```

> **Deliberate error above, and it is a chosen one.** Exactly two roles carry their **light** value
> in the dark block — `--eyt-state-draft-text` (`#7a5300` instead of `#e3b95b`) and
> `--eyt-state-info-text` (`#155e75` instead of `#7cc1db`) — while their **backgrounds stay dark**.
> That is what makes it the requirement-3 mutation: dark text on a dark surface.
>
> A tempting alternative — flipping a text/background **pair** together — would have been useless
> here and was rejected on measurement: `#9b2c1f` on `#f7e3df` is 6.13:1 and `#155e75` on `#deedf2`
> is 6.06:1, so a coherent light pair sitting in the dark block **passes** the contrast gate and only
> the value assertions bite. Half a mutation is the useful one in this specific case
> (`counter-mutation-must-be-coherent` cuts the other way when the invariant is a *relation* between
> two tokens).

**Step 2: Run and read which cases go red**

```bash
pnpm --filter @easytree/ui exec vitest run test/basisdesign-tokens.test.ts
```

Expected (ratios pre-computed 2026-08-27 — compare the printed numbers against these):

| Failing case                                                       | Reason                        |
| ------------------------------------------------------------------ | ----------------------------- |
| `--eyt-state-draft-text traegt die genehmigten Werte` (dark)        | `#7a5300` ≠ `#e3b95b`         |
| `--eyt-state-info-text traegt die genehmigten Werte` (dark)         | `#155e75` ≠ `#7cc1db`         |
| `dunkel: --eyt-state-draft-text auf --eyt-state-draft-bg`           | **1.92:1** (needs 4.5)        |
| `dunkel: --eyt-state-info-text auf --eyt-state-info-bg`             | **1.77:1**                    |
| `dunkel: --eyt-state-info-text auf --eyt-bg-surface`                | **2.26:1**                    |

Five failing cases; the ENOENT from Task 1 is gone. **This is the executed counter-mutation for
requirement 3.** Record the case names and the printed ratios verbatim. If the contrast cases are
green while only the value cases are red, the gate is not measuring what it claims — stop and
investigate the helper before proceeding.

**Step 3: Correct the two dark text values**

```bash
cd packages/ui
python3 - <<'PY'
from pathlib import Path
p = Path("src/basisdesign-v2.css")
s = p.read_text()
grenze = s.index("@media")
kopf, schwanz = s[:grenze], s[grenze:]
for falsch, richtig in [
    ("--eyt-state-draft-text: #7a5300;", "--eyt-state-draft-text: #e3b95b;"),
    ("--eyt-state-info-text: #155e75;", "--eyt-state-info-text: #7cc1db;"),
]:
    # Der Anker MUSS eindeutig sein: beide Zeichenketten stehen auch im
    # Hellblock, deshalb wird nur der Schwanz ab @media ersetzt und die
    # Trefferzahl geprueft (scripted-mutations-need-unique-anchors).
    assert schwanz.count(falsch) == 1, (falsch, schwanz.count(falsch))
    schwanz = schwanz.replace(falsch, richtig)
p.write_text(kopf + schwanz)
PY
cd ../..
```

Then **grep the result, not the exit code** (`verify-replacements-not-exit-codes`):

```bash
sed -n '/@media/,$p' packages/ui/src/basisdesign-v2.css | grep -E 'draft-text|info-text'
```

Expected exactly: `--eyt-state-draft-text: #e3b95b;` and `--eyt-state-info-text: #7cc1db;`.

**Step 4: Add the export subpath and the copy step**

Modify `packages/ui/package.json`:

- `exports`: add `"./basisdesign-v2.css": "./dist/basisdesign-v2.css"` after `"."`.
- `sideEffects`: `false` → `["*.css"]`. (Belt-and-braces: the spike passed with this set; whether
  `false` alone would also have worked was **not** isolated. `["*.css"]` is the correct declaration
  either way — the file is pure side effect.)
- `build`: `"tsc -p tsconfig.build.json"` → `"tsc -p tsconfig.build.json && cp src/basisdesign-v2.css dist/basisdesign-v2.css"`.
  `tsc` does not copy non-TS files (`include: ["src"]` only selects TS inputs), so without this the
  subpath resolves to nothing. `turbo.json` already lists `dist/**` as a build output, so the copied
  file is cached and restored.

**Step 5: Prove the build really produces it — from a cleared `dist`**

A stale `dist` makes a resolution check falsely green
(`local-dist-makes-import-resolution-tests-pass-wrongly`), so clear it first:

```bash
rm -rf packages/ui/dist
pnpm --filter @easytree/ui build
ls -l packages/ui/dist/basisdesign-v2.css
node -e "console.log(require.resolve('@easytree/ui/basisdesign-v2.css', { paths: ['apps/web'] }))"
```

Expected: the file exists, and `require.resolve` prints the `packages/ui/dist/…` path.

**Step 6: Run the suite green**

```bash
pnpm --filter @easytree/ui exec vitest run test/basisdesign-tokens.test.ts
```

Expected: all cases pass; printed file count **1**.

**Step 7: Commit**

```bash
git add packages/ui/src/basisdesign-v2.css packages/ui/package.json
git diff --cached --name-only
git commit -m "feat(ui): EYT-80 Basisdesign-v2-Tokens als kanonische Quelle in packages/ui"
```

---

## Task 3: The consumption guard in `apps/web` — red first

**Files:**

- Create: `apps/web/test/basisdesign-tokens.test.ts`

**Step 1: Write the guard**

```ts
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
     * Totalverlust fangen, nicht jede Umbenennung.
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
```

**Step 2: Run it — expect three of four red**

```bash
pnpm --filter @easytree/web exec vitest run test/basisdesign-tokens.test.ts
```

Expected on the unchanged `globals.css`: the `@import` case fails, the "no own declarations" case
fails listing 15 tokens, and the literal case fails (it still holds `#555` plus the whole palette).
The "still uses the roles" case passes. Printed file count **1**.

**Step 3: Commit the red guard**

```bash
git add apps/web/test/basisdesign-tokens.test.ts
git diff --cached --name-only
git commit -m "test(web): EYT-80 Waechter gegen eigene Palette in globals.css (rot)"
```

---

## Task 4: Make `apps/web` consume the canonical source

**Files:**

- Modify: `apps/web/app/globals.css` (delete the 15 light + 15 dark `--eyt-*` declarations, add the
  `@import`, fix the `#555` fallback)

**Step 1: Add the import as line 1**

`@import` must precede every rule. Put it above the file's leading comment block — a comment is not
a rule, but keeping the import literally first removes the question:

```css
/* Die kanonische Tokenbasis gehoert @easytree/ui (EYT-80). */
@import "@easytree/ui/basisdesign-v2.css";
```

**Step 2: Delete the palette from `:root`**

In the `:root` block, remove the 15 lines from `--eyt-bg-canvas` through `--eyt-state-info-bg`
including the `/* Basisdesign v2.0 §2.1 — hell */` comment. **Keep** the `Aliasse fuer Bestandsstile`
block (`--color-bg`, `--color-text`, `--color-brand`, `--color-brand-contrast`, `--color-border`,
`--color-focus`) and the `--space` / `--radius` block untouched — they are app-level and they
reference the imported roles through `var()`, which resolves at use time regardless of declaration
order.

**Step 3: Reduce the dark block to the app-level token**

The `@media (prefers-color-scheme: dark)` block in `globals.css` becomes:

```css
@media (prefers-color-scheme: dark) {
  :root {
    /* Die Farbrollen kommen aus @easytree/ui; hier bleibt nur, was die
       Anwendung selbst besitzt. */
    --color-focus: #7cc1db;
  }
}
```

**Step 4: Remove the last stray literal**

In `.eyt-table__caption`, replace

```css
  color: var(--eyt-color-text-muted, #555);
```

with

```css
  color: var(--eyt-text-secondary);
```

`--eyt-color-text-muted` is declared nowhere, so `#555` is what actually rendered — this is the one
deliberate visible change in the slice (`#555` → `#5b564e`, a §2.1 role). Same line, the
`padding-block-end: var(--eyt-space-2, 0.5rem)` fallback: leave it. It is a **spacing** token, not a
colour role, and spacing is out of this slice's scope — note it in the PR.

**Step 5: Run both guards plus the two neighbouring suites**

```bash
pnpm --filter @easytree/web exec vitest run test/basisdesign-tokens.test.ts test/app-shell-styles.test.ts
```

Expected: both files collected (file count **2**), all cases green. `app-shell-styles.test.ts` must
stay green — it asserts class rules and `css.length > 1000`, and the file is still far above that.

**Step 6: Counter-mutation for requirement 6 — disconnect `apps/web` from the source**

Copy the file first: `git checkout --` restores the **commit** state, not the working state
(`git-checkout-reverts-to-commit-not-worktree`), and the change is not committed yet.

```bash
cp apps/web/app/globals.css /tmp/globals.behalten.css
# Mutation: den @import entfernen
grep -v '@import "@easytree/ui/basisdesign-v2.css";' /tmp/globals.behalten.css > apps/web/app/globals.css
grep -c '@import' apps/web/app/globals.css     # must print 0 — grep the RESULT
pnpm --filter @easytree/web exec vitest run test/basisdesign-tokens.test.ts
```

Expected: **RED**, case `bindet die kanonische Tokendatei als erste Anweisung ein`. Record the
message. Then restore and prove the restore:

```bash
cp /tmp/globals.behalten.css apps/web/app/globals.css
git diff --stat -- apps/web/app/globals.css   # compare against the pre-mutation working copy
diff /tmp/globals.behalten.css apps/web/app/globals.css && echo RESTORE_OK
```

**Step 7: Commit**

```bash
git add apps/web/app/globals.css
git diff --cached --name-only
git commit -m "refactor(web): EYT-80 globals.css bezieht die Farbrollen aus @easytree/ui"
```

---

## Task 5: Prove the tokens reach the **built** application in a real browser

A green unit test cannot show that the built app carries the contract — this task is the answer to
"a successful unit test is not sufficient".

**Files:**

- Modify: `apps/web/e2e/shell-smoke.spec.ts` (append one test)

**Step 1: Append the browser assertion**

```ts
/**
 * Die Tokens erreichen die GEBAUTE Anwendung (EYT-80 Inkrement 2).
 *
 * Die Datei-Waechter in `apps/web/test/basisdesign-tokens.test.ts` und
 * `packages/ui/test/basisdesign-tokens.test.ts` lesen Quelltext. Sie koennen
 * nicht sehen, ob Next den `@import` aufloest, ob das Paket seine CSS-Datei
 * ueberhaupt ausliefert oder ob ein Bundler sie als nebenwirkungsfrei
 * wegwirft. Dieser Fall liest den BERECHNETEN Wert im Chromium.
 *
 * Drei Routen, weil die Zusage „auf den realen Produktflaechen" lautet und
 * nicht „auf der Startseite". Im `web-smoke` laeuft keine API; alle drei
 * antworten trotzdem mit 200 und tragen dieselbe CSS-Datei (gemessen
 * 27.08.2026). Geprueft werden hier die TOKENWERTE, nicht der angemeldete
 * Zustand — der gehoert dem auth-journey.
 */
const KANONISCHE_ROLLEN: ReadonlyArray<readonly [string, string]> = [
  ["--eyt-bg-canvas", "#f6f4ef"],
  ["--eyt-bg-surface", "#ffffff"],
  ["--eyt-text-primary", "#1d1b18"],
  ["--eyt-text-secondary", "#5b564e"],
  ["--eyt-border-default", "#d8d4cb"],
  ["--eyt-action-primary", "#1e5231"],
  ["--eyt-state-published-bg", "#e1ebe2"],
  ["--eyt-state-draft-text", "#7a5300"],
  ["--eyt-state-draft-bg", "#f4e8ce"],
  ["--eyt-state-danger-text", "#9b2c1f"],
  ["--eyt-state-danger-bg", "#f7e3df"],
  ["--eyt-state-info-text", "#155e75"],
  ["--eyt-state-info-bg", "#deedf2"],
];

for (const pfad of ["/", "/planung", "/kosten"]) {
  test(`${pfad} liefert die kanonischen Basisdesign-Tokens aus`, async ({ page }) => {
    await page.goto(pfad);
    await expect(page.getByRole("main")).toBeVisible();

    const gemessen = await page.evaluate((namen) => {
      const stil = getComputedStyle(document.documentElement);
      return Object.fromEntries(namen.map((n) => [n, stil.getPropertyValue(n).trim().toLowerCase()]));
    }, KANONISCHE_ROLLEN.map(([name]) => name));

    for (const [name, wert] of KANONISCHE_ROLLEN) {
      expect(gemessen[name], `${pfad}: ${name}`).toBe(wert);
    }
  });
}
```

`shell-smoke.spec.ts` runs at the default viewport under `prefers-color-scheme: light` (Playwright's
default `colorScheme` is `light`), so the light values are the right expectation. Do **not** add a
dark-mode browser case in this slice — it needs a second `test.use({ colorScheme: "dark" })` project
and is not required by either acceptance criterion. Note it as a limitation.

**Step 2: Build and run the smoke**

```bash
env -u EASYTREE_API_PROXY_TARGET pnpm --filter @easytree/web... build
EASYTREE_API_PROXY_TARGET=http://127.0.0.1:3001 pnpm --filter @easytree/web run test:e2e
```

Expected: all `shell-smoke` cases pass, including the three new ones. Port 3000 must be free.
`run test:e2e -- <filter>` does **not** filter — read the printed test list
(`fresh-worktree-missing-playwright-browsers`).

**Step 3: Counter-mutation — break the package's delivery, not the app's source**

This is the mutation the file-level guards **cannot** see, so it is the one that proves this test
earns its place.

```bash
cp packages/ui/package.json /tmp/ui-pkg.behalten.json
node -e '
const fs=require("fs");
const p=JSON.parse(fs.readFileSync("packages/ui/package.json","utf8"));
delete p.exports["./basisdesign-v2.css"];
fs.writeFileSync("packages/ui/package.json",JSON.stringify(p,null,2)+"\n");
'
node -e 'const e=require("./packages/ui/package.json").exports; console.log(Object.keys(e).join(","))'
```

Expected: prints `.` only — grep the **result**. Then:

```bash
rm -rf packages/ui/dist apps/web/.next
env -u EASYTREE_API_PROXY_TARGET pnpm --filter @easytree/web... build
```

Expected: the **build fails** — Next cannot resolve the `@import`. If it instead succeeds, run the
smoke; the three new cases must be red. **Either outcome is a valid red**; record which one
occurred, because "the build refuses" and "the browser reports the wrong colour" are different
guarantees and the PR must not claim the stronger one.

Restore and prove it:

```bash
cp /tmp/ui-pkg.behalten.json packages/ui/package.json
diff /tmp/ui-pkg.behalten.json packages/ui/package.json && echo RESTORE_OK
git diff --stat -- packages/ui/package.json     # empty: this file is already committed
rm -rf packages/ui/dist && pnpm --filter @easytree/ui build
```

**Step 4: Commit**

```bash
git add apps/web/e2e/shell-smoke.spec.ts
git diff --cached --name-only
git commit -m "test(web): EYT-80 Browser belegt die Basisdesign-Tokens auf /, /planung und /kosten"
```

---

## Task 6: Full uncached gate

Turbo replays are not runs. Every number below needs `--force` and a look at the `Cached:` line.
Stop the local Supabase stack first if it is running — a live stack turns integration suites into
false reds (`turbo-test-with-live-local-stack-false-reds`).

**Step 1: Formatting** (check the tracked set; untracked `docs/plans/` files are local-only noise)

```bash
git ls-files -z | xargs -0 pnpm exec prettier --ignore-unknown --check
```

Expected: exit 0. The new `.css` and `.ts` files are in scope.

**Step 2: Lint / typecheck / tests, uncached**

```bash
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run test --force
```

Expected for each: `Cached: 0 cached` **and** `Tasks: N successful`.

**Step 3: Build**

```bash
rm -rf packages/ui/dist apps/web/.next apps/web/.open-next
env -u EASYTREE_API_PROXY_TARGET pnpm build
```

Expected: exit 0, `Cached: 0 cached`. The `env -u` is the standing counter-probe that no build reads
`EASYTREE_API_PROXY_TARGET` (EYT-126).

**Step 4: The OpenNext path that `build-web` also runs**

```bash
pnpm --filter @easytree/web run build:cf
pnpm --filter @easytree/web run cf:dry-run
```

Expected: both exit 0, and `cf:dry-run` prints a `Total Upload: … / gzip: …` line — the CI step fails
hard when that line is missing.

**Step 5: Prove the tokens are in the built artefacts, not just in source**

```bash
CHUNK=$(ls apps/web/.next/static/chunks/*.css | head -1)
echo "$CHUNK"
grep -c 'eyt-bg-canvas' "$CHUNK"      # expect 1
grep -c '@import' "$CHUNK"            # expect 0 — the import must be inlined, not dangling
grep -rl 'eyt-bg-canvas' apps/web/.open-next/assets/_next/static/chunks/ | head -1
```

**Step 6: Browser smoke**

```bash
EASYTREE_API_PROXY_TARGET=http://127.0.0.1:3001 pnpm --filter @easytree/web run test:e2e
```

Expected: green, and the printed list contains the three new token cases.

---

## Task 7: Push and open the pull request

**Step 1: Read the gate output before pushing** — `vitest` alone misses a type error in a test file,
which is why Task 6 Step 2 runs `typecheck` separately.

**Step 2: Push**

```bash
git push -u origin feat/eyt-80-basisdesign-tokens
git rev-parse HEAD    # record this — it is the exact head all evidence is bound to
```

**Step 3: Open the PR** (do **not** merge — the brief withholds merge authority)

```bash
gh pr create --base master --head feat/eyt-80-basisdesign-tokens \
  --title "feat(ui): EYT-80 zentrale Basisdesign-v2-Tokens und deterministisches Kontrastgate" \
  --body-file docs/plans/pr-eyt-80-inkrement-2.md
```

The body must state, separated as **tool-observed** vs **agent-reported**:

- the token-ownership model chosen and the three rejected alternatives, with the spike measurement
  that decided it;
- every counter-mutation actually executed (Task 2 Step 2, Task 4 Step 6, Task 5 Step 3), each with
  the case that went red and the scoped restore proof;
- the four findings from this plan's *Findings* section, explicitly not fixed;
- the one intentional visible change (`#555` → `#5b564e` in `.eyt-table__caption`);
- that `BLOCKER_ENVIRONMENT_SEPARATION` is untouched and **no deploy occurred**.

**Step 4: Wait for CI at the exact head**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 2400
gh run list --branch feat/eyt-80-basisdesign-tokens --limit 3
```

Exit 0 can also mean timeout, and exit 1 can mean *cancelled* (`ci.yml` has `cancel-in-progress`) —
confirm the final state with `gh run view` either way
(`gh-ci-wait-exit-zero-can-mean-timeout`, `gh-ci-wait-exit-1-can-mean-cancelled`).

**Step 5: Jira evidence comment — EYT-80 stays `In Arbeit`**

Only after exact-head CI evidence exists. Compose → re-read → send. Do **not** transition the issue.
Map the evidence to:

- **EYT-80 AC**: "Tokens für Canvas, Surface, Text, Border, Primary, Published, Draft, Danger und
  Info sind zentral versioniert."
- **EYT-80 AC**: "Kontrasttests verhindern die verworfenen Penpot-Kombinationen `#6D786F/#F0F4EF`
  und `#A86B2B/#F6E9D8` für normalen Kleintext."
- **EYT-12 AC**: "Kontrasttests sichern die semantischen Hell-/Dunkel-Tokens aus EYT-80 ab."

State plainly which EYT-80 criteria this increment does **not** touch (`BottomNavigation`, the
state-pattern family, the employee shell, visual regressions from real pages).

---

## Known limitations to carry into the report

1. **Dark mode is asserted from source, not from a browser.** The Playwright case runs under
   Playwright's default `colorScheme: "light"`. The dark values are proven by
   `packages/ui/test/basisdesign-tokens.test.ts` reading the same file the browser loads — a strong
   chain, but not a rendered measurement.
2. **The 4.5:1 threshold is checked for the twelve enumerated normal-text pairs**, not for every
   foreground/background combination that could occur. A new pairing introduced by a future
   component is not covered until it is added to `TEXTPAARE`.
3. **Non-text contrast (EYT-12's 3:1 focus requirement) is not gated.** Measured today at 6.10:1
   (light) / 9.13:1 (dark), but nothing keeps it there.
4. **axe `color-contrast` stays disabled** in `apps/web/test/a11y.test.tsx`. jsdom has no layout
   engine; this slice replaces that gap with a deterministic calculation rather than pretending axe
   can close it. Do not report "contrast fully verified by axe".
5. **The `--eyt-space-2` fallback in `.eyt-table__caption` remains.** Spacing tokens are not part of
   this slice.
6. **`sideEffects: ["*.css"]` was not isolated as necessary.** The spike passed with it set; whether
   the previous `false` would also have worked is untested.

## Stop conditions — re-read before each task

STOP and report without broadening scope if: `origin/master` has moved; a PR appears touching
`packages/ui` or `apps/web/app/globals.css`; the canonical CSS route needs a generator, a new
dependency or a build-system change beyond the one `cp` in the package `build` script; a change to
domain/API/auth/DB becomes necessary; the architecture-scanner weaknesses would have to be repaired
to finish this slice; or a gate turns red for a reason unrelated to this change.

**Do not merge. Do not deploy. Do not move EYT-80 to Fertig.**
