/**
 * Zustaende des Planungsfensters (EYT-50).
 *
 * Der wichtigste Fall ist die Unterscheidung LEER vs. FEHLER. Zeigte die
 * Ansicht bei einem Ausfall eine leere Woche, laese sich der Ausfall als
 * "nichts geplant" — und genau das ist der Zustand, in dem jemand eine
 * Baustelle nicht besetzt, weil die Anzeige plausibel aussah.
 */
import type { GatewayResult, PlanningGateway, PlanningWindow } from "@easytree/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlanningWindowView } from "../components/planning-window-view";
import { PlanningGatewayProvider } from "../lib/planning-gateway-provider";

function gatewayReturning(result: GatewayResult<PlanningWindow>): PlanningGateway {
  return {
    getPlanningWindow: () => Promise.resolve(result),
    validateDraft: () => {
      throw new Error("in dieser Ansicht nicht benutzt");
    },
    createAssignment: () => {
      throw new Error("in dieser Ansicht nicht benutzt");
    },
    publishPlan: () => {
      throw new Error("in dieser Ansicht nicht benutzt");
    },
  };
}

function renderWith(result: GatewayResult<PlanningWindow>): void {
  render(
    <PlanningGatewayProvider gateway={gatewayReturning(result)}>
      <PlanningWindowView weekKey="2026-W32" />
    </PlanningGatewayProvider>,
  );
}

const LEERE_WOCHE: PlanningWindow = {
  weekKey: "2026-W32",
  timeZone: "Europe/Berlin",
  assignments: [],
  sourceVersion: null,
  publishedVersionId: null,
};

// Ohne dieses Cleanup bleiben die gerenderten Baeume stehen und der
// naechste Test findet die Elemente des vorigen — ein Fehlalarm, der wie
// ein echter Befund aussieht.
afterEach(cleanup);

describe("PlanningWindowView", () => {
  it("zeigt zuerst den Ladezustand", () => {
    renderWith({ ok: true, value: LEERE_WOCHE });
    expect(screen.getByTestId("planungsfenster-laedt")).toBeTruthy();
  });

  it("zeigt eine leere Woche als leer, nicht als Fehler", async () => {
    renderWith({ ok: true, value: LEERE_WOCHE });
    await waitFor(() => expect(screen.getByTestId("planungsfenster-leer")).toBeTruthy());
    expect(screen.queryByTestId("planungsfenster-fehler")).toBeNull();
    expect(screen.getByTestId("planungsfenster-zone").textContent).toContain("Europe/Berlin");
  });

  it("zeigt einen Ausfall als Fehler, nicht als leere Woche", async () => {
    // Die Unterscheidung, an der alles haengt.
    renderWith({ ok: false, failure: "UNAVAILABLE", problem: null });
    await waitFor(() => expect(screen.getByTestId("planungsfenster-fehler")).toBeTruthy());
    expect(screen.queryByTestId("planungsfenster-leer")).toBeNull();
    expect(screen.getByTestId("planungsfenster-fehler").getAttribute("data-failure")).toBe(
      "UNAVAILABLE",
    );
  });

  it("meldet einen Vertragsbruch als solchen", async () => {
    // Ein Server, der 200 mit falscher Form antwortet, darf nicht als leere
    // Woche durchgehen — der Client hat ihn bereits verworfen.
    renderWith({ ok: false, failure: "CONTRACT_VIOLATION", problem: null });
    await waitFor(() =>
      expect(screen.getByTestId("planungsfenster-fehler").getAttribute("data-failure")).toBe(
        "CONTRACT_VIOLATION",
      ),
    );
  });

  it("zeigt fehlende Anmeldung als solche, nicht als leere Woche", async () => {
    renderWith({ ok: false, failure: "UNAUTHENTICATED", problem: null });
    await waitFor(() =>
      expect(screen.getByTestId("planungsfenster-fehler").getAttribute("data-failure")).toBe(
        "UNAUTHENTICATED",
      ),
    );
  });

  it("traegt die serverseitigen Ids im Markup", async () => {
    // AK9 verlangt, dass beide Ansichten DIESELBEN Ids zeigen. Ueber Text
    // waere das ein Vergleich von Darstellung; hier stehen die Ids selbst.
    renderWith({
      ok: true,
      value: {
        weekKey: "2026-W32",
        timeZone: "Europe/Berlin",
        assignments: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            employeeId: "22222222-2222-4222-8222-222222222222",
            worksiteId: "33333333-3333-4333-8333-333333333333",
            interval: {
              startUtc: "2026-08-03T06:00:00.000Z",
              endUtc: "2026-08-03T14:00:00.000Z",
            },
          },
        ],
        sourceVersion: { id: "55555555-5555-4555-8555-555555555555", state: "draft" },
        publishedVersionId: "44444444-4444-4444-8444-444444444444",
      },
    });

    await waitFor(() => expect(screen.getByTestId("planungsfenster-liste")).toBeTruthy());
    const eintrag = screen.getByTestId("planungsfenster-liste").querySelector("li");
    expect(eintrag?.getAttribute("data-assignment-id")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(
      screen.getByTestId("planungsfenster-version").getAttribute("data-published-version-id"),
    ).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("unterscheidet die vier Staende sichtbar", async () => {
    // Der eigentliche Befund: ein Entwurf UEBER einer veroeffentlichten
    // Version. Ohne die Unterscheidung stuende "Veroeffentlichte Version X"
    // ueber Zuweisungen, die nicht zu X gehoeren.
    const faelle: { fenster: PlanningWindow; erwartet: string }[] = [
      { fenster: LEERE_WOCHE, erwartet: "ohne-version" },
      {
        fenster: {
          ...LEERE_WOCHE,
          sourceVersion: { id: "55555555-5555-4555-8555-555555555555", state: "draft" },
        },
        erwartet: "entwurf",
      },
      {
        fenster: {
          ...LEERE_WOCHE,
          sourceVersion: { id: "44444444-4444-4444-8444-444444444444", state: "published" },
          publishedVersionId: "44444444-4444-4444-8444-444444444444",
        },
        erwartet: "veroeffentlicht",
      },
      {
        fenster: {
          ...LEERE_WOCHE,
          sourceVersion: { id: "55555555-5555-4555-8555-555555555555", state: "draft" },
          publishedVersionId: "44444444-4444-4444-8444-444444444444",
        },
        erwartet: "entwurf-ueber-veroeffentlicht",
      },
    ];

    for (const { fenster, erwartet } of faelle) {
      cleanup();
      renderWith({ ok: true, value: fenster });
      await waitFor(() => expect(screen.getByTestId("planungsfenster-stand")).toBeTruthy());
      expect(screen.getByTestId("planungsfenster-stand").getAttribute("data-stand"), erwartet).toBe(
        erwartet,
      );
    }
  });
});
