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
    // EYT-147 M2: neue Portmethoden. Diese Ansicht ruft sie nicht auf —
    // ein Wurf faellt auf, eine stille Leerantwort nicht.
    planWorksiteDay: () => {
      throw new Error("in dieser Ansicht nicht benutzt");
    },
    updateWorksiteDayTeam: () => {
      throw new Error("in dieser Ansicht nicht benutzt");
    },
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

/**
 * Seit EYT-147 steht das Einsatzformular im seitlichen Inspector und ist erst
 * nach „Einsatz anlegen" im Baum. Der erste Zugriff WARTET auf den Ausloeser
 * (der erscheint erst mit dem geladenen Fenster), der zweite auf das Formular.
 */
async function inspectorOeffnen(): Promise<void> {
  await userEvent.click(await screen.findByTestId("werkbank-einsatz-anlegen"));
  await screen.findByTestId("einsatzformular");
}

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

  // EYT-158: dieselben Sicherheitszusicherungen am WorksiteDay-Port.
  const geschrieben = {
    worksiteDayId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    configurationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    worksiteId: PLANBARE_WOCHE.resources.worksites[0]!.id,
    localDate: "2026-08-03",
    lockVersion: 0,
    team: [
      {
        assignmentId: "11111111-1111-4111-8111-111111111111",
        employeeId: PLANBARE_WOCHE.resources.employees[0]!.id,
        interval: { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T16:00:00.000Z" },
      },
    ],
  };
  const gelesen: PlanningWindow = {
    ...PLANBARE_WOCHE,
    worksiteDays: [geschrieben],
    assignments: geschrieben.team.map((m) => ({
      id: m.assignmentId,
      employeeId: m.employeeId,
      worksiteId: geschrieben.worksiteId,
      interval: m.interval,
    })),
  };
  async function ausfuellen(gateway: PlanningGateway) {
    render(
      <PlanningGatewayProvider gateway={gateway}>
        <PlanningWindowView weekKey="2026-W32" />
      </PlanningGatewayProvider>,
    );
    await inspectorOeffnen();
    await userEvent.selectOptions(screen.getByTestId("feld-worksite"), geschrieben.worksiteId);
    await userEvent.type(screen.getByTestId("feld-datum"), geschrieben.localDate);
    await userEvent.selectOptions(
      screen.getByTestId("feld-employee"),
      geschrieben.team[0]!.employeeId,
    );
  }

  it("behält den Idempotenzschlüssel bei einem unklaren Fehler für den Retry", async () => {
    const keys: string[] = [];
    let attempt = 0;
    const gateway: PlanningGateway = {
      ...gatewayReturning({ ok: true, value: PLANBARE_WOCHE }),
      planWorksiteDay: (_input, options) => {
        keys.push(options.idempotencyKey);
        attempt += 1;
        return Promise.resolve(
          attempt === 1
            ? { ok: false, failure: "UNAVAILABLE", problem: null }
            : { ok: true, value: geschrieben },
        );
      },
      getPlanningWindow: () =>
        Promise.resolve({ ok: true, value: attempt > 1 ? gelesen : PLANBARE_WOCHE }),
    };
    await ausfuellen(gateway);
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
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

  it("bestätigt Erfolg erst nach serverseitigem Read-through und hält das Formular sichtbar", async () => {
    let leseversuch = 0;
    let abschliessen!: (r: GatewayResult<PlanningWindow>) => void;
    const offen = new Promise<GatewayResult<PlanningWindow>>((resolve) => {
      abschliessen = resolve;
    });
    const gateway: PlanningGateway = {
      ...gatewayReturning({ ok: true, value: PLANBARE_WOCHE }),
      planWorksiteDay: () => Promise.resolve({ ok: true, value: geschrieben }),
      getPlanningWindow: () =>
        ++leseversuch === 1 ? Promise.resolve({ ok: true, value: PLANBARE_WOCHE }) : offen,
    };
    await ausfuellen(gateway);
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    await waitFor(() => expect(leseversuch).toBe(2));
    expect(screen.queryByTestId("einsatzformular-meldung")).toBeNull();
    expect(screen.queryByTestId("planungsfenster-laedt")).toBeNull();
    expect(screen.getByTestId("einsatzformular")).toBeTruthy();
    abschliessen({ ok: true, value: gelesen });
    await waitFor(() =>
      expect(screen.getByTestId("einsatzformular-meldung").getAttribute("data-state")).toBe(
        "erfolg",
      ),
    );
  });

  it("zeigt nach dem Speichern auch den ausschließlich im Readback vorhandenen Serverstand", async () => {
    const SERVERSTAND_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const read: PlanningWindow = {
      ...gelesen,
      assignments: [...gelesen.assignments, { ...gelesen.assignments[0]!, id: SERVERSTAND_ID }],
    };
    let leseversuch = 0;
    const gateway: PlanningGateway = {
      ...gatewayReturning({ ok: true, value: PLANBARE_WOCHE }),
      planWorksiteDay: () => Promise.resolve({ ok: true, value: geschrieben }),
      getPlanningWindow: () =>
        Promise.resolve({ ok: true, value: ++leseversuch === 1 ? PLANBARE_WOCHE : read }),
    };
    await ausfuellen(gateway);
    expect(leseversuch).toBe(1);
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    await waitFor(() =>
      expect(screen.getByTestId("einsatzformular-meldung").getAttribute("data-state")).toBe(
        "erfolg",
      ),
    );
    expect(leseversuch).toBe(2);
    const ids = [
      ...screen.getByTestId("planungsfenster-liste").querySelectorAll("[data-assignment-id]"),
    ].map((e) => e.getAttribute("data-assignment-id"));
    expect(ids).toEqual(
      expect.arrayContaining([geschrieben.team[0]!.assignmentId, SERVERSTAND_ID]),
    );
    expect(ids).toHaveLength(2);
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
