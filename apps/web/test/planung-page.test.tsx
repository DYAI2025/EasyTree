/**
 * Die Seite liest die Woche aus der URL (EYT-50).
 *
 * Der wichtigste Fall: bei ungueltigem Parameter wird das Gateway GAR NICHT
 * gerufen. Ein Aufruf mit geratener Woche saehe aus wie ein Ergebnis.
 */
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PlanungPage from "../app/planung/page";
import { PlanningGatewayProvider } from "../lib/planning-gateway-provider";
import type { GatewayResult, PlanningGateway, PlanningWindow } from "@easytree/contracts";

afterEach(cleanup);

const LEER: PlanningWindow = {
  weekKey: "2026-W32",
  timeZone: "Europe/Berlin",
  assignments: [],
  sourceVersion: null,
  publishedVersionId: null,
};

function gateway(seen: string[]): PlanningGateway {
  return {
    getPlanningWindow: (input: { weekKey: string }): Promise<GatewayResult<PlanningWindow>> => {
      seen.push(input.weekKey);
      return Promise.resolve({ ok: true, value: LEER });
    },
    validateDraft: vi.fn(),
    createAssignment: vi.fn(),
    publishPlan: vi.fn(),
  } as unknown as PlanningGateway;
}

async function renderPage(
  params: Record<string, string | string[] | undefined>,
  seen: string[],
): Promise<void> {
  const element = await PlanungPage({ searchParams: Promise.resolve(params) });
  render(<PlanningGatewayProvider gateway={gateway(seen)}>{element}</PlanningGatewayProvider>);
}

describe("/planung", () => {
  it("laedt die Woche aus dem Parameter", async () => {
    const seen: string[] = [];
    await renderPage({ weekKey: "2026-W32" }, seen);
    await waitFor(() => expect(seen).toEqual(["2026-W32"]));
  });

  it.each([
    ["fehlend", undefined],
    ["leer", ""],
    ["W00", "2026-W00"],
    ["W54", "2026-W54"],
    ["syntaktisch ungueltig", "zweitausendsechsundzwanzig"],
    ["mehrfach angegeben", ["2026-W32", "2026-W33"]],
  ])("lehnt einen %s Wochenschluessel sichtbar ab", async (_name, wert) => {
    const seen: string[] = [];
    await renderPage({ weekKey: wert }, seen);
    expect(screen.getByTestId("planungsfenster-parameterfehler")).toBeTruthy();
    // Der Kern: kein Aufruf mit geratener Woche.
    expect(seen).toEqual([]);
  });

  it("akzeptiert die Grenzen 01 und 53", async () => {
    for (const weekKey of ["2026-W01", "2026-W53"]) {
      cleanup();
      const seen: string[] = [];
      await renderPage({ weekKey }, seen);
      await waitFor(() => expect(seen).toEqual([weekKey]));
    }
  });
});
