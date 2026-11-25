# EYT-80 Inkrement 1 — Werkbank-UI-Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ein domänenfreies `AppShell` und ein domänenfreies `DateRangeControl` in `@easytree/ui` bauen und beide auf der REALEN Fläche beweisen — die bestehende `apps/web`-Shell komponiert das eine, die bestehende `WochenNavigation` auf `/planung` das andere —, ohne Wochenmodell, `weekKey`-Semantik, Kalenderrechnung oder das Verhalten Planen → Veröffentlichen → Kosten anzufassen.

**Architecture:** Reine Komposition, keine neue Fachbreite. `@easytree/ui` bekommt zwei Primitives, die AUSSCHLIESSLICH Struktur, Landmarks und Reihenfolge tragen; alles Fachliche — Session, Rechte, Organisationswahl, Routing, Wochenableitung — bleibt in `apps/web` und wird als Prop oder als `children` hineingereicht. Die Wege der Leiste werden über eine `renderLink`-Funktion gerendert, damit `next/link` NICHT in `@easytree/ui` landet. Die Layoutklassen bleiben bei der App (`className`-Durchreichung je Slot), damit `globals.css` unangetastet bleibt und kein visueller Regress ohne Test entsteht. Ein neuer statischer Wächter in `packages/ui/test/` hält die Paketgrenze — bis heute hielt sie NICHTS außer Konvention.

**Tech Stack:** TypeScript 5.9 (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`, `module: NodeNext`), React 19, Next.js 16 App Router, Vitest 4 (jsdom), `@testing-library/react`, `axe-core`, Playwright, pnpm 10.28.0 + Turborepo.

---

## 0. Vertrag, Sperre und Beweislage

### 0.1 Der WIP-Gate ist HEUTE zu

Gemessen am 26.08.2026, unmittelbar vor dem Schreiben dieses Plans:

```
$ git fetch origin --prune && git rev-parse origin/master
02c669355e81cad198a0e396684b3771a707ecd5

$ gh pr view 94 --json number,state,headRefName,headRefOid,mergedAt,closedAt,mergeStateStatus
{"closedAt":null,"headRefName":"fix/eyt-142-staging-harness",
 "headRefOid":"c3947f792a3d27b023bf71524e674a6bb6c7593a",
 "mergeStateStatus":"CLEAN","mergedAt":null,"number":94,"state":"OPEN"}
```

**PR #94 ist OPEN.** Der Auftragsvertrag nennt das als STOP-Bedingung 1: read-only melden, keine
parallele Implementierung. Dieser Plan ist deshalb geschrieben, aber **nicht freigegeben zur
Ausführung**. Task 1 ist der Gate selbst und bricht ab, solange #94 offen ist.

Zusatzrisiko aus dem Projektgedächtnis: das Ruleset verlangt einen up-to-date Branch. Ein zweiter
PR nach einem Merge braucht `master`-Merge plus vollen CI-Rerun — PRs seriell planen, nicht parallel.

### 0.2 Was EYT-80 verlangt und was dieses Inkrement davon abdeckt

Aus Jira EYT-80 (Status `Zu erledigen`, Epic EYT-1, Labels u. a. `basisdesign-v2`, `sprint-7`):

| EYT-80 Akzeptanzkriterium                                                                                                                                            | Stand vor diesem Inkrement                                                                                                                                | Dieses Inkrement                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Tokens Canvas/Surface/Text/Border/Primary/Published/Draft/Danger/Info zentral versioniert                                                                            | **erfüllt** — `apps/web/app/globals.css:13-59`, hell und dunkel, Werte identisch zur Confluence-Tabelle                                                   | unverändert                                                     |
| Kontrasttests gegen `#6D786F/#F0F4EF` und `#A86B2B/#F6E9D8`                                                                                                          | **offen** — kein Test im Repo                                                                                                                             | **NICHT** — siehe §9 neu entdeckte Arbeit                       |
| Primitives mind. `AppShell`, `PageHeader`, `BottomNavigation`, `StatusBadge`, `StateBanner`, `PrimaryAction`, `Card`, `DateRangeControl`, `EmptyState`, `ErrorState` | vorhanden: `PageHeader`, `StatusBadge`, `StateBanner`, `PrimaryAction`, `Card`, `EmptyState`, `ErrorState` (+ `Button`, `LoadingState`, `VisuallyHidden`) | **`AppShell` + `DateRangeControl`**                             |
| Zustandsmuster Loading/Empty/Error/Forbidden/Unauthenticated/Stale/Partial/Retry                                                                                     | teilweise — `LoadingState`, `EmptyState`, `ErrorState`                                                                                                    | **NICHT** — §9                                                  |
| Admin- und Mitarbeiter-Shell teilen Tokens, nicht Layoutzwänge                                                                                                       | keine geteilte Shell — `apps/web/components/app-shell.tsx` ist die einzige                                                                                | **teilweise**: das Primitive trägt Struktur, die App das Layout |
| 320/375/1440/1920 px, Tastatur, Fokus, 200 % Zoom, axe                                                                                                               | Shell-Baseline grün (`apps/web/test/a11y.test.tsx`, `apps/web/e2e/shell-smoke.spec.ts`)                                                                   | **erhalten** und um die neuen Primitives erweitert              |
| Visuelle Regressionen aus realen Produktseiten                                                                                                                       | keine Snapshot-Infrastruktur                                                                                                                              | **NICHT** — §9                                                  |
| Playwright-/Komponententests machen Zustands-/A11y-Regressionen rot                                                                                                  | teilweise                                                                                                                                                 | **erhalten** + neuer Paketgrenzen-Wächter                       |
| Keine Sprint-7-Fläche führt ein abweichendes Token-/Button-/Status-System ein                                                                                        | gehalten                                                                                                                                                  | gehalten                                                        |

Der PO-Kommentar vom 12.08.2026 an EYT-80 gilt weiter: EYT-80 wird **nicht** als Ganzes committed;
EYT-141 hat den Sprint-6-Ausschnitt geliefert; **dieses Inkrement macht EYT-80 nicht Done.**

Aus EYT-12 wirken auf diesen Ausschnitt: Desktop-Aktionen ≥ 40 px (`.wochennavigation__ziel` hält
`min-height: 2.5rem`, `apps/web/app/globals.css:641-646` — muss überleben), Zustand nie nur über
Farbe (die Marke „Aktuelle Woche" ist TEXT), Fokus sichtbar, Screenreader-Reihenfolge = sichtbare
Reihenfolge, Landmarks eindeutig.

Aus Confluence 8486960 §5: Design-Tokens und zugängliche UI-Primitives sind GEMEINSAM; Navigation,
responsive Layouts und Darstellungsdichte sind GETRENNT. Genau diese Linie ist die Prop-Grenze der
beiden Primitives.

### 0.3 Gemessene Baseline (26.08.2026, auf `02c6693`, lokaler Lauf)

```
$ pnpm --filter @easytree/ui exec vitest run
 Test Files  2 passed (2)
      Tests  16 passed (16)

$ pnpm --filter @easytree/web exec vitest run
 Test Files  28 passed (28)
      Tests  309 passed (309)

$ pnpm --filter @easytree/web exec vitest run test/wochen-navigation.test.tsx \
      test/planungs-werkbank.test.tsx test/a11y.test.tsx test/planung-a11y.test.tsx
 Test Files  4 passed (4)
      Tests  27 passed (27)
```

Evidenzstufe: **lokaler Lauf**. Docker lief bei der Messung nicht (`Cannot connect to the Docker
daemon`), also kein lokaler Supabase-Stack — die bekannte Falle „laufender Stack erzeugt falsche
Rottöne" greift hier nicht. Diese vier Zahlen sind die Vergleichswerte für jeden Schritt unten.

### 0.4 Was NICHT angefasst wird

`packages/domain`, `packages/contracts`, `apps/api`, `supabase/**`, jede Migration, jeder
Auth-/Session-Pfad, `lib/wochennavigation.ts` (die Wochenrechnung), `BottomNavigation`, die
Mitarbeiter-Shell, EYT-81/82/113/147/148, jede neue Laufzeitabhängigkeit, jeder Deploy, jede
Jira-/Confluence-Schreiboperation, jeder Merge.

---

## 1. Entwurfsentscheidungen (bindend für die Tasks)

**E1 — Die Layoutklassen bleiben bei der App.** Beide Primitives setzen ihre eigene
`eyt-*`-Basisklasse UND hängen eine durchgereichte `className` daran (dasselbe Muster wie
`Button`, `packages/ui/src/button.tsx:15`). `apps/web` reicht die bestehenden Klassen
(`app-header`, `app-main`, `app-footer`, `skip-link`, `wochennavigation`, `wochennavigation__ziel`,
`wochennavigation__woche`, `wochennavigation__zeitraum`, `wochennavigation__marke`) durch.
Folge: **`apps/web/app/globals.css` wird in diesem Inkrement nicht geändert.** Die Alternative —
die CSS-Selektoren auf `eyt-app-shell__*` / `eyt-date-range-control__*` umbenennen — wäre sauberer
und trüge ein visuelles Regressionsrisiko, das kein Test im Repo heute abfängt. Nicht in einem
Inkrement, das die Grenze einzieht.

**E2 — `next/link` erreicht `@easytree/ui` nicht.** `DateRangeControl` rendert seine Wege über eine
`renderLink`-Funktion; Vorgabe ist ein nacktes `<a href>`. `WochenNavigation` übergibt eine
Funktion, die `next/link` benutzt — clientseitige Navigation bleibt damit exakt erhalten. Ein
`<a href>` in der Werkbank wäre ein volles Neuladen und damit eine Verhaltensänderung.

**E3 — Die Testanker kommen von außen.** Alle `data-testid` (`wochennavigation`,
`wochennavigation-vorherige|-heute|-naechste|-aktuell`, `werkbank-woche-iso`,
`werkbank-woche-bereich`) werden als Props hineingereicht, nie vom Primitive erfunden. Grund:
Playwright hängt daran. `apps/web/e2e/staging/journey.pwtest.ts` klickt
`wochennavigation-vorherige|-naechste|-heute`, `apps/web/e2e/planungswerkbank.spec.ts` liest
`werkbank-woche-iso` und `werkbank-woche-bereich`. Playwright läuft NICHT in `pnpm test` — ein
entfernter Anker bricht die Reise still und kostet einen CI-Lauf.

**E4 — Die Sentinels bleiben die Zusicherung.** `apps/web/test/wochen-navigation.test.tsx` prüft
mit unrechenbaren Werten (`SENTINEL-VOR`, `SENTINEL-NACH`, `SENTINEL-HEUTE`), dass die Komponente
DURCHREICHT statt zu rechnen, und mit `toBe` statt `toContain`, dass in `werkbank-woche-iso` genau
`"SENTINEL-WOCHENTEXT SENTINEL-SCHLUESSEL"` steht. Das eine Leerzeichen stammt aus dem `{" "}`
zwischen sichtbarem Text und `VisuallyHidden`. **Beide Zusicherungen müssen die Umstellung
unverändert überleben** — sie werden nicht angepasst, sie sind der Beweis.

**E5 — Die DOM-Reihenfolge bleibt.** vorherige → Woche → Zeitraum → Marke → Heute → nächste.
EYT-12 verlangt Screenreader-Reihenfolge = sichtbare Reihenfolge; die CSS-Regeln
(`flex-basis: 100%` auf Woche und Zeitraum) hängen an genau dieser Quellreihenfolge.

**E6 — `AppShell` besitzt nur, was die Barrierefreiheit trägt.** Sprunglink, `<header>`, `<main
id tabIndex={-1}>`, `<footer>`. Marke, Navigation, Organisationswahl und Abmelden bleiben Markup
der App und kommen als `header`-Slot herein. Ein Primitive, das die Navigationspunkte selbst
zusammensetzte, müsste `hatRecht` kennen — und wäre keine domänenfreie Komponente mehr.

**E7 — Namenskollision explizit auflösen.** `@easytree/ui` und `apps/web/components/app-shell.tsx`
exportieren beide `AppShell`. In der Web-Datei wird als `WerkbankRahmen` importiert. Der
Exportname der Web-Komponente bleibt `AppShell` — `apps/web/app/layout.tsx:4` und
`apps/web/test/a11y.test.tsx:11` importieren ihn.

---

## Task 1: WIP-Gate, Baseline und Branch

**Files:** keine Änderung — reine Messung.

**Step 1: Origin holen und PR #94 prüfen**

```bash
cd /Users/benjaminpoersch/EasyTree
git fetch origin --prune
gh pr view 94 --json number,state,headRefOid,mergedAt,closedAt
```

Erwartet für ein GRÜNES Gate: `"state":"MERGED"` oder `"state":"CLOSED"` (also `mergedAt` bzw.
`closedAt` nicht `null`).

**Wenn `"state":"OPEN"` — HIER ABBRECHEN.** Den Zustand read-only melden, nichts anlegen, nichts
ändern. Das ist STOP-Bedingung 1 des Auftragsvertrags. Stand 26.08.2026 ist genau das der Fall.

**Step 2: Den neuen Baseline-SHA festhalten**

```bash
git rev-parse origin/master
```

Den ausgegebenen SHA notieren. Er ist der Startpunkt und wird in Task 9 gegen den dann aktuellen
`origin/master` gegengeprüft — ein Wechsel während des Slices ist STOP-Bedingung 2.

**Step 3: Branch vom FRISCHEN `origin/master` anlegen**

```bash
git switch --create feat/eyt-80-werkbank-foundation origin/master
git status --short --branch
```

Erwartet: `## feat/eyt-80-werkbank-foundation...origin/master`. Nie gegen lokalen `master`
planen — der lag hier schon 25 Commits zurück und machte vier Evidenzbefunde falsch.

**Step 4: Abhängigkeiten bauen, dann die Baseline neu messen**

`typecheck` und `test` hängen an `^build`. `apps/web` löst `@easytree/ui` über
`packages/ui/dist` auf, nicht über die Quelle — ein veraltetes `dist` macht Tests still falsch
grün oder falsch rot, und `noEmitOnError` ist nirgends gesetzt, ein roter Build hinterlässt also
ein benutzbares altes `dist`.

```bash
pnpm install --frozen-lockfile
pnpm --filter @easytree/ui... build
pnpm --filter @easytree/ui exec vitest run
pnpm --filter @easytree/web exec vitest run
```

Erwartet: `@easytree/ui` → `Test Files 2 passed (2)` / `Tests 16 passed (16)`;
`@easytree/web` → `Test Files 28 passed (28)` / `Tests 309 passed (309)`.

Weicht eine der vier Zahlen ohne eigene Änderung ab, ist das eine fremde Baseline-Störung —
STOP-Bedingung „unrelated baseline failure", nicht wegerklären.

**Step 5: Kein Commit.** Task 1 ändert keine Datei.

---

## Task 2: Der Wächter, der die Paketgrenze wirklich hält

Heute hält NICHTS `@easytree/ui` domänenfrei außer dem Dateikopf von `packages/ui/src/index.ts`.
`apps/api/test/architecture.test.ts` deckt ausschließlich `apps/api`; `eslint.config.mjs` enthält
keine Import-Regel. Der Auftragsvertrag verlangt die Freiheit von Next-Routing, Session, API,
Domain und Rechtelogik — also braucht sie zuerst einen Messpunkt. Deshalb steht dieser Wächter
VOR den beiden Primitives.

**Files:**

- Create: `packages/ui/test/paket-grenze.test.ts`

**Step 1: Den Wächter schreiben**

`packages/ui/test/paket-grenze.test.ts`:

```ts
/**
 * Die Paketgrenze von `@easytree/ui` — gemessen, nicht behauptet (EYT-80).
 *
 * ## Warum es diese Datei gibt
 *
 * Bis zum 26.08.2026 stand die Domänenfreiheit dieses Pakets ausschliesslich im
 * Dateikopf von `src/index.ts`. `apps/api/test/architecture.test.ts` prueft nur
 * `apps/api`, und in `eslint.config.mjs` steht keine Importregel. Ein
 * `import { useSession } from "…"` oder ein `next/link` haette hier landen
 * koennen, ohne dass ein einziger Lauf rot geworden waere — und `@easytree/ui`
 * traegt seit EYT-141 die gemeinsame Grundlage BEIDER Clients (Confluence
 * 8486960 §5: Tokens und Primitives gemeinsam, Navigation und Layout getrennt).
 *
 * ## Warum `ts.preProcessFile` und kein regulaerer Ausdruck
 *
 * Dieselbe Begruendung wie in `apps/api/test/architecture.test.ts`: ein Regex
 * uebersieht `export *`, dynamisches `import()` und rein typseitige Formen.
 *
 * ## Warum eine ERLAUBNISLISTE
 *
 * Eine Sperrliste kann „domaenenfrei" nicht ausdruecken — sie kennt nur die
 * Namen, die jemand beim Schreiben im Kopf hatte. `@easytree/costs-schema`
 * von morgen faellt durch eine Sperrliste durch und durch diese Liste nicht.
 *
 * ## Warum diese Datei nicht vakuum werden kann
 *
 * Sie zaehlt die besuchten Dateien und wird rot, wenn es keine gibt. Ein
 * verrutschtes Verzeichnis oder eine Umbenennung meldet sich damit als Fehler
 * statt als stilles Gruen.
 *
 * ## Gegenmutation
 *
 * `import Link from "next/link";` in eine Datei unter `src/` setzen — die
 * Zusicherung „importiert ausserhalb der Erlaubnisliste nichts" wird rot und
 * nennt Datei und Modulnamen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `import.meta.url` ist unter jsdom KEIN `file://`-URL — `fileURLToPath` wirft
 * dort (gemessen). Das Arbeitsverzeichnis eines gefilterten pnpm-Laufs ist
 * `packages/ui`, und darauf wird der Pfad gebildet.
 */
const PAKETWURZEL = process.cwd();
const QUELLE = join(PAKETWURZEL, "src");

/**
 * Was ein domaenenfreies Primitive braucht — und sonst nichts. Relative Pfade
 * innerhalb von `src/` sind unabhaengig davon immer erlaubt.
 */
const ERLAUBTE_PAKETE = new Set(["react", "react/jsx-runtime", "react-dom"]);

/** Alle `.ts`/`.tsx`-Dateien unter `src/`, rekursiv. */
function quelldateien(verzeichnis: string): string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      gefunden.push(...quelldateien(pfad));
      continue;
    }
    if (/\.tsx?$/.test(eintrag.name)) gefunden.push(pfad);
  }
  return gefunden.sort();
}

/** Die Modulnamen, die eine Datei importiert — inklusive `export *` und `import()`. */
function importierteModule(pfad: string): string[] {
  const info = ts.preProcessFile(readFileSync(pfad, "utf8"), true, true);
  return info.importedFiles.map((treffer) => treffer.fileName);
}

const DATEIEN = quelldateien(QUELLE);

describe("@easytree/ui — die Paketgrenze", () => {
  it("besucht ueberhaupt Quelldateien", () => {
    // Ohne diese Zusicherung waere jede folgende bei einer Umbenennung still gruen.
    expect(DATEIEN.length).toBeGreaterThan(0);
  });

  it("importiert ausserhalb der Erlaubnisliste nichts", () => {
    const verstoesse: string[] = [];
    for (const pfad of DATEIEN) {
      for (const modul of importierteModule(pfad)) {
        if (modul.startsWith(".")) continue;
        if (ERLAUBTE_PAKETE.has(modul)) continue;
        verstoesse.push(`${relative(PAKETWURZEL, pfad)} → ${modul}`);
      }
    }
    expect(verstoesse).toEqual([]);
  });

  it("verlaesst `src/` nicht ueber relative Pfade", () => {
    // Ein `../../apps/web/lib/session-provider` waere relativ und stuende damit
    // ueber der Erlaubnisliste — genau die Luecke, die diese Zusicherung schliesst.
    const ausbrueche: string[] = [];
    for (const pfad of DATEIEN) {
      for (const modul of importierteModule(pfad)) {
        if (!modul.startsWith(".")) continue;
        const ziel = join(pfad, "..", modul);
        if (relative(QUELLE, ziel).startsWith("..")) {
          ausbrueche.push(`${relative(PAKETWURZEL, pfad)} → ${modul}`);
        }
      }
    }
    expect(ausbrueche).toEqual([]);
  });
});
```

**Step 2: Den Wächter ausführen — er ist grün, und das ist noch kein Beweis**

```bash
pnpm --filter @easytree/ui exec vitest run test/paket-grenze.test.ts
```

Erwartet: `Test Files 1 passed (1)` / `Tests 3 passed (3)`. Die Dateizahl LESEN — ein
Pfadfilter ohne Treffer meldet Exit 0, ohne etwas geprüft zu haben.

Ein Wächter, der eine bereits wahre Eigenschaft zusichert, hat keine natürliche rote Phase. Sein
Nachweis ist die Gegenmutation in Step 3, nicht ein erfundener Fehlschlag.

**Step 3: Gegenmutation — ausführen, messen, zurücknehmen**

```bash
cp packages/ui/src/button.tsx /tmp/button.tsx.sicherung
printf '%s\n' 'import Link from "next/link";' | cat - packages/ui/src/button.tsx > /tmp/button.mutiert \
  && mv /tmp/button.mutiert packages/ui/src/button.tsx
grep -n 'next/link' packages/ui/src/button.tsx
```

Erwartet: `1:import Link from "next/link";` — die Mutation ist wirklich in der Datei. Die
Ersetzung greppen, nicht dem Exit-Code glauben.

```bash
pnpm --filter @easytree/ui exec vitest run test/paket-grenze.test.ts
```

Erwartet: **FAIL**, `Tests 1 failed | 2 passed (3)`, und in der Ausgabe
`src/button.tsx → next/link`.

Zurücknehmen — mit der Sicherungskopie, nicht mit `git checkout --`: die Datei ist unverändert
committed, aber die Regel „Sicherungskopie statt checkout" hat hier schon zweimal Arbeit gerettet.

```bash
cp /tmp/button.tsx.sicherung packages/ui/src/button.tsx && rm /tmp/button.tsx.sicherung
git diff -- packages/ui/src/button.tsx
```

Erwartet: leere Ausgabe — auf die mutierte Datei EINGEGRENZT, weil ein globaler leerer `git diff`
mit den noch nicht committeten neuen Dateien unerreichbar ist.

```bash
pnpm --filter @easytree/ui exec vitest run test/paket-grenze.test.ts
```

Erwartet: wieder `Tests 3 passed (3)`.

**Step 4: Committen**

```bash
git add packages/ui/test/paket-grenze.test.ts
git diff --cached --name-only
git commit -m "test(ui): EYT-80 die Paketgrenze von @easytree/ui wird gemessen statt behauptet"
```

`git diff --cached --name-only` muss GENAU `packages/ui/test/paket-grenze.test.ts` zeigen — ein
verzeichnisweites `git add` fegt sonst ungetrackten Lärm mit (unter `docs/plans/` liegt unter
anderem diese Plandatei, die NICHT committed werden darf).

---

## Task 3: `DateRangeControl` — der Abnahmevertrag zuerst

**Files:**

- Create: `packages/ui/test/date-range-control.test.tsx`

**Step 1: Den fehlschlagenden Test schreiben**

`packages/ui/test/date-range-control.test.tsx`:

```tsx
/**
 * `DateRangeControl` — die Periodenleiste als domaenenfreies Primitive (EYT-80).
 *
 * ## Was hier gemessen wird
 *
 * Struktur, Reihenfolge, Namen und Durchreichung. NICHT: Wochen, ISO-Kalender,
 * `weekKey`. Das Primitive kennt keine Woche — es kennt eine Periode mit einer
 * Beschriftung, einem Detail und drei Wegen. Genau deshalb kann derselbe
 * Baustein spaeter die Tages- und Mehrwochenansicht tragen (Confluence 8486960
 * §3: Wochen-, Monats- und rollierende Mehrwochenplanung).
 *
 * ## Warum die Werte hier nicht wie Wochen aussehen
 *
 * `PERIODE-*` und `/ziel/vor` sind unrechenbar. Baute das Primitive selbst eine
 * Adresse, staende dort etwas anderes. Dieselbe Bauart wie die Sentinels in
 * `apps/web/test/wochen-navigation.test.tsx`, aus demselben Grund.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DateRangeControl, type DateRangeLinkProps } from "../src/index.js";

afterEach(cleanup);

const HEUTE = { href: "/ziel/jetzt", label: "Heute", testId: "leiste-jetzt" } as const;
const VOR = { href: "/ziel/vor", label: "Zurueck", testId: "leiste-vor" } as const;
const NACH = { href: "/ziel/nach", label: "Vorwaerts", testId: "leiste-nach" } as const;

const PERIODE = {
  label: "PERIODE-SICHTBAR",
  hiddenLabel: "PERIODE-SCHLUESSEL",
  detail: "PERIODE-DETAIL",
  currentLabel: "Aktuelle Periode",
  testId: "leiste-periode",
  detailTestId: "leiste-detail",
  currentTestId: "leiste-marke",
} as const;

function vollstaendig(zusatz: Record<string, unknown> = {}) {
  return (
    <DateRangeControl
      label="Periodennavigation"
      testId="leiste"
      previous={VOR}
      current={HEUTE}
      next={NACH}
      period={PERIODE}
      {...zusatz}
    />
  );
}

describe("DateRangeControl — die vollstaendige Periode", () => {
  it("gibt der Leiste einen eigenen zugaenglichen Namen", () => {
    render(vollstaendig());
    expect(screen.getByRole("navigation", { name: "Periodennavigation" })).toBeTruthy();
  });

  it("verlinkt jeden Weg auf genau die uebergebene Adresse", () => {
    render(vollstaendig());
    expect(screen.getByRole("link", { name: "Zurueck" }).getAttribute("href")).toBe("/ziel/vor");
    expect(screen.getByRole("link", { name: "Heute" }).getAttribute("href")).toBe("/ziel/jetzt");
    expect(screen.getByRole("link", { name: "Vorwaerts" }).getAttribute("href")).toBe("/ziel/nach");
  });

  it("traegt genau ein Bedienelement je Richtung", () => {
    render(vollstaendig());
    for (const name of ["Zurueck", "Heute", "Vorwaerts"]) {
      expect(screen.getAllByRole("link", { name })).toHaveLength(1);
    }
  });

  it("stellt sichtbare Beschriftung und verborgenen Schluessel in EIN Element", () => {
    render(vollstaendig());
    // GLEICHHEIT, nicht Enthaltensein: eine zweite, widersprechende Periodenaussage
    // in derselben Flaeche muss auffallen.
    expect(screen.getByTestId("leiste-periode").textContent).toBe(
      "PERIODE-SICHTBAR PERIODE-SCHLUESSEL",
    );
  });

  it("haelt den verborgenen Schluessel im Accessibility-Tree, aber von der Flaeche fern", () => {
    render(vollstaendig());
    const verborgen = within(screen.getByTestId("leiste-periode")).getByText("PERIODE-SCHLUESSEL");
    expect(verborgen.style.position).toBe("absolute");
    expect(verborgen.style.width).toBe("1px");
  });

  it("zeigt das Detail unveraendert an", () => {
    render(vollstaendig());
    expect(screen.getByTestId("leiste-detail").textContent).toBe("PERIODE-DETAIL");
  });

  it("haelt die sichtbare Reihenfolge zurueck, Periode, Detail, Marke, Heute, vorwaerts", () => {
    // EYT-12: Screenreader-Reihenfolge folgt der sichtbaren Reihenfolge. Ein
    // umsortiertes Primitive waere ohne diese Zusicherung unsichtbar falsch.
    render(vollstaendig({ period: { ...PERIODE, isCurrent: true } }));
    const anker = [...screen.getByTestId("leiste").children].map((kind) =>
      kind.getAttribute("data-testid"),
    );
    expect(anker).toEqual([
      "leiste-vor",
      "leiste-periode",
      "leiste-detail",
      "leiste-marke",
      "leiste-jetzt",
      "leiste-nach",
    ]);
  });
});

describe("DateRangeControl — die laufende Periode traegt TEXT, nicht nur Farbe", () => {
  it("nennt sie im Klartext und markiert den Rueckweg maschinenlesbar", () => {
    render(vollstaendig({ period: { ...PERIODE, isCurrent: true } }));
    expect(screen.getByTestId("leiste-marke").textContent).toBe("Aktuelle Periode");
    expect(screen.getByRole("link", { name: "Heute" }).getAttribute("aria-current")).toBe("page");
  });

  it("nennt sie NICHT, wenn eine andere Periode angezeigt wird", () => {
    render(vollstaendig());
    expect(screen.queryByTestId("leiste-marke")).toBeNull();
    expect(screen.getByRole("link", { name: "Heute" }).getAttribute("aria-current")).toBeNull();
  });
});

describe("DateRangeControl — ohne darstellbare Periode bleibt der Rueckweg", () => {
  it("laesst genau den Rueckweg stehen und bietet kein Blaettern an", () => {
    render(<DateRangeControl label="Periodennavigation" testId="leiste" current={HEUTE} />);
    expect(screen.getByRole("link", { name: "Heute" }).getAttribute("href")).toBe("/ziel/jetzt");
    expect(screen.queryByRole("link", { name: "Zurueck" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Vorwaerts" })).toBeNull();
    expect(screen.queryByTestId("leiste-periode")).toBeNull();
    expect(screen.queryByTestId("leiste-detail")).toBeNull();
  });
});

describe("DateRangeControl — Darstellung bleibt bei der App", () => {
  it("haengt die durchgereichten Klassen an die eigenen an", () => {
    render(vollstaendig({ className: "eigene-leiste", stepClassName: "eigener-weg" }));
    const leiste = screen.getByTestId("leiste");
    expect(leiste.className.split(" ")).toContain("eyt-date-range-control");
    expect(leiste.className.split(" ")).toContain("eigene-leiste");
    expect(screen.getByRole("link", { name: "Heute" }).className.split(" ")).toContain(
      "eigener-weg",
    );
  });

  it("rendert die Wege ueber die uebergebene Funktion", () => {
    // Ohne diesen Haken muesste `next/link` in dieses Paket — und die
    // Paketgrenze aus `paket-grenze.test.ts` fiele.
    const gesehen: string[] = [];
    const eigenesZiel = ({ href, children, ...rest }: DateRangeLinkProps) => {
      gesehen.push(href);
      return (
        <a data-eigen="ja" href={href} {...rest}>
          {children}
        </a>
      );
    };
    render(vollstaendig({ renderLink: eigenesZiel }));
    expect(gesehen).toEqual(["/ziel/vor", "/ziel/jetzt", "/ziel/nach"]);
    expect(screen.getByRole("link", { name: "Heute" }).getAttribute("data-eigen")).toBe("ja");
  });
});
```

**Step 2: Rot messen**

```bash
pnpm --filter @easytree/ui exec vitest run test/date-range-control.test.tsx
```

Erwartet: **FAIL** mit `Failed to resolve import` bzw.
`No "DateRangeControl" export is defined on the "../src/index.js" mock` — die Datei existiert
nicht. Die Dateizahl muss `1` sein; `0 files` hieße, der Filter greift nicht.

**Step 3: Das Primitive implementieren**

`packages/ui/src/date-range-control.tsx`:

```tsx
import type { ReactNode } from "react";

import { VisuallyHidden } from "./visually-hidden.js";

/**
 * Ein Sprungziel der Leiste. Adresse und Beschriftung kommen FERTIG herein —
 * dieses Paket rechnet keine Periode aus und kennt keinen Kalender.
 */
export interface DateRangeStep {
  readonly href: string;
  readonly label: string;
  /** Testanker. Wird von der App vergeben, nie hier erfunden. */
  readonly testId?: string;
}

/** Was die Leiste an einen Weg uebergibt, wenn sie ihn rendern laesst. */
export interface DateRangeLinkProps {
  readonly href: string;
  readonly className: string;
  readonly children: ReactNode;
  readonly "aria-current"?: "page";
  readonly "data-testid"?: string;
}

/**
 * Die dargestellte Periode. Fehlt sie ganz, gibt es nichts anzuzeigen — dann
 * bleibt nur der Rueckweg stehen, und die Leiste ist trotzdem keine Sackgasse.
 */
export interface DateRangePeriod {
  /** Sichtbare Beschriftung, etwa „KW 34 · 2026". */
  readonly label: string;
  /** Nur fuer assistive Technik — etwa der kanonische Schluessel der Adresse. */
  readonly hiddenLabel?: string;
  /** Der vollstaendige Zeitraum, etwa „17.08.2026 – 23.08.2026". */
  readonly detail?: string;
  /** Steht die angezeigte Periode auf der laufenden? */
  readonly isCurrent?: boolean;
  /**
   * Der Text der Marke. Sie traegt die Aussage (EYT-12: ein Zustand nie NUR
   * ueber Farbe); ohne Text bleibt die Marke weg statt stumm zu faerben.
   */
  readonly currentLabel?: string;
  readonly className?: string;
  readonly detailClassName?: string;
  readonly currentClassName?: string;
  readonly testId?: string;
  readonly detailTestId?: string;
  readonly currentTestId?: string;
}

export interface DateRangeControlProps {
  /** Zugaenglicher Name des Navigationsbereichs. */
  label: string;
  /** Der Rueckweg auf die laufende Periode — der einzige Pflichtweg. */
  current: DateRangeStep;
  previous?: DateRangeStep;
  next?: DateRangeStep;
  period?: DateRangePeriod;
  /**
   * Rendert einen Weg. Vorgabe ist ein nacktes `<a href>`; eine App mit
   * clientseitigem Routing reicht hier ihre eigene Verknuepfung herein. Damit
   * bleibt dieses Paket frei von Routing (ADR-001, Confluence 8486960 §5).
   */
  renderLink?: (props: DateRangeLinkProps) => ReactNode;
  className?: string;
  /** Klasse aller Wege — Mindesthoehen und Abstaende gehoeren der App. */
  stepClassName?: string;
  testId?: string;
}

function klassen(...werte: Array<string | undefined>): string {
  return werte.filter(Boolean).join(" ");
}

const nacktesZiel = (props: DateRangeLinkProps): ReactNode => <a {...props} />;

/**
 * Die Periodenleiste des Basisdesigns v2.0 (§3.1 Kopfbereich): eine Periode,
 * ihr vollstaendiger Zeitraum, ein Rueckweg und je ein Weg vor und zurueck.
 *
 * ## Sie zeigt, sie rechnet nicht
 *
 * Alle Adressen und Beschriftungen kommen fertig herein. Rechnete sie selbst,
 * gaebe es eine ZWEITE Periodenregel neben der der App — und beide liefen
 * genau an den Raendern auseinander, an denen es darauf ankommt.
 *
 * ## Die Reihenfolge im Quelltext ist die sichtbare Reihenfolge
 *
 * zurueck, Periode, Detail, Marke, Rueckweg, vorwaerts. EYT-12 verlangt, dass
 * die Screenreader-Reihenfolge der sichtbaren folgt; ein Umsortieren per CSS
 * waere genau der Bruch.
 */
export function DateRangeControl({
  label,
  current,
  previous,
  next,
  period,
  renderLink = nacktesZiel,
  className,
  stepClassName,
  testId,
}: DateRangeControlProps): ReactNode {
  const wegKlasse = klassen("eyt-date-range-control__step", stepClassName);
  const laufend = period?.isCurrent === true;

  // `exactOptionalPropertyTypes`: ein ausdrueckliches `undefined` ist etwas
  // anderes als eine fehlende Eigenschaft — deshalb ueberall bedingtes Streuen.
  const weg = (schritt: DateRangeStep, ariaCurrent?: "page"): ReactNode =>
    renderLink({
      href: schritt.href,
      className: wegKlasse,
      children: schritt.label,
      ...(ariaCurrent === undefined ? {} : { "aria-current": ariaCurrent }),
      ...(schritt.testId === undefined ? {} : { "data-testid": schritt.testId }),
    });

  return (
    <nav
      aria-label={label}
      className={klassen("eyt-date-range-control", className)}
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      {previous === undefined ? null : weg(previous)}

      {period === undefined ? null : (
        <p
          className={klassen("eyt-date-range-control__period", period.className)}
          {...(period.testId === undefined ? {} : { "data-testid": period.testId })}
        >
          <span className="eyt-date-range-control__period-label">{period.label}</span>
          {period.hiddenLabel === undefined ? null : (
            <>
              {" "}
              <VisuallyHidden className="eyt-date-range-control__period-key">
                {period.hiddenLabel}
              </VisuallyHidden>
            </>
          )}
        </p>
      )}

      {period?.detail === undefined ? null : (
        <p
          className={klassen("eyt-date-range-control__detail", period.detailClassName)}
          {...(period.detailTestId === undefined ? {} : { "data-testid": period.detailTestId })}
        >
          {period.detail}
        </p>
      )}

      {laufend && period?.currentLabel !== undefined ? (
        <p
          className={klassen("eyt-date-range-control__current", period.currentClassName)}
          {...(period.currentTestId === undefined ? {} : { "data-testid": period.currentTestId })}
        >
          {period.currentLabel}
        </p>
      ) : null}

      {weg(current, laufend ? "page" : undefined)}
      {next === undefined ? null : weg(next)}
    </nav>
  );
}
```

**Step 4: Aus dem Paket exportieren**

`packages/ui/src/index.ts` — nach der `LoadingState`-Zeile ergänzen:

```ts
export {
  DateRangeControl,
  type DateRangeControlProps,
  type DateRangeLinkProps,
  type DateRangePeriod,
  type DateRangeStep,
} from "./date-range-control.js";
```

**Step 5: Grün messen**

```bash
pnpm --filter @easytree/ui exec vitest run
```

Erwartet: `Test Files 4 passed (4)` (primitives, cost-slice-primitives, paket-grenze,
date-range-control) / `Tests 30 passed (30)` (16 + 3 + 11).

```bash
pnpm --filter @easytree/ui run typecheck && pnpm --filter @easytree/ui run lint
```

Erwartet: beide Exit 0.

**Step 6: Committen**

```bash
git add packages/ui/src/date-range-control.tsx packages/ui/src/index.ts \
        packages/ui/test/date-range-control.test.tsx
git diff --cached --name-only
git commit -m "feat(ui): EYT-80 DateRangeControl als domaenenfreie Periodenleiste"
```

---

## Task 4: `WochenNavigation` komponiert `DateRangeControl`

Die Sentinels aus `apps/web/test/wochen-navigation.test.tsx` werden NICHT angefasst. Sie sind
der Abnahmevertrag dieser Umstellung: bleiben sie grün, hat sich am Verhalten nichts geändert.

**Files:**

- Modify: `apps/web/components/wochen-navigation.tsx` (vollständiger Rumpf ab Zeile 59)

**Step 1: `@easytree/ui` bauen, damit `apps/web` das neue Export überhaupt sieht**

```bash
pnpm --filter @easytree/ui run build
node -e "console.log(Object.keys(require('./packages/ui/dist/index.js')).sort().join(' '))" 2>/dev/null \
  || grep -c 'DateRangeControl' packages/ui/dist/index.d.ts
```

Erwartet: `DateRangeControl` taucht auf. `apps/web` löst `@easytree/ui` über `dist` auf — ohne
diesen Bau misst der nächste Schritt ein veraltetes Paket.

**Step 2: Die Sentinel-Baseline vorher messen**

```bash
pnpm --filter @easytree/web exec vitest run test/wochen-navigation.test.tsx
```

Erwartet: `Test Files 1 passed (1)` / `Tests 11 passed (11)`.

**Step 3: Die Komponente umstellen**

`apps/web/components/wochen-navigation.tsx` — der Dateikopf (Zeilen 1–58) bleibt inhaltlich
erhalten; ergänzt wird ein Abschnitt, ersetzt wird alles ab dem Import-Block:

```tsx
/**
 * … (bestehender Dateikopf, Zeilen 1–57, unveraendert) …
 *
 * ## Seit EYT-80: die Leiste selbst ist ein geteiltes Primitive
 *
 * Struktur, Reihenfolge, der verborgene Schluessel und die Textmarke der
 * laufenden Periode liegen in `DateRangeControl` (`@easytree/ui`) und gelten
 * damit fuer JEDE Periodenleiste beider Clients. Diese Datei ist nur noch die
 * UEBERSETZUNG: sie bildet `Wochenmodell` auf die Prop-Form ab und reicht
 * `next/link` als Wegrenderer herein.
 *
 * Warum der Wegrenderer und nicht einfach `<a href>` im Primitive: ein `next/link`
 * in `@easytree/ui` faellt am Waechter `packages/ui/test/paket-grenze.test.ts`,
 * und ein nacktes `<a href>` hier waere ein volles Neuladen — also eine
 * Verhaltensaenderung, die dieser Slice nicht vornimmt.
 *
 * Die Testanker bleiben unveraendert und werden hier vergeben, nicht dort:
 * `apps/web/e2e/staging/journey.pwtest.ts` klickt `wochennavigation-vorherige`,
 * `-naechste` und `-heute`, `apps/web/e2e/planungswerkbank.spec.ts` liest
 * `werkbank-woche-iso` und `werkbank-woche-bereich`. Playwright laeuft nicht in
 * `pnpm test`; ein umbenannter Anker braeche die Reise still.
 */
import { DateRangeControl, type DateRangeLinkProps } from "@easytree/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import type { Wochenmodell } from "../lib/wochennavigation";

/** Der Rueckweg zur LAUFENDEN Woche — in beiden Modellvarianten derselbe. */
function heuteWeg(modell: Wochenmodell) {
  return { href: modell.heuteUrl, label: "Heute", testId: "wochennavigation-heute" };
}

/** Ein Weg als Next-Verknuepfung: clientseitige Navigation bleibt erhalten. */
function wochenZiel({ href, children, ...rest }: DateRangeLinkProps): ReactNode {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

export function WochenNavigation({ modell }: { modell: Wochenmodell }) {
  if (modell.art === "fehlerhaft") {
    return (
      <DateRangeControl
        label="Wochennavigation"
        className="wochennavigation"
        stepClassName="wochennavigation__ziel"
        testId="wochennavigation"
        current={heuteWeg(modell)}
        renderLink={wochenZiel}
      />
    );
  }

  return (
    <DateRangeControl
      label="Wochennavigation"
      className="wochennavigation"
      stepClassName="wochennavigation__ziel"
      testId="wochennavigation"
      previous={{
        href: modell.vorherigeUrl,
        label: "Vorherige Woche",
        testId: "wochennavigation-vorherige",
      }}
      current={heuteWeg(modell)}
      next={{
        href: modell.naechsteUrl,
        label: "Nächste Woche",
        testId: "wochennavigation-naechste",
      }}
      period={{
        label: modell.isoWochenText,
        hiddenLabel: modell.schluessel,
        detail: modell.zeitraumText,
        isCurrent: modell.istAktuelleWoche,
        currentLabel: "Aktuelle Woche",
        className: "wochennavigation__woche",
        detailClassName: "wochennavigation__zeitraum",
        currentClassName: "wochennavigation__marke",
        testId: "werkbank-woche-iso",
        detailTestId: "werkbank-woche-bereich",
        currentTestId: "wochennavigation-aktuell",
      }}
      renderLink={wochenZiel}
    />
  );
}
```

**Step 4: Die Sentinels müssen unverändert grün sein**

```bash
pnpm --filter @easytree/web exec vitest run test/wochen-navigation.test.tsx \
     test/planungs-werkbank.test.tsx test/kosten-uebergang.test.tsx test/planung-a11y.test.tsx
```

Erwartet: `Test Files 4 passed (4)`, keine einzige Anpassung an einer dieser Dateien.

Geht `test/wochen-navigation.test.tsx` rot mit
`expected "SENTINEL-WOCHENTEXT SENTINEL-SCHLUESSEL"`, fehlt das `{" "}` zwischen sichtbarem Text
und `VisuallyHidden` im Primitive — das ist der wahrscheinlichste Fehler dieses Tasks.

**Step 5: Gegenmutation über die Nahtstelle — ausführen, messen, zurücknehmen**

Diese Gegenmutation zielt auf die NEUE Nahtstelle: dass die Adresse aus dem Modell wirklich durch
das Primitive bis in den Weg getragen wird.

```bash
cp apps/web/components/wochen-navigation.tsx /tmp/wochen-navigation.tsx.sicherung
perl -0pi -e 's/href: modell\.naechsteUrl,/href: modell.vorherigeUrl,/' \
  apps/web/components/wochen-navigation.tsx
grep -c 'href: modell.vorherigeUrl,' apps/web/components/wochen-navigation.tsx
```

Erwartet: `2` — die Mutation ist wirklich drin, und genau einmal ersetzt worden. Trefferzahl
lesen: ein Skript, das stumm mehr oder weniger mutiert, macht die Messung falsch.

```bash
pnpm --filter @easytree/web exec vitest run test/wochen-navigation.test.tsx
```

Erwartet: **FAIL**, `verlinkt vorwaerts auf genau die uebergebene Adresse`, gemeldet als
`expected "/planung?weekKey=SENTINEL-VOR" to be "/planung?weekKey=SENTINEL-NACH"`.

Zurücknehmen und belegen:

```bash
cp /tmp/wochen-navigation.tsx.sicherung apps/web/components/wochen-navigation.tsx \
  && rm /tmp/wochen-navigation.tsx.sicherung
grep -c 'href: modell.naechsteUrl,' apps/web/components/wochen-navigation.tsx
pnpm --filter @easytree/web exec vitest run test/wochen-navigation.test.tsx
```

Erwartet: `1`, dann `Tests 11 passed (11)`.

**Step 6: Committen**

```bash
git add apps/web/components/wochen-navigation.tsx
git diff --cached --name-only
git commit -m "refactor(web): EYT-80 die Wochennavigation komponiert DateRangeControl"
```

---

## Task 5: `AppShell` — der Abnahmevertrag zuerst

**Files:**

- Create: `packages/ui/test/app-shell.test.tsx`

**Step 1: Den fehlschlagenden Test schreiben**

`packages/ui/test/app-shell.test.tsx`:

```tsx
/**
 * `AppShell` — der geteilte Rahmen beider Clients (EYT-80, Confluence 8814623 §6).
 *
 * ## Was das Primitive besitzt — und was ausdruecklich nicht
 *
 * Es besitzt genau das, was die Barrierefreiheit traegt: den Sprunglink, die
 * `header`-, `main`- und `footer`-Landmarks und die `id`, die Sprunglink und
 * Hauptbereich TEILEN. Alles andere — Marke, Navigationspunkte,
 * Organisationswahl, Abmelden — ist Markup der App und kommt als Slot herein.
 *
 * Der Grund steht in Confluence 8486960 §5: Tokens und zugaengliche Primitives
 * sind GEMEINSAM, Navigation und Informationsarchitektur sind GETRENNT. Ein
 * Rahmen, der die Navigationspunkte selbst zusammensetzte, muesste die
 * Rechteliste kennen — und waere keine domaenenfreie Komponente mehr. Der Weg
 * dorthin ist auch nicht offen: `paket-grenze.test.ts` wuerde den Import melden.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell } from "../src/index.js";

afterEach(cleanup);

function rahmen(zusatz: Record<string, unknown> = {}) {
  return (
    <AppShell
      skipLinkLabel="Zum Hauptinhalt springen"
      mainId="hauptinhalt"
      header={<span data-testid="marke">Produktname</span>}
      footer={<p data-testid="fuss">Fusszeile</p>}
      {...zusatz}
    >
      <p data-testid="inhalt">Seiteninhalt</p>
    </AppShell>
  );
}

describe("AppShell — die Landmarks", () => {
  it("stellt genau eine main-Landmark mit der uebergebenen id bereit", () => {
    render(rahmen());
    const haupt = screen.getByRole("main");
    expect(haupt.id).toBe("hauptinhalt");
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("laesst die main-Landmark programmatisch fokussierbar sein", () => {
    // Ohne `tabIndex={-1}` springt der Sprunglink zwar zum Anker, der Fokus
    // bleibt aber stehen — die Tastaturbedienung waere still gebrochen.
    render(rahmen());
    expect(screen.getByRole("main").getAttribute("tabindex")).toBe("-1");
  });

  it("rendert Kopf- und Fussbereich als eigene Landmarks", () => {
    render(rahmen());
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
  });

  it("laesst Kopf und Fuss ganz weg, wenn kein Slot uebergeben wird", () => {
    render(
      <AppShell skipLinkLabel="Springen" mainId="inhalt">
        <p>nur Inhalt</p>
      </AppShell>,
    );
    // Ein leeres `<header>` waere eine Landmark ohne Inhalt — im Screenreader
    // eine Station, die nirgendwohin fuehrt.
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });
});

describe("AppShell — der Sprunglink", () => {
  it("zielt auf genau die id der main-Landmark", () => {
    render(rahmen());
    const sprung = screen.getByRole("link", { name: "Zum Hauptinhalt springen" });
    expect(sprung.getAttribute("href")).toBe("#hauptinhalt");
  });

  it("folgt der id, wenn die App eine andere vergibt", () => {
    // Eine fest verdrahtete `#hauptinhalt` waere hier gruen und im
    // Mitarbeiter-Client falsch.
    render(rahmen({ mainId: "feld-inhalt" }));
    expect(
      screen.getByRole("link", { name: "Zum Hauptinhalt springen" }).getAttribute("href"),
    ).toBe("#feld-inhalt");
    expect(screen.getByRole("main").id).toBe("feld-inhalt");
  });

  it("steht als ERSTES Element im Rahmen", () => {
    const { container } = render(rahmen());
    expect(container.firstElementChild?.tagName).toBe("A");
    expect(container.firstElementChild?.getAttribute("href")).toBe("#hauptinhalt");
  });
});

describe("AppShell — Slots und Reihenfolge", () => {
  it("stellt Kopf, Inhalt und Fuss in dieser Reihenfolge dar", () => {
    const { container } = render(rahmen());
    expect([...container.children].map((kind) => kind.tagName)).toEqual([
      "A",
      "HEADER",
      "MAIN",
      "FOOTER",
    ]);
  });

  it("reicht die Slots unveraendert durch", () => {
    render(rahmen());
    expect(screen.getByTestId("marke").textContent).toBe("Produktname");
    expect(screen.getByTestId("inhalt").textContent).toBe("Seiteninhalt");
    expect(screen.getByTestId("fuss").textContent).toBe("Fusszeile");
  });
});

describe("AppShell — Darstellung bleibt bei der App", () => {
  it("haengt die durchgereichten Klassen an die eigenen an", () => {
    const { container } = render(
      rahmen({
        skipLinkClassName: "skip-link",
        headerClassName: "app-header",
        mainClassName: "app-main",
        footerClassName: "app-footer",
      }),
    );
    const klassen = (auswahl: string) =>
      (container.querySelector(auswahl)?.className ?? "").split(" ");
    expect(klassen("a")).toEqual(expect.arrayContaining(["eyt-app-shell__skip-link", "skip-link"]));
    expect(klassen("header")).toEqual(
      expect.arrayContaining(["eyt-app-shell__header", "app-header"]),
    );
    expect(klassen("main")).toEqual(expect.arrayContaining(["eyt-app-shell__main", "app-main"]));
    expect(klassen("footer")).toEqual(
      expect.arrayContaining(["eyt-app-shell__footer", "app-footer"]),
    );
  });
});
```

**Step 2: Rot messen**

```bash
pnpm --filter @easytree/ui exec vitest run test/app-shell.test.tsx
```

Erwartet: **FAIL** — kein `AppShell`-Export. Dateizahl `1` lesen.

**Step 3: Das Primitive implementieren**

`packages/ui/src/app-shell.tsx`:

```tsx
import type { ReactNode } from "react";

export interface AppShellProps {
  /** Beschriftung des Sprunglinks — das erste Tab-Ziel jeder Seite. */
  skipLinkLabel: string;
  /**
   * Die `id` des Hauptbereichs. Sprunglink und `<main>` TEILEN sie; sie steht
   * deshalb genau einmal hier und wird nicht zweimal geschrieben.
   */
  mainId: string;
  /** Kopfbereich. Inhalt, Reihenfolge und Rechtefilter bestimmt die App. */
  header?: ReactNode;
  /** Fussbereich. */
  footer?: ReactNode;
  children: ReactNode;
  skipLinkClassName?: string;
  headerClassName?: string;
  mainClassName?: string;
  footerClassName?: string;
}

function klassen(...werte: Array<string | undefined>): string {
  return werte.filter(Boolean).join(" ");
}

/**
 * Der geteilte Rahmen beider Clients (Basisdesign v2.0 §6, Confluence 8486960 §5).
 *
 * ## Was er besitzt
 *
 * Sprunglink, `header`, `main` und `footer` — und die `id`, die Sprunglink und
 * Hauptbereich verbindet. `tabIndex={-1}` auf dem `<main>` ist kein Beiwerk:
 * ohne ihn springt der Sprunglink zwar zum Anker, der Fokus bleibt aber stehen.
 *
 * ## Was er ausdruecklich NICHT besitzt
 *
 * Navigationspunkte, Organisationswahl, Sitzung, Routing, Layout. Admin- und
 * Mitarbeiter-Shell teilen sich Tokens und Primitives, aber NICHT die
 * Informationsarchitektur und nicht die Darstellungsdichte. Die Slots sind
 * genau diese Grenze; die Klassen kommen von aussen dazu, statt hier zu stehen.
 *
 * ## Warum die Landmarks entfallen, wenn ihr Slot fehlt
 *
 * Ein leeres `<header>` waere eine Station im Screenreader, die nirgendwohin
 * fuehrt. Kein Slot, keine Landmark.
 */
export function AppShell({
  skipLinkLabel,
  mainId,
  header,
  footer,
  children,
  skipLinkClassName,
  headerClassName,
  mainClassName,
  footerClassName,
}: AppShellProps): ReactNode {
  return (
    <>
      <a className={klassen("eyt-app-shell__skip-link", skipLinkClassName)} href={`#${mainId}`}>
        {skipLinkLabel}
      </a>
      {header === undefined ? null : (
        <header className={klassen("eyt-app-shell__header", headerClassName)}>{header}</header>
      )}
      <main id={mainId} tabIndex={-1} className={klassen("eyt-app-shell__main", mainClassName)}>
        {children}
      </main>
      {footer === undefined ? null : (
        <footer className={klassen("eyt-app-shell__footer", footerClassName)}>{footer}</footer>
      )}
    </>
  );
}
```

**Step 4: Aus dem Paket exportieren**

`packages/ui/src/index.ts` ergänzen:

```ts
export { AppShell, type AppShellProps } from "./app-shell.js";
```

**Step 5: Grün messen**

```bash
pnpm --filter @easytree/ui exec vitest run
pnpm --filter @easytree/ui run typecheck && pnpm --filter @easytree/ui run lint
pnpm --filter @easytree/ui run build
```

Erwartet: `Test Files 5 passed (5)` / `Tests 41 passed (41)` (16 + 3 + 11 + 11), alle drei
Befehle Exit 0. Der `paket-grenze`-Wächter deckt die zwei neuen Dateien automatisch mit ab.

**Step 6: Committen**

```bash
git add packages/ui/src/app-shell.tsx packages/ui/src/index.ts packages/ui/test/app-shell.test.tsx
git diff --cached --name-only
git commit -m "feat(ui): EYT-80 AppShell als domaenenfreier Rahmen beider Clients"
```

---

## Task 6: Die reale `apps/web`-Shell komponiert das Primitive

**Files:**

- Modify: `apps/web/components/app-shell.tsx` (Rumpf ab Zeile 38 — Import-Block ergänzt)

Session, `hatRecht`, Organisationswahl, `usePathname`, `useRouter` und `abmelden` bleiben Zeile
für Zeile hier. Es ändert sich ausschließlich, WER die vier Rahmenelemente rendert.

**Step 1: Die Shell-Baseline vorher messen**

```bash
pnpm --filter @easytree/web exec vitest run test/a11y.test.tsx
```

Erwartet: `Test Files 1 passed (1)`, davon die vier Zusicherungen der Shell-Baseline grün.

**Step 2: Die Shell umstellen**

`apps/web/components/app-shell.tsx`:

```tsx
"use client";

import { AppShell as WerkbankRahmen } from "@easytree/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useSession } from "../lib/session-provider";

/**
 * Shell der Werkbank (Basisdesign v2.0 §3.1): kompakte Topbar, globale
 * Navigation, Organisations- und Benutzeranzeige. Skip-Link und Landmarks
 * bleiben aus Sprint 1 erhalten (EYT-41).
 *
 * Der Navigationspunkt „Kosten" erscheint AUSSCHLIESSLICH mit `costs.read`
 * aus der realen Session — und ersetzt trotzdem keine API-Autorisierung:
 * dieselbe Rechteliste steuert hier nur die Anzeige.
 *
 * ## Seit EYT-80: der Rahmen ist geteilt, die Fachlichkeit nicht
 *
 * Sprunglink, `header`, `main` und `footer` liegen in `AppShell`
 * (`@easytree/ui`) und gelten damit fuer BEIDE Clients (Confluence 8486960 §5).
 * Hier bleibt, was ein domaenenfreies Paket nicht wissen darf: die Sitzung, die
 * Rechtefilterung der Navigationspunkte, die Organisationswahl und das
 * Abmelden. Der Rahmen bekommt sie als fertiges Markup in den `header`-Slot.
 *
 * Das Primitive wird als `WerkbankRahmen` importiert, weil beide Module eine
 * `AppShell` exportieren; der Exportname HIER bleibt `AppShell`, weil
 * `app/layout.tsx` und `test/a11y.test.tsx` ihn so importieren.
 *
 * Die Layoutklassen (`skip-link`, `app-header`, `app-main`, `app-footer`)
 * werden durchgereicht statt verschoben: `globals.css` bleibt damit
 * unveraendert und es entsteht kein visueller Regress, den heute kein Test
 * abfinge.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pfad = usePathname();
  const router = useRouter();
  const { sitzung, organisation, organisationWaehlen, hatRecht, abmelden } = useSession();

  const angemeldet = sitzung.zustand === "angemeldet";
  const organisationen = angemeldet ? sitzung.session.organisations : [];

  const navPunkte: Array<{ href: string; label: string }> = [
    { href: "/", label: "Start" },
    // Seit EYT-107 gefiltert: bis dahin stand „Planung" unbedingt in der
    // Navigation, waehrend die API jede Planungsanfrage mit 401/403
    // beantwortete — ein Link, der fuer niemanden funktionierte. Basisdesign
    // v2.0 §3.1: „Die Navigation wird serverseitig nach atomaren Rechten
    // gefiltert. Ein sichtbarer Navigationspunkt ersetzt keine
    // Autorisierung." Beides gilt: gefiltert wird hier, entschieden dort.
    ...(hatRecht("planning.read") ? [{ href: "/planung", label: "Planung" }] : []),
    ...(hatRecht("costs.read") ? [{ href: "/kosten", label: "Kosten" }] : []),
  ];

  return (
    <WerkbankRahmen
      skipLinkLabel="Zum Hauptinhalt springen"
      skipLinkClassName="skip-link"
      mainId="hauptinhalt"
      headerClassName="app-header"
      mainClassName="app-main"
      footerClassName="app-footer"
      header={
        <>
          <span className="app-brand">easyTree</span>
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
          <div className="app-session">
            {angemeldet ? (
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
            )}
          </div>
        </>
      }
      footer={<p>easyTree — Arboscus Teamplaner</p>}
    >
      {children}
    </WerkbankRahmen>
  );
}
```

**Step 3: Grün messen — die volle Web-Suite, nicht nur die Shell**

```bash
pnpm --filter @easytree/ui run build
pnpm --filter @easytree/web exec vitest run
```

Erwartet: `Test Files 28 passed (28)` / `Tests 309 passed (309)` — **exakt die Baseline aus
§0.3**. Jede Abweichung nach unten ist ein Regress, jede nach oben ohne eigene neue Testdatei
ebenfalls verdächtig.

```bash
pnpm --filter @easytree/web run typecheck && pnpm --filter @easytree/web run lint
```

Erwartet: beide Exit 0.

**Step 4: Gegenmutation auf der A11y-Nahtstelle — ausführen, messen, zurücknehmen**

```bash
cp packages/ui/src/app-shell.tsx /tmp/app-shell.tsx.sicherung
perl -0pi -e 's/        tabIndex=\{-1\}\n//' packages/ui/src/app-shell.tsx
grep -c 'tabIndex' packages/ui/src/app-shell.tsx
```

Erwartet: `0` — die Zeile ist wirklich weg.

```bash
pnpm --filter @easytree/ui exec vitest run test/app-shell.test.tsx
```

Erwartet: **FAIL**, `laesst die main-Landmark programmatisch fokussierbar sein`, gemeldet als
`expected null to be "-1"`.

Zweite Hälfte derselben Gegenmutation — auf der REALEN Fläche, über den gebauten Pfad:

```bash
pnpm --filter @easytree/ui run build
pnpm --filter @easytree/web exec vitest run e2e_platzhalter 2>/dev/null; \
  pnpm --filter @easytree/web run test:e2e 2>&1 | tail -20
```

Erwartet: `Tastatur: Skip-Link ist erstes Tab-Ziel und springt zu #hauptinhalt` wird ROT
(`expect(page.locator("#hauptinhalt")).toBeFocused()` schlägt fehl). Läuft Playwright nicht,
weil die Browser fehlen (`Executable doesn't exist`), erst `pnpm exec playwright install chromium`
— 100 % rote Playwright-Läufe in einem frischen Baum sind fehlende Binaries, keine Regression.
Ist der Lauf hier nicht fahrbar, das ausdrücklich als NICHT gemessen melden statt zu behaupten.

Zurücknehmen und belegen:

```bash
cp /tmp/app-shell.tsx.sicherung packages/ui/src/app-shell.tsx && rm /tmp/app-shell.tsx.sicherung
git diff -- packages/ui/src/app-shell.tsx
pnpm --filter @easytree/ui run build
pnpm --filter @easytree/ui exec vitest run test/app-shell.test.tsx
```

Erwartet: leerer Diff auf die mutierte Datei, dann `Tests 11 passed (11)`.

**Step 5: Committen**

```bash
git add apps/web/components/app-shell.tsx
git diff --cached --name-only
git commit -m "refactor(web): EYT-80 die Werkbank-Shell komponiert das geteilte AppShell"
```

---

## Task 7: Die Nahtstelle bekommt einen eigenen Wächter

Bis hierher hält nichts fest, dass die Web-Shell den geteilten Rahmen wirklich BENUTZT. Sie
könnte morgen wieder `<header>` und `<main>` selbst schreiben, und alle Tests blieben grün — die
Landmarks stünden ja weiterhin da. Genau diese Klasse Lücke ist im Projekt schon aufgefallen
(„Wächter existiert, betritt die Fläche aber nie").

**Files:**

- Create: `apps/web/test/shell-komposition.test.ts`

**Step 1: Den Wächter schreiben**

`apps/web/test/shell-komposition.test.ts`:

```ts
/**
 * Die Werkbank-Shell benutzt den GETEILTEN Rahmen — gemessen (EYT-80).
 *
 * ## Warum die Landmark-Zusicherungen dafuer nicht reichen
 *
 * `test/a11y.test.tsx` prueft, DASS es eine `main`-Landmark mit der richtigen
 * `id` gibt und dass der Sprunglink das erste Tab-Ziel ist. Beides bliebe gruen,
 * wenn `app-shell.tsx` morgen wieder `<header>`, `<main>` und `<footer>` selbst
 * schriebe — die geteilte Grundlage waere still wieder zwei Grundlagen, und der
 * Mitarbeiter-Client baute spaeter seine eigene daneben (EYT-80: „Keine
 * Sprint-7-Produktflaeche fuehrt ein eigenes abweichendes System ein").
 *
 * ## Gelesen werden die IMPORTE, nicht der Rohtext
 *
 * Dieselbe Bauart wie in `test/kosten-uebergang.test.tsx:135-142`: ein
 * Kommentar, der `@easytree/ui` erwaehnt, darf diese Zusicherung nicht faerben.
 *
 * ## Gegenmutation
 *
 * Den Import von `@easytree/ui` aus `components/app-shell.tsx` entfernen und
 * `<header>`/`<main>`/`<footer>` wieder direkt schreiben — „bezieht den Rahmen
 * aus dem geteilten Paket" wird rot.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** `import.meta.url` ist unter jsdom kein `file://`-URL; `cwd` ist `apps/web`. */
const SHELL = join(process.cwd(), "components", "app-shell.tsx");

const QUELLE = readFileSync(SHELL, "utf8");

describe("Werkbank-Shell — die Komposition ist gemessen", () => {
  it("liest wirklich die Shell", () => {
    // Nicht vakuum: ohne diese Zeile prueften die folgenden eine leere Datei.
    expect(QUELLE).toContain("export function AppShell");
  });

  it("bezieht den Rahmen aus dem geteilten Paket", () => {
    const importe = [...QUELLE.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)].map(
      (treffer) => treffer[1],
    );
    expect(importe).toContain("@easytree/ui");
  });

  it("schreibt die Rahmen-Landmarks nicht selbst", () => {
    // Sie kommen aus dem Primitive. Stuenden sie hier, gaebe es zwei Rahmen —
    // und im Zweifel zwei verschachtelte `main`, wie schon einmal in EYT-141.
    for (const marke of ["<header", "<main", "<footer"]) {
      expect(QUELLE).not.toContain(marke);
    }
  });

  it("behaelt Sitzung und Rechtefilter HIER", () => {
    // Die Gegenrichtung: der geteilte Rahmen darf die Fachlichkeit nicht
    // an sich ziehen. Waere sie dort, faende `paket-grenze.test.ts` den Import
    // — und diese Zeile faende sie hier nicht mehr.
    expect(QUELLE).toContain("useSession");
    expect(QUELLE).toContain('hatRecht("costs.read")');
  });
});
```

**Step 2: Grün messen**

```bash
pnpm --filter @easytree/web exec vitest run test/shell-komposition.test.ts
```

Erwartet: `Test Files 1 passed (1)` / `Tests 4 passed (4)`.

**Step 3: Gegenmutation — ausführen, messen, zurücknehmen**

```bash
cp apps/web/components/app-shell.tsx /tmp/app-shell-web.tsx.sicherung
perl -0pi -e 's/<WerkbankRahmen/<main data-mutation="ja"/' apps/web/components/app-shell.tsx
grep -c '<main data-mutation="ja"' apps/web/components/app-shell.tsx
pnpm --filter @easytree/web exec vitest run test/shell-komposition.test.ts
```

Erwartet: `1`, dann **FAIL** bei `schreibt die Rahmen-Landmarks nicht selbst`.

```bash
cp /tmp/app-shell-web.tsx.sicherung apps/web/components/app-shell.tsx \
  && rm /tmp/app-shell-web.tsx.sicherung
git diff -- apps/web/components/app-shell.tsx
pnpm --filter @easytree/web exec vitest run test/shell-komposition.test.ts
```

Erwartet: leerer Diff, dann `Tests 4 passed (4)`.

**Step 4: Committen**

```bash
git add apps/web/test/shell-komposition.test.ts
git diff --cached --name-only
git commit -m "test(web): EYT-80 die Shell-Komposition wird gemessen statt vorausgesetzt"
```

---

## Task 8: Die Repository-Gates

**Files:** keine Änderung.

**Step 1: Format**

```bash
git ls-files -z | xargs -0 pnpm exec prettier --ignore-unknown --check
```

Erwartet: Exit 0. Der Befehl prüft die GETRACKTE Menge; `pnpm format` würde zusätzlich
ungetrackte Dateien unter `docs/plans/` melden — darunter diese Plandatei —, was CI nie sieht.

Schlägt er fehl: `git ls-files -z | xargs -0 pnpm exec prettier --ignore-unknown --write`, dann
erneut prüfen und die Formatierung als eigenen Commit anhängen.

**Step 2: Lint, Typecheck, Test — erzwungen, nicht abgespielt**

```bash
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run test --force
```

Erwartet je Lauf: `Cached: 0 cached` UND `Tasks: N successful`. **Die `Cached:`-Zeile lesen.**
Ein `FULL TURBO` ist ein Abspielen und beweist nichts — der Cache greift außerdem über Worktrees
hinweg.

**Step 3: Build**

```bash
env -u EASYTREE_API_PROXY_TARGET pnpm build
```

Erwartet: Exit 0, `Cached: 0 cached`. Kein Build braucht `EASYTREE_API_PROXY_TARGET` (EYT-126);
der Variablen-Entzug beweist genau das mit.

**Step 4: Playwright auf der realen Fläche**

```bash
pnpm exec playwright install chromium   # nur nötig, wenn Binaries fehlen
pnpm --filter @easytree/web run test:e2e
```

Erwartet: Exit 0. Port 3000 muss frei sein; Playwright startet seinen eigenen Server gegen den
Produktionsbau. Deckt `shell-smoke.spec.ts` (Sprunglink, Fokus, Landmarks, 320/375 px, axe) und
`planungswerkbank.spec.ts` (`werkbank-woche-iso`, `werkbank-woche-bereich`) ab — genau die zwei
Flächen, die dieser Slice anfasst.

Ist der Lauf nicht fahrbar, das SO melden. „Playwright nicht gelaufen" ist ein offener Punkt,
kein grüner.

**Step 5: Diff-Umfang belegen**

```bash
git diff --name-only origin/master...HEAD
git diff --name-only origin/master...HEAD -- \
  packages/domain packages/contracts apps/api supabase '*.sql'
```

Erwartet: erste Liste enthält AUSSCHLIESSLICH

```
apps/web/components/app-shell.tsx
apps/web/components/wochen-navigation.tsx
apps/web/test/shell-komposition.test.ts
packages/ui/src/app-shell.tsx
packages/ui/src/date-range-control.tsx
packages/ui/src/index.ts
packages/ui/test/app-shell.test.tsx
packages/ui/test/date-range-control.test.tsx
packages/ui/test/paket-grenze.test.ts
```

Die zweite Liste muss **leer** sein — kein Domain-, Contract-, API-, Auth-, DB- oder
Migrationspfad. `apps/web/app/globals.css` steht bewusst nicht in der ersten Liste (E1).

**Step 6: Die Plandatei darf NICHT mitgehen**

```bash
git status --porcelain docs/plans/2026-08-26-eyt-80-werkbank-ui-foundation.md
```

Erwartet: `?? docs/plans/2026-08-26-eyt-80-werkbank-ui-foundation.md` — ungetrackt. Der
Auftragsvertrag verbietet einen committeten Plan; ein generierter Ausführungsplan im Slice ist
im Review ein eigener Befund.

---

## Task 9: Push und PR

**Files:** keine Änderung.

**Step 1: Gegen den aktuellen `origin/master` gegenprüfen**

```bash
git fetch origin --prune
git rev-parse origin/master
```

Weicht der SHA vom Startpunkt aus Task 1 Step 2 ab, ist das STOP-Bedingung 2. Dann: `git merge
origin/master`, die Gates aus Task 8 VOLLSTÄNDIG wiederholen, und den Wechsel im Evidenzpaket
nennen. Das Ruleset verlangt ohnehin einen up-to-date Branch.

**Step 2: Push**

```bash
git push --set-upstream origin feat/eyt-80-werkbank-foundation
```

Nie vor grünem Gate pushen; Task 8 muss durch sein.

**Step 3: PR öffnen**

```bash
gh pr create --base master --head feat/eyt-80-werkbank-foundation \
  --title "feat(ui): EYT-80 Werkbank-UI-Foundation — AppShell und DateRangeControl" \
  --body-file /tmp/eyt-80-pr.md
```

Der Rumpf wird VORHER in `/tmp/eyt-80-pr.md` geschrieben, nach dem Schreiben noch einmal GELESEN
und erst dann gesendet — Entwurfsfragmente sind hier schon einmal in ein Jira-Kommentar geraten.
Er enthält:

- was gebaut wurde und was ausdrücklich nicht (§0.2-Tabelle, gekürzt);
- die drei ausgeführten Gegenmutationen mit dem jeweils gemeldeten roten Text und dem Beleg der
  Rücknahme;
- die Gate-Ausgaben aus Task 8 mit ihren Zahlen, nicht mit Häkchen;
- den Satz: **EYT-80 ist damit NICHT Done** — dieses Inkrement deckt zwei der zehn geforderten
  Primitives ab; Kontrasttests, Zustandsmuster, `BottomNavigation` und visuelle Regressionen
  bleiben offen (§9);
- ob Playwright gelaufen ist oder nicht;
- die Evidenzstufe jeder Aussage.

**Step 4: CI beobachten**

```bash
gh pr view --json number,headRefOid
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree <headRefOid> 2400
gh run view <run-id> --json status,conclusion,headSha
```

`gh-ci-wait` Exit 1 kann „abgebrochen" heißen (`ci.yml` hat `cancel-in-progress`; ein
nachgeschobener Push verdrängt den Lauf des vorherigen Heads), Exit 0 kann Timeout heißen — den
Endstand IMMER direkt über `gh run view` gegenprüfen und den Lauf mit ID und Head-SHA nennen.

**Step 5: STOP.** Kein Merge, kein Jira-Übergang, kein Deploy, kein nächster Sprint-7-Slice.

---

## 9. Offene Risiken und neu entdeckte Arbeit

**Bewusst nicht in diesem Inkrement, gehört aber zu EYT-80:**

1. **Kontrasttests (EYT-80 AC2, EYT-12).** Kein Test verhindert heute `#6D786F` auf `#F0F4EF`
   (≈ 4,14:1) und `#A86B2B` auf `#F6E9D8` (≈ 3,66:1) als normalen Kleintext. Die Tokens in
   `globals.css:13-59` sind korrekt, aber ungeschützt. Braucht einen eigenen Rechen-Wächter über
   die Token-Paare — und die Notiz, dass axe `color-contrast` in jsdom deaktiviert ist
   (`a11y.test.tsx:70`), also nichts davon abfängt.
2. **Zustandsmuster (EYT-80 AC4).** `Forbidden`, `Unauthenticated`, `Stale`, `Partial`, `Retry`
   existieren als Primitives nicht.
3. **`BottomNavigation` und die Mitarbeiter-Shell.** EYT-81/EYT-113, ausdrücklich außerhalb.
4. **Visuelle Regressionen aus realen Produktseiten (EYT-80 AC7).** Keine Snapshot-Infrastruktur.
5. **`prefers-reduced-motion` (EYT-12).** In `globals.css` nicht behandelt (nicht gegengeprüft, ob
   es überhaupt Animationen gibt).

**Risiken dieses Inkrements:**

- **`packages/ui/dist` als stille Fehlerquelle.** `apps/web` liest `dist`, nicht die Quelle, und
  `noEmitOnError` ist nirgends gesetzt. Jeder Schritt, der Web-Tests nach einer UI-Änderung misst,
  MUSS `pnpm --filter @easytree/ui run build` davor haben. Im Plan steht das an jeder betroffenen
  Stelle; wird es übersprungen, misst der Lauf das alte Paket.
- **`prettier`-Lärm aus `docs/plans/`.** Die ungetrackte Plandatei taucht in `pnpm format` auf.
  Das ist lokales Rauschen, kein CI-Befund — geprüft wird die getrackte Menge (Task 8 Step 1).
- **Der Playwright-Beleg ist der schwächste Punkt.** Ein frischer Baum ohne Browser-Binaries meldet
  100 % rot; Port 3000 muss frei sein. Ist der Lauf nicht fahrbar, bleibt die reale Fläche für
  Sprunglink-Fokus und die Wochenanker in DIESEM Slice unbewiesen — dann ist `auth-journey` in CI
  die einzige Stelle, die den Pfad noch anfasst, und das gehört so gesagt.
- **`.eyt-app-shell__*`- und `.eyt-date-range-control__*`-Klassen haben keine CSS-Regeln.** Das ist
  Absicht (E1) und heute folgenlos, weil die App ihre eigenen Klassen mitgibt. Der Mitarbeiter-
  Client wird sie brauchen — dann ist zu entscheiden, ob die Vorgaben ins Paket wandern oder pro
  Client bleiben.
- **Der `paket-grenze`-Wächter erlaubt `react-dom`.** Heute importiert es niemand. Erlaubt ist es,
  weil ein Primitive mit Portal es bräuchte; wer die Liste enger zieht, muss `react-dom` streichen.

**Evidenzstufen in diesem Plan:** alle Zahlen aus §0.3 und die PR-#94-Messung sind **lokale
Läufe** bzw. **`gh`-Abfragen** vom 26.08.2026. Nichts hier ist durch einen CI-Lauf belegt — der
kommt erst in Task 9 Step 4 und ist die höhere Stufe.

---

## Execution Handoff

Der Plan ist unter `docs/plans/2026-08-26-eyt-80-werkbank-ui-foundation.md` abgelegt und
**bewusst nicht committed**.

**Er ist noch nicht ausführbar:** Task 1 bricht ab, solange PR #94 offen ist (Stand 26.08.2026:
`OPEN`, Head `c3947f792a3d27b023bf71524e674a6bb6c7593a`, `mergeStateStatus: CLEAN`). Erst nach
Merge oder Schließung von #94 startet Task 1 gegen den dann frischen `origin/master`.
