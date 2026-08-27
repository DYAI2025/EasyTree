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
 * Nicht, weil die zwei Literale in `apps/web/components/app-shell.tsx`
 * ungeschuetzt gewesen waeren — das waren sie nicht. Beide sind heute einzeln
 * festgenagelt, und ein Tippfehler in einem von ihnen faerbt zwei Pflichtjobs
 * rot (gemessen 27.08.2026): `apps/web/test/a11y.test.tsx:80` prueft
 * `href === "#hauptinhalt"` und `:90` prueft `main.id === "hauptinhalt"` im
 * Job `unit-tests`; `apps/web/e2e/shell-smoke.spec.ts:65` sucht
 * `a[href='#hauptinhalt']`, drueckt Enter und `:68` verlangt, dass
 * `#hauptinhalt` den Fokus bekommt — Job `web-smoke`.
 *
 * Geschuetzt ist damit aber nur DIESER EINE Wert, und zwar dadurch, dass
 * `a11y.test.tsx` dieselbe Zeichenkette zweimal hart hinschreibt. Der Gewinn
 * des Primitives ist, dass die Kopplung fuer JEDE id haelt — auch fuer das
 * `mainId` eines Feld-Clients, wo es kein solches festgenageltes Paar gibt.
 * Genau das misst der Fall `mainId: "inhalt-feld"`, und sonst nichts hier.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell, type AppShellProps } from "../src/index.js";

afterEach(cleanup);

function rahmen(zusatz: Partial<AppShellProps> = {}) {
  return render(
    <AppShell skipLinkLabel="Zum Inhalt" brand={<span>Marke</span>} {...zusatz}>
      <p>Seiteninhalt</p>
    </AppShell>,
  );
}

/**
 * Die drei Formen, in denen ein Slot ABWESEND ist. `null` und `false` sind
 * keine Randfaelle, sondern das, was `bedingung ? <X/> : null` und
 * `bedingung && <X/>` erzeugen — die zwei Schreibweisen, die eine aufrufende
 * Anwendung tatsaechlich verwendet.
 */
const ABWESENDE_FORMEN: [string, ReactNode][] = [
  ["undefined (Prop fehlt ganz)", undefined],
  ["null (bedingung ? <X/> : null)", null],
  ["false (bedingung && <X/>)", false],
];

describe("AppShell — Struktur", () => {
  it("stellt genau eine banner-, main- und contentinfo-Landmark", () => {
    rahmen({ footer: <p>Fusszeile</p> });
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  });

  it("stellt Kinder in den Hauptbereich, nicht daneben", () => {
    rahmen();
    expect(screen.getByRole("main").contains(screen.getByText("Seiteninhalt"))).toBe(true);
  });

  it("stellt Marke, Navigation und Sitzungsbereich in den Kopf", () => {
    const { container } = rahmen({
      navigation: <nav aria-label="Test">Punkte</nav>,
      sessionArea: <span>Sitzung</span>,
    });
    const kopf = screen.getByRole("banner");
    expect(kopf.contains(screen.getByRole("navigation", { name: "Test" }))).toBe(true);

    // Die Marke bekommt eine Huelle, und die traegt in der Werkbank eigene
    // Regeln (heute `.eyt-app-shell__brand`, `apps/web/app/globals.css:123`,
    // nachgemessen 27.08.2026 nach der Umbenennung). Ein blosses
    // `kopf.contains(...)` waere auch ohne sie wahr — dieselbe Luecke wie beim
    // Sitzungsbereich, deshalb dieselbe Zusicherung.
    const markenhuelle = container.querySelector(".eyt-app-shell__brand");
    expect(markenhuelle).not.toBeNull();
    expect(markenhuelle?.contains(screen.getByText("Marke"))).toBe(true);

    // Die Navigation bekommt bewusst KEINE Huelle: das `<nav>` der Anwendung
    // ist direktes Flex-Kind der Kopfleiste, und die Regeln der Werkbank
    // stuetzen sich darauf. Ohne diese Zusicherung koennte ein Huellen-`div`
    // hinzukommen, ohne dass irgendetwas rot wird.
    expect(screen.getByRole("navigation", { name: "Test" }).parentElement).toBe(kopf);

    // Der Sitzungsbereich dagegen bekommt eine Huelle, und die traegt in der
    // Werkbank `margin-left: auto` (heute `.eyt-app-shell__session`,
    // `apps/web/app/globals.css:262-267`, nachgemessen 27.08.2026 nach der
    // Umbenennung). Ein blosses `kopf.contains(...)` waere auch ohne sie wahr —
    // deshalb wird die Huelle selbst geprueft. Dass die Regel auch WIRKT, misst
    // `apps/web/e2e/shell-smoke.spec.ts` im Browser; hier steht nur die Huelle.
    const huelle = container.querySelector(".eyt-app-shell__session");
    expect(huelle).not.toBeNull();
    expect(huelle?.contains(screen.getByText("Sitzung"))).toBe(true);
  });
});

describe("AppShell — abwesende Slots erzeugen gar kein Element", () => {
  // Eine LEERE contentinfo-Landmark ist der Fehler, den diese Faelle
  // verhindern — und axe meldet sie nicht, auch nicht mit `best-practice`
  // (gemessen 27.08.2026). Nur ein Test kann das halten.
  it.each(ABWESENDE_FORMEN)("laesst die Fusszeile weg bei %s", (_form, wert) => {
    rahmen({ footer: wert });
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });

  it.each(ABWESENDE_FORMEN)("laesst die Sitzungshuelle weg bei %s", (_form, wert) => {
    const { container } = rahmen({ sessionArea: wert });
    expect(container.querySelectorAll(".eyt-app-shell__session")).toHaveLength(0);
  });
});

describe("AppShell — ein leerer String ist ein Wert, keine Abwesenheit", () => {
  /*
   * Die Grenze von `fehlt`, hier als ZUSAGE und nicht als Zufall.
   *
   * `""` gehoert nicht zu den drei Abwesenheits-Idiomen: es ist etwas, das die
   * aufrufende Anwendung uebergeben hat, und ein Primitive, das uebergebene
   * Werte still verschluckt, raet. Der Preis ist bekannt und wird bewusst
   * gezahlt — es entsteht dieselbe leere Landmark, vor der die Faelle oben
   * schuetzen. Vollstaendig kann diese Pruefung ohnehin nicht sein: sie sieht
   * den Knoten, nicht sein Ergebnis, und eine Komponente, die `null`
   * zurueckgibt, ist von aussen nicht von Inhalt zu unterscheiden.
   *
   * Zweiter Ertrag: diese zwei Faelle machen die Wahrheitspruefung
   * (`footer ? ... : null`) angreifbar — die laesst `""` weg und faellt hier
   * auf. Der Waechter hat damit ZWEI unabhaengige Gegenmutationen statt einer.
   */
  it("rendert die contentinfo-Landmark auch bei footer als leerem String", () => {
    rahmen({ footer: "" });
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  });

  it("rendert die Sitzungshuelle auch bei sessionArea als leerem String", () => {
    const { container } = rahmen({ sessionArea: "" });
    expect(container.querySelectorAll(".eyt-app-shell__session")).toHaveLength(1);
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

  it("setzt den Sprunganker als ERSTES Element des Rahmens", () => {
    const { container } = rahmen();
    // Reihenfolge, nicht Existenz: ein Sprunganker hinter der Navigation ist
    // kein Sprunganker (a11y-Checkliste #2).
    //
    // Was das hier NICHT beweist: `container` ist das div, das RTL an
    // `document.body` haengt — geprueft ist also die Reihenfolge INNERHALB des
    // Rahmens, nicht die des Dokuments. Ob der Sprunganker das erste Tab-Ziel
    // der Seite ist, haengt daran, was `apps/web/app/layout.tsx` um den Rahmen
    // herum rendert; einzige Evidenz dafuer ist
    // `apps/web/e2e/shell-smoke.spec.ts:62-69` im Pflichtjob `web-smoke`.
    expect(container.firstElementChild?.tagName).toBe("A");
    expect(container.firstElementChild?.getAttribute("href")).toBe(
      `#${screen.getByRole("main").id}`,
    );
  });
});
