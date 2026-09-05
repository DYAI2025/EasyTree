/**
 * `StateBanner` — der Ton steht als ZEICHEN im DOM, nicht nur in der Farbe
 * (EYT-160, Basisdesign v2.0 §10 „Status nie nur durch Farbe").
 *
 * Bis EYT-160 trug den Ton allein die Klasse `eyt-state-banner--<tone>`, also
 * die Farbe aus `globals.css`. `StatusBadge` hatte die Regel seit EYT-106
 * (aria-hidden-Zeichen je Ton), sein Geschwister nicht — gemessen 05.09.2026:
 * `grep -c aria-hidden src/state-banner.tsx` = 0.
 *
 * ## Warum das Zeichen IM Titel steht und der Titeltext ein eigenes Element hat
 *
 * `globals.css` macht `.eyt-state-banner__title` zum Block und den Streifen zu
 * `display:flex; justify-content:space-between`. Ein Zeichen als Geschwister
 * des Titels staende auf eigener Zeile, als drittes Flex-Kind schoebe es den
 * Text in die Mitte — beides nur mit einer Stylesheet-Aenderung zu heilen, die
 * dieses Paket nicht machen darf. Im Titel sitzt es ohne jede Regel auf der
 * Titelzeile. Und `getByText(titel)` in `apps/web` vergleicht den GANZEN
 * textContent eines Elements: ohne `__title-text` faende es „▲ Titel" statt
 * „Titel", und die Anwendung verloere ihre Anker.
 *
 * Gegenmutationen (ausgefuehrt 05.09.2026, siehe Commit):
 * 1. `TONE_MARK.warning = "▲"` → „gibt jedem Ton ein ANDERES Zeichen" rot.
 * 2. `__title-text`-Span entfernen, Titel direkt in `<strong>` →
 *    „laesst den Titel als eigenen Text stehen" rot.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BANNER_TONES, StateBanner } from "../src/index.js";

afterEach(cleanup);

describe("StateBanner — der Ton steht als Zeichen im DOM, nicht nur in der Farbe", () => {
  it.each(BANNER_TONES)("%s traegt ein aria-hidden-Zeichen im Titel", (tone) => {
    const { container } = render(<StateBanner tone={tone} title="SENTINEL-TITEL" />);
    const zeichen = container.querySelector(".eyt-state-banner__mark");
    expect(zeichen, "kein Zeichen ausgegeben").not.toBeNull();
    expect(zeichen?.getAttribute("aria-hidden")).toBe("true");
    expect((zeichen?.textContent ?? "").trim()).not.toBe("");
    // IM Titel, nicht daneben — das Layout der Anwendung haengt daran.
    expect(container.querySelector(".eyt-state-banner__title")?.contains(zeichen)).toBe(true);
  });

  it("gibt jedem Ton ein ANDERES Zeichen — sonst traegt wieder nur die Farbe den Unterschied", () => {
    const zeichen = BANNER_TONES.map((tone) => {
      const { container, unmount } = render(<StateBanner tone={tone} title="x" />);
      const wert = container.querySelector(".eyt-state-banner__mark")?.textContent ?? "";
      unmount();
      return wert;
    });
    expect(new Set(zeichen).size, `Zeichen: ${zeichen.join(" ")}`).toBe(BANNER_TONES.length);
  });

  it("laesst den Titel als eigenen Text stehen, damit getByText(Titel) ihn weiter findet", () => {
    render(<StateBanner tone="danger" title="SENTINEL-TITEL" />);
    // Exakter Treffer auf ein Element, dessen GANZER Text der Titel ist.
    expect(screen.getByText("SENTINEL-TITEL").className).toContain("eyt-state-banner__title-text");
  });

  it("aendert Rolle und Aussage nicht: danger bleibt alert, der Text traegt den Titel", () => {
    render(
      <StateBanner tone="danger" title="SENTINEL-TITEL">
        SENTINEL-DETAIL
      </StateBanner>,
    );
    const meldung = screen.getByRole("alert");
    expect(meldung.textContent).toContain("SENTINEL-TITEL");
    expect(meldung.textContent).toContain("SENTINEL-DETAIL");
  });
});
