import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpAuthGateway, type CostSnapshot, type CostsGateway } from "@easytree/contracts";

import RootLayout from "../app/layout";
import HomePage from "../app/page";
import { AppShell } from "../components/app-shell";
import { KostenAnsicht } from "../components/kosten-ansicht";
import { createApiClient } from "../lib/api-client";
import { ApiClientProvider } from "../lib/api-client-provider";
import { AuthGatewayProvider } from "../lib/auth-gateway-provider";
import { CostsGatewayProvider } from "../lib/costs-gateway-provider";
import { SessionProvider } from "../lib/session-provider";

// Die Shell ist seit EYT-106 eine Client-Komponente mit Router-Bezug;
// jsdom hat keinen App-Router, also liefern die Hooks feste Werte.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

/** Shell samt Startseite, mit Test-Client (kein echtes Netzwerk). */
function renderShell() {
  const client = createApiClient(
    "http://api.test",
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok" }),
      }) as unknown as Response,
  );
  // Sitzung: der Server meldet "nicht angemeldet" — die Shell zeigt dann den
  // Anmelden-Link; genau dieser Zustand wird auf Barrierefreiheit geprueft.
  const auth = new HttpAuthGateway("http://api.test/api/v1", {
    fetchImpl: async () =>
      ({
        ok: false,
        status: 401,
        json: async () => ({}),
      }) as unknown as Response,
  });
  return render(
    <ApiClientProvider client={client}>
      <AuthGatewayProvider gateway={auth}>
        <SessionProvider>
          <AppShell>
            <HomePage />
          </AppShell>
        </SessionProvider>
      </AuthGatewayProvider>
    </ApiClientProvider>,
  );
}

describe("Accessibility-Baseline der Shell (EYT-41)", () => {
  it("has zero axe violations (WCAG A/AA)", async () => {
    const { container } = renderShell();
    const results = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: {
        // Kontrastberechnung benötigt echtes Rendering/Canvas — in jsdom
        // nicht verfügbar; Kontrast ist Teil der manuellen Checkliste
        // (docs/runbooks/a11y-checklist.md).
        "color-contrast": { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });

  it("renders a skip link that is the first tab target", async () => {
    const { getByRole } = renderShell();
    const skipLink = getByRole("link", { name: /zum hauptinhalt springen/i });
    expect(skipLink.getAttribute("href")).toBe("#hauptinhalt");

    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(skipLink);
  });

  it("exposes a main landmark that the skip link targets", () => {
    const { getByRole } = renderShell();
    const main = getByRole("main");
    expect(main.id).toBe("hauptinhalt");
  });

  it("sets html lang='de' in the root layout", () => {
    const element = RootLayout({ children: null });
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe("html");
    expect((element.props as { lang?: string }).lang).toBe("de");
  });
});

/**
 * EYT-80 — die Shell komponiert den geteilten Rahmen, ohne Politik abzugeben.
 *
 * Diese Zusicherungen sind der Gegenpol zur Extraktion: sie halten fest, dass
 * NACH dem Umbau immer noch `apps/web` entscheidet, wer welche Punkte sieht.
 * Ohne sie waere „AppShell benutzt jetzt @easytree/ui" eine Behauptung ueber
 * den Import und keine ueber das Verhalten.
 *
 * Sie sind bewusst VOR dem Umbau geschrieben und muessen schon auf dem alten
 * Stand gruen sein — eine Charakterisierung, kein roter TDD-Schritt. Das
 * entbindet sie nicht von der Hausregel: jede benannte Gegenmutation steht
 * unten am Fall und ist ausgefuehrt worden.
 *
 * ## Ein dritter Fall stand hier und ist ersatzlos entfallen
 *
 * Er verglich `anker.getAttribute("href")` mit `#${getByRole("main").id}`.
 * Beide Seiten rendert das Primitive aus EINER Variablen (`mainId`) — die
 * Gleichung gilt darum bauartbedingt, und keine Aenderung in `apps/web` kann
 * sie brechen. Auch nicht die naheliegendste: `mainId="inhalt-feld"` an
 * `<UiAppShell>` durchgereicht bewegt Anker UND Landmark gemeinsam. Gemessen
 * 27.08.2026 blieb der Fall dabei gruen, waehrend `:80` (`href ===
 * "#hauptinhalt"`) und `:90` (`main.id === "hauptinhalt"`) beide rot wurden —
 * die zwei Zusicherungen also, die den Wert unabhaengig voneinander auf das
 * Literal festnageln. Dass die Kopplung fuer JEDE id haelt, misst
 * `packages/ui/test/app-shell.test.tsx` am Primitive selbst.
 */
describe("AppShell — Komposition ohne Politikverlust (EYT-80)", () => {
  it("stellt Marke und Navigation weiterhin in die banner-Landmark", () => {
    // Gegenmutation (ausgefuehrt 27.08.2026): in
    // `apps/web/components/app-shell.tsx` das Prop `navigation={…}` samt
    // seinem `<nav aria-label="Hauptnavigation">` streichen. Der Rahmen stellt
    // dann keine Navigation mehr hin, `getByRole("navigation", …)` findet
    // nichts und dieser Fall wird rot.
    const { getByRole } = renderShell();
    const kopf = getByRole("banner");
    expect(kopf.textContent).toContain("easyTree");
    expect(kopf.contains(getByRole("navigation", { name: "Hauptnavigation" }))).toBe(true);
  });

  it("traegt die Fusszeile als contentinfo", () => {
    // Gegenmutation (ausgefuehrt 27.08.2026): das Prop `footer={…}` streichen.
    // `fehlt(footer)` greift dann, das `<footer>`-Element entsteht gar nicht
    // erst — die contentinfo-Landmark fehlt und dieser Fall wird rot. Das ist
    // der Gegenpol zu `packages/ui`, wo dieselbe Abwesenheit die ZUSAGE ist:
    // dort wird geprueft, dass keine LEERE Landmark stehen bleibt, hier, dass
    // `apps/web` die Fusszeile ueberhaupt noch mitgibt.
    const { getByRole } = renderShell();
    expect(getByRole("contentinfo").textContent).toContain("Arboscus Teamplaner");
  });
});

/**
 * Die Kostenansicht ist die erste Ansicht mit ZWEI Datentabellen und einem
 * Formular auf einem Screen (EYT-144). Genau dort entstehen die Verstoesse, die
 * die Shell-Baseline nicht sehen kann: eine Tabelle ohne `caption`, ein
 * `select` ohne verbundenes `label`, eine Spaltenueberschrift ohne `scope`.
 *
 * Geprueft wird der GEFUELLTE Zustand. Ein leerer Zustand ohne Tabelle waere
 * barrierefrei, ohne dass die Tabellen je gemessen wurden.
 */
const A11Y_SNAPSHOT: CostSnapshot = {
  id: "00000000-0000-4000-8000-00000a110001",
  planVersionId: "00000000-0000-4000-8000-00000a110002",
  worksiteId: null,
  weekKey: "2026-W32",
  timeZone: "Europe/Berlin",
  currency: "EUR",
  ruleVersion: "personnel-plan-cost-v1",
  createdAt: "2026-08-05T09:30:00.000Z",
  createdBy: "00000000-0000-4000-8000-00000a110003",
  correlationId: "korrelation-a11y",
  totalMinorUnits: "34000",
  days: [{ localDate: "2026-08-03", amountMinorUnits: "34000" }],
  positions: [
    {
      id: "00000000-0000-4000-8000-00000a110004",
      assignmentId: "00000000-0000-4000-8000-00000a110005",
      worksiteId: "00000000-0000-4000-8000-00000a110006",
      worksiteLabel: "Baustelle Nord",
      employeeId: "00000000-0000-4000-8000-00000a110007",
      employeeLabel: "Bernd Christ",
      localDate: "2026-08-03",
      durationMilliseconds: "28800000",
      rateVersionId: "00000000-0000-4000-8000-00000a110008",
      amountMinorUnits: "34000",
    },
  ],
};

function kostenGateway(): CostsGateway {
  const werfe = () => {
    throw new Error("in der a11y-Pruefung nicht benutzt");
  };
  return {
    listEmployees: werfe,
    rateHistory: werfe,
    createRateVersion: werfe,
    publishedPlanVersions: () =>
      Promise.resolve({
        ok: true,
        value: {
          versions: [
            {
              id: "00000000-0000-4000-8000-00000a110002",
              weekKey: "2026-W32",
              publishedAt: "2026-08-01T07:08:09.010Z",
            },
          ],
        },
      }),
    worksitesForPublishedPlanVersion: () =>
      Promise.resolve({
        ok: true,
        value: {
          worksites: [
            { id: "00000000-0000-4000-8000-00000a110006", label: "Baustelle Nord" },
            { id: "00000000-0000-4000-8000-00000a110009", label: "Baustelle Süd" },
          ],
        },
      }),
    createSnapshot: werfe,
    snapshot: () => Promise.resolve({ ok: true, value: A11Y_SNAPSHOT }),
  };
}

/**
 * Der AUSWAHLPFAD — ohne gespeicherten Snapshot, dafuer mit beiden Selects.
 *
 * Der Fall daneben rendert `snapshotId` und misst damit den Reload-Vertrag: dort
 * erscheint die Auswahl gar nicht. Ein `select` ohne verbundenes `label` waere
 * genau dort unsichtbar geblieben — deshalb ein zweiter, eigener Aufbau
 * (EYT-146).
 */
async function zeigeAuswahl(): Promise<void> {
  render(
    <CostsGatewayProvider gateway={kostenGateway()}>
      <KostenAnsicht snapshotId={null} />
    </CostsGatewayProvider>,
  );
  await userEvent.type(screen.getByLabelText("Von Woche"), "2026-W32");
  await userEvent.type(screen.getByLabelText("Bis Woche"), "2026-W32");
  await userEvent.click(screen.getByRole("button", { name: "Planversionen laden" }));
  await userEvent.selectOptions(await screen.findByLabelText("Veröffentlichte Planversion"), [
    "00000000-0000-4000-8000-00000a110002",
  ]);
  await screen.findByTestId("kosten-baustellen");
}

describe("Accessibility der Kostenansicht (EYT-144)", () => {
  it("has zero axe violations with a stored snapshot on screen", async () => {
    const { container } = render(
      <CostsGatewayProvider gateway={kostenGateway()}>
        <KostenAnsicht snapshotId={A11Y_SNAPSHOT.id} />
      </CostsGatewayProvider>,
    );
    // Erst wenn die Tabellen wirklich da sind — sonst misst axe ein Skelett.
    await screen.findByTestId("kosten-positionen");

    const results = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it("beschriftet beide Wochenfelder und jede Tabellenspalte", async () => {
    render(
      <CostsGatewayProvider gateway={kostenGateway()}>
        <KostenAnsicht snapshotId={A11Y_SNAPSHOT.id} />
      </CostsGatewayProvider>,
    );
    await screen.findByTestId("kosten-positionen");

    // `getByLabelText` findet nur, was ueber `for`/`id` wirklich verbunden ist.
    expect(screen.getByLabelText("Von Woche")).toBeTruthy();
    expect(screen.getByLabelText("Bis Woche")).toBeTruthy();

    for (const testid of ["kosten-tage", "kosten-positionen"]) {
      const tabelle = screen.getByTestId(testid);
      expect(tabelle.querySelector("caption")).toBeTruthy();
      const kopfzellen = [...tabelle.querySelectorAll("thead th")];
      expect(kopfzellen.length).toBeGreaterThan(0);
      expect(kopfzellen.every((zelle) => zelle.getAttribute("scope") === "col")).toBe(true);
    }
  });

  it("has zero axe violations with both selectors on screen (EYT-146)", async () => {
    await zeigeAuswahl();

    // Auf `document.body` und nicht auf einem `container`: `zeigeAuswahl`
    // rendert selbst, und ein zweiter Aufhaenger daneben waere ein leerer Baum,
    // den axe klaglos als fehlerfrei meldete.
    const results = await axe.run(document.body, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it("beschriftet die Baustellenauswahl und nennt 'Alle Baustellen' im Text", async () => {
    await zeigeAuswahl();

    // `getByLabelText` findet nur, was ueber `for`/`id` wirklich verbunden ist.
    const auswahl = screen.getByLabelText("Baustelle");
    expect(auswahl.tagName).toBe("SELECT");
    // Der Zustand „kein Filter" steht als TEXT in einer Option und nicht nur in
    // der Abwesenheit einer Auswahl — vorlesbar, nicht erschlossen.
    expect([...auswahl.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Alle Baustellen",
      "Baustelle Nord",
      "Baustelle Süd",
    ]);
  });
});
