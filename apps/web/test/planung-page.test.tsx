/**
 * `/planung` — welche Woche die Seite anfordert (EYT-50, erweitert um EYT-140 M5).
 *
 * Zwei Faelle, die bewusst NICHT derselbe sind (`E2`):
 *
 *  * **Kein** `weekKey` → die laufende Woche (`AC-003`). Bis M5 war auch das ein
 *    Fehler, und die Planerin musste den technischen Schluessel selbst in die
 *    Adresse schreiben.
 *  * Ein **vorhandener, aber ungueltiger** `weekKey` → sichtbare Ablehnung, und
 *    das Gateway wird GAR NICHT gerufen. Ein Aufruf mit geratener Woche saehe
 *    aus wie ein Ergebnis.
 *
 * Der Zeitpunkt wird in jedem Fall festgestellt (`vi.setSystemTime`). Ohne das
 * wechselte die Erwartung „laufende Woche" jede Woche ihren Wert — der Test
 * maesse dann den Kalender des Rechners, nicht die Seite.
 */
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlanungPage from "../app/planung/page";
import { AuthGatewayProvider } from "../lib/auth-gateway-provider";
import { PlanningGatewayProvider } from "../lib/planning-gateway-provider";
import { SessionProvider } from "../lib/session-provider";
import type {
  AuthGateway,
  GatewayResult,
  PlanningGateway,
  PlanningWindow,
  SessionDto,
} from "@easytree/contracts";

vi.mock("next/navigation", async () => {
  const modul = await import("./helpers/navigation-attrappe");
  return modul.nextNavigationModul();
});

/**
 * Mittwoch, 12:00 UTC. Wochenmitte und Mittag: der Zeitpunkt liegt in jeder
 * Zone zwischen UTC-12 und UTC+14 in derselben ISO-Woche, der Test haengt also
 * nicht an der Zeitzone der Maschine.
 *
 * `2026-08-19` ist ein Mittwoch; der Montag dieser ISO-Woche ist der
 * 17.08.2026, die Woche also **2026-W34** (unabhaengig gerechnet, nicht aus dem
 * Produktionscode uebernommen).
 */
const MITTWOCH_KW34 = new Date("2026-08-19T12:00:00.000Z");
const LAUFENDE_WOCHE = "2026-W34";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MITTWOCH_KW34);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LEER: PlanningWindow = {
  weekKey: "2026-W32",
  timeZone: "Europe/Berlin",
  assignments: [],
  sourceVersion: null,
  publishedVersionId: null,
  resources: { employees: [], worksites: [] },
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

/**
 * Eine angemeldete Sitzung mit Planungsrechten.
 *
 * Seit EYT-107 haengt `/planung` an `PlanungZugang`: die Seite rendert erst,
 * wenn die Sitzung `planning.read` traegt. Das ist keine Testhuerde, sondern
 * die Aussage — bis dahin zeigte die Seite jedem einen Wochenplan an, den die
 * API danach mit 401 beantwortete.
 */
const SITZUNG: SessionDto = {
  userId: "00000000-0000-4000-8000-00000000aaa1",
  organisations: [
    {
      id: "00000000-0000-4000-8000-0000000000a1",
      name: "Alpha",
      role: "owner",
      permissions: ["planning.read", "planning.write", "planning.publish"],
    },
  ],
};

const authGateway = (): AuthGateway =>
  ({
    session: (): Promise<GatewayResult<SessionDto>> =>
      Promise.resolve({ ok: true, value: SITZUNG }),
    login: vi.fn(),
    logout: vi.fn(),
  }) as unknown as AuthGateway;

async function renderPage(
  params: Record<string, string | string[] | undefined>,
  seen: string[],
): Promise<void> {
  const element = await PlanungPage({ searchParams: Promise.resolve(params) });
  render(
    <AuthGatewayProvider gateway={authGateway()}>
      <SessionProvider>
        <PlanningGatewayProvider gateway={gateway(seen)}>{element}</PlanningGatewayProvider>
      </SessionProvider>
    </AuthGatewayProvider>,
  );
}

describe("/planung — der Parameter", () => {
  it("laedt die Woche aus dem Parameter", async () => {
    const seen: string[] = [];
    await renderPage({ weekKey: "2026-W32" }, seen);
    await waitFor(() => expect(seen).toEqual(["2026-W32"]));
  });

  it.each([
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

describe("/planung — ohne technischen Parameter (`AC-003`)", () => {
  it("fragt den Server nach der laufenden Woche", async () => {
    const seen: string[] = [];
    await renderPage({}, seen);
    await waitFor(() => expect(seen).toEqual([LAUFENDE_WOCHE]));
  });

  it("zeigt dabei kein Parameterfehler-Ersatzbild", async () => {
    const seen: string[] = [];
    await renderPage({}, seen);
    await waitFor(() => expect(seen).toEqual([LAUFENDE_WOCHE]));
    expect(screen.queryByTestId("planungsfenster-parameterfehler")).toBeNull();
  });

  it("liest den Zeitpunkt wirklich aus der Uhr", async () => {
    // Dieselbe Seite, ein anderer Zeitpunkt, ein anderes Ergebnis. Ohne diese
    // Zusicherung waere ein fest eingebautes `"2026-W34"` in beiden Faellen
    // oben gruen. 2027-01-01 ist ein Freitag und liegt nach der
    // Donnerstagsregel noch in 2026-W53.
    vi.setSystemTime(new Date("2027-01-01T12:00:00.000Z"));
    const seen: string[] = [];
    await renderPage({}, seen);
    await waitFor(() => expect(seen).toEqual(["2026-W53"]));
  });

  it("blendet die Wochennavigation ein", async () => {
    const seen: string[] = [];
    await renderPage({}, seen);
    expect(screen.getByRole("navigation", { name: "Wochennavigation" })).toBeTruthy();
    // Kein Nachbau der Wochenrechnung: geprueft wird, DASS die Seite die
    // laufende Woche als solche kennzeichnet. Welche Adressen dabei entstehen,
    // ist in `wochenmodell.test.ts` absolut gepinnt.
    expect(screen.getByTestId("wochennavigation-aktuell")).toBeTruthy();
  });
});

describe("/planung — die beiden Fehlergruende sind unterscheidbar", () => {
  it("nennt einen unbrauchbaren Parameter beim Namen", async () => {
    const seen: string[] = [];
    await renderPage({ weekKey: "2026-W99" }, seen);
    expect(screen.getByTestId("planungsfenster-parameterfehler")).toBeTruthy();
    expect(screen.queryByTestId("planungsfenster-randwoche")).toBeNull();
    expect(seen).toEqual([]);
  });

  it("unterscheidet die gueltige Randwoche ohne Nachbarwoche davon", async () => {
    // `9999-W52` ist ein GUELTIGER Schluessel — nur seine Nachbarwoche liegt
    // ausserhalb der Vertragsgrenze 0001–9999. Der Hinweis „erwartet wird
    // `?weekKey=2026-W32`" waere hier schlicht falsch: der Schluessel war
    // wohlgeformt. Ohne diesen Zweig haette `grund` aus dem Modell keinen Leser.
    const seen: string[] = [];
    await renderPage({ weekKey: "9999-W52" }, seen);
    expect(screen.getByTestId("planungsfenster-randwoche")).toBeTruthy();
    expect(screen.queryByTestId("planungsfenster-parameterfehler")).toBeNull();
    expect(seen).toEqual([]);
  });

  it("laesst aus beiden Fehlern den Rueckweg zur laufenden Woche offen", async () => {
    for (const weekKey of ["2026-W99", "9999-W52"]) {
      cleanup();
      const seen: string[] = [];
      await renderPage({ weekKey }, seen);
      const heute = screen.getByRole("link", { name: "Heute" });
      expect(heute.getAttribute("href")).toBe(`/planung?weekKey=${LAUFENDE_WOCHE}`);
    }
  });
});
