/**
 * REQ-002 / `AC-004` — die Wochennavigation zeigt, sie rechnet nicht (EYT-140 M4).
 *
 * ## Warum jede Erwartung hier ein SENTINEL ist
 *
 * Der naheliegende Test baut die erwarteten Adressen selbst: „`vorherigeUrl`
 * muss `/planung?weekKey=2026-W31` sein". Damit prueft er seine eigene
 * Reimplementierung der Wochenrechnung — und bliebe gruen, wenn Komponente und
 * Test denselben Fehler machen. Die Modelle hier tragen deshalb Werte, die
 * keine Rechnung erzeugen kann (`SENTINEL-VOR`, `SENTINEL-NACH`,
 * `SENTINEL-HEUTE`). Steht der Sentinel im DOM, hat die Komponente den
 * uebergebenen Wert DURCHGEREICHT; rechnet sie selbst, steht dort ein
 * Wochenschluessel und die Zusicherung faellt.
 *
 * Die echten Adressen sind in `wochenmodell.test.ts` absolut gepinnt (M3), samt
 * der drei Jahreswechsel-Randvektoren. Hier wird bewusst NICHTS davon
 * wiederholt.
 *
 * ## Die Sentinels sind asymmetrisch
 *
 * `vorherigeUrl`, `naechsteUrl` und `heuteUrl` sind gleich getypte
 * Zeichenketten und damit vertauschbar, ohne dass ein Typ es meldet. Drei
 * unterscheidbare Werte plus eine Zusicherung je Bedienelement machen jede
 * Vertauschung sichtbar.
 *
 * ## Gegenmutation (ausgefuehrt, 19.08.2026)
 *
 * In `wochen-navigation.tsx` `href={modell.naechsteUrl}` durch die selbst
 * gebaute Adresse `` href={`/planung?weekKey=${modell.schluessel}`} `` ersetzen
 * — also die Komponente rechnen lassen. „verlinkt vorwaerts auf genau die
 * uebergebene Adresse" wird rot und meldet `/planung?weekKey=SENTINEL-SCHLUESSEL`
 * gegen `/planung?weekKey=SENTINEL-NACH`.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WochenNavigation } from "../components/wochen-navigation";
import type { Wochenmodell } from "../lib/wochennavigation";

vi.mock("next/navigation", async () => {
  const modul = await import("./helpers/navigation-attrappe");
  return modul.nextNavigationModul();
});

afterEach(cleanup);

const WOCHE: Extract<Wochenmodell, { art: "woche" }> = {
  art: "woche",
  schluessel: "SENTINEL-SCHLUESSEL",
  isoWochenText: "SENTINEL-WOCHENTEXT",
  zeitraumText: "SENTINEL-ZEITRAUM",
  vorherigeUrl: "/planung?weekKey=SENTINEL-VOR",
  naechsteUrl: "/planung?weekKey=SENTINEL-NACH",
  heuteUrl: "/planung?weekKey=SENTINEL-HEUTE",
  istAktuelleWoche: false,
};

const FEHLERHAFT: Extract<Wochenmodell, { art: "fehlerhaft" }> = {
  art: "fehlerhaft",
  grund: "parameter-unbrauchbar",
  heuteUrl: "/planung?weekKey=SENTINEL-HEUTE",
};

/** Genau ein Bedienelement mit diesem zugaenglichen Namen — oder ein lauter Fehler. */
function link(name: string): HTMLAnchorElement {
  return screen.getByRole("link", { name }) as HTMLAnchorElement;
}

describe("WochenNavigation — der Wochenfall", () => {
  it("verlinkt rueckwaerts auf genau die uebergebene Adresse", () => {
    render(<WochenNavigation modell={WOCHE} />);
    expect(link("Vorherige Woche").getAttribute("href")).toBe("/planung?weekKey=SENTINEL-VOR");
  });

  it("verlinkt vorwaerts auf genau die uebergebene Adresse", () => {
    render(<WochenNavigation modell={WOCHE} />);
    expect(link("Nächste Woche").getAttribute("href")).toBe("/planung?weekKey=SENTINEL-NACH");
  });

  it("verlinkt „Heute“ auf die LAUFENDE Woche, nicht auf die angezeigte", () => {
    render(<WochenNavigation modell={WOCHE} />);
    expect(link("Heute").getAttribute("href")).toBe("/planung?weekKey=SENTINEL-HEUTE");
  });

  it("zeigt Wochentext und kanonischen Schluessel unveraendert an", () => {
    render(<WochenNavigation modell={WOCHE} />);
    const iso = screen.getByTestId("werkbank-woche-iso").textContent ?? "";
    expect(iso).toContain("SENTINEL-WOCHENTEXT");
    // Der kanonische Schluessel steht mit im Element: er ist das, was in der
    // Adresse steht und was geteilt wird.
    expect(iso).toContain("SENTINEL-SCHLUESSEL");
  });

  it("zeigt den Zeitraum unveraendert an", () => {
    render(<WochenNavigation modell={WOCHE} />);
    expect(screen.getByTestId("werkbank-woche-bereich").textContent).toBe("SENTINEL-ZEITRAUM");
  });

  it("traegt genau ein Bedienelement je Richtung", () => {
    render(<WochenNavigation modell={WOCHE} />);
    for (const name of ["Vorherige Woche", "Nächste Woche", "Heute"]) {
      expect(screen.getAllByRole("link", { name })).toHaveLength(1);
    }
  });

  it("gibt der Navigation einen eigenen zugaenglichen Namen", () => {
    render(<WochenNavigation modell={WOCHE} />);
    expect(screen.getByRole("navigation", { name: "Wochennavigation" })).toBeTruthy();
  });
});

describe("WochenNavigation — die laufende Woche traegt TEXT, nicht nur Farbe", () => {
  it("nennt die laufende Woche im Klartext", () => {
    render(<WochenNavigation modell={{ ...WOCHE, istAktuelleWoche: true }} />);
    // `AC-018`: ein Zustand darf nie NUR ueber Farbe getragen werden. Ein
    // `aria-current` allein waere fuer sehende Nutzerinnen unsichtbar, eine
    // Einfaerbung allein fuer farbfehlsichtige.
    expect(screen.getByTestId("wochennavigation-aktuell").textContent).toContain("Aktuelle Woche");
    expect(link("Heute").getAttribute("aria-current")).toBe("page");
  });

  it("nennt sie NICHT, wenn eine andere Woche angezeigt wird", () => {
    render(<WochenNavigation modell={WOCHE} />);
    expect(screen.queryByTestId("wochennavigation-aktuell")).toBeNull();
    expect(link("Heute").getAttribute("aria-current")).toBeNull();
  });
});

describe("WochenNavigation — der Fehlerfall ist keine Sackgasse", () => {
  it("laesst genau den Rueckweg zur laufenden Woche stehen", () => {
    render(<WochenNavigation modell={FEHLERHAFT} />);
    expect(link("Heute").getAttribute("href")).toBe("/planung?weekKey=SENTINEL-HEUTE");
  });

  it("bietet kein Blaettern an, wo es keine anzeigbare Woche gibt", () => {
    render(<WochenNavigation modell={FEHLERHAFT} />);
    // Ein Blaetterlink brauchte eine Nachbarwoche — und genau die gibt es im
    // Fehlerfall nicht. Ein Link ins Leere waere die stille Variante.
    expect(screen.queryByRole("link", { name: "Vorherige Woche" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Nächste Woche" })).toBeNull();
    expect(screen.queryByTestId("werkbank-woche-iso")).toBeNull();
    expect(screen.queryByTestId("werkbank-woche-bereich")).toBeNull();
  });
});

describe("WochenNavigation — statischer Waechter", () => {
  it("enthaelt keine eigene Wochenrechnung und keine Uhr", () => {
    // Das Fertigkriterium des Meilensteins als bleibende Zusicherung statt als
    // einmaliger `grep`: eine zweite Wochenregel in der Darstellung liefe an
    // den Jahresgrenzen von der ersten weg (2026 hat 53 ISO-Wochen, 2025 und
    // 2027 haben 52), und der Fehler saehe wie ein Darstellungsfehler aus.
    const quelle = readFileSync(join(process.cwd(), "components", "wochen-navigation.tsx"), "utf8");
    // Geprueft wird die GANZE Datei, Kommentare eingeschlossen — genau das tut
    // auch der `grep -c` des Fertigkriteriums, und zwei Zaehlungen mit
    // verschiedenem Geltungsbereich waeren zwei Aussagen, von denen eine still
    // falsch werden koennte. Der Preis: der Dateikopf darf die drei Namen nicht
    // nennen. Er verweist stattdessen hierher.
    for (const verboten of ["new Date()", "shiftPlanningWeek", "parseIsoWeekKey"]) {
      expect(quelle).not.toContain(verboten);
    }
  });
});
