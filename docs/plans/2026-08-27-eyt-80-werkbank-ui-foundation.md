# EYT-80 Increment 1 — Werkbank UI-Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract two genuinely domain-free primitives — `AppShell` and `DateRangeControl` — into `@easytree/ui`, prove the boundary with a new executable architecture rule, and compose both into the real `/planung` Werkbank without changing one bit of business behaviour.

**Architecture:** `packages/ui` stays structure-only: it renders `<header>/<main>/<footer>` and a navigation strip, it receives every label, every URL and every `data-testid` as a prop, and it may import nothing but `react`. All policy — session, permission-filtered navigation, organisation selection, logout, routing, ISO-week computation — stays in `apps/web`. `apps/web/components/app-shell.tsx` and `apps/web/components/wochen-navigation.tsx` are **refactored to compose** the primitives; they are not replaced, and their exported names, props and `data-testid` values do not change, so every existing consumer and every existing test keeps working unchanged.

**Tech Stack:** TypeScript 5.9 (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`), React 19, Next.js 16 App Router, Vitest 4 + jsdom + @testing-library, axe-core, Playwright, pnpm 10.28 / Turborepo.

---

## Verified baseline (measured 2026-08-27, before any edit)

| Fact                                                 | Value                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin/master`                                      | `9bebb1186ecc7e6c8338887f5831c1f31d79b1a9` — identical to the SHA named in the brief                                                                                                                                                                     |
| Open pull requests                                   | `gh pr list --state open --json number` → `[]`                                                                                                                                                                                                           |
| `packages/ui/src` external imports                   | `react` only (10 occurrences), plus relative `./*.js` — measured with `grep -rhoE 'from "[^"]+"' packages/ui/src`                                                                                                                                        |
| Architecture rules that guard `packages/ui`          | **none.** `RULES` in `apps/api/test/architecture/rules.ts` holds 9 ids (counted 2026-08-27 with `grep -cE '^\s+id: "'`); not one has `packages/ui` in scope. The file set scanned by `architecture.test.ts` **does** include `packages/**` (lines 34-37) |
| Files that render `apps/web` `AppShell`              | `app/layout.tsx:29`, `test/a11y.test.tsx:53`, `test/planung-zugang.test.tsx:203`, `test/helpers/werkbank.tsx:262`                                                                                                                                        |
| Selectors that pin the shell DOM from the outside    | `e2e/shell-smoke.spec.ts`: `a[href='#hauptinhalt']`, `#hauptinhalt`, `getByRole("banner")`, `getByRole("main")`                                                                                                                                          |
| Selectors that pin the week strip from the outside   | `e2e/planungswerkbank.spec.ts`: `werkbank-woche-iso`, `werkbank-woche-bereich`, roles `link`/`button` named `Vorherige Woche` / `Nächste Woche` / `Heute`                                                                                                |
| CSS class names referenced from any test or e2e file | **none** — `grep -rnE '\.(skip-link\|app-header\|app-main\|app-footer\|…)' apps/web/test apps/web/e2e scripts` exits 1                                                                                                                                   |

**Re-verify before Task 1** (the plan is only valid on this baseline):

```bash
git fetch origin --quiet
test "$(git rev-parse origin/master)" = 9bebb1186ecc7e6c8338887f5831c1f31d79b1a9 && echo BASELINE_OK || echo BASELINE_MOVED
gh pr list --state open --json number,headRefName
```

`BASELINE_MOVED` or a non-empty PR list touching `packages/ui`, `apps/web/components/app-shell.tsx` or `apps/web/components/wochen-navigation.tsx` ⇒ **STOP and report**, per the brief's stop conditions.

---

## Design decisions (settled before coding — do not re-litigate mid-task)

### D1 — The `packages/ui` shell is named `AppShell`; the web shell keeps its name and aliases the import

`apps/web` already exports `AppShell` from `components/app-shell.tsx`, and four files import it by that name. Renaming the web export would touch four files for zero behavioural gain and would rewrite a test suite (`planung-zugang.test.tsx`) that this increment must leave untouched as regression evidence. The web file therefore does `import { AppShell as UiAppShell } from "@easytree/ui"` and keeps `export function AppShell`.

### D2 — The shell takes slots, never policy, and has **no** default copy

Every visible string (`skipLinkLabel`, brand, footer, navigation contents) is a required or explicitly-passed prop. A German default inside `@easytree/ui` would make the package own product copy and would silently ship the Werkbank's wording into the future Feld client. The one non-copy default is `mainId = "hauptinhalt"`, because it is a DOM contract, not language.

### D3 — The skip-link target and the `<main>` id come from **one** value

Today `app-shell.tsx` writes the literal `#hauptinhalt` in the anchor (line 40) and the literal `hauptinhalt` in `<main id=…>` (line 103). In the primitive both come from a single `mainId` prop.

**Correction, measured 2026-08-27 — an earlier draft of this section claimed nothing forces the two literals to agree. That is false.** The value is independently pinned in five places across two required CI jobs: `apps/web/test/a11y.test.tsx:80` (the `href`) and `:90` (the `main.id`), `apps/web/test/planung-a11y.test.tsx:82`, and `apps/web/e2e/shell-smoke.spec.ts:65` (locator), `:68` (focus target) and `:142` (tab order). A typo in either literal turns `unit-tests` and `web-smoke` red today.

The real gain is narrower and worth stating precisely: those five assertions pin one specific string, so they protect `apps/web` and nothing else. The primitive makes the coupling hold for **any** id — including a future Feld client's `mainId`, where no such pinned pair exists. That is exactly what the `mainId: "inhalt-feld"` test proves, and it is why the default value stays `"hauptinhalt"`: the Werkbank rebuild must not have to move a string that five assertions already hold.

### D4 — `packages/ui` must not import a router; the link element is injected

`DateRangeControl` renders navigation targets. It may not import `next/link` (framework independence) and it may not fall back to a bare `<a>` (that would turn every soft App-Router navigation into a full page load — a real behaviour change on `/planung`). It therefore accepts `linkComponent`, defaulting to `"a"`, and `apps/web` passes a five-line adapter around `next/link`.

An adapter rather than passing `Link` directly: `next/link`'s prop type is wide (`href: Url`) and its assignability to a narrow injected-component type is a TypeScript gamble that would be discovered only at `typecheck`. The adapter is deterministic and costs five lines.

### D5 — `DateRangeControl` receives its `data-testid` values as props

`werkbank-woche-iso` and `werkbank-woche-bereich` are pinned by Playwright and by four jsdom suites. Hard-coding them inside `@easytree/ui` would put German domain vocabulary into the domain-free package; dropping them would break `web-smoke` silently (Playwright does not run in `pnpm test`). Passing them keeps both properties: the package stays vocabulary-free, and every existing selector survives byte-identical.

### D6 — CSS class names move with the DOM they style

The primitives emit `eyt-`-prefixed classes, matching every existing primitive (`eyt-card`, `eyt-page-header`, `eyt-button`). The corresponding blocks in `apps/web/app/globals.css` are **renamed, not duplicated**. The dividing line is who renders the element: the primitive owns skip-link, header, brand span, session wrapper, main and footer, so those six selectors move; `apps/web` still renders the nav list, the organisation controls and the logout/login control itself, so `app-nav-list`, `app-org-name`, `app-org-select`, `app-org-select__label`, `app-logout` and `app-login-link` stay untouched. No test references a class name (measured above), so the rename is invisible to the suites — which is exactly why Task 3 Step 6 counts the old selectors down to zero by hand.

### D7 — The boundary is proven by an executable rule, not by a comment

There is no guard today that stops `packages/ui` importing `@easytree/domain`, `@easytree/contracts` or `next/navigation`. Task 1 adds `ui-dependency-allowlist` to the existing, already-required `architecture.test.ts` (job `unit-tests`). Allowlist, not blocklist — the same reasoning the file header already gives for `domain-allowlist`: a blocklist cannot express "domain-free".

### D8 — The plan file is **not** committed

`docs/plans/` is untracked-but-unignored, so Prettier checks it (see CLAUDE.md _Commands_). Keep this file Prettier-clean, and never `git add` it: a generated execution plan inside the slice is its own review finding.

---

## Task 1: The architecture rule that makes the boundary real

**Files:**

- Modify: `apps/api/test/architecture/rules.ts` (add `UI_ALLOWED_PACKAGES` near `API_ALLOWED_PACKAGES:98-108`; add rule to `RULES:110-282`)
- Modify: `apps/api/test/architecture-red-case.test.ts` (add one `it`)

**Step 1: Write the failing red-case test**

Append inside the existing `describe("Rot-Fall", …)` in `apps/api/test/architecture-red-case.test.ts`:

```ts
it("faengt Domain-, Vertrags- und Routerimporte in packages/ui", () => {
  // Die drei realistischen Einbruchstellen einer geteilten UI-Bibliothek:
  // ein Domaintyp „nur fuer die Typisierung", ein Vertrags-DTO „nur fuer die
  // Props", und der Router, weil ein Link ja irgendwohin muss. Alle drei
  // wuerden `packages/ui` an easyTree binden und die Wiederverwendung in der
  // Feld-App unmoeglich machen.
  write(
    "packages/ui/src/bad.tsx",
    [
      'import type { PlanningWeek } from "@easytree/domain";',
      'import type { SessionDto } from "@easytree/contracts";',
      'import Link from "next/link";',
      'import { useRouter } from "next/navigation";',
      "export const bad = [Link, useRouter] as const;",
      "export type Props = { week: PlanningWeek; session: SessionDto };",
    ].join("\n") + "\n",
  );

  const found = violationsFor().violations.filter((v) => v.rule === "ui-dependency-allowlist");
  const messages = found.map((v) => v.message);
  for (const needle of [
    "@easytree/domain",
    "@easytree/contracts",
    "next/link",
    "next/navigation",
  ]) {
    expect(
      messages.some((m) => m.includes(needle)),
      `nicht gemeldet: ${needle}`,
    ).toBe(true);
  }
});

it("laesst react und paketinterne Pfade in packages/ui zu", () => {
  // Ohne diese Gegenprobe waere eine Regel, die ALLES meldet, ebenso gruen.
  write("packages/ui/src/ok-nachbar.tsx", "export const nachbar = 1;\n");
  write(
    "packages/ui/src/ok.tsx",
    [
      'import type { ReactNode } from "react";',
      'import { nachbar } from "./ok-nachbar.js";',
      "export const ok = (kind: ReactNode) => [kind, nachbar];",
    ].join("\n") + "\n",
  );

  const gemeldet = violationsFor()
    .violations.filter((v) => v.rule === "ui-dependency-allowlist")
    .filter((v) => v.file === "packages/ui/src/ok.tsx");
  expect(gemeldet).toEqual([]);
});
```

**Step 2: Run it to verify it fails**

```bash
pnpm --filter @easytree/api exec vitest run test/architecture-red-case.test.ts
```

Expected: FAIL. Read the printed **file count ≥ 1** first (a path filter that matches nothing exits 0 — see CLAUDE.md). The first new case fails with `nicht gemeldet: @easytree/domain`, because no rule with id `ui-dependency-allowlist` exists yet.

**Step 3: Add the allowlist constant**

In `apps/api/test/architecture/rules.ts`, directly after the `API_ALLOWED_PACKAGES` block (ends line 108):

```ts
/**
 * Was `packages/ui/src` importieren darf (EYT-80).
 *
 * Absichtlich eine ALLOWLIST — dieselbe Lehre wie bei `domain-allowlist` im
 * Dateikopf: „domaenenfrei" ist ein universelles Verbot, und eine endliche
 * Liste verbotener Pakete kann es nie ausdruecken. Eine Sperrliste
 * `["@easytree/domain", "next"]` liesse `next/link`, `@easytree/domain/dist/…`
 * und jedes kuenftige Fachpaket durch.
 *
 * `react` steht hier, weil ein React-Primitive ohne React keins ist. Ein
 * Routerpaket steht bewusst NICHT hier: `DateRangeControl` bekommt sein
 * Link-Element injiziert, damit dasselbe Primitive spaeter die Feld-App
 * bedienen kann (EYT-80, Zwei-Client-Architektur, Confluence 8486960).
 */
const UI_ALLOWED_PACKAGES: readonly RegExp[] = [/^react$/, /^react\/jsx-runtime$/];

const UI_PACKAGE = "packages/ui/src/";
```

**Step 4: Add the rule**

In the same file, append as the last entry of `RULES` (after the `no-contract-testing-in-production-code` entry, before the closing `];` on line 282):

```ts
  {
    // EYT-80 — `packages/ui` ist domaenenfrei, API-frei, auth-frei und
    // routerunabhaengig (ADR-001 Z. 77, Basisdesign v2.0, Zwei-Client-
    // Architektur). Bis EYT-80 war das eine Zusage im Dateikopf von
    // `packages/ui/src/index.ts` und sonst nirgends: KEINE Regel hatte
    // `packages/ui` im Geltungsbereich, gemessen 27.08.2026.
    id: "ui-dependency-allowlist",
    inScope: (file): boolean => file.startsWith(UI_PACKAGE),
    check: (ref): string | null => {
      if (ref.isTypeReference) {
        return `packages/ui darf keine /// <reference types="${ref.specifier}" /> fuehren — sie zieht eine ganze Ambient-Oberflaeche in den Scope.`;
      }
      if (!ref.specifier.startsWith(".")) {
        if (UI_ALLOWED_PACKAGES.some((allowed) => allowed.test(ref.specifier))) return null;
        return `"${ref.specifier}" steht nicht auf der Importliste von packages/ui/src. Erlaubt sind ausschliesslich react und paketinterne relative Pfade — Fachbegriffe, Vertraege, Router und HTTP-Clients gehoeren in die Anwendung (EYT-80).`;
      }
      if (ref.resolved === null) {
        return `Relativer Import "${ref.specifier}" ist nicht aufloesbar — der Scanner koennte ihn sonst stillschweigend uebergehen.`;
      }
      if (!ref.resolved.startsWith(UI_PACKAGE)) {
        return `packages/ui darf nicht nach "${ref.resolved}" hinausgreifen (EYT-80).`;
      }
      return null;
    },
  },
```

**Step 5: Run the red case again**

```bash
pnpm --filter @easytree/api exec vitest run test/architecture-red-case.test.ts
```

Expected: PASS, file count 1.

**Step 6: Run the real architecture test — the rule must see real files**

```bash
pnpm --filter @easytree/api exec vitest run test/architecture.test.ts
```

Expected: PASS. `architecture.test.ts:102-104` demands every rule id sees ≥ 1 file; `packages/ui/src` has 10 `react` imports today, so `ui-dependency-allowlist` is non-vacuous from the first run. Read the printed `[architecture] … rules=10 violations=0` line — `rules=10`, not 9. (`vitest` swallows `console.log`; add `--disableConsoleIntercept` or the gate line never appears.) Measured at commit `d3e7bff`: `[architecture] files=333 imports=1332 modules=5 rules=10 violations=0`.

**Step 7: Commit**

```bash
git add apps/api/test/architecture/rules.ts apps/api/test/architecture-red-case.test.ts
git diff --cached --name-only
git commit -m "test(arch): EYT-80 packages/ui bekommt eine ausfuehrbare Importgrenze"
```

---

## Task 2: `AppShell` in `@easytree/ui`

**Files:**

- Create: `packages/ui/src/app-shell.tsx`
- Modify: `packages/ui/src/index.ts`
- Create: `packages/ui/test/app-shell.test.tsx`

**Step 1: Write the failing test**

Create `packages/ui/test/app-shell.test.tsx`:

```tsx
/**
 * `AppShell` — der domaenenfreie Rahmen (EYT-80, Basisdesign v2.0 §3.1).
 *
 * ## Was hier bewiesen wird
 *
 * Dass der Rahmen STRUKTUR ist und sonst nichts: Landmarks, Sprunganker,
 * Reihenfolge. Er entscheidet nicht, welche Navigationspunkte es gibt, ob
 * jemand angemeldet ist oder welche Organisation gewaehlt wurde — das alles
 * kommt als fertiges `ReactNode` herein und wird nur hingestellt.
 *
 * ## Warum der Sprunganker seine eigene Zusicherung bekommt
 *
 * In `apps/web/components/app-shell.tsx` standen bis EYT-80 ZWEI Literale:
 * `href="#hauptinhalt"` und `id="hauptinhalt"`. Nichts zwang sie, gleich zu
 * bleiben; ein Tippfehler in einem der beiden haette den Sprunganker ins Leere
 * zeigen lassen, und die a11y-Suite haette ihn weiterhin gefunden. Hier ist es
 * EIN Wert, und die Zusicherung prueft die Kopplung, nicht den Wortlaut.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell } from "../src/index.js";

afterEach(cleanup);

function rahmen(zusatz: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return render(
    <AppShell skipLinkLabel="Zum Inhalt" brand={<span>Marke</span>} {...zusatz}>
      <p>Seiteninhalt</p>
    </AppShell>,
  );
}

describe("AppShell — Struktur", () => {
  it("stellt genau eine banner-, main- und contentinfo-Landmark", () => {
    rahmen({ footer: <p>Fusszeile</p> });
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  });

  it("laesst die Fusszeile weg, wenn keine uebergeben wurde", () => {
    rahmen();
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });

  it("stellt Kinder in den Hauptbereich, nicht daneben", () => {
    rahmen();
    expect(screen.getByRole("main").contains(screen.getByText("Seiteninhalt"))).toBe(true);
  });

  it("stellt Marke, Navigation und Sitzungsbereich in den Kopf", () => {
    rahmen({ navigation: <nav aria-label="Test">Punkte</nav>, sessionArea: <span>Sitzung</span> });
    const kopf = screen.getByRole("banner");
    expect(kopf.contains(screen.getByText("Marke"))).toBe(true);
    expect(kopf.contains(screen.getByRole("navigation", { name: "Test" }))).toBe(true);
    expect(kopf.contains(screen.getByText("Sitzung"))).toBe(true);
  });
});

describe("AppShell — der Sprunganker und die Landmark sind EIN Wert", () => {
  it("zeigt mit der Vorgabe auf den Hauptbereich", () => {
    rahmen();
    const anker = screen.getByRole("link", { name: "Zum Inhalt" });
    expect(anker.getAttribute("href")).toBe(`#${screen.getByRole("main").id}`);
    expect(screen.getByRole("main").id).toBe("hauptinhalt");
  });

  it("folgt einer abweichenden id, ohne dass ein zweites Literal gepflegt wird", () => {
    // Der Kern der Zusicherung: EIN Prop bewegt BEIDE Seiten. Mit zwei
    // Literalen im Rahmen wuerde diese Erwartung fehlschlagen.
    rahmen({ mainId: "inhalt-feld" });
    expect(screen.getByRole("link", { name: "Zum Inhalt" }).getAttribute("href")).toBe(
      "#inhalt-feld",
    );
    expect(screen.getByRole("main").id).toBe("inhalt-feld");
  });

  it("macht den Hauptbereich programmatisch fokussierbar, ohne ihn in die Tabfolge zu nehmen", () => {
    rahmen();
    expect(screen.getByRole("main").getAttribute("tabindex")).toBe("-1");
  });

  it("setzt den Sprunganker als ERSTES Element des Dokuments", () => {
    const { container } = rahmen();
    // Reihenfolge, nicht Existenz: ein Sprunganker hinter der Navigation ist
    // kein Sprunganker (a11y-Checkliste #2).
    expect(container.firstElementChild?.tagName).toBe("A");
    expect(container.firstElementChild?.getAttribute("href")).toBe("#hauptinhalt");
  });
});
```

**Step 2: Run it to verify it fails**

```bash
pnpm --filter @easytree/ui exec vitest run test/app-shell.test.tsx
```

Expected: FAIL with `No "AppShell" export is defined on the "../src/index.js" mock` / `AppShell is not a function`. Confirm the printed file count is `1`.

**Step 3: Write the primitive**

Create `packages/ui/src/app-shell.tsx`:

```tsx
import type { ReactNode } from "react";

export interface AppShellProps {
  /**
   * Beschriftung des Sprungankers. Bewusst PFLICHT und ohne Vorgabe: eine
   * deutsche Vorgabe hier waere Produkttext im domaenenfreien Paket und wuerde
   * die Wortwahl der Werkbank stillschweigend in die Feld-App tragen.
   */
  skipLinkLabel: string;
  /** Marken-/Logobereich links im Kopf. */
  brand: ReactNode;
  /**
   * Navigationsbereich. Der Rahmen stellt ihn nur hin — WELCHE Punkte darin
   * stehen und nach welchen Rechten gefiltert wird, entscheidet die Anwendung.
   * Auch das `<nav>` samt zugaenglichem Namen gehoert dorthin: der Rahmen
   * kennt die Sprache der Anwendung nicht.
   */
  navigation?: ReactNode;
  /** Rechter Kopfbereich — Sitzung, Organisation, Abmelden. */
  sessionArea?: ReactNode;
  /** Fusszeile. Fehlt sie, entsteht gar keine contentinfo-Landmark. */
  footer?: ReactNode;
  /**
   * id der main-Landmark UND Ziel des Sprungankers — EIN Wert, nicht zwei
   * Literale, die auseinanderlaufen koennen. Das ist der einzige Vorgabewert
   * dieses Rahmens, weil er DOM-Vertrag ist und keine Sprache.
   */
  mainId?: string;
  children: ReactNode;
}

/**
 * Der Anwendungsrahmen (Basisdesign v2.0 §3.1): Sprunganker, Kopfleiste mit
 * Marke/Navigation/Sitzungsbereich, Hauptbereich, optionale Fusszeile.
 *
 * Domaenenfrei im woertlichen Sinn: dieses Modul importiert `react` und sonst
 * nichts — keine Sitzung, keine Rechte, keinen Router, keinen Fachbegriff.
 * Erzwungen wird das von der Regel `ui-dependency-allowlist` im Pflichtjob
 * `unit-tests`, nicht von diesem Kommentar.
 *
 * Styling gehoert der Anwendung: das Paket vergibt nur `eyt-app-shell*`-Klassen
 * (wie jedes andere Primitive hier auch), die Regeln stehen in
 * `apps/web/app/globals.css`.
 */
export function AppShell({
  skipLinkLabel,
  brand,
  navigation,
  sessionArea,
  footer,
  mainId = "hauptinhalt",
  children,
}: AppShellProps): ReactNode {
  return (
    <>
      <a className="eyt-app-shell__skip-link" href={`#${mainId}`}>
        {skipLinkLabel}
      </a>
      <header className="eyt-app-shell__header">
        <span className="eyt-app-shell__brand">{brand}</span>
        {navigation}
        {sessionArea === undefined ? null : (
          <div className="eyt-app-shell__session">{sessionArea}</div>
        )}
      </header>
      <main id={mainId} tabIndex={-1} className="eyt-app-shell__main">
        {children}
      </main>
      {footer === undefined ? null : <footer className="eyt-app-shell__footer">{footer}</footer>}
    </>
  );
}
```

**Step 4: Export it**

In `packages/ui/src/index.ts`, append after the `LoadingState` line (line 28):

```ts
export { AppShell, type AppShellProps } from "./app-shell.js";
```

**Step 5: Run the test to verify it passes**

```bash
pnpm --filter @easytree/ui exec vitest run test/app-shell.test.tsx
```

Expected: PASS, 9 tests, file count 1.

**Step 6: Prove the boundary rule still sees this file and stays green**

```bash
pnpm --filter @easytree/api exec vitest run test/architecture.test.ts
```

Expected: PASS with `violations=0`.

**Step 7: Commit**

```bash
git add packages/ui/src/app-shell.tsx packages/ui/src/index.ts packages/ui/test/app-shell.test.tsx
git diff --cached --name-only
git commit -m "feat(ui): EYT-80 domaenenfreier AppShell mit einem Anker statt zwei Literalen"
```

---

## Task 3: `apps/web` composes the shared shell

**Files:**

- Modify: `apps/web/components/app-shell.tsx` (whole render body; lines 38-110)
- Modify: `apps/web/app/globals.css` (lines 97-112, 114-121, 147-159, 258-260)

**Step 1: Add the failing regression test for the coupling that must NOT move**

Append to `apps/web/test/a11y.test.tsx`, after the existing `describe("Accessibility-Baseline der Shell (EYT-41)", …)` block:

```tsx
/**
 * EYT-80 — die Shell komponiert den geteilten Rahmen, ohne Politik abzugeben.
 *
 * Diese Zusicherungen sind der Gegenpol zur Extraktion: sie halten fest, dass
 * NACH dem Umbau immer noch `apps/web` entscheidet, wer welche Punkte sieht,
 * und dass der Sprunganker weiterhin auf die eine main-Landmark zeigt. Ohne
 * sie waere „AppShell benutzt jetzt @easytree/ui" eine Behauptung ueber den
 * Import und keine ueber das Verhalten.
 */
describe("AppShell — Komposition ohne Politikverlust (EYT-80)", () => {
  it("haelt Sprunganker und main-Landmark auf demselben Ziel", () => {
    const { getByRole } = renderShell();
    const anker = getByRole("link", { name: /zum hauptinhalt springen/i });
    expect(anker.getAttribute("href")).toBe(`#${getByRole("main").id}`);
  });

  it("stellt Marke und Navigation weiterhin in die banner-Landmark", () => {
    const { getByRole } = renderShell();
    const kopf = getByRole("banner");
    expect(kopf.textContent).toContain("easyTree");
    expect(kopf.contains(getByRole("navigation", { name: "Hauptnavigation" }))).toBe(true);
  });

  it("traegt die Fusszeile als contentinfo", () => {
    const { getByRole } = renderShell();
    expect(getByRole("contentinfo").textContent).toContain("Arboscus Teamplaner");
  });
});
```

**Step 2: Run it — it must PASS on the unchanged code**

```bash
pnpm --filter @easytree/web exec vitest run test/a11y.test.tsx
```

Expected: PASS. This is a **characterisation** test, not a red-first test: it pins behaviour that already exists so the refactor cannot change it unnoticed. Its red phase is Step 6.

**Step 3: Commit the characterisation**

```bash
git add apps/web/test/a11y.test.tsx
git diff --cached --name-only
git commit -m "test(web): EYT-80 Shellverhalten vor der Extraktion festschreiben"
```

**Step 4: Refactor the web shell to compose the primitive**

Replace `apps/web/components/app-shell.tsx` lines 1-7 (the import block) with:

```tsx
"use client";

import { AppShell as UiAppShell } from "@easytree/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useSession } from "../lib/session-provider";
```

Then replace the entire `return ( … );` body (lines 38-110) with:

```tsx
return (
  <UiAppShell
    skipLinkLabel="Zum Hauptinhalt springen"
    brand="easyTree"
    navigation={
      <nav aria-label="Hauptnavigation">
        <ul className="app-nav-list">
          {navPunkte.map((punkt) => (
            <li key={punkt.href}>
              <Link
                href={punkt.href}
                aria-current={
                  pfad === punkt.href || (punkt.href !== "/" && pfad.startsWith(punkt.href))
                    ? "page"
                    : undefined
                }
              >
                {punkt.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    }
    sessionArea={
      angemeldet ? (
        <>
          {organisationen.length > 1 ? (
            <label className="app-org-select">
              <span className="app-org-select__label">Organisation</span>
              <select
                value={organisation?.id ?? ""}
                onChange={(ereignis) => organisationWaehlen(ereignis.target.value)}
              >
                <option value="" disabled>
                  Bitte wählen
                </option>
                {organisationen.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="app-org-name">{organisation?.name ?? ""}</span>
          )}
          <button
            type="button"
            className="app-logout"
            onClick={() => {
              void abmelden().then(() => router.push("/anmelden"));
            }}
          >
            Abmelden
          </button>
        </>
      ) : (
        <Link href="/anmelden" className="app-login-link">
          Anmelden
        </Link>
      )
    }
    footer={<p>easyTree — Arboscus Teamplaner</p>}
  >
    {children}
  </UiAppShell>
);
```

Also update the file-header comment (lines 9-17) — add one paragraph, keep the existing two:

```
 * Seit EYT-80 stellt der Rahmen selbst nichts mehr her: Sprunganker, Kopf,
 * Hauptbereich und Fusszeile kommen aus `@easytree/ui`. Was hier bleibt, ist
 * genau das, was dort nicht hingehoert — Sitzung, Rechtefilter,
 * Organisationswahl, Abmelden und der Router. Der Sprunganker und die
 * main-Landmark sind dort EIN Wert; hier standen dafuer zwei Literale.
```

**Step 5: Rename the six selectors whose DOM moved — eight edits, because `.app-header` is declared twice**

In `apps/web/app/globals.css`:

| Line    | From                                                | To                                                                                |
| ------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| 97      | `.skip-link {`                                      | `.eyt-app-shell__skip-link {`                                                     |
| 109-110 | `.skip-link:focus-visible,`<br>`.skip-link:focus {` | `.eyt-app-shell__skip-link:focus-visible,`<br>`.eyt-app-shell__skip-link:focus {` |
| 114     | `.app-header {`                                     | `.eyt-app-shell__header {`                                                        |
| 123     | `.app-brand {`                                      | `.eyt-app-shell__brand {`                                                         |
| 147     | `.app-main {`                                       | `.eyt-app-shell__main {`                                                          |
| 155     | `.app-footer {`                                     | `.eyt-app-shell__footer {`                                                        |
| 258     | `.app-header {`                                     | `.eyt-app-shell__header {`                                                        |
| 262     | `.app-session {`                                    | `.eyt-app-shell__session {`                                                       |

`.app-nav-list`, `.app-nav-list a`, `.app-org-name`, `.app-org-select`, `.app-org-select__label`, `.app-logout`, `.app-login-link` stay exactly as they are — `apps/web` still renders those elements.

**Step 6: Verify the rename left nothing behind — by NAME, not by count**

```bash
grep -cE '^\.(skip-link|app-header|app-brand|app-main|app-footer|app-session)[ ,:{]' apps/web/app/globals.css
```

Expected: `0`. A non-zero number is an orphaned rule styling nothing.

Then the other direction — and it must check the **exact set of names**, not a total. An earlier draft counted `grep -cE 'eyt-app-shell__'` and expected `9`; a misspelled selector such as `.eyt-app-shell__mian` satisfies that count perfectly. Print the sorted set instead:

```bash
grep -oE '^\.eyt-app-shell__[a-z-]+' apps/web/app/globals.css | sort -u
```

Expected, exactly these six lines and no others:

```
.eyt-app-shell__brand
.eyt-app-shell__footer
.eyt-app-shell__header
.eyt-app-shell__main
.eyt-app-shell__session
.eyt-app-shell__skip-link
```

**Step 6a: A test that couples the emitted classes to the stylesheet**

The root cause behind every CSS finding in this increment: nothing in the repo connects a class name emitted by `packages/ui` to a rule in `globals.css`. That is not a suspicion — measured 2026-08-27, **eight** already-shipped classes have zero rules today and everything is green (`eyt-empty-state__action`, `eyt-loading-state__label`, `eyt-page-header__actions`, `eyt-page-header__text`, `eyt-state-banner__action`, `eyt-state-banner__detail`, `eyt-state-banner__text`, `eyt-status-badge__mark`). There is no stylelint (`ls .stylelintrc*` → no matches) and no test reads the file.

Add `apps/web/test/app-shell-styles.test.ts` — scoped deliberately to the six classes this increment moves, **not** to every `packages/ui` class, because the general form would be red today and needs its own justified exception list:

```ts
/**
 * Die sechs Klassen des geteilten Rahmens haben eine Regel (EYT-80).
 *
 * Ohne diese Zusicherung ist die Umbenennung in `globals.css` ungedeckt: kein
 * Test und kein e2e-Nachweis nennt eine Klassenname, und jede der sechs Regeln
 * koennte beim Umbenennen verlorengehen, ohne dass einer der elf Pflichtjobs
 * rot wird. Der teuerste Einzelfall waere `.eyt-app-shell__skip-link` — ohne
 * `position: absolute; top: -100%` stuende der Sprunganker dauerhaft sichtbar
 * auf jeder Seite, und alle vier bestehenden Sprunganker-Zusicherungen pruefen
 * Existenz, Reihenfolge und Fokus, nie Sichtbarkeit.
 *
 * Bewusst auf diese sechs eingegrenzt: die allgemeine Fassung „jede von
 * packages/ui emittierte Klasse hat eine Regel" waere HEUTE rot (acht Klassen
 * ohne Regel, gemessen 27.08.2026) und braucht zuerst eine begruendete
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
```

Run it, then EXECUTE the counter-mutation: delete the `.eyt-app-shell__skip-link` block from `globals.css`, confirm two of these tests go red, restore, prove with an empty scoped `git diff`.

**Step 6b: Browser assertions for what jsdom cannot see**

Five geometry/visibility facts carry the Basisdesign v2.0 layout and none is measured today. Add them to the existing `apps/web/e2e/shell-smoke.spec.ts` (required job `web-smoke`, and Playwright can read computed geometry), except the last which is cheaper in jsdom.

1. **Skip link off-screen until focused.** Before any Tab, its `getBoundingClientRect().bottom` must be `<= 0`; after one Tab it must be focused and its `top` `>= 0`. Counter-mutation: delete the `.eyt-app-shell__skip-link` positioning block → the first assertion reports a positive `bottom`.
2. **Header is one row with the session area pushed right.** At viewport 1280, the gap from the session control's right edge to the header's right edge must be smaller than the gap from the header's left edge to the control's left edge. Covers `.eyt-app-shell__header{display:flex}` **and** `.eyt-app-shell__session{margin-left:auto}` in one assertion. Two counter-mutations, each flipping the inequality.
3. **Main is a centred, bounded column.** At viewport 1440, `main` width `< 1440` and left/right margins equal within 2 px. Counter-mutations: drop `max-width: 60rem` → first fails; drop `margin: 0 auto` → second fails.
4. **Touch target.** The `Anmelden` control's box height `>= 40` (Basisdesign v2.0 §2.3). Counter-mutation: remove `min-height: 40px` from `.app-logout, .app-login-link` — **read the actual height from the red run and record it**; the arithmetic estimate of ~38 px is a derivation, not a measurement.
5. **Navigation and footer are named landmarks** — two lines in the existing `apps/web/test/a11y.test.tsx`, no browser needed: the banner contains `getByRole("navigation", { name: "Hauptnavigation" })`, and `getByRole("contentinfo")` contains "Arboscus". Counter-mutations: drop the `aria-label`; omit the `footer` prop.

Do **not** re-assert what is already sharply caught: `skipLinkLabel`, `mainId`, `tabIndex={-1}`, a missing `sessionArea`, a missing `navigation`, a duplicate `main` landmark and a missing header per route are each already pinned by `a11y.test.tsx`, `planung-a11y.test.tsx`, `planung-zugang.test.tsx` or `shell-smoke.spec.ts`.

Note for item 4's counter-mutation: a prefix-wide `sed 's/\.app-/.eyt-app-shell__/g'` would silently rewrite **eight** selectors whose elements stay in `apps/web` (`.app-nav-list`, `.app-nav-list a`, `.app-nav-list a[aria-current="page"]`, `.app-org-name`, `.app-org-select`, `.app-org-select__label`, `.app-logout`, `.app-login-link`). Rename by exact selector, never by prefix.

**Step 7: Run the web suite**

```bash
pnpm --filter @easytree/ui build
pnpm --filter @easytree/web test
```

Expected: PASS. `@easytree/ui` must be built first — `apps/web` resolves `@easytree/ui` through `dist/`, and an unbuilt package makes the whole suite fail to resolve (see the project memory on `apps/web` reading `dist`, not source).

**Step 7a: Re-verify every line number cited in a comment — this task moves the files they point at**

Tasks 1 and 2 wrote comments citing exact sites (`a11y.test.tsx:80` / `:90`, `planung-a11y.test.tsx:82`, `shell-smoke.spec.ts:65` / `:68` / `:142`, `globals.css:83-88`, `:123`, `:147`, `:262`), each stamped `gemessen 27.08.2026`. This task edits `apps/web/app/globals.css`, `apps/web/test/a11y.test.tsx` and `apps/web/e2e/shell-smoke.spec.ts`, so several of those numbers move.

A stale `gemessen`-stamped line number is the same defect class this increment already corrected twice. Re-derive each one and correct it:

```bash
grep -n 'hauptinhalt' apps/web/test/a11y.test.tsx apps/web/test/planung-a11y.test.tsx apps/web/e2e/shell-smoke.spec.ts
grep -n 'display: flex' apps/web/app/globals.css | head -3
grep -nE '^\.eyt-app-shell__(brand|main|session)' apps/web/app/globals.css
grep -rn 'gemessen 27.08.2026' packages/ui/src apps/api/test/architecture
```

Every line reference inside a comment must match what the last command's targets actually contain now. Where a citation has moved, update the number; where the cited fact itself no longer holds, rewrite the claim rather than the number.

**Step 8: Commit**

```bash
git add apps/web/components/app-shell.tsx apps/web/app/globals.css \
        apps/web/test/app-shell-styles.test.ts apps/web/test/a11y.test.tsx \
        apps/web/e2e/shell-smoke.spec.ts
git diff --cached --name-only
git commit -m "refactor(web): EYT-80 die Shell komponiert den geteilten Rahmen"
```

Read back the staged list: exactly those five paths, plus any `packages/ui` file only if Step 7a required a comment correction there. Nothing else.

---

## Task 4: `DateRangeControl` in `@easytree/ui`

**Files:**

- Create: `packages/ui/src/date-range-control.tsx`
- Modify: `packages/ui/src/index.ts`
- Create: `packages/ui/test/date-range-control.test.tsx`

**Step 1: Write the failing test**

Create `packages/ui/test/date-range-control.test.tsx`:

```tsx
/**
 * `DateRangeControl` — blaettert, rechnet aber nicht (EYT-80).
 *
 * ## Jede Erwartung ist ein SENTINEL
 *
 * Dasselbe Muster wie in `apps/web/test/wochen-navigation.test.tsx`: die
 * Modelle tragen Werte, die keine Rechnung erzeugen kann. Steht der Sentinel
 * im DOM, hat das Primitive DURCHGEREICHT; rechnet es selbst, steht dort etwas
 * anderes und die Zusicherung faellt. Ein Test, der die erwartete Adresse
 * selbst zusammensetzt, prueft nur seine eigene Reimplementierung.
 *
 * ## Warum die Sentinels asymmetrisch sind
 *
 * `previous`, `next` und `reset` sind gleich getypt und damit vertauschbar,
 * ohne dass ein Typ es meldet. Drei unterscheidbare Werte plus eine Zusicherung
 * je Bedienelement machen jede Vertauschung sichtbar.
 *
 * ## Warum das Link-Element injiziert wird
 *
 * `@easytree/ui` darf keinen Router importieren (Regel
 * `ui-dependency-allowlist`), und ein festverdrahtetes `<a>` wuerde in einer
 * Next-App aus jeder weichen Navigation einen vollen Seitenwechsel machen. Der
 * Test unten belegt, dass die Injektion wirklich benutzt wird — sonst waere
 * `linkComponent` eine Zusage ohne Leser.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { DateRangeControl } from "../src/index.js";

afterEach(cleanup);

const VOLL = {
  label: "SENTINEL-BEREICHSNAME",
  previous: { label: "Zurueck", href: "/x?k=SENTINEL-VOR", testId: "sentinel-vor" },
  next: { label: "Vor", href: "/x?k=SENTINEL-NACH", testId: "sentinel-nach" },
  reset: { label: "Anker", href: "/x?k=SENTINEL-ANKER", testId: "sentinel-anker" },
  rangeLabel: "SENTINEL-BESCHRIFTUNG",
  rangeKey: "SENTINEL-SCHLUESSEL",
  rangeDetail: "SENTINEL-DETAIL",
  rangeLabelTestId: "sentinel-bereich",
  rangeDetailTestId: "sentinel-detailfeld",
} as const;

function element(name: string): HTMLElement {
  return screen.getByRole("link", { name });
}

describe("DateRangeControl — reicht durch, rechnet nicht", () => {
  it("verlinkt rueckwaerts auf genau die uebergebene Adresse", () => {
    render(<DateRangeControl {...VOLL} />);
    expect(element("Zurueck").getAttribute("href")).toBe("/x?k=SENTINEL-VOR");
  });

  it("verlinkt vorwaerts auf genau die uebergebene Adresse", () => {
    render(<DateRangeControl {...VOLL} />);
    expect(element("Vor").getAttribute("href")).toBe("/x?k=SENTINEL-NACH");
  });

  it("verlinkt den Rueckweg auf genau die uebergebene Adresse", () => {
    render(<DateRangeControl {...VOLL} />);
    expect(element("Anker").getAttribute("href")).toBe("/x?k=SENTINEL-ANKER");
  });

  it("zeigt Beschriftung und kanonischen Schluessel unveraendert — als GANZEN Text", () => {
    render(<DateRangeControl {...VOLL} />);
    // Gleichheit, nicht Enthaltensein: mit `toContain` bliebe diese Zusicherung
    // gruen, wenn das Primitive eine ZWEITE, widersprechende Bereichsaussage in
    // dieselbe Flaeche setzte.
    expect(screen.getByTestId("sentinel-bereich").textContent).toBe(
      "SENTINEL-BESCHRIFTUNG SENTINEL-SCHLUESSEL",
    );
  });

  it("haelt den kanonischen Schluessel im Accessibility-Tree, aber nicht auf der Flaeche", () => {
    render(<DateRangeControl {...VOLL} />);
    const versteckt = screen.getByText("SENTINEL-SCHLUESSEL");
    expect(versteckt.style.position).toBe("absolute");
    expect(versteckt.style.width).toBe("1px");
  });

  it("zeigt den Detailtext unveraendert an", () => {
    render(<DateRangeControl {...VOLL} />);
    expect(screen.getByTestId("sentinel-detailfeld").textContent).toBe("SENTINEL-DETAIL");
  });

  it("gibt dem Bereich einen eigenen zugaenglichen Namen", () => {
    render(<DateRangeControl {...VOLL} />);
    expect(screen.getByRole("navigation", { name: "SENTINEL-BEREICHSNAME" })).toBeTruthy();
  });

  it("traegt genau ein Bedienelement je Richtung", () => {
    render(<DateRangeControl {...VOLL} />);
    for (const name of ["Zurueck", "Vor", "Anker"]) {
      expect(screen.getAllByRole("link", { name })).toHaveLength(1);
    }
  });
});

describe("DateRangeControl — der Zustand steht im TEXT, nicht in der Farbe", () => {
  it("nennt den laufenden Bereich im Klartext und setzt aria-current", () => {
    render(
      <DateRangeControl
        {...VOLL}
        currentMarker="SENTINEL-MARKE"
        currentMarkerTestId="sentinel-marke"
        reset={{ ...VOLL.reset, current: true }}
      />,
    );
    expect(screen.getByTestId("sentinel-marke").textContent).toBe("SENTINEL-MARKE");
    expect(element("Anker").getAttribute("aria-current")).toBe("page");
  });

  it("nennt ihn nicht, wenn kein Marker uebergeben wurde", () => {
    render(<DateRangeControl {...VOLL} />);
    expect(screen.queryByTestId("sentinel-marke")).toBeNull();
    expect(element("Anker").getAttribute("aria-current")).toBeNull();
  });
});

describe("DateRangeControl — der reduzierte Fall ist keine Sackgasse", () => {
  it("laesst genau den Rueckweg stehen, wenn es keine Nachbarn und keinen Bereich gibt", () => {
    render(
      <DateRangeControl
        label={VOLL.label}
        reset={VOLL.reset}
        rangeLabelTestId="sentinel-bereich"
      />,
    );
    expect(element("Anker").getAttribute("href")).toBe("/x?k=SENTINEL-ANKER");
    expect(screen.queryByRole("link", { name: "Zurueck" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Vor" })).toBeNull();
    // Ohne Beschriftung entsteht das Feld gar nicht erst — ein leeres Feld mit
    // testid waere fuer jede Abwesenheitszusicherung ein falsches Gruen.
    expect(screen.queryByTestId("sentinel-bereich")).toBeNull();
  });
});

describe("DateRangeControl — das Link-Element ist injizierbar", () => {
  it("benutzt die uebergebene Komponente statt eines nackten a", () => {
    // Ohne diese Zusicherung koennte `linkComponent` stillschweigend ignoriert
    // werden: die href-Zusicherungen oben blieben gruen, und in der echten App
    // wuerde jede weiche Navigation ein voller Seitenwechsel.
    function Marker(eigenschaften: { href: string; children: ReactNode }): ReactNode {
      return (
        <a data-injiziert="ja" href={eigenschaften.href}>
          {eigenschaften.children}
        </a>
      );
    }
    render(<DateRangeControl {...VOLL} linkComponent={Marker} />);
    expect(element("Vor").getAttribute("data-injiziert")).toBe("ja");
  });
});
```

**Step 2: Run it to verify it fails**

```bash
pnpm --filter @easytree/ui exec vitest run test/date-range-control.test.tsx
```

Expected: FAIL — `DateRangeControl is not defined`. File count `1`.

**Step 3: Write the primitive**

Create `packages/ui/src/date-range-control.tsx`:

```tsx
import type { ComponentType, ReactNode } from "react";

import { VisuallyHidden } from "./visually-hidden.js";

/** Die Eigenschaften, die dieses Primitive an ein Link-Element weitergibt. */
export interface DateRangeLinkProps {
  href: string;
  className?: string | undefined;
  "aria-current"?: "page" | undefined;
  "data-testid"?: string | undefined;
  children: ReactNode;
}

/** Ein Ziel des Bereichswechsels — fertig aufgeloest, nie berechnet. */
export interface DateRangeAction {
  /** Zugaenglicher Name des Bedienelements. */
  readonly label: string;
  /** Die fertige Zieladresse. Dieses Paket setzt keine Adressen zusammen. */
  readonly href: string;
  /** Markiert das Ziel als aktuelle Seite. */
  readonly current?: boolean;
  readonly testId?: string;
}

export interface DateRangeControlProps {
  /** Zugaenglicher Name des Navigationsbereichs. */
  label: string;
  previous?: DateRangeAction;
  next?: DateRangeAction;
  /** Der Rueckweg zum Bezugszeitraum. Immer vorhanden — sonst waere der Fehlerfall eine Sackgasse. */
  reset: DateRangeAction;
  /** Sichtbare Beschriftung des Zeitraums. */
  rangeLabel?: string;
  /** Kanonischer Schluessel — bleibt im Accessibility-Tree und im textContent, nicht auf der Flaeche. */
  rangeKey?: string;
  /** Zweite Zeile, etwa der ausgeschriebene Zeitraum. */
  rangeDetail?: string;
  /**
   * TEXT, der den laufenden Zeitraum benennt. Basisdesign v2.0: ein Zustand
   * wird nie NUR ueber Farbe getragen — deshalb ein Wort und kein Farbwert.
   */
  currentMarker?: string;
  rangeLabelTestId?: string;
  rangeDetailTestId?: string;
  currentMarkerTestId?: string;
  testId?: string;
  /**
   * Das Element, das ein Ziel darstellt. Vorgabe ist `"a"`. Eine Anwendung mit
   * eigenem Router reicht hier ihre Link-Komponente herein — dieses Paket darf
   * keinen Router importieren (Regel `ui-dependency-allowlist`) und wuerde mit
   * einem festverdrahteten `<a>` in einer Next-App jede weiche Navigation zu
   * einem vollen Seitenwechsel machen.
   */
  linkComponent?: ComponentType<DateRangeLinkProps> | "a";
}

/**
 * Bedienleiste fuer einen Zeitraum: zurueck, Bezugszeitraum, vor, plus
 * Beschriftung und Detailzeile.
 *
 * ## Dieses Primitive rechnet nicht, es zeigt
 *
 * Kein `new Date()`, keine Kalenderarithmetik, kein Wochenbegriff. Jede Adresse
 * und jeder Text kommt fertig herein. Der Grund ist nicht Geschmack: eine
 * Rechnung hier waere eine ZWEITE Zeitregel neben der der Anwendung, und die
 * beiden liefen genau an den Jahresgrenzen auseinander, an denen `± 1` falsch
 * ist. Ein Darstellungsfehler waere dann von einem Rechenfehler nicht mehr zu
 * unterscheiden. Getragen wird die Zusicherung von den Sentinels in
 * `test/date-range-control.test.tsx` und strukturell von
 * `ui-dependency-allowlist` — nicht von diesem Absatz.
 */
export function DateRangeControl({
  label,
  previous,
  next,
  reset,
  rangeLabel,
  rangeKey,
  rangeDetail,
  currentMarker,
  rangeLabelTestId,
  rangeDetailTestId,
  currentMarkerTestId,
  testId,
  linkComponent: Link = "a",
}: DateRangeControlProps): ReactNode {
  const ziel = (aktion: DateRangeAction): ReactNode => (
    <Link
      href={aktion.href}
      className="eyt-date-range__action"
      {...(aktion.current === true ? { "aria-current": "page" as const } : {})}
      {...(aktion.testId === undefined ? {} : { "data-testid": aktion.testId })}
    >
      {aktion.label}
    </Link>
  );

  return (
    <nav
      aria-label={label}
      className="eyt-date-range"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      {previous === undefined ? null : ziel(previous)}

      {rangeLabel === undefined ? null : (
        <p
          className="eyt-date-range__range"
          {...(rangeLabelTestId === undefined ? {} : { "data-testid": rangeLabelTestId })}
        >
          <span className="eyt-date-range__range-text">{rangeLabel}</span>{" "}
          {rangeKey === undefined ? null : (
            <VisuallyHidden className="eyt-date-range__range-key">{rangeKey}</VisuallyHidden>
          )}
        </p>
      )}
      {rangeDetail === undefined ? null : (
        <p
          className="eyt-date-range__detail"
          {...(rangeDetailTestId === undefined ? {} : { "data-testid": rangeDetailTestId })}
        >
          {rangeDetail}
        </p>
      )}
      {currentMarker === undefined ? null : (
        <p
          className="eyt-date-range__marker"
          {...(currentMarkerTestId === undefined ? {} : { "data-testid": currentMarkerTestId })}
        >
          {currentMarker}
        </p>
      )}

      {ziel(reset)}
      {next === undefined ? null : ziel(next)}
    </nav>
  );
}
```

> **Note on element order:** `previous`, range, detail, marker, `reset`, `next` — byte-for-byte the DOM order `wochen-navigation.tsx` renders today (lines 84-123). Tab order is asserted by `e2e/shell-smoke.spec.ts`'s full tab-cycle test, so the order is not cosmetic.

**Step 4: Export it**

In `packages/ui/src/index.ts`, append:

```ts
export {
  DateRangeControl,
  type DateRangeControlProps,
  type DateRangeAction,
  type DateRangeLinkProps,
} from "./date-range-control.js";
```

**Step 5: Run the test to verify it passes**

```bash
pnpm --filter @easytree/ui exec vitest run test/date-range-control.test.tsx
```

Expected: PASS, 13 tests, file count 1.

**Step 6: Commit**

```bash
git add packages/ui/src/date-range-control.tsx packages/ui/src/index.ts packages/ui/test/date-range-control.test.tsx
git diff --cached --name-only
git commit -m "feat(ui): EYT-80 domaenenfreier DateRangeControl mit injiziertem Link-Element"
```

---

## Task 5: `WochenNavigation` composes `DateRangeControl`

**Files:**

- Modify: `apps/web/components/wochen-navigation.tsx` (whole render body; lines 59-125)
- Modify: `apps/web/app/globals.css` (lines 607-647)

**Step 1: Run the existing suite first — it is the acceptance contract**

```bash
pnpm --filter @easytree/ui build
pnpm --filter @easytree/web exec vitest run test/wochen-navigation.test.tsx
```

Expected: PASS, 11 tests, file count 1. **Do not modify this file.** Its sentinels (`SENTINEL-VOR` / `SENTINEL-NACH` / `SENTINEL-HEUTE`) and its `textContent` **equality** assertion are exactly the proof that the refactor must survive. If a change to `wochen-navigation.tsx` requires editing this test, the change is wrong.

**Step 2: Rewrite the component to compose**

Replace `apps/web/components/wochen-navigation.tsx` from line 59 to the end with:

```tsx
import { DateRangeControl, type DateRangeLinkProps } from "@easytree/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import type { Wochenmodell } from "../lib/wochennavigation";

/**
 * Der Adapter um `next/link` (EYT-80).
 *
 * `DateRangeControl` bekommt sein Link-Element injiziert, weil `@easytree/ui`
 * keinen Router importieren darf. Ein Adapter statt `Link` direkt: die
 * Prop-Typen von `next/link` sind weiter (`href: Url`) als die des Primitives,
 * und ob TypeScript die Zuweisung akzeptiert, waere eine Wette, die erst im
 * `typecheck` aufgeht. Fuenf Zeilen sind billiger als diese Wette.
 */
function WochenLink({ children, ...rest }: DateRangeLinkProps): ReactNode {
  return <Link {...rest}>{children}</Link>;
}

export function WochenNavigation({ modell }: { modell: Wochenmodell }) {
  if (modell.art === "fehlerhaft") {
    return (
      <DateRangeControl
        label="Wochennavigation"
        testId="wochennavigation"
        linkComponent={WochenLink}
        reset={{
          label: "Heute",
          href: modell.heuteUrl,
          testId: "wochennavigation-heute",
        }}
      />
    );
  }

  return (
    <DateRangeControl
      label="Wochennavigation"
      testId="wochennavigation"
      linkComponent={WochenLink}
      previous={{
        label: "Vorherige Woche",
        href: modell.vorherigeUrl,
        testId: "wochennavigation-vorherige",
      }}
      next={{
        label: "Nächste Woche",
        href: modell.naechsteUrl,
        testId: "wochennavigation-naechste",
      }}
      reset={{
        label: "Heute",
        href: modell.heuteUrl,
        ...(modell.istAktuelleWoche ? { current: true } : {}),
        testId: "wochennavigation-heute",
      }}
      rangeLabel={modell.isoWochenText}
      rangeKey={modell.schluessel}
      rangeDetail={modell.zeitraumText}
      rangeLabelTestId="werkbank-woche-iso"
      rangeDetailTestId="werkbank-woche-bereich"
      {...(modell.istAktuelleWoche
        ? { currentMarker: "Aktuelle Woche", currentMarkerTestId: "wochennavigation-aktuell" }
        : {})}
    />
  );
}
```

Keep the existing file header (lines 1-58) and **add** one paragraph before the imports:

```
 * ## Seit EYT-80: die Darstellung liegt in `@easytree/ui`
 *
 * Was hier bleibt, ist die UEBERSETZUNG des Wochenmodells in einen
 * domaenenfreien Bereichswechsel — Beschriftungen, `data-testid`-Werte und der
 * Link-Adapter. Die Zusicherung „rechnet nicht" ist damit doppelt getragen:
 * von den Sentinels in `test/wochen-navigation.test.tsx` wie bisher, und
 * strukturell von der Regel `ui-dependency-allowlist`, die dem Primitive jeden
 * Domain-, Vertrags- und Routerimport verbietet.
```

> **`exactOptionalPropertyTypes` matters here.** `current: modell.istAktuelleWoche ? true : undefined` would be a type error — an explicit `undefined` is not a missing property. Hence the spread form.

**Step 3: Rename the CSS blocks whose DOM moved**

In `apps/web/app/globals.css`:

| Line | From                            | To                          |
| ---- | ------------------------------- | --------------------------- |
| 607  | `.wochennavigation {`           | `.eyt-date-range {`         |
| 618  | `.wochennavigation__woche {`    | `.eyt-date-range__range {`  |
| 626  | `.wochennavigation__zeitraum {` | `.eyt-date-range__detail {` |
| 636  | `.wochennavigation__marke {`    | `.eyt-date-range__marker {` |
| 642  | `.wochennavigation__ziel {`     | `.eyt-date-range__action {` |

The `min-height: 2.5rem` on `.eyt-date-range__action` (line 646) is the Basisdesign v2.0 §2.3 40-px rule and must move with the selector.

**Step 4: Verify the rename BY NAME, and extend the stylesheet guard**

```bash
grep -c 'wochennavigation' apps/web/app/globals.css
```

Expected: `0` — a leftover is a rule styling nothing.

```bash
grep -oE '^\.eyt-date-range[a-z_-]*' apps/web/app/globals.css | sort -u
```

Expected, exactly these five names and no others:

```
.eyt-date-range
.eyt-date-range__action
.eyt-date-range__detail
.eyt-date-range__marker
.eyt-date-range__range
```

A count (`grep -cE '^\.eyt-date-range'` = 5) would pass a misspelled selector such as `.eyt-date-range__marer`; the sorted set will not. This is the identical trap Task 3 hit, corrected there.

**Step 4a: Both halves of the coupling, or neither is guarded**

Task 3 measured this the hard way. Renaming `eyt-app-shell__footer` inside the primitive left `apps/web` at 30 files / 376 tests and `packages/ui` at 3 / 31 — byte-identical to the unmutated run — while the footer silently lost its padding and top border. The stylesheet test is one-directional: it proves the CSS still contains the names, never that the component still emits them.

So this task owes **two** additions, not one:

1. **Stylesheet side** — extend `KLASSEN` in `apps/web/test/app-shell-styles.test.ts` with the five `eyt-date-range*` names. That file already matches boundary-anchored (`\.<klasse>(?![\w-])\s*[,{]`) with CSS comments stripped, so a name-lengthening rename or a name surviving only in a comment cannot satisfy it.
2. **Emitter side** — the class-coverage case in `packages/ui/test/date-range-control.test.tsx` (Task 4) must name all five. Verify it does; if Task 4 emitted a class the test does not name, add it there rather than here.

Counter-mutation for each half, both executed: rename one class in `globals.css` (stylesheet half goes red) and rename the same class in `packages/ui/src/date-range-control.tsx`, rebuild `@easytree/ui` (emitter half goes red). A fix that only makes one of the two red has closed one door and left the other open.

**Step 4b: The 40-px rule moves with its selector**

`.eyt-date-range__action` carries `min-height: 2.5rem` (Basisdesign v2.0 §2.3). Nothing measures it — Task 3 established that the only geometry assertions in the repo are the four in `shell-smoke.spec.ts`, and none of them visits `/planung`'s week strip. Either add one browser assertion for it in `shell-smoke.spec.ts` (the route `/planung?weekKey=2026-W32` already loads there for the render check, and the week controls render without an API), or register the gap explicitly in the findings table. Do not leave it unstated.

**Step 5: Run the focused suites**

```bash
pnpm --filter @easytree/ui build
pnpm --filter @easytree/web exec vitest run test/wochen-navigation.test.tsx test/wochennavigation.test.tsx test/planungs-werkbank.test.tsx test/planung-a11y.test.tsx
```

Expected: PASS. Read the printed **file count = 4**. `test/wochennavigation.test.tsx` is the year-boundary journey suite (2026-W53 → 2027-W01 and back), `planung-a11y.test.tsx` is the axe + single-`main` guard.

**Step 6: Commit**

```bash
git add apps/web/components/wochen-navigation.tsx apps/web/app/globals.css
git diff --cached --name-only
git commit -m "refactor(web): EYT-80 die Wochennavigation komponiert DateRangeControl"
```

---

## Task 6: Counter-mutations — executed, not imagined

Two invariants, two mutations. Each one: apply, measure red, revert, prove the revert with a **scoped** diff (a global empty `git diff` is unreachable while other files are staged — project memory `revert-evidence-must-be-scoped`).

**Step 1: Counter-mutation A — the AppShell domain boundary**

Add to `packages/ui/src/app-shell.tsx`, at the top of the import block:

```ts
import type { PlanningWeek } from "@easytree/domain";
```

and reference it so the compiler cannot elide it:

```ts
export type ShellWeek = PlanningWeek;
```

**Step 2: Measure it red**

```bash
pnpm --filter @easytree/api exec vitest run test/architecture.test.ts
```

Expected: **FAIL**, naming `packages/ui/src/app-shell.tsx` with rule `ui-dependency-allowlist` and the message `"@easytree/domain" steht nicht auf der Importliste von packages/ui/src`. Record the exact violation line.

**Step 3: Revert and prove it**

```bash
git checkout -- packages/ui/src/app-shell.tsx
git diff -- packages/ui/src/app-shell.tsx
```

Expected: empty output. (`git checkout --` restores the **committed** state; Task 2 Step 7 committed this file, so this is safe here. Where a file is uncommitted, take a copy first — project memory `git-checkout-reverts-to-commit-not-worktree`.)

```bash
pnpm --filter @easytree/api exec vitest run test/architecture.test.ts
```

Expected: PASS, `violations=0`.

**Step 4: Counter-mutation B — DateRangeControl must not own the computation**

In `apps/web/components/wochen-navigation.tsx`, replace the `next` target with a self-built address — i.e. let the presentation compute:

```tsx
      next={{
        label: "Nächste Woche",
        href: `/planung?weekKey=${modell.schluessel}`,
        testId: "wochennavigation-naechste",
      }}
```

**Step 5: Measure it red**

```bash
pnpm --filter @easytree/web exec vitest run test/wochen-navigation.test.tsx
```

Expected: **FAIL** on `verlinkt vorwaerts auf genau die uebergebene Adresse`, reporting `/planung?weekKey=SENTINEL-SCHLUESSEL` against `/planung?weekKey=SENTINEL-NACH`.

**Step 6: Revert and prove it**

```bash
git checkout -- apps/web/components/wochen-navigation.tsx
git diff -- apps/web/components/wochen-navigation.tsx
```

Expected: empty output.

```bash
pnpm --filter @easytree/web exec vitest run test/wochen-navigation.test.tsx
```

Expected: PASS, 11 tests.

**Step 7: Counter-mutation C — the skip-link/landmark coupling (the invariant the extraction adds)**

In `packages/ui/src/app-shell.tsx`, break the single value back into two literals:

```tsx
      <a className="eyt-app-shell__skip-link" href="#hauptinhalt">
```

(i.e. hard-code the anchor while `<main id={mainId}>` still follows the prop).

```bash
pnpm --filter @easytree/ui exec vitest run test/app-shell.test.tsx
```

Expected: **FAIL** on `folgt einer abweichenden id, ohne dass ein zweites Literal gepflegt wird`, reporting `#hauptinhalt` against `#inhalt-feld`.

```bash
git checkout -- packages/ui/src/app-shell.tsx
git diff -- packages/ui/src/app-shell.tsx
pnpm --filter @easytree/ui exec vitest run test/app-shell.test.tsx
```

Expected: empty diff, then PASS.

**Step 8: No commit** — nothing changed. Record the three results for the evidence packet.

---

## Task 7: Full gates

Each command below must be run and its output read. `Cached: 0 cached` or the printed file count is the evidence; an exit code behind a pipe is not.

**Step 1: Format (tracked set only — see CLAUDE.md on untracked `docs/plans/` noise)**

```bash
git ls-files -z | xargs -0 pnpm exec prettier --ignore-unknown --check
```

Expected: exit 0. If `packages/ui/src/*.tsx` is reported, run `pnpm format:fix` on the named files only and re-run.

**Step 2: Lint**

```bash
pnpm exec turbo run lint --force
```

Expected: `Cached: 0 cached` and `Tasks: N successful`.

**Step 3: Typecheck**

```bash
pnpm exec turbo run typecheck --force
```

Expected: `Cached: 0 cached`, `Tasks: N successful`. This is where a bad `linkComponent` type would surface; the adapter in Task 5 is there precisely so it does not.

**Step 4: Full test run — stop the local Supabase stack first**

```bash
pnpm exec supabase stop 2>/dev/null || true
pnpm exec turbo run test --force
```

Expected: `Cached: 0 cached`, all tasks successful. Stopping the stack first: with a live local stack the integration suites run against it and produce false reds (project memory `turbo-test-with-live-local-stack-false-reds`).

**Step 5: Web build**

```bash
env -u EASYTREE_API_PROXY_TARGET pnpm exec turbo run build --force --filter=@easytree/web...
```

Expected: exit 0, `Cached: 0 cached`. Unsetting `EASYTREE_API_PROXY_TARGET` is deliberate — no build needs it (EYT-126).

**Step 6: Playwright — the two specs that pin the changed DOM**

```bash
pnpm --filter @easytree/web exec playwright install chromium
pnpm --filter @easytree/web exec playwright test e2e/shell-smoke.spec.ts e2e/planungswerkbank.spec.ts
```

Expected: all tests pass. Port 3000 must be free. **100 % red means the browser binary is missing, not a regression** (project memory `fresh-worktree-missing-playwright-browsers`) — install and re-run before diagnosing anything.

These two specs carry the accessibility evidence for the changed UI: `shell-smoke` proves skip-link-first tab order, `#hauptinhalt` focus, visible focus ring on every interactive element, no keyboard trap, no horizontal scroll at 320/375 px, and axe with **color-contrast enabled** (only the browser can compute it); `planungswerkbank` proves the week strip is keyboard-operable via `focus()` + Enter. `apps/web/test/planung-a11y.test.tsx` adds the single-`main`-landmark count and axe including `best-practice` in jsdom.

**Step 7: Push and open exactly one PR**

```bash
git push -u origin feat/eyt-80-werkbank-foundation
gh pr create --base master --title "feat(ui): EYT-80 Werkbank-Foundation — domaenenfreier AppShell und DateRangeControl auf /planung" --body-file -
```

PR body must state: the baseline SHA, what moved and what deliberately did not, the three executed counter-mutations with their red messages, and the gate output. Compose it, re-read it, then send — external mutations do not get drafts.

**Step 8: Wait for CI on the exact head**

```bash
HEAD_SHA=$(git rev-parse HEAD)
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$HEAD_SHA" 2400
gh run list --commit "$HEAD_SHA" --json databaseId,name,conclusion
```

Exit 0 from `gh-ci-wait` can still mean timeout — always confirm the final state with `gh run view` (project memory `gh-ci-wait-exit-zero-can-mean-timeout`). Exit 1 can mean "cancelled by a later push", which is not a red CI (`gh-ci-wait-exit-1-can-mean-cancelled`).

**Step 9: Jira — fresh read, then transition, then comment**

```
getJiraIssue EYT-80        # confirm it is still „Zu erledigen"
getTransitionsForJiraIssue EYT-80
transitionJiraIssue        # → „In Arbeit"
addCommentToJiraIssue      # PR link + evidence level per claim
```

Do **not** set Done. Do not touch any other issue. Watch for trailing punctuation directly after a bare URL — Atlassian's renderer swallows it into the href; re-read the rendered comment, not the draft.

---

## What this increment deliberately does not do

- No `BottomNavigation`, no Feld shell, no employee surfaces — they have no consuming Sprint-7 surface yet (EYT-113, EYT-81).
- No new dependency in any `package.json`. Expected diff on every `package.json`: **zero lines**.
- No migration, no contract change, no `openapi/v1.json` regeneration, no RLS/permission/auth change, no planning command change, no ISO-week arithmetic change. `packages/domain`, `packages/contracts`, `apps/api/src` and `supabase/` are untouched except for the two **test** files in Task 1.
- No deploy, no merge, no Jira Done.

## Stop conditions during execution

Stop and report, without widening scope, if: `origin/master` has moved and the delta touches this slice; a competing PR appears on the same surface; the primitive cannot be built without domain/auth/API knowledge; `typecheck` demands a new production dependency; any existing planning/week test needs editing to stay green; or three materially different repair hypotheses for one failure have failed.

## Findings register

Nothing below is folded into this PR. Every entry is measured, not suspected.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                           | Class              | Where it belongs        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------- |
| 1   | `packages/ui` had no rule constraining its **dependency surface** before this increment. Four rules did already have its files in scope (`no-app-to-app`, `no-generic-shared-package`, `no-fixtures-in-production-code`, `no-contract-testing-in-production-code`), but all four are narrow bans that `@easytree/domain` and `next/link` walk straight through. Task 1 closes it for `packages/ui`; other packages are unchecked. | IMPORTANT_FOLLOWUP | own ticket, not this PR |
| 2   | `scan.ts` never turns `info.referencedFiles` into an `ImportRef`, so `/// <reference path="../../domain/src/index.ts" />` is invisible to **all ten** rules — while the `types=` sibling is caught. The `path=` form is the more dangerous one: it reaches into another package's source file rather than a package name. Executed: `violations=0` with a real domain binding present.                                            | IMPORTANT_FOLLOWUP | scanner ticket          |
| 3   | `scan.ts` derives `declare module` spans from a raw-text regex that ignores comments and does not require a balanced quote. One line `// declare module "a` makes the span close on the next string literal, swallowing the import that follows. Executed: a real `@easytree/domain` import in `packages/ui/src` with `violations=0`. Evasion hole, not a drift hole — but it defeats every path/allowlist rule.                  | IMPORTANT_FOLLOWUP | scanner ticket          |
| 4   | `SKIP_DIRS` matches by directory **name at any depth**, so `packages/ui/src/dist/**`, `…/coverage/**` etc. are never scanned — yet the unchanged `tsconfig.build.json` compiles and ships them, and the public entry may re-export from them at `violations=0`. The suite's own anti-silent-skip guard stays green because the specifier _does_ resolve. Low accident-realism, visible in a diff, but unmitigated.                | IMPORTANT_FOLLOWUP | scanner ticket          |
| 5   | Symlinks under `packages/ui/src/` are dropped by the walker (`readdirSync` withFileTypes reports them as neither `isDirectory()` nor `isFile()`), while `tsc` follows them into `dist`. Executed end-to-end: domain code shipped inside `@easytree/ui` at a path reading `packages/ui/src/…`, `violations=0`.                                                                                                                     | IMPORTANT_FOLLOWUP | scanner ticket          |
| 6   | `packages/ui/test/**` is constrained by no dependency rule. Deliberate — those files legitimately import `vitest` and `@testing-library/react`, which a package-wide allowlist would have to reject — but it means the reusability claim is proven for `src/` only. Cheapest realistic first breach: a test reaching for a domain fixture.                                                                                        | IMPORTANT_FOLLOWUP | own ticket              |
| 7   | Neither `packages/ui/package.json` `exports` nor `tsconfig.build.json` `include` is pinned by any assertion. A second entry point backed by `packages/ui/adapter/` builds, ships and resolves for a consumer while `ui-dependency-allowlist` never sees the file. Executed: consumer loaded domain code through `@easytree/ui/adapter` at `violations=0`.                                                                         | IMPORTANT_FOLLOWUP | own ticket              |
| 8   | A `/** @jsxImportSource @easytree/domain */` pragma emits a real import into `dist` that no scanner branch sees. Reach is limited today (the named package must ship a `/jsx-runtime` subpath, which `@easytree/domain` does not), so it is a live vector for a future `@easytree/*` UI or theming package rather than for domain itself.                                                                                         | MINOR              | scanner ticket          |

**Wording consequence for the PR body and the Jira comment:** what is measured is _"ordinary source files under `packages/ui/src` may not import domain, contracts or a router"_. Not _"`packages/ui` is provably domain-free"_. Findings 2–5 are exactly why.
