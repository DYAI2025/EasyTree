/**
 * Seitenwaechter und Navigationsfilter der Planung (EYT-107).
 *
 * ## Der Befund, den diese Datei in eine Messung verwandelt
 *
 * Bis EYT-107 stand „Planung" unbedingt in der Navigation, und `/planung`
 * hatte keinen Waechter — waehrend die API jede Planungsanfrage mit 401 oder
 * 403 beantwortete. Jede angemeldete Person sah einen Link, der fuer sie nie
 * funktionierte, und danach einen Fehlerzustand ohne Erklaerung.
 *
 * Basisdesign v2.0 §3.1 verlangt beides: nach atomaren Rechten filtern UND
 * nicht auf die Filterung vertrauen. Diese Suite prueft die erste Haelfte;
 * die zweite steht in `apps/api/test/planning-publish.http.test.ts` und
 * `supabase/tests/0011_planning_publish.sql`.
 *
 * Gegenmutation, die diese Datei rot macht: in `PlanungZugang` die
 * `hatRecht("planning.read")`-Pruefung entfernen, oder in `AppShell` den
 * Planungspunkt wieder unbedingt aufnehmen.
 */
import type { AuthGateway, GatewayResult, SessionDto } from "@easytree/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../components/app-shell";
import { PlanungZugang } from "../components/planung-zugang";
import { AuthGatewayProvider } from "../lib/auth-gateway-provider";
import { SessionProvider } from "../lib/session-provider";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  usePathname: (): string => "/planung",
  useRouter: (): { push: () => void; refresh: () => void } => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const ORG = "00000000-0000-4000-8000-0000000000a1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";

function sitzungMit(organisations: SessionDto["organisations"]): AuthGateway {
  return {
    session: (): Promise<GatewayResult<SessionDto>> =>
      Promise.resolve({
        ok: true,
        value: { userId: "00000000-0000-4000-8000-00000000aaa1", organisations },
      }),
    login: vi.fn(),
    logout: vi.fn(),
  } as unknown as AuthGateway;
}

const abgemeldet = (): AuthGateway =>
  ({
    session: (): Promise<GatewayResult<SessionDto>> =>
      Promise.resolve({ ok: false, failure: "UNAUTHENTICATED", problem: null }),
    login: vi.fn(),
    logout: vi.fn(),
  }) as unknown as AuthGateway;

const unbekannt = (): AuthGateway =>
  ({
    session: (): Promise<GatewayResult<SessionDto>> =>
      Promise.resolve({ ok: false, failure: "UNAVAILABLE", problem: null }),
    login: vi.fn(),
    logout: vi.fn(),
  }) as unknown as AuthGateway;

const orgMit = (permissions: readonly string[], id: string = ORG) => ({
  id,
  name: "Alpha",
  role: "owner" as const,
  permissions: [...permissions],
});

function zeichneWaechter(gateway: AuthGateway): {
  gesehen: boolean[];
  kostenGesehen: boolean[];
} {
  const gesehen: boolean[] = [];
  const kostenGesehen: boolean[] = [];
  render(
    <AuthGatewayProvider gateway={gateway}>
      <SessionProvider>
        <PlanungZugang>
          {({ darfVeroeffentlichen, darfKostenLesen }) => {
            gesehen.push(darfVeroeffentlichen);
            kostenGesehen.push(darfKostenLesen);
            return <p data-testid="planung-inhalt">Inhalt</p>;
          }}
        </PlanungZugang>
      </SessionProvider>
    </AuthGatewayProvider>,
  );
  return { gesehen, kostenGesehen };
}

describe("PlanungZugang", () => {
  it("gibt mit planning.read frei", async () => {
    zeichneWaechter(sitzungMit([orgMit(["planning.read"])]));
    await waitFor(() => expect(screen.queryByTestId("planung-inhalt")).not.toBeNull());
  });

  it("zeigt Forbidden ohne planning.read", async () => {
    zeichneWaechter(sitzungMit([orgMit(["costs.read"])]));
    await waitFor(() => expect(screen.queryByTestId("planung-forbidden")).not.toBeNull());
    expect(screen.queryByTestId("planung-inhalt")).toBeNull();
  });

  it("zeigt Unauthenticated statt eines leeren Wochenplans", async () => {
    zeichneWaechter(abgemeldet());
    await waitFor(() => expect(screen.queryByTestId("planung-unauthenticated")).not.toBeNull());
  });

  it("unterscheidet Nichtwissen von Abgemeldet", async () => {
    // Ein nicht erreichbarer Auth-Server heisst NICHT „abgemeldet". Wer beides
    // gleich behandelt, schickt bei jedem Ausfall alle zur Anmeldung.
    zeichneWaechter(unbekannt());
    await waitFor(() => expect(screen.queryByTestId("planung-sitzung-unbekannt")).not.toBeNull());
    expect(screen.queryByTestId("planung-unauthenticated")).toBeNull();
  });

  it("verlangt bei mehreren Organisationen eine sichtbare Auswahl", async () => {
    zeichneWaechter(sitzungMit([orgMit(["planning.read"]), orgMit(["planning.read"], ORG_B)]));
    await waitFor(() => expect(screen.queryByTestId("planung-org-erforderlich")).not.toBeNull());
    expect(screen.queryByTestId("planung-inhalt")).toBeNull();
  });

  it("zeigt denselben Zustand bei GAR KEINER Mitgliedschaft", async () => {
    // Der Fall des Reisenden B: angemeldet, aber nirgends Mitglied. Bis
    // EYT-107 behauptete der Banner hier „Du gehörst mehreren Organisationen
    // an" — fuer B nachweislich falsch, aufgedeckt von der Browserreise.
    zeichneWaechter(sitzungMit([]));
    await waitFor(() => expect(screen.queryByTestId("planung-org-erforderlich")).not.toBeNull());
    expect(screen.queryByTestId("planung-inhalt")).toBeNull();
    expect(screen.queryByTestId("planung-forbidden")).toBeNull();
  });

  it("verraet nicht, OB die Person irgendwo Mitglied ist", async () => {
    // Ein Existenzleck waere, „du gehoerst keiner an" von „waehle aus" zu
    // unterscheiden. Beide Lagen zeigen denselben Text — dieselbe Regel, aus
    // der die API ORG_NOT_A_MEMBER und PERMISSION_MISSING gleich beantwortet.
    zeichneWaechter(sitzungMit([]));
    await waitFor(() => expect(screen.queryByTestId("planung-org-erforderlich")).not.toBeNull());
    const ohne = screen.getByTestId("planung-org-erforderlich").textContent ?? "";
    cleanup();

    zeichneWaechter(sitzungMit([orgMit(["planning.read"]), orgMit(["planning.read"], ORG_B)]));
    await waitFor(() => expect(screen.queryByTestId("planung-org-erforderlich")).not.toBeNull());
    const mehrere = screen.getByTestId("planung-org-erforderlich").textContent ?? "";

    expect(ohne).toBe(mehrere);
  });

  it("reicht planning.publish als false durch, wenn die Rolle es nicht traegt", async () => {
    const { gesehen } = zeichneWaechter(sitzungMit([orgMit(["planning.read", "planning.write"])]));
    await waitFor(() => expect(screen.queryByTestId("planung-inhalt")).not.toBeNull());
    expect(gesehen).toContain(false);
    expect(gesehen).not.toContain(true);
  });

  it("reicht planning.publish als true durch, wenn die Rolle es traegt", async () => {
    // Gegenprobe: ohne sie waere die Zeile darueber auch dann gruen, wenn
    // immer `false` durchgereicht wuerde.
    const { gesehen } = zeichneWaechter(
      sitzungMit([orgMit(["planning.read", "planning.publish"])]),
    );
    await waitFor(() => expect(screen.queryByTestId("planung-inhalt")).not.toBeNull());
    expect(gesehen).toContain(true);
  });

  // Dieselbe Doppelprobe fuer `costs.read` (EYT-140, Plan-Meilenstein `M8`). Sie
  // fehlte, seit der Waechter `darfKostenLesen` ausliefert: der Kostenuebergang
  // haengt daran, aber KEIN Test sagte, dass der Waechter die Frage ueberhaupt
  // beantwortet — geschweige denn in beide Richtungen.
  it("reicht costs.read als false durch, wenn die Rolle es nicht traegt", async () => {
    const { kostenGesehen } = zeichneWaechter(
      sitzungMit([orgMit(["planning.read", "planning.write"])]),
    );
    await waitFor(() => expect(screen.queryByTestId("planung-inhalt")).not.toBeNull());
    expect(kostenGesehen).toContain(false);
    expect(kostenGesehen).not.toContain(true);
  });

  it("reicht costs.read als true durch, wenn die Rolle es traegt", async () => {
    // Gegenprobe: ohne sie waere die Zeile darueber auch dann gruen, wenn der
    // Waechter fuer Kosten konstant `false` liefert — und der Uebergang
    // erschiene nie, ohne dass ein Test es meldet.
    const { kostenGesehen } = zeichneWaechter(
      sitzungMit([orgMit(["planning.read", "costs.read"])]),
    );
    await waitFor(() => expect(screen.queryByTestId("planung-inhalt")).not.toBeNull());
    expect(kostenGesehen).toContain(true);
  });
});

describe("AppShell — Navigationsfilter", () => {
  function zeichneShell(gateway: AuthGateway): void {
    render(
      <AuthGatewayProvider gateway={gateway}>
        <SessionProvider>
          <AppShell>
            <p>Inhalt</p>
          </AppShell>
        </SessionProvider>
      </AuthGatewayProvider>,
    );
  }

  it("zeigt den Planungspunkt mit planning.read", async () => {
    zeichneShell(sitzungMit([orgMit(["planning.read"])]));
    await waitFor(() => expect(screen.queryByText("Planung")).not.toBeNull());
  });

  it("zeigt ihn NICHT ohne planning.read", async () => {
    zeichneShell(sitzungMit([orgMit(["costs.read"])]));
    // „Start" belegt, dass die Navigation ueberhaupt gerendert wurde — sonst
    // waere die Abwesenheit von „Planung" nichtssagend.
    await waitFor(() => expect(screen.queryByText("Start")).not.toBeNull());
    expect(screen.queryByText("Planung")).toBeNull();
  });

  it("zeigt ihn einer abgemeldeten Person nicht", async () => {
    zeichneShell(abgemeldet());
    await waitFor(() => expect(screen.queryByText("Start")).not.toBeNull());
    expect(screen.queryByText("Planung")).toBeNull();
  });
});
