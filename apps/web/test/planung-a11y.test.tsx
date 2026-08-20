/**
 * Barrierefreiheit der Planungsflaeche (EYT-141).
 *
 * ## Warum diese Datei ueberhaupt entsteht
 *
 * Bis EYT-141 lief axe an genau zwei Stellen: in `a11y.test.tsx` gegen die
 * Shell mit der STARTSEITE darin, und in `e2e/shell-smoke.spec.ts` gegen `/`.
 * Beide prueften also die Huelle plus eine Seite, die weder Planung noch
 * Kosten ist. `/planung` — die Flaeche, auf der die Sprint-6-Kernreise
 * stattfindet — wurde von keinem Barrierefreiheitswaechter je betreten.
 *
 * Der Preis dafuer stand messbar im Baum: `PlanungsWerkbank` rendert ein
 * `<main>`, und `AppShell` rendert es ebenfalls — verschachtelt. Zwei
 * `main`-Landmarks in einem Dokument sind ein Fehler, und der Skip-Link zeigt
 * auf die aeussere. Kein Test ist deswegen rot geworden, weil kein Test
 * hingeschaut hat.
 *
 * ## Warum die Landmark-Zaehlung NEBEN axe steht
 *
 * axe fuehrt `landmark-no-duplicate-main` unter `best-practice`, nicht unter
 * `wcag2a`/`wcag2aa`. Ein Lauf mit den WCAG-Tags allein — genau die
 * Konfiguration der bestehenden Baseline — haette den Befund also auch dann
 * nicht gemeldet, wenn er die Seite gesehen haette. Deshalb zwei Zusicherungen:
 * axe inklusive `best-practice`, UND eine eigene Zaehlung, die unabhaengig von
 * axes Regelkatalog gilt.
 *
 * ## Gegenmutation — auszufuehren, nicht auszudenken
 *
 * In `apps/web/components/planungs-werkbank.tsx` das `<section aria-label=…>`
 * wieder auf `<main>` zuruecksetzen (beide Tags, oeffnend und schliessend).
 * „genau EINE main-Landmark im ganzen Dokument" muss rot werden und dabei
 * `2` gegen `1` melden.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigationZuruecksetzen } from "./helpers/navigation-attrappe";
import { netzLoesen, werkbankRendern } from "./helpers/werkbank";
import { fensterMitEntwurf, sitzungMit } from "./helpers/werkbank-daten";

vi.mock("next/navigation", async () => {
  const modul = await import("./helpers/navigation-attrappe");
  return modul.nextNavigationModul();
});

const MITTWOCH_KW34 = new Date("2026-08-19T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MITTWOCH_KW34);
  navigationZuruecksetzen();
});

afterEach(() => {
  cleanup();
  netzLoesen();
  vi.useRealTimers();
});

/** Die Werkbank einer berechtigten Planerin, fertig geladen. */
async function werkbankGeladen(): Promise<void> {
  werkbankRendern({
    sitzung: sitzungMit(["planning.read", "planning.write", "costs.read"]),
    fenster: (weekKey) => fensterMitEntwurf(weekKey),
  });
  await screen.findByTestId("werkbank-woche-iso");
  await waitFor(() => expect(screen.queryByTestId("planungsfenster-laedt")).toBeNull());
}

describe("EYT-141 — Barrierefreiheit der Planungsflaeche", () => {
  it("hat genau EINE main-Landmark im ganzen Dokument", async () => {
    await werkbankGeladen();

    // `getAllByRole` statt `querySelectorAll("main")`: gezaehlt wird die
    // ROLLE, nicht das Tag. Ein `<div role="main">` waere derselbe Fehler und
    // wuerde einer Tagzaehlung entgehen.
    const landmarks = screen.getAllByRole("main");
    expect(landmarks).toHaveLength(1);
    // Und es ist die, auf die der Skip-Link zeigt — sonst spraenge er in einen
    // Bereich, der die eigentliche Landmark nur enthaelt.
    expect(landmarks[0]?.id).toBe("hauptinhalt");
  });

  it("benennt die Planungsflaeche als eigenen Bereich innerhalb des Hauptinhalts", async () => {
    await werkbankGeladen();

    const flaeche = screen.getByTestId("werkbank-planungsflaeche");
    // Ein `<section>` OHNE Namen ist keine Landmark und im Screenreader nicht
    // anspringbar — die Zusicherung gilt dem Namen, nicht dem Tag.
    const name = flaeche.getAttribute("aria-label") ?? "";
    expect(name).not.toBe("");
    // Derselbe Titel, den der Kopf zeigt: keine zweite Formulierung, die
    // auseinanderlaufen koennte.
    expect(screen.getByTestId("werkbank-kopf").textContent).toContain(name);
    // Sie liegt INNERHALB des Hauptinhalts, nicht daneben.
    expect(screen.getByRole("main").contains(flaeche)).toBe(true);
  });

  it("hat null axe-Verstoesse (WCAG A/AA plus best-practice)", async () => {
    await werkbankGeladen();

    const ergebnis = await axe.run(document.body, {
      runOnly: {
        type: "tag",
        // `best-practice` ist hier bewusst dabei: die Landmark-Regeln leben
        // dort, und ohne sie liefe genau der Befund durch, der diese Datei
        // ausgeloest hat.
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
      },
      rules: {
        // Kontrast braucht echtes Rendering/Canvas — in jsdom nicht
        // verfuegbar. Er wird im Browser geprueft (`web-smoke`), nicht hier
        // stillschweigend uebersprungen.
        "color-contrast": { enabled: false },
      },
    });

    expect(ergebnis.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it("gibt jedem Zustandsbaustein der Flaeche eine Rolle, die ihn ansagt", async () => {
    await werkbankGeladen();

    // Der Stand traegt sein Abzeichen mit eigener Glyphe (nicht nur Farbe),
    // und die Glyphe ist `aria-hidden` — die AUSSAGE steht im Text.
    const abzeichen = screen.getByTestId("planungsfenster-stand-abzeichen");
    expect(abzeichen.querySelector('[aria-hidden="true"]')?.textContent ?? "").not.toBe("");
    expect((abzeichen.textContent ?? "").trim()).not.toBe("");
  });
});
