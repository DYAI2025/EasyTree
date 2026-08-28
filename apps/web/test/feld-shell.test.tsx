import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpAuthGateway } from "@easytree/contracts";

import { FeldShell } from "../components/feld/feld-shell";
import { FeldStart } from "../components/feld/feld-start";
import { AuthGatewayProvider } from "../lib/auth-gateway-provider";
import { SessionProvider } from "../lib/session-provider";

// Die Feld-Shell ist eine Client-Komponente mit Router-Bezug; jsdom hat
// keinen App-Router, also liefern die Hooks feste Werte (Muster a11y.test).
vi.mock("next/navigation", () => ({
  usePathname: () => "/feld",
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

const MEMBER_SITZUNG = {
  userId: "00000000-0000-4000-8000-000000000001",
  organisations: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Baumpflege Nord",
      role: "member",
      permissions: [],
    },
  ],
};

/**
 * Feld-Shell samt Startseite mit realem SessionProvider gegen einen
 * gestubbten Auth-Endpunkt — kein Mock der eigenen Logik, nur des Netzes.
 */
function renderFeld(sessionBody: unknown = MEMBER_SITZUNG, status = 200) {
  const auth = new HttpAuthGateway("http://api.test/api/v1", {
    fetchImpl: async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => sessionBody,
      }) as unknown as Response,
  });
  return render(
    <AuthGatewayProvider gateway={auth}>
      <SessionProvider>
        <FeldShell>
          <FeldStart />
        </FeldShell>
      </SessionProvider>
    </AuthGatewayProvider>,
  );
}

describe("Feld-Shell (EYT-113)", () => {
  it("zeigt einem member Organisation, Rolle und Abmelden — und hat null axe-Verstoesse", async () => {
    const ansicht = renderFeld();
    // findBy wartet auf den Sitzungs-Effekt (Client laedt die Session nach).
    expect((await ansicht.findByTestId("feld-org")).textContent).toContain("Baumpflege Nord");
    expect(await ansicht.findByTestId("feld-abmelden")).toBeTruthy();
    expect((await ansicht.findByTestId("feld-rolle")).textContent).toContain("Mitarbeiter");

    const results = await axe.run(ansicht.container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      // Kontrast braucht echtes Rendering — Teil der manuellen Checkliste.
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it("traegt die Pflicht-Landmarken und den Sprunganker als erstes Tab-Ziel", async () => {
    const ansicht = renderFeld();
    await ansicht.findByTestId("feld-abmelden");

    const main = ansicht.getByRole("main");
    expect(main.id).toBe("hauptinhalt");
    expect(ansicht.getByRole("banner")).toBeTruthy();

    const skipLink = ansicht.getByRole("link", { name: /zum hauptinhalt springen/i });
    expect(skipLink.getAttribute("href")).toBe("#hauptinhalt");
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(skipLink);
  });

  it("zeigt KEINE Werkbank-Navigation — keine Links auf /planung oder /kosten", async () => {
    // Gegenmutation, die diesen Fall rot macht: der Feld-Shell einen
    // Navigationspunkt auf /planung oder /kosten geben (die Import-Grenze
    // in architecture.test.ts faengt zusaetzlich den Komponenten-Import).
    const ansicht = renderFeld();
    await ansicht.findByTestId("feld-abmelden");
    expect(
      ansicht.container.querySelectorAll('a[href="/planung"], a[href="/kosten"], a[href^="/kosten/"]'),
    ).toHaveLength(0);
  });

  it("ohne Organisation bleibt die Flaeche ehrlich leer statt fachlich zu raten", async () => {
    const ansicht = renderFeld({ userId: MEMBER_SITZUNG.userId, organisations: [] });
    expect(await ansicht.findByTestId("feld-ohne-organisation")).toBeTruthy();
    expect(ansicht.queryByTestId("feld-rolle")).toBeNull();
  });

  it("meldet einen Sitzungsfehler assertiv, statt Inhalte zu zeigen", async () => {
    const ansicht = renderFeld({}, 500);
    expect(await ansicht.findByTestId("feld-start-fehler")).toBeTruthy();
    expect(ansicht.queryByTestId("feld-org")).toBeNull();
  });
});
