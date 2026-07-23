import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, Card, VisuallyHidden } from "../src/index.js";

afterEach(cleanup);

describe("Button", () => {
  it("renders an accessible button with default type=button", () => {
    render(<Button>Speichern</Button>);
    const button = screen.getByRole("button", { name: "Speichern" });
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect((button as HTMLButtonElement).type).toBe("button");
  });

  it("fires onClick and respects disabled", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Senden
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Senden" });
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("applies the variant as class without domain knowledge", () => {
    render(<Button variant="ghost">Abbrechen</Button>);
    const button = screen.getByRole("button", { name: "Abbrechen" });
    expect(button.className).toContain("eyt-button--ghost");
  });
});

describe("Card", () => {
  it("renders children and an optional accessible title", () => {
    render(
      <Card title="Abschnitt">
        <p>Inhalt</p>
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Abschnitt" })).toBeTruthy();
    expect(screen.getByText("Inhalt")).toBeTruthy();
  });

  it("renders without a heading when no title is given", () => {
    render(<Card>Nur Inhalt</Card>);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Nur Inhalt")).toBeTruthy();
  });
});

describe("VisuallyHidden", () => {
  it("keeps text available to assistive technology while visually hidden", () => {
    render(<VisuallyHidden>Nur für Screenreader</VisuallyHidden>);
    const el = screen.getByText("Nur für Screenreader");
    expect(el.textContent).toBe("Nur für Screenreader");
    // Visuell versteckt über das etablierte 1px-Clip-Muster, nicht display:none
    // (display:none würde den Text auch für Screenreader entfernen).
    expect(el.style.position).toBe("absolute");
    expect(el.style.width).toBe("1px");
    expect(el.style.overflow).toBe("hidden");
  });
});
