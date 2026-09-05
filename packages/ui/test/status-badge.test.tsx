/**
 * `StatusBadge` — der Ton `warning` (EYT-160).
 *
 * Basisdesign v2.0 §3 nennt die generischen Rollen success/warning/danger/
 * info; `StateBanner` kennt alle vier, `StatusBadge` kannte
 * published/draft/danger/info/neutral — keine Warnstufe. §4 verlangt
 * „Konflikte und Deckungsluecken getrennt", also zwei Schweregrade im
 * Abzeichen; bisher blieb nur der Missbrauch von `draft` (Fachwort) oder
 * `danger` (falsche Stufe). Rein additiv: `Record<Stand, StatusTone>` in
 * `planning-window-view.tsx:125` benutzt den Ton als WERT, die Erweiterung
 * der Union bricht dort nichts.
 *
 * Das Zeichen bleibt je Ton verschieden — `warning` △ neben `danger` ▲, die
 * Fuellung traegt den Unterschied, nicht die Farbe.
 *
 * Gegenmutation (ausgefuehrt 05.09.2026, siehe Commit):
 * `warning: "▲"` → „gibt jedem Ton ein ANDERES Zeichen" rot.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { STATUS_TONES, StatusBadge } from "../src/index.js";

afterEach(cleanup);

describe("StatusBadge — Toene", () => {
  it("kennt den Ton warning — dieselbe Warnstufe, die StateBanner schon hat", () => {
    expect(STATUS_TONES).toContain("warning");
    const { container } = render(<StatusBadge tone="warning">Deckung offen</StatusBadge>);
    expect(container.querySelector(".eyt-status-badge--warning")).not.toBeNull();
    // Die Klasse allein waere schon vor der Aenderung da (Template-String);
    // das ZEICHEN ist der Beleg, dass der Ton wirklich bekannt ist.
    const zeichen = container.querySelector(".eyt-status-badge__mark")?.textContent ?? "";
    expect(zeichen.trim()).not.toBe("");
  });

  it("gibt jedem Ton ein ANDERES Zeichen", () => {
    const zeichen = STATUS_TONES.map((tone) => {
      const { container, unmount } = render(<StatusBadge tone={tone}>x</StatusBadge>);
      const wert = container.querySelector(".eyt-status-badge__mark")?.textContent ?? "";
      unmount();
      return wert;
    });
    expect(new Set(zeichen).size, `Zeichen: ${zeichen.join(" ")}`).toBe(STATUS_TONES.length);
  });
});
