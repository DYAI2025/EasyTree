import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { isValidElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import RootLayout from "../app/layout";
import HomePage from "../app/page";
import { AppShell } from "../components/app-shell";
import { createApiClient } from "../lib/api-client";
import { ApiClientProvider } from "../lib/api-client-provider";

afterEach(cleanup);

/** Shell samt Startseite, mit Test-Client (kein echtes Netzwerk). */
function renderShell() {
  const client = createApiClient(
    "http://api.test",
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok" }),
      }) as unknown as Response,
  );
  return render(
    <ApiClientProvider client={client}>
      <AppShell>
        <HomePage />
      </AppShell>
    </ApiClientProvider>,
  );
}

describe("Accessibility-Baseline der Shell (EYT-41)", () => {
  it("has zero axe violations (WCAG A/AA)", async () => {
    const { container } = renderShell();
    const results = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: {
        // Kontrastberechnung benötigt echtes Rendering/Canvas — in jsdom
        // nicht verfügbar; Kontrast ist Teil der manuellen Checkliste
        // (docs/runbooks/a11y-checklist.md).
        "color-contrast": { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });

  it("renders a skip link that is the first tab target", async () => {
    const { getByRole } = renderShell();
    const skipLink = getByRole("link", { name: /zum hauptinhalt springen/i });
    expect(skipLink.getAttribute("href")).toBe("#hauptinhalt");

    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(skipLink);
  });

  it("exposes a main landmark that the skip link targets", () => {
    const { getByRole } = renderShell();
    const main = getByRole("main");
    expect(main.id).toBe("hauptinhalt");
  });

  it("sets html lang='de' in the root layout", () => {
    const element = RootLayout({ children: null });
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe("html");
    expect((element.props as { lang?: string }).lang).toBe("de");
  });
});
