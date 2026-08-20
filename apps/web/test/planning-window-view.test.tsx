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
import userEvent from "@testing-library/user-event";
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
  resources: { employees: [], worksites: [] },
};

const PLANBARE_WOCHE: PlanningWindow = {
  ...LEERE_WOCHE,
  resources: {
    employees: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        label: "Beschaeftigte A",
        active: true,
      },
    ],
    worksites: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        label: "Baustelle A",
        active: true,
      },
    ],
  },
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
        resources: {
          employees: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              label: "Beschaeftigte A",
              active: true,
            },
          ],
          worksites: [
            { id: "33333333-3333-4333-8333-333333333333", label: "Baustelle A", active: true },
          ],
        },
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

  it("behält den Idempotenzschlüssel bei einem unklaren Fehler für den Retry", async () => {
    const keys: string[] = [];
    let attempt = 0;
    const gateway: PlanningGateway = {
      getPlanningWindow: () => Promise.resolve({ ok: true, value: PLANBARE_WOCHE }),
      validateDraft: () => {
        throw new Error("in dieser Ansicht nicht benutzt");
      },
      createAssignment: (_input, options) => {
        keys.push(options.idempotencyKey);
        attempt += 1;
        return Promise.resolve(
          attempt === 1
            ? { ok: false, failure: "UNAVAILABLE" as const, problem: null }
            : {
                ok: true,
                value: {
                  id: "11111111-1111-4111-8111-111111111111",
                  employeeId: PLANBARE_WOCHE.resources.employees[0]?.id ?? "",
                  worksiteId: PLANBARE_WOCHE.resources.worksites[0]?.id ?? "",
                  interval: {
                    startUtc: "2026-08-03T06:00:00.000Z",
                    endUtc: "2026-08-03T14:00:00.000Z",
                  },
                },
              },
        );
      },
      publishPlan: () => {
        throw new Error("in dieser Ansicht nicht benutzt");
      },
    };

    render(
      <PlanningGatewayProvider gateway={gateway}>
        <PlanningWindowView weekKey="2026-W32" />
      </PlanningGatewayProvider>,
    );
    await screen.findByTestId("einsatzformular");

    await userEvent.selectOptions(
      screen.getByTestId("feld-employee"),
      PLANBARE_WOCHE.resources.employees[0]?.id ?? "",
    );
    await userEvent.selectOptions(
      screen.getByTestId("feld-worksite"),
      PLANBARE_WOCHE.resources.worksites[0]?.id ?? "",
    );
    await userEvent.type(screen.getByTestId("feld-datum"), "2026-08-03");
    await userEvent.type(screen.getByTestId("feld-beginn"), "08:00");
    await userEvent.type(screen.getByTestId("feld-ende"), "16:00");

    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    // Genau die Meldung DES FORMULARS, nicht "irgendein Statusbereich":
    // seit EYT-141 traegt auch der Leerzustand `role="status"`, und ein
    // Rollenzugriff faende beide.
    await waitFor(() =>
      expect(screen.getByTestId("einsatzformular-meldung").getAttribute("data-state")).toBe(
        "fehler",
      ),
    );
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    await waitFor(() =>
      expect(screen.getByTestId("einsatzformular-meldung").getAttribute("data-state")).toBe(
        "erfolg",
      ),
    );

    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("behält die Erfolgsmeldung während des serverseitigen Read-through sichtbar", async () => {
    let leseversuch = 0;
    const offenerReadThrough = new Promise<GatewayResult<PlanningWindow>>(() => {});
    const gateway: PlanningGateway = {
      getPlanningWindow: () => {
        leseversuch += 1;
        return leseversuch === 1
          ? Promise.resolve({ ok: true, value: PLANBARE_WOCHE })
          : offenerReadThrough;
      },
      validateDraft: () => {
        throw new Error("in dieser Ansicht nicht benutzt");
      },
      createAssignment: () =>
        Promise.resolve({
          ok: true,
          value: {
            id: "11111111-1111-4111-8111-111111111111",
            employeeId: PLANBARE_WOCHE.resources.employees[0]?.id ?? "",
            worksiteId: PLANBARE_WOCHE.resources.worksites[0]?.id ?? "",
            interval: {
              startUtc: "2026-08-03T06:00:00.000Z",
              endUtc: "2026-08-03T14:00:00.000Z",
            },
          },
        }),
      publishPlan: () => {
        throw new Error("in dieser Ansicht nicht benutzt");
      },
    };

    render(
      <PlanningGatewayProvider gateway={gateway}>
        <PlanningWindowView weekKey="2026-W32" />
      </PlanningGatewayProvider>,
    );
    await screen.findByTestId("einsatzformular");

    await userEvent.selectOptions(
      screen.getByTestId("feld-employee"),
      PLANBARE_WOCHE.resources.employees[0]?.id ?? "",
    );
    await userEvent.selectOptions(
      screen.getByTestId("feld-worksite"),
      PLANBARE_WOCHE.resources.worksites[0]?.id ?? "",
    );
    await userEvent.type(screen.getByTestId("feld-datum"), "2026-08-03");
    await userEvent.type(screen.getByTestId("feld-beginn"), "08:00");
    await userEvent.type(screen.getByTestId("feld-ende"), "16:00");
    await userEvent.click(screen.getByTestId("einsatz-speichern"));

    const meldung = await screen.findByTestId("einsatzformular-meldung");
    await waitFor(() => expect(meldung.getAttribute("data-state")).toBe("erfolg"));
    expect(meldung.textContent).toContain("Der Entwurf wurde gespeichert.");
    expect(leseversuch).toBe(2);
    expect(screen.queryByTestId("planungsfenster-laedt")).toBeNull();
  });

  /**
   * EYT-140 M7 — `AC-007` (`REQ-004`).
   *
   * Der Rundlauf allein bewiese nichts: ein optimistisch eingefuegter
   * Clientzustand saehe genauso aus. Deshalb tragen die drei Quellen hier
   * DREI verschiedene Ids —
   *
   * - `GESENDETE_ID` schickt der Client nie mit (er sendet nur Person,
   *   Baustelle und Intervall), steht aber als Kontrollwert im Baum,
   * - `SCHREIBANTWORT_ID` liefert `createAssignment` zurueck,
   * - `SERVERSTAND_ID` liefert erst der ZWEITE `getPlanningWindow`.
   *
   * Im Markup darf nur `SERVERSTAND_ID` stehen. Stuende dort
   * `SCHREIBANTWORT_ID`, zeigte die Ansicht die Schreibantwort statt des neu
   * gelesenen Serverstands — und ein Schreibvorgang, dessen Antwort unterwegs
   * verloren ging, saehe aus wie ein gelungener.
   */
  it("zeigt nach dem Speichern den neu gelesenen Serverstand, nicht die Schreibantwort", async () => {
    const SCHREIBANTWORT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const SERVERSTAND_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const mitarbeiterId = PLANBARE_WOCHE.resources.employees[0]?.id ?? "";
    const baustellenId = PLANBARE_WOCHE.resources.worksites[0]?.id ?? "";
    const intervall = {
      startUtc: "2026-08-03T06:00:00.000Z",
      endUtc: "2026-08-03T14:00:00.000Z",
    };

    let leseversuch = 0;
    const gateway: PlanningGateway = {
      getPlanningWindow: () => {
        leseversuch += 1;
        return Promise.resolve(
          leseversuch === 1
            ? { ok: true, value: PLANBARE_WOCHE }
            : {
                ok: true,
                value: {
                  ...PLANBARE_WOCHE,
                  assignments: [
                    {
                      id: SERVERSTAND_ID,
                      employeeId: mitarbeiterId,
                      worksiteId: baustellenId,
                      interval: intervall,
                    },
                  ],
                },
              },
        );
      },
      validateDraft: () => {
        throw new Error("in dieser Ansicht nicht benutzt");
      },
      createAssignment: () =>
        Promise.resolve({
          ok: true,
          value: {
            id: SCHREIBANTWORT_ID,
            employeeId: mitarbeiterId,
            worksiteId: baustellenId,
            interval: intervall,
          },
        }),
      publishPlan: () => {
        throw new Error("in dieser Ansicht nicht benutzt");
      },
    };

    render(
      <PlanningGatewayProvider gateway={gateway}>
        <PlanningWindowView weekKey="2026-W32" />
      </PlanningGatewayProvider>,
    );
    await screen.findByTestId("einsatzformular");

    // Vor dem Speichern: genau EIN Lesevorgang, und noch keine Zuweisung.
    expect(leseversuch).toBe(1);
    expect(screen.getByTestId("planungsfenster-leer")).toBeTruthy();

    await userEvent.selectOptions(screen.getByTestId("feld-employee"), mitarbeiterId);
    await userEvent.selectOptions(screen.getByTestId("feld-worksite"), baustellenId);
    await userEvent.type(screen.getByTestId("feld-datum"), "2026-08-03");
    await userEvent.type(screen.getByTestId("feld-beginn"), "08:00");
    await userEvent.type(screen.getByTestId("feld-ende"), "16:00");
    await userEvent.click(screen.getByTestId("einsatz-speichern"));

    const liste = await screen.findByTestId("planungsfenster-liste");

    // Nach dem Speichern: genau ZWEI Lesevorgaenge.
    expect(leseversuch).toBe(2);

    const zeilen = liste.querySelectorAll("li[data-assignment-id]");
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.getAttribute("data-assignment-id")).toBe(SERVERSTAND_ID);

    // Und die Schreibantwort taucht nirgends im ausgelieferten Markup auf.
    expect(document.body.innerHTML).not.toContain(SCHREIBANTWORT_ID);
  });

  /**
   * EYT-140 M7 — `AC-018`: der Unterschied Entwurf/veroeffentlicht traegt
   * zusaetzlich ueber Form und Zeichen, nicht nur ueber Farbe.
   *
   * Geprueft wird deshalb die Glyphe im Markup, nicht eine CSS-Farbe: eine
   * Klasse allein waere genau die reine Farbcodierung, die das Kriterium
   * ausschliesst.
   */
  it("unterscheidet Entwurf und veroeffentlicht auch ohne Farbe", async () => {
    const zeichen = async (fenster: PlanningWindow): Promise<string> => {
      cleanup();
      renderWith({ ok: true, value: fenster });
      const abzeichen = await screen.findByTestId("planungsfenster-stand-abzeichen");
      const marke = abzeichen.querySelector('[aria-hidden="true"]');
      expect(marke?.textContent ?? "").not.toBe("");
      return `${marke?.textContent ?? ""}|${abzeichen.textContent ?? ""}`;
    };

    const entwurf = await zeichen({
      ...LEERE_WOCHE,
      sourceVersion: { id: "55555555-5555-4555-8555-555555555555", state: "draft" },
    });
    const veroeffentlicht = await zeichen({
      ...LEERE_WOCHE,
      sourceVersion: { id: "44444444-4444-4444-8444-444444444444", state: "published" },
      publishedVersionId: "44444444-4444-4444-8444-444444444444",
    });

    expect(entwurf).not.toBe(veroeffentlicht);
  });
});
