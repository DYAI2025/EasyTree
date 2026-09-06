/**
 * Dispositionswerkbank Slice 1 (EYT-147) — Woche als Achse, Inspector, eine
 * primaere Aktion.
 *
 * ## Gegenmutationen (ausgefuehrt, siehe PR-Beschreibung)
 *
 * 1. In `planning-window-view.tsx` `useState(false)` des Inspectors auf
 *    `useState(true)` stellen → „der Inspector ist anfangs geschlossen" rot.
 * 2. Den Ausloeser unabhaengig vom Stand als `PrimaryAction` rendern →
 *    „im Entwurfszustand ist Veroeffentlichen die einzige primaere Aktion"
 *    rot (und `planungs-werkbank.test.tsx` zaehlt 2).
 * 3. Die Tageszuordnung in `lib/wochenraster.ts` auf das UTC-Datum stellen →
 *    dort rot (`wochenraster.test.ts`), nicht hier: die Rechnung hat genau
 *    einen Ort.
 */
import type { GatewayResult, PlanningGateway, PlanningWindow } from "@easytree/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { PlanningWindowView } from "../components/planning-window-view";
import { PlanningGatewayProvider } from "../lib/planning-gateway-provider";

const PERSON = "22222222-2222-4222-8222-222222222222";
const BAUSTELLE = "33333333-3333-4333-8333-333333333333";

function fenster(teil: Partial<PlanningWindow>): PlanningWindow {
  return {
    weekKey: "2026-W36",
    timeZone: "Europe/Berlin",
    assignments: [],
    sourceVersion: null,
    publishedVersionId: null,
    resources: {
      employees: [{ id: PERSON, label: "Anna Berg", active: true }],
      worksites: [{ id: BAUSTELLE, label: "Baustelle Nord", active: true }],
    },
    ...teil,
  };
}

function einsatz(id: string, startUtc: string, endUtc: string) {
  return { id, employeeId: PERSON, worksiteId: BAUSTELLE, interval: { startUtc, endUtc } };
}

function gatewayMit(result: GatewayResult<PlanningWindow>): PlanningGateway {
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
      throw new Error("in diesem Test nicht benutzt");
    },
    publishPlan: () => {
      throw new Error("in diesem Test nicht benutzt");
    },
  };
}

function rendern(wert: PlanningWindow, darfVeroeffentlichen = false): void {
  render(
    <PlanningGatewayProvider gateway={gatewayMit({ ok: true, value: wert })}>
      <PlanningWindowView weekKey={wert.weekKey} darfVeroeffentlichen={darfVeroeffentlichen} />
    </PlanningGatewayProvider>,
  );
}

afterEach(cleanup);

describe("EYT-147 — die Woche ist die Flaeche", () => {
  it("zeigt alle sieben Wochentage der Woche aus der Serverantwort", async () => {
    rendern(fenster({}));
    const liste = await screen.findByTestId("planungsfenster-liste");
    const koepfe = [...liste.querySelectorAll(".wochenraster__tagkopf")].map(
      (kopf) => kopf.textContent ?? "",
    );
    expect(koepfe).toHaveLength(7);
    expect(koepfe[0]).toContain("Montag");
    expect(koepfe[0]).toContain("31.08.");
    expect(koepfe[6]).toContain("Sonntag");
    expect(koepfe[6]).toContain("06.09.");
  });

  it("legt einen Einsatz auf den Kalendertag seines Beginns in der Organisationszone", async () => {
    // 22:30 UTC am Montag ist in Berlin bereits Dienstag, 00:30 — die Karte
    // steht am Dienstag. Eine UTC-Zuordnung legte sie auf den Montag.
    rendern(
      fenster({
        sourceVersion: { id: "55555555-5555-4555-8555-555555555555", state: "draft" },
        assignments: [
          einsatz(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "2026-08-31T22:30:00.000Z",
            "2026-09-01T04:00:00.000Z",
          ),
        ],
      }),
    );
    const liste = await screen.findByTestId("planungsfenster-liste");
    const dienstag = liste.querySelector('[data-tag="2026-09-01"]');
    expect(dienstag).not.toBeNull();
    const karte = within(dienstag as HTMLElement).getByRole("listitem");
    expect(karte.getAttribute("data-assignment-id")).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    // Die Karte nennt Baustelle, Person und Wanduhrzeit — nicht die Uuid.
    expect(karte.textContent).toContain("Baustelle Nord");
    expect(karte.textContent).toContain("Anna Berg");
    expect(karte.textContent).toContain("00:30");
    const montag = liste.querySelector('[data-tag="2026-08-31"]');
    expect(within(montag as HTMLElement).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("verschluckt einen Einsatz ausserhalb der Woche nicht, sondern stellt ihn aus", async () => {
    rendern(
      fenster({
        sourceVersion: { id: "55555555-5555-4555-8555-555555555555", state: "draft" },
        assignments: [
          einsatz(
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "2026-09-14T06:00:00.000Z",
            "2026-09-14T14:00:00.000Z",
          ),
        ],
      }),
    );
    const liste = await screen.findByTestId("planungsfenster-liste");
    const ausserhalb = liste.querySelector(".wochenraster__ausserhalb");
    expect(ausserhalb).not.toBeNull();
    expect(
      within(ausserhalb as HTMLElement)
        .getByRole("listitem")
        .getAttribute("data-assignment-id"),
    ).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  });
});

describe("EYT-147 — der Erstellungs-Inspector", () => {
  it("ist anfangs geschlossen: das Formular steht erst nach „Einsatz anlegen“ im Baum", async () => {
    rendern(fenster({}));
    const ausloeser = await screen.findByTestId("werkbank-einsatz-anlegen");
    expect(screen.queryByTestId("einsatzformular")).toBeNull();
    expect(ausloeser.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(ausloeser);
    expect(await screen.findByTestId("einsatzformular")).toBeTruthy();
    expect(ausloeser.getAttribute("aria-expanded")).toBe("true");
  });

  it("setzt beim Oeffnen den Fokus in das erste Bedienelement des Formulars", async () => {
    rendern(fenster({}));
    await userEvent.click(await screen.findByTestId("werkbank-einsatz-anlegen"));
    await screen.findByTestId("einsatzformular");
    expect(document.activeElement).toBe(screen.getByTestId("feld-worksite"));
  });

  it("schliesst mit Escape und stellt den Fokus auf den Ausloeser zurueck", async () => {
    rendern(fenster({}));
    const ausloeser = await screen.findByTestId("werkbank-einsatz-anlegen");
    await userEvent.click(ausloeser);
    await screen.findByTestId("einsatzformular");

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("einsatzformular")).toBeNull();
    expect(document.activeElement).toBe(ausloeser);
  });

  it("schliesst ueber die Schaltflaeche und stellt den Fokus zurueck", async () => {
    rendern(fenster({}));
    const ausloeser = await screen.findByTestId("werkbank-einsatz-anlegen");
    await userEvent.click(ausloeser);
    await userEvent.click(await screen.findByTestId("werkbank-inspector-schliessen"));
    expect(screen.queryByTestId("einsatzformular")).toBeNull();
    expect(document.activeElement).toBe(ausloeser);
  });
});

describe("EYT-147 — genau eine primaere Aktion je Zustand", () => {
  it("macht im veroeffentlichbaren Entwurf das Veroeffentlichen zur einzigen primaeren Aktion", async () => {
    rendern(
      fenster({ sourceVersion: { id: "55555555-5555-4555-8555-555555555555", state: "draft" } }),
      true,
    );
    const ausloeser = await screen.findByTestId("werkbank-einsatz-anlegen");
    const primaere = document.querySelectorAll(".eyt-primary-action");
    expect(primaere).toHaveLength(1);
    expect(primaere[0]?.getAttribute("data-testid")).toBe("planung-veroeffentlichen");
    expect(ausloeser.classList.contains("eyt-primary-action")).toBe(false);
  });

  it("macht ohne Veroeffentlichungsweg das Anlegen zur einzigen primaeren Aktion", async () => {
    rendern(
      fenster({
        sourceVersion: { id: "44444444-4444-4444-8444-444444444444", state: "published" },
        publishedVersionId: "44444444-4444-4444-8444-444444444444",
      }),
      true,
    );
    const ausloeser = await screen.findByTestId("werkbank-einsatz-anlegen");
    expect(screen.queryByTestId("planung-veroeffentlichen")).toBeNull();
    const primaere = document.querySelectorAll(".eyt-primary-action");
    expect(primaere).toHaveLength(1);
    expect(primaere[0]).toBe(ausloeser);
  });

  it("laesst dem Entwurf OHNE planning.publish die Anlage als primaere Aktion", async () => {
    rendern(
      fenster({ sourceVersion: { id: "55555555-5555-4555-8555-555555555555", state: "draft" } }),
      false,
    );
    const ausloeser = await screen.findByTestId("werkbank-einsatz-anlegen");
    expect(screen.queryByTestId("planung-veroeffentlichen")).toBeNull();
    expect(ausloeser.classList.contains("eyt-primary-action")).toBe(true);
  });
});
