import type { PlanningGateway, PlanningWindow, WorksiteDayDto } from "@easytree/contracts";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanningWindowView } from "../components/planning-window-view";
import { PlanningGatewayProvider } from "../lib/planning-gateway-provider";

afterEach(cleanup);
const employees = [1, 2, 3].map((n) => ({
  id: `22222222-2222-4222-8222-22222222222${n}`,
  label: `Person ${n}`,
  active: true,
}));
const site = "33333333-3333-4333-8333-333333333333";
const empty: PlanningWindow = {
  weekKey: "2028-W02",
  timeZone: "Europe/Berlin",
  assignments: [],
  worksiteDays: [],
  sourceVersion: null,
  publishedVersionId: null,
  resources: { employees, worksites: [{ id: site, label: "Baustelle Nord", active: true }] },
};
const day: WorksiteDayDto = {
  worksiteDayId: "44444444-4444-4444-8444-444444444444",
  configurationId: "55555555-5555-4555-8555-555555555555",
  worksiteId: site,
  localDate: "2028-01-10",
  lockVersion: 0,
  team: employees.map((e, n) => ({
    employeeId: e.id,
    assignmentId: `66666666-6666-4666-8666-66666666666${n}`,
    interval: { startUtc: "2028-01-10T07:00:00.000Z", endUtc: "2028-01-10T17:00:00.000Z" },
  })),
};
const saved: PlanningWindow = {
  ...empty,
  worksiteDays: [day],
  assignments: day.team.map((m) => ({
    id: m.assignmentId,
    employeeId: m.employeeId,
    worksiteId: site,
    interval: m.interval,
  })),
  sourceVersion: { id: "77777777-7777-4777-8777-777777777777", state: "draft" },
};

function setup(initial = empty) {
  const getPlanningWindow = vi
    .fn<PlanningGateway["getPlanningWindow"]>()
    .mockResolvedValue({ ok: true, value: initial });
  const planWorksiteDay = vi
    .fn<PlanningGateway["planWorksiteDay"]>()
    .mockResolvedValue({ ok: true, value: day });
  const createAssignment = vi
    .fn<PlanningGateway["createAssignment"]>()
    .mockResolvedValue({ ok: false, failure: "REJECTED", problem: null });
  const unused = () => {
    throw new Error("Nicht Teil dieses Flows");
  };
  const gateway: PlanningGateway = {
    getPlanningWindow,
    planWorksiteDay,
    createAssignment,
    updateWorksiteDayTeam: unused,
    validateDraft: unused,
    publishPlan: unused,
  };
  render(
    <PlanningGatewayProvider gateway={gateway}>
      <PlanningWindowView weekKey={empty.weekKey} />
    </PlanningGatewayProvider>,
  );
  return { getPlanningWindow, planWorksiteDay, createAssignment };
}
async function open() {
  await userEvent.click(await screen.findByTestId("werkbank-einsatz-anlegen"));
  return screen.getByTestId("einsatzformular");
}
async function fill() {
  await userEvent.selectOptions(screen.getByTestId("feld-worksite"), site);
  await userEvent.type(screen.getByTestId("feld-datum"), day.localDate);
  await userEvent.selectOptions(
    screen.getByTestId("feld-employee"),
    employees.map((e) => e.id),
  );
}

describe("EYT-158 worksite-first Create", () => {
  it("rendert genau eine primäre Baustellentag-Karte für drei Einplanungen", async () => {
    setup(saved);
    await screen.findByTestId("planungsfenster-liste");
    // RED-Phase vor EYT-158: drei Assignment-Karten statt einer Tageskarte.
    const cards = document.querySelectorAll(".einsatzkarte");
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.getAttribute("data-worksite-day-id")).toBe(day.worksiteDayId);
    expect(card.getAttribute("data-configuration-id")).toBe(day.configurationId);
    expect(card.textContent).toContain("Baustelle Nord");
    // Deutsches Datum, nicht der ISO-String; maschinenlesbar bleibt `dateTime`.
    expect(card.textContent).toContain("10.01.2028");
    expect(card.querySelector("time")?.getAttribute("dateTime")).toBe("2028-01-10");
    expect(card.textContent).toContain("08:00–18:00");
    expect(card.textContent).toContain("Einsatzteam");
    expect(card.querySelectorAll("[data-assignment-id]")).toHaveLength(3);
    for (const person of employees) expect(card.textContent).toContain(person.label);
    expect(document.querySelectorAll("[data-assignment-id]")).toHaveLength(3);
    expect(card.closest("[data-tag]")?.getAttribute("data-tag")).toBe(day.localDate);
  });

  it("erhält Legacy-Einplanungen getrennt ohne erfundene Tagesidentität", async () => {
    const legacy = { ...saved.assignments[0]!, id: "88888888-8888-4888-8888-888888888888" };
    setup({ ...saved, assignments: [...saved.assignments, legacy] });
    await screen.findByTestId("planungsfenster-liste");
    expect(document.querySelectorAll(".einsatzkarte")).toHaveLength(1);
    expect(
      document
        .querySelector(`[data-assignment-id="${legacy.id}"]`)
        ?.closest("[data-worksite-day-id]"),
    ).toBeNull();
    expect(document.querySelectorAll("[data-assignment-id]")).toHaveLength(4);
    expect(screen.getByText("Einplanungen ohne Baustellentag")).toBeTruthy();
  });

  it("beginnt mit Baustelle, Datum, editierbarer Arbeitszeit und danach dem Einsatzteam", async () => {
    setup();
    const form = await open();
    // RED-Phase vor EYT-158: die einzelne Person stand zuerst, die Zeiten waren leer.
    expect(
      [...form.querySelectorAll("select,input")].map((e) => e.getAttribute("data-testid")),
    ).toEqual(["feld-worksite", "feld-datum", "feld-beginn", "feld-ende", "feld-employee"]);
    expect(document.activeElement).toBe(screen.getByTestId("feld-worksite"));
    expect((screen.getByTestId("feld-beginn") as HTMLInputElement).value).toBe("08:00");
    expect((screen.getByTestId("feld-ende") as HTMLInputElement).value).toBe("18:00");
    expect((screen.getByTestId("feld-employee") as HTMLSelectElement).multiple).toBe(true);
    await userEvent.clear(screen.getByTestId("feld-beginn"));
    await userEvent.type(screen.getByTestId("feld-beginn"), "09:00");
    expect((screen.getByTestId("feld-beginn") as HTMLInputElement).value).toBe("09:00");
  });

  it("sendet drei Personen in genau einem WorksiteDay-Command und bestätigt erst den Readback", async () => {
    const g = setup();
    await open();
    await fill();
    let finish!: (value: Awaited<ReturnType<PlanningGateway["getPlanningWindow"]>>) => void;
    g.getPlanningWindow.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    await waitFor(() => expect(g.planWorksiteDay).toHaveBeenCalledTimes(1));
    expect(g.planWorksiteDay.mock.calls[0]?.[0]).toEqual({
      weekKey: empty.weekKey,
      worksiteId: site,
      localDate: day.localDate,
      team: day.team.map(({ employeeId, interval }) => ({ employeeId, interval })),
    });
    expect(g.createAssignment).not.toHaveBeenCalled();
    expect(screen.queryByTestId("einsatzformular-meldung")).toBeNull();
    finish({ ok: true, value: saved });
    await waitFor(() =>
      expect(screen.getByTestId("einsatzformular-meldung").getAttribute("data-state")).toBe(
        "erfolg",
      ),
    );
  });

  it.each([
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "REJECTED",
    "STALE_VERSION",
    "UNAVAILABLE",
    "CONTRACT_VIOLATION",
  ] as const)("zeigt %s ohne Erfolg oder erfundene Karte", async (failure) => {
    const g = setup();
    g.planWorksiteDay.mockResolvedValue({ ok: false, failure, problem: null });
    await open();
    await fill();
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    const message = await screen.findByTestId("einsatzformular-meldung");
    expect(message.getAttribute("data-state")).toBe("fehler");
    expect(message.getAttribute("role")).toBe("alert");
    expect(document.querySelectorAll("[data-worksite-day-id]")).toHaveLength(0);
    expect(g.getPlanningWindow).toHaveBeenCalledTimes(1);
  });

  it("meldet fehlenden Readback statt Erfolg und behält beim Retry denselben Schlüssel", async () => {
    const g = setup();
    await open();
    await fill();
    // Write erfolgreich, Read lässt den Tag weg: keine Erfolgsmeldung.
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    expect((await screen.findByTestId("einsatzformular-meldung")).getAttribute("data-state")).toBe(
      "fehler",
    );
    g.getPlanningWindow.mockResolvedValue({ ok: true, value: saved });
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    await waitFor(() =>
      expect(screen.getByTestId("einsatzformular-meldung").getAttribute("data-state")).toBe(
        "erfolg",
      ),
    );
    expect(g.planWorksiteDay).toHaveBeenCalledTimes(2);
    expect(g.planWorksiteDay.mock.calls[0]?.[1]).toEqual(g.planWorksiteDay.mock.calls[1]?.[1]);
  });

  it("zeigt bei fehlgeschlagenem Readback keine POST-basierte Erfolgskarte", async () => {
    const g = setup();
    await open();
    await fill();
    g.getPlanningWindow.mockResolvedValue({ ok: false, failure: "UNAVAILABLE", problem: null });
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    expect((await screen.findByTestId("einsatzformular-meldung")).getAttribute("data-state")).toBe(
      "fehler",
    );
    expect(document.querySelectorAll("[data-worksite-day-id]")).toHaveLength(0);
  });
});

const nichtTeilDesFlows = () => {
  throw new Error("Nicht Teil dieses Flows");
};

describe("EYT-158 Readback-Wahrheit", () => {
  it.each([
    [
      "anderer Konfigurationsrevision",
      (d: WorksiteDayDto): WorksiteDayDto => ({
        ...d,
        configurationId: "99999999-9999-4999-8999-999999999999",
      }),
    ],
    [
      "fehlendem Teammitglied",
      (d: WorksiteDayDto): WorksiteDayDto => ({ ...d, team: d.team.slice(0, 2) }),
    ],
    [
      "anderer lockVersion",
      (d: WorksiteDayDto): WorksiteDayDto => ({ ...d, lockVersion: d.lockVersion + 1 }),
    ],
  ])(
    "meldet bei einem Readback mit %s keinen Erfolg und behaelt den Vorgangsschluessel",
    async (_name, abweichend) => {
      const g = setup();
      await open();
      await fill();
      // Der Server bestaetigt den Write, der Readback widerspricht ihm in
      // GENAU einem Merkmal. Ein Vergleich, der nur die Tagesidentitaet
      // prueft, liesse jede dieser Abweichungen als Erfolg durch.
      g.getPlanningWindow.mockResolvedValue({
        ok: true,
        value: { ...saved, worksiteDays: [abweichend(day)] },
      });
      await userEvent.click(screen.getByTestId("einsatz-speichern"));
      const message = await screen.findByTestId("einsatzformular-meldung");
      expect(message.getAttribute("data-state")).toBe("fehler");
      expect(message.textContent).toMatch(/stimmt nicht überein/);
      // Kein Erfolgszustand irgendwo im Formular — der Leerzustand der Woche
      // traegt selbst `role="status"`, deshalb gezielt auf die Meldung.
      expect(
        document.querySelector('[data-testid="einsatzformular-meldung"][data-state="erfolg"]'),
      ).toBeNull();

      // Der Vorgang ist NICHT abgeschlossen: der Wiederholungsversuch traegt
      // denselben Schluessel und bleibt damit derselbe Vorgang.
      await userEvent.click(screen.getByTestId("einsatz-speichern"));
      await waitFor(() => expect(g.planWorksiteDay).toHaveBeenCalledTimes(2));
      expect(g.planWorksiteDay.mock.calls[0]?.[1]).toEqual(g.planWorksiteDay.mock.calls[1]?.[1]);
    },
  );

  it("verwirft den Readback der alten Woche, wenn waehrend des Speicherns die Woche wechselt", async () => {
    const naechste: PlanningWindow = { ...empty, weekKey: "2028-W03" };
    const getPlanningWindow = vi.fn<PlanningGateway["getPlanningWindow"]>();
    let readbackAufloesen!: (
      wert: Awaited<ReturnType<PlanningGateway["getPlanningWindow"]>>,
    ) => void;
    getPlanningWindow.mockImplementation(({ weekKey }) => {
      if (weekKey === naechste.weekKey) return Promise.resolve({ ok: true, value: naechste });
      // Erster Aufruf fuer W02: das Laden. Zweiter: der Readback nach dem
      // Write — er bleibt offen, bis der Test ihn aufloest.
      const bisher = getPlanningWindow.mock.calls.filter(([i]) => i.weekKey === empty.weekKey);
      return bisher.length === 1
        ? Promise.resolve({ ok: true, value: empty })
        : new Promise((resolve) => {
            readbackAufloesen = resolve;
          });
    });
    const gateway: PlanningGateway = {
      getPlanningWindow,
      planWorksiteDay: vi
        .fn<PlanningGateway["planWorksiteDay"]>()
        .mockResolvedValue({ ok: true, value: day }),
      createAssignment: nichtTeilDesFlows,
      updateWorksiteDayTeam: nichtTeilDesFlows,
      validateDraft: nichtTeilDesFlows,
      publishPlan: nichtTeilDesFlows,
    };
    const { rerender } = render(
      <PlanningGatewayProvider gateway={gateway}>
        <PlanningWindowView weekKey={empty.weekKey} />
      </PlanningGatewayProvider>,
    );
    await open();
    await fill();
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    await waitFor(() => expect(getPlanningWindow).toHaveBeenCalledTimes(2));

    // Wochenwechsel, waehrend der Readback der alten Woche noch offen ist.
    rerender(
      <PlanningGatewayProvider gateway={gateway}>
        <PlanningWindowView weekKey={naechste.weekKey} />
      </PlanningGatewayProvider>,
    );
    await waitFor(() => expect(getPlanningWindow).toHaveBeenCalledTimes(3));
    await screen.findByTestId("planungsfenster-leer");

    // Jetzt kommt der Readback der ALTEN Woche an. Der Write war erfolgreich —
    // aber die Karte gehoert nach W02 und darf W03 nicht ueberschreiben. Das
    // Formular der alten Woche ist mit dem Wochenwechsel ausgehaengt; die
    // einzige beobachtbare Wirkung eines fehlenden Riegels waere die fremde
    // Karte im Baum.
    await act(async () => {
      readbackAufloesen({ ok: true, value: saved });
      await Promise.resolve();
    });
    expect(getPlanningWindow).toHaveBeenCalledTimes(3);
    expect(document.querySelectorAll("[data-worksite-day-id]")).toHaveLength(0);
    expect(screen.getByTestId("planungsfenster-leer")).toBeTruthy();
  });
});

describe("EYT-158 Leerzustand des Formulars", () => {
  it.each([
    [
      "ohne aktive Mitarbeitende",
      { employees: [], worksites: empty.resources.worksites },
      /keine aktiven Mitarbeitenden/,
    ],
    ["ohne aktive Baustellen", { employees, worksites: [] }, /keine aktiven Baustellen/],
  ])("erklaert den Leerzustand %s statt ein Formular zu zeigen", async (_name, resources, text) => {
    setup({ ...empty, resources });
    await userEvent.click(await screen.findByTestId("werkbank-einsatz-anlegen"));
    const leer = await screen.findByTestId("einsatzformular-leer");
    expect(leer.textContent).toMatch(text);
    expect(screen.queryByTestId("einsatzformular")).toBeNull();
    // Benannter Bereich: der Erklaertext ist als Region anspringbar, nicht
    // nur als loser Absatz — dieselbe Zusicherung wie beim Formular selbst.
    const labelledBy = leer.getAttribute("aria-labelledby") ?? "";
    expect(labelledBy).not.toBe("");
    expect(document.getElementById(labelledBy)?.textContent).toContain("Baustellentag planen");
  });
});
