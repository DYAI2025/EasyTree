/**
 * Auswahl-Meldung des SessionProvider an die Kompositionswurzel (EYT-113
 * Inkrement 2).
 *
 * Der Provider meldet die ausgewaehlte Organisation ueber
 * `onOrganisationChange` nach oben; die Kompositionswurzel schreibt daraus
 * das Selector-Cookie fuer das Server-Gate. Zwei Eigenschaften haengen daran:
 *
 *  1. Waehrend die Sitzung ungeklaert ist ("laedt"/"fehler"), wird NICHT
 *     gemeldet — ein transienter `null` wuerde das Auswahl-Cookie bei jedem
 *     Seitenaufbau loeschen.
 *  2. `initialeOrganisationId` (das beim Mount gelesene Cookie) stellt die
 *     Auswahl wieder her — aber nur, wenn die Id in der real verifizierten
 *     Session steht; eine fremde Id faellt ersatzlos.
 *
 * Attrappen-Muster wie `planung-page.test.tsx`: das AuthGateway liefert ein
 * steuerbares `session()`-Versprechen, damit der Schwebezustand messbar ist.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthGatewayProvider } from "../lib/auth-gateway-provider";
import { SessionProvider, useSession } from "../lib/session-provider";
import type {
  AuthGateway,
  GatewayResult,
  SessionDto,
  SessionOrganisation,
} from "@easytree/contracts";

const ORG_ALPHA: SessionOrganisation = {
  id: "00000000-0000-4000-8000-0000000000d1",
  name: "Alpha",
  role: "owner",
  permissions: ["costs.read"],
};

const ORG_BETA: SessionOrganisation = {
  id: "00000000-0000-4000-8000-0000000000d2",
  name: "Beta",
  role: "member",
  permissions: [],
};

const FREMDE_ID = "00000000-0000-4000-8000-00000000ffff";

/** Steuerbares Gateway: `session()` schwebt, bis der Test aufloest. */
function steuerbaresGateway(): {
  gateway: AuthGateway;
  aufloesen: (ergebnis: GatewayResult<SessionDto>) => void;
} {
  let aufloesen!: (ergebnis: GatewayResult<SessionDto>) => void;
  const versprechen = new Promise<GatewayResult<SessionDto>>((resolve) => {
    aufloesen = resolve;
  });
  const gateway = {
    session: (): Promise<GatewayResult<SessionDto>> => versprechen,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  } as unknown as AuthGateway;
  return { gateway, aufloesen };
}

const sitzungMit = (...orgs: SessionOrganisation[]): GatewayResult<SessionDto> => ({
  ok: true,
  value: { userId: "00000000-0000-4000-8000-00000000aaa3", organisations: orgs },
});

/** Sichtbarer Abmeldeknopf — der Test drueckt, was die Kopfleiste drueckt. */
function AbmeldeKnopf() {
  const { abmelden } = useSession();
  return (
    <button type="button" onClick={() => void abmelden()}>
      Abmelden
    </button>
  );
}

function providerRendern(optionen: {
  gateway: AuthGateway;
  gemeldet: (id: string | null) => void;
  initialeOrganisationId?: string | null;
}): void {
  render(
    <AuthGatewayProvider gateway={optionen.gateway}>
      <SessionProvider
        onOrganisationChange={optionen.gemeldet}
        initialeOrganisationId={optionen.initialeOrganisationId ?? null}
      >
        <AbmeldeKnopf />
      </SessionProvider>
    </AuthGatewayProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("SessionProvider — Meldung der Organisationsauswahl (EYT-113 Inkrement 2)", () => {
  it("meldet NICHTS, solange die Sitzung laedt", () => {
    // Gegenmutation: den laedt/fehler-Guard aus dem Melde-Effekt entfernen —
    // dann feuert der Effekt beim Mount mit `null` und dieser Fall wird rot.
    const gemeldet = vi.fn();
    const { gateway } = steuerbaresGateway();
    providerRendern({ gateway, gemeldet });
    expect(gemeldet).not.toHaveBeenCalled();
  });

  it("meldet die einzige Organisation genau einmal, sobald die Sitzung steht", async () => {
    // Gegenmutation: die Meldung an `sitzung` statt an `organisation` haengen
    // und doppelt feuern — der Einmal-Zaehler unten wird rot.
    const gemeldet = vi.fn();
    const { gateway, aufloesen } = steuerbaresGateway();
    providerRendern({ gateway, gemeldet });
    aufloesen(sitzungMit(ORG_ALPHA));
    await waitFor(() => expect(gemeldet).toHaveBeenCalledWith(ORG_ALPHA.id));
    expect(gemeldet.mock.calls.filter(([id]) => id === ORG_ALPHA.id)).toHaveLength(1);
  });

  it("stellt eine gemerkte Auswahl aus initialeOrganisationId wieder her", async () => {
    // Gegenmutation: `initialeOrganisationId` ignorieren (useState(null)) —
    // bei zwei Organisationen bliebe die Auswahl leer, gemeldet wuerde null.
    const gemeldet = vi.fn();
    const { gateway, aufloesen } = steuerbaresGateway();
    providerRendern({ gateway, gemeldet, initialeOrganisationId: ORG_BETA.id });
    aufloesen(sitzungMit(ORG_ALPHA, ORG_BETA));
    await waitFor(() => expect(gemeldet).toHaveBeenCalledWith(ORG_BETA.id));
  });

  it("verwirft eine fremde initialeOrganisationId — gemeldet wird null", async () => {
    // Gegenmutation: die gemerkte Id UNGEPRUEFT als Organisation melden —
    // dann kaeme die fremde Id oben an statt null.
    const gemeldet = vi.fn();
    const { gateway, aufloesen } = steuerbaresGateway();
    providerRendern({ gateway, gemeldet, initialeOrganisationId: FREMDE_ID });
    aufloesen(sitzungMit(ORG_ALPHA, ORG_BETA));
    await waitFor(() => expect(gemeldet).toHaveBeenCalledWith(null));
    expect(gemeldet).not.toHaveBeenCalledWith(FREMDE_ID);
  });

  it("meldet null nach dem Abmelden", async () => {
    // Gegenmutation: den abgemeldet-Zustand mit in den Melde-Guard nehmen —
    // dann bliebe nach dem Abmelden die alte Id als letzte Meldung stehen.
    const gemeldet = vi.fn();
    const { gateway, aufloesen } = steuerbaresGateway();
    providerRendern({ gateway, gemeldet });
    aufloesen(sitzungMit(ORG_ALPHA));
    await waitFor(() => expect(gemeldet).toHaveBeenCalledWith(ORG_ALPHA.id));
    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    await waitFor(() => expect(gemeldet).toHaveBeenLastCalledWith(null));
  });
});
