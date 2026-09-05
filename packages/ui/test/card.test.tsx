/**
 * `Card` — mit Titel eine BENANNTE Region (EYT-160).
 *
 * Der Dateikopf von `src/card.tsx` versprach seit EYT-41, dass Karten mit
 * Titel „als benannte Region in der Landmark-Struktur auftauchen koennen".
 * Die `section` hatte aber kein `aria-labelledby`, und aria-query 5.3.0
 * (Sonde 05.09.2026) macht aus `section` nur dann `region`, wenn `aria-label`
 * oder `aria-labelledby` gesetzt ist. Keine Karte war eine Landmark — in
 * einer Werkbank mit vielen Karten die Navigation, die Screenreader-Nutzer
 * zuerst benutzen.
 *
 * `useId` statt eines Literals: zwei Karten auf einer Seite brauchen zwei
 * Ueberschriften-ids, und ein Aufrufer-`id` auf der Karte darf nichts damit
 * zu tun haben. Ohne Titel bleibt die `section` namenlos — eine LEERE Region
 * waere derselbe Fehler wie die leere contentinfo-Landmark in `AppShell`.
 *
 * Gegenmutation (ausgefuehrt 05.09.2026, siehe Commit): `aria-labelledby`
 * immer setzen, auch ohne Titel → „bleibt ohne Titel eine namenlose section"
 * rot; `aria-labelledby` weglassen → „ist ueber den Titel als Region
 * auffindbar" rot.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Card } from "../src/index.js";

afterEach(cleanup);

describe("Card — mit Titel eine benannte Region", () => {
  it("ist ueber den Titel als Region auffindbar", () => {
    render(
      <Card title="SENTINEL-TITEL">
        <p>Inhalt</p>
      </Card>,
    );
    expect(screen.getByRole("region", { name: "SENTINEL-TITEL" })).not.toBeNull();
  });

  it("verweist per aria-labelledby auf GENAU die eigene Ueberschrift — je Karte eine andere", () => {
    const { container } = render(
      <>
        <Card title="A" />
        <Card title="B" />
      </>,
    );
    const karten = [...container.querySelectorAll("section")];
    expect(karten).toHaveLength(2);
    const verweise = karten.map((karte) => {
      const verweis = karte.getAttribute("aria-labelledby") ?? "";
      expect(verweis).not.toBe("");
      expect(karte.querySelector(".eyt-card__title")?.id).toBe(verweis);
      return verweis;
    });
    expect(new Set(verweise).size).toBe(2);
  });

  it("bleibt ohne Titel eine namenlose section — keine leere Region", () => {
    const { container } = render(<Card>Nur Inhalt</Card>);
    expect(screen.queryByRole("region")).toBeNull();
    expect(container.querySelector("section")?.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("laesst ein eigenes id des Aufrufers auf der Karte, nicht auf der Ueberschrift", () => {
    // `start-inhalt.tsx` setzt `<Card id="status" …>` (gemessen 05.09.2026).
    const { container } = render(<Card id="SENTINEL-ID" title="T" />);
    expect(container.querySelector("section")?.id).toBe("SENTINEL-ID");
    expect(container.querySelector(".eyt-card__title")?.id).not.toBe("SENTINEL-ID");
  });
});
