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
