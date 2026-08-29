/**
 * Serverseitige Kosten-Ladegrenze der beiden Kostenseiten (EYT-113 Inkrement 2).
 *
 * ## Was hier gemessen wird
 *
 * `/kosten` und `/kosten/stundensaetze` fragen VOR jedem Kosteninhalt
 * `leseKostenFreigabe()` (`lib/kosten-freigabe.ts`) und rendern in den vier
 * Verweigerungszustaenden eine reine Server-Flaeche — OHNE die
 * Kosten-Client-Komponenten. Der Client-Waechter `KostenZugang` ist dann kein
 * zweiter Riegel, sondern gar nicht erst montiert: was nicht montiert ist,
 * laedt keinen Chunk und traegt keine Props ins HTML
 * (`rsc-flight-payload-contains-client-props`).
 *
 * ## RED-Beweis vor der Implementierung (TDD)
 *
 * Diese Datei entsteht BEVOR die Seiten die Freigabe rufen. Heute rendern
 * beide Seiten `KostenZugang` bedingungslos; jede Verweigerungs-Zusicherung
 * unten ist damit per Konstruktion rot (fehlende Server-Testid bzw. ein
 * sichtbares `kosten-laedt`). Gruen wird sie erst durch die Ladegrenze selbst.
 *
 * ## Gegenmutationen (je Zusicherung im Test benannt)
 *
 * Nach der Implementierung macht z. B. „das Gate aus `stundensaetze/page.tsx`
 * entfernen" die Stundensaetze-Haelfte rot, „`unbekannt` wie `abgemeldet`
 * behandeln" den Unterscheidungsfall, „Any-Org-Pruefung statt ausgewaehlter
 * Organisation" den `verboten`-Fall (die Flaeche naennte die falsche bzw.
 * keine Organisation).
 *
 * ## Warum die Freigabe als GANZES Modul gemockt ist
 *
 * `leseKostenFreigabe` liest `next/headers` — das gibt es in jsdom nicht.
 * Die Entscheidungsfunktion `kostenFreigabe` selbst ist in
 * `kosten-freigabe.test.ts` erschoepfend gemessen; HIER geht es darum, was die
 * Seiten aus jedem Ergebnis MACHEN.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import KostenPage from "../app/(werkbank)/kosten/page";
import StundensaetzePage from "../app/(werkbank)/kosten/stundensaetze/page";
import { AuthGatewayProvider } from "../lib/auth-gateway-provider";
import { leseKostenFreigabe, type KostenFreigabe } from "../lib/kosten-freigabe";
import { SessionProvider } from "../lib/session-provider";
import type {
  AuthGateway,
  GatewayResult,
  SessionDto,
  SessionOrganisation,
} from "@easytree/contracts";

vi.mock("next/navigation", async () => {
  const modul = await import("./helpers/navigation-attrappe");
  return modul.nextNavigationModul();
});

// Das GANZE Modul, nicht nur die Funktion: die Seiten importieren es als
// `../../../lib/kosten-freigabe` (bzw. eine Ebene tiefer) — vitest loest beide
// Pfade auf dieselbe Datei auf, der Mock gilt fuer alle Importeure.
vi.mock("../lib/kosten-freigabe", () => ({ leseKostenFreigabe: vi.fn() }));

const ORG_OHNE_RECHT: SessionOrganisation = {
  id: "00000000-0000-4000-8000-0000000000c1",
  name: "Org Ohne Recht",
  role: "member",
  permissions: [],
};

const ORG_MIT_RECHT: SessionOrganisation = {
  id: "00000000-0000-4000-8000-0000000000c2",
  name: "Org Mit Recht",
  role: "owner",
  permissions: ["costs.read"],
};

/**
 * Eine Sitzung, die NIE antwortet.
 *
 * In den Verweigerungsfaellen ist das die schaerfste Attrappe: bliebe der
 * Client-Waechter faelschlich montiert, zeigt er deterministisch sein
 * `kosten-laedt` — und genau das faellt unten auf. Eine AUFGELOESTE Sitzung
 * koennte dagegen selbst eine der vier Testids rendern (`KostenZugang` traegt
 * `kosten-unauthenticated` und `kosten-forbidden` woertlich) und wuerde die
 * Server-Zusicherung gruen faerben, ohne dass ein Server-Gate existiert.
 */
const offeneSitzung = (): AuthGateway =>
  ({
    session: (): Promise<GatewayResult<SessionDto>> => new Promise(() => undefined),
    login: vi.fn(),
    logout: vi.fn(),
  }) as unknown as AuthGateway;

/** Angemeldet, eine Organisation, `costs.read` — der gewaehrte Client-Pfad. */
const angemeldetMitKostenrecht = (): AuthGateway =>
  ({
    session: (): Promise<GatewayResult<SessionDto>> =>
      Promise.resolve({
        ok: true,
        value: {
          userId: "00000000-0000-4000-8000-00000000aaa2",
          organisations: [ORG_MIT_RECHT],
        },
      }),
    login: vi.fn(),
    logout: vi.fn(),
  }) as unknown as AuthGateway;

type Params = Record<string, string | string[] | undefined>;

async function seiteRendern(
  route: "/kosten" | "/kosten/stundensaetze",
  freigabe: KostenFreigabe,
  optionen: { params?: Params; auth?: AuthGateway } = {},
): Promise<void> {
  vi.mocked(leseKostenFreigabe).mockResolvedValue(freigabe);
  // `await` vertraegt beide Formen: heute ist die Stundensaetze-Seite synchron,
  // mit der Ladegrenze wird sie async — der Test bleibt dabei unveraendert.
  const element =
    route === "/kosten"
      ? await KostenPage({ searchParams: Promise.resolve(optionen.params ?? {}) })
      : await StundensaetzePage();
  render(
    <AuthGatewayProvider gateway={optionen.auth ?? offeneSitzung()}>
      <SessionProvider>{element}</SessionProvider>
    </AuthGatewayProvider>,
  );
}

beforeEach(() => {
  vi.mocked(leseKostenFreigabe).mockReset();
});

afterEach(() => {
  cleanup();
});

const VERWEIGERUNGEN: readonly (readonly [string, KostenFreigabe])[] = [
  ["unbekannt", { art: "unbekannt" }],
  ["abgemeldet", { art: "abgemeldet" }],
  ["keine-auswahl", { art: "keine-auswahl" }],
  ["verboten", { art: "verboten", organisation: ORG_OHNE_RECHT }],
];

describe.each(["/kosten", "/kosten/stundensaetze"] as const)(
  "%s — serverseitige Ladegrenze (EYT-113 Inkrement 2)",
  (route) => {
    it("fragt die Freigabe genau einmal", async () => {
      // Gegenmutation: den `leseKostenFreigabe()`-Aufruf aus der Seite
      // entfernen — heute ist genau das der Zustand, der Zaehler steht auf 0.
      await seiteRendern(route, { art: "gewaehrt", organisation: ORG_MIT_RECHT });
      expect(vi.mocked(leseKostenFreigabe)).toHaveBeenCalledTimes(1);
    });

    it("unbekannt: eigene Flaeche, NICHT der Abgemeldet-Banner", async () => {
      await seiteRendern(route, { art: "unbekannt" });
      // Gegenmutation: `unbekannt` im Server-Gate wie `abgemeldet` behandeln —
      // dann fehlt die erste Testid und die zweite erscheint.
      expect(screen.getByTestId("kosten-sitzung-unbekannt")).toBeTruthy();
      expect(screen.queryByTestId("kosten-unauthenticated")).toBeNull();
    });

    it("abgemeldet: Banner mit dem Weg zur Anmeldung", async () => {
      await seiteRendern(route, { art: "abgemeldet" });
      const flaeche = screen.getByTestId("kosten-unauthenticated");
      // Gegenmutation: den Link entfernen oder auf `/` zeigen lassen.
      const link = within(flaeche).getByRole("link");
      expect(link.getAttribute("href")).toBe("/anmelden");
    });

    it("keine-auswahl: fordert die Organisationswahl", async () => {
      // Gegenmutation: bei fehlender Auswahl still die erste Organisation
      // nehmen — dann rendert der gewaehrte Zweig statt dieser Flaeche.
      await seiteRendern(route, { art: "keine-auswahl" });
      expect(screen.getByTestId("kosten-org-auswahl")).toBeTruthy();
    });

    it("verboten: nennt die AUSGEWAEHLTE Organisation beim Namen", async () => {
      await seiteRendern(route, { art: "verboten", organisation: ORG_OHNE_RECHT });
      const flaeche = screen.getByTestId("kosten-forbidden");
      // Gegenmutation: die Organisation aus der Beschreibung streichen — die
      // Planerin wuesste dann nicht, WO ihr das Recht fehlt.
      expect(flaeche.textContent).toContain("Org Ohne Recht");
    });

    it.each(VERWEIGERUNGEN)(
      "%s: der Client-Waechter wird gar nicht erst montiert",
      async (_name, freigabe) => {
        await seiteRendern(route, freigabe);
        // Der Kern der Ladegrenze — und der heutige rote Zustand: beide Seiten
        // rendern `KostenZugang` bedingungslos, sein `kosten-laedt` steht im
        // Baum. Gegenmutation nach der Implementierung: das Gate aus
        // `stundensaetze/page.tsx` (bzw. `kosten/page.tsx`) entfernen.
        expect(screen.queryByTestId("kosten-laedt")).toBeNull();
        expect(screen.queryByTestId("saetze-laedt")).toBeNull();
        expect(document.querySelector(".eyt-kosten-ansicht")).toBeNull();
        // Seit D4 Stufe 3 noch eine Stufe strenger: auch der kostenfreie
        // LADER (`KostenFlaeche`/`StundensaetzeFlaeche`) darf im
        // Verweigerungszustand nicht montiert sein — sonst forderte sein
        // `next/dynamic` die Kosten-Chunks trotz Server-Gate an.
        // Gegenmutation: den Verweigerungszweig einer Seite auf die Flaeche
        // umstellen — dann steht deren Lade-Testid im Baum.
        expect(screen.queryByTestId("kosten-flaeche-laedt")).toBeNull();
        expect(screen.queryByTestId("saetze-flaeche-laedt")).toBeNull();
      },
    );
  },
);

describe("/kosten — der gewaehrte Zweig bleibt der bestehende Client-Pfad", () => {
  it("rendert keine Verweigerungsflaeche, sondern den Client-Waechter", async () => {
    await seiteRendern("/kosten", { art: "gewaehrt", organisation: ORG_MIT_RECHT });
    // Seit D4 Stufe 3 kommt `KostenZugang` per `next/dynamic` aus einem
    // Lazy-Chunk: unmittelbar nach dem Rendern steht erst das
    // `kosten-flaeche-laedt` des Laders im Baum, `findByTestId` wartet die
    // Aufloesung ab. Die Sitzung der Attrappe antwortet dann NIE — der
    // Client-Waechter bleibt in seinem Ladezustand stehen. Gegenmutation: den
    // gewaehrten Zweig ebenfalls auf eine Server-Flaeche umstellen und
    // `KostenZugang` ganz entfernen.
    expect(await screen.findByTestId("kosten-laedt")).toBeTruthy();
    for (const testid of [
      "kosten-forbidden",
      "kosten-unauthenticated",
      "kosten-org-auswahl",
      "kosten-sitzung-unbekannt",
    ]) {
      expect(screen.queryByTestId(testid)).toBeNull();
    }
  });

  it("lehnt einen kaputten snapshot-Parameter AUCH im gewaehrten Zweig sichtbar ab", async () => {
    // Gegenmutation: die Parameterpruefung beim Einbau der Ladegrenze aus dem
    // gewaehrten Zweig fallen lassen — dann fehlt `kosten-parameterfehler`.
    await seiteRendern(
      "/kosten",
      { art: "gewaehrt", organisation: ORG_MIT_RECHT },
      { params: { snapshot: "kaputt" }, auth: angemeldetMitKostenrecht() },
    );
    expect(await screen.findByTestId("kosten-parameterfehler")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Zur Stundensatzverwaltung" })).toBeTruthy();
  });
});
