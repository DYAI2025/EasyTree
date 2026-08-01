/**
 * Basisdesign-v2.0-Bausteine des Kosten-Slices (EYT-106).
 *
 * Geprüft werden die Zugänglichkeitseigenschaften, die das Basisdesign
 * verbindlich macht — nicht Pixel: Status nie nur über Farbe, Fehler
 * assertiv, Leerzustand höflich, genau eine h1 im Seitenkopf.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  PrimaryAction,
  StateBanner,
  StatusBadge,
} from "../src/index.js";

afterEach(cleanup);

describe("StatusBadge", () => {
  it("traegt neben der Farbe IMMER ein Zeichen und den Text (nie nur Farbe)", () => {
    // Gegenmutation: das aria-hidden-Zeichen entfernen -> rot.
    const { container } = render(<StatusBadge tone="danger">Konflikt</StatusBadge>);
    expect(screen.getByText("Konflikt")).toBeInstanceOf(HTMLElement);
    const mark = container.querySelector(".eyt-status-badge__mark");
    expect(mark?.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("StateBanner", () => {
  it("meldet danger assertiv (role=alert)", () => {
    render(<StateBanner tone="danger" title="Speichern fehlgeschlagen" />);
    expect(screen.getByRole("alert").textContent).toContain("Speichern fehlgeschlagen");
  });

  it("meldet Erfolg hoeflich (role=status)", () => {
    render(<StateBanner tone="success" title="Version angelegt" />);
    expect(screen.getByRole("status").textContent).toContain("Version angelegt");
  });
});

describe("EmptyState / ErrorState", () => {
  it("Leerzustand erklaert das Warum und ist role=status", () => {
    render(<EmptyState title="Keine Mitarbeiter" description="Noch niemand angelegt." />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Keine Mitarbeiter");
    expect(status.textContent).toContain("Noch niemand angelegt.");
  });

  it("Fehlerzustand ist role=alert und bietet Wiederholen an", () => {
    const wiederholen = vi.fn();
    render(
      <ErrorState
        title="Laden fehlgeschlagen"
        description="Keine Verbindung."
        onRetry={wiederholen}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Laden fehlgeschlagen");
    screen.getByRole("button", { name: "Erneut versuchen" }).click();
    expect(wiederholen).toHaveBeenCalledTimes(1);
  });
});

describe("PageHeader / PrimaryAction", () => {
  it("rendert genau eine h1 mit dem Titel", () => {
    render(<PageHeader title="Stundensätze" description="Versionen je Mitarbeiter" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Stundensätze");
  });

  it("PrimaryAction ist ein Button mit type=button als Default", () => {
    render(<PrimaryAction>Neue Satzversion anlegen</PrimaryAction>);
    const button = screen.getByRole("button", { name: "Neue Satzversion anlegen" });
    expect(button.getAttribute("type")).toBe("button");
  });
});
