/**
 * EYT-147 PO-Review-Reparatur — Oberflaechen-Guards der Dispositionswerkbank.
 *
 * ## R1 — technische Identifikatoren sind kein Planertext
 *
 * Die Werkbank zeigte eine serverseitige Planversions-Id als sichtbaren Satz
 * („Zuletzt veroeffentlicht: <UUID>") und die Publish-Bestaetigung nannte Id
 * UND rohen ISO-Zeitstempel im Fliesstext. Beides ist Serverwahrheit, aber
 * keine Planerinformation. Die Guards hier verlangen beides zugleich:
 *
 * - KEINE rohe UUID und KEIN roher ISO-Instant im Text der Werkbank;
 * - DIESELBEN echten Server-Ids weiterhin im vorgesehenen `data-*`-Seam,
 *   an dem `read-through.spec.ts`, `auth-journey` und die Unit-Suiten haengen.
 *
 * Der Textvergleich laeuft ueber `textContent` des gesamten Baums — bewusst
 * einschliesslich visuell versteckter Texte: auch ein `VisuallyHidden` mit
 * einer UUID waere fuer Screenreader-Nutzer eine zugemutete Id.
 *
 * ## R2 — genau EINE Statusmarke fuer den Planstand
 *
 * Vor der Reparatur trugen `planungsfenster-stand-abzeichen` (Wochenansicht)
 * und `planung-stand-marke` (Publish-Baustein) beide ein sichtbares
 * `StatusBadge` mit derselben Aussage („Entwurf" neben „Entwurf"). Der Guard
 * zaehlt die `StatusBadge`-Elemente der gerenderten Werkbank und verlangt
 * genau eines — das der Wochenansicht. Die Marke des Publish-Bausteins bleibt
 * als unsichtbarer Seam (Testanker, Screenreader, `data-stand`) erhalten.
 *
 * ## Gegenmutationen (ausgefuehrt, gemessen, zurueckgenommen — siehe PR)
 *
 * 1. `planning-window-view.tsx`: die sichtbare Zeile
 *    `Zuletzt veroeffentlicht: ${fenster.publishedVersionId}` wiederherstellen
 *    → „nennt im Text keine rohe UUID" rot.
 * 2. `planning-publish-action.tsx`: in `planung-stand-marke` wieder ein
 *    `StatusBadge` rendern → „traegt genau eine Statusmarke" rot.
 */
import type { GatewayResult, PlanningGateway, PlanningWindow } from "@easytree/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanningWindowView } from "../components/planning-window-view";
import { PlanningGatewayProvider } from "../lib/planning-gateway-provider";
import {
  EINSATZ_VOM_SERVER,
  ENTWURF_VERSION,
  VEROEFFENTLICHTE_VERSION,
  fensterMitEntwurf,
  fensterVeroeffentlicht,
} from "./helpers/werkbank-daten";

const WOCHE = "2026-W34";

/** RFC-4122-Form, unabhaengig von Gross-/Kleinschreibung. */
const UUID_MUSTER = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Roher ISO-Instant (`2026-08-19T12:00…`) — als Text niemals Planer-UI. */
const ISO_INSTANT_MUSTER = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Entwurf UEBER einer veroeffentlichten Version — beide Server-Ids im Spiel. */
function fensterEntwurfUeberVeroeffentlicht(): PlanningWindow {
  return { ...fensterMitEntwurf(WOCHE), publishedVersionId: VEROEFFENTLICHTE_VERSION };
}

function gatewayMit(
  antwort: () => GatewayResult<PlanningWindow>,
  publishPlan?: PlanningGateway["publishPlan"],
): PlanningGateway {
  return {
    getPlanningWindow: () => Promise.resolve(antwort()),
    validateDraft: () => {
      throw new Error("in dieser Suite nicht benutzt");
    },
    createAssignment: () => {
      throw new Error("in dieser Suite nicht benutzt");
    },
    publishPlan:
      publishPlan ??
      (() => {
        throw new Error("in dieser Suite nicht benutzt");
      }),
  };
}

function rendern(gateway: PlanningGateway, darfVeroeffentlichen: boolean): void {
  render(
    <PlanningGatewayProvider gateway={gateway}>
      <PlanningWindowView weekKey={WOCHE} darfVeroeffentlichen={darfVeroeffentlichen} />
    </PlanningGatewayProvider>,
  );
}

afterEach(cleanup);

describe("R1 — kein technischer Identifikator im Text der Werkbank", () => {
  it("nennt im Text keine rohe UUID — die Server-Ids stehen im data-Seam", async () => {
    rendern(
      gatewayMit(() => ({ ok: true, value: fensterEntwurfUeberVeroeffentlicht() })),
      true,
    );
    await screen.findByTestId("planungsfenster-liste");

    // Kein Textknoten des Baums traegt eine UUID — sichtbar oder versteckt.
    expect(document.body.textContent ?? "").not.toMatch(UUID_MUSTER);

    // Und zwar NICHT, weil die Ids fehlen: dieselben echten Server-Ids
    // stehen weiterhin exakt an ihren technischen Seams.
    const version = screen.getByTestId("planungsfenster-version");
    expect(version.getAttribute("data-published-version-id")).toBe(VEROEFFENTLICHTE_VERSION);
    expect(version.getAttribute("data-source-version-id")).toBe(ENTWURF_VERSION);
    expect(document.querySelector(`[data-assignment-id="${EINSATZ_VOM_SERVER}"]`)).not.toBeNull();
  });

  it("nennt im Text keinen rohen ISO-Zeitstempel", async () => {
    rendern(
      gatewayMit(() => ({ ok: true, value: fensterEntwurfUeberVeroeffentlicht() })),
      true,
    );
    await screen.findByTestId("planungsfenster-liste");
    expect(document.body.textContent ?? "").toMatch(/\d{2}:\d{2}/); // Wanduhrzeit ja …
    expect(document.body.textContent ?? "").not.toMatch(ISO_INSTANT_MUSTER); // … Instant nein.
  });

  it("haelt auch die Publish-Bestaetigung frei von UUID und Instant — beide bleiben als data-Attribute", async () => {
    const VERSION_ID = ENTWURF_VERSION;
    const PUBLISHED_AT = "2026-08-19T12:34:56.000Z";
    let veroeffentlicht = false;
    const publishPlan = vi.fn(() => {
      veroeffentlicht = true;
      return Promise.resolve({
        ok: true as const,
        value: {
          versionId: VERSION_ID,
          weekKey: WOCHE,
          publishedAtUtc: PUBLISHED_AT,
          assignmentIds: [EINSATZ_VOM_SERVER],
        },
      });
    });
    rendern(
      gatewayMit(
        () => ({
          ok: true,
          value: veroeffentlicht ? fensterVeroeffentlicht(WOCHE) : fensterMitEntwurf(WOCHE),
        }),
        publishPlan,
      ),
      true,
    );

    await userEvent.click(await screen.findByTestId("planung-veroeffentlichen"));
    const erfolg = await screen.findByTestId("planung-publish-erfolg");

    expect(erfolg.textContent ?? "").not.toMatch(UUID_MUSTER);
    expect(erfolg.textContent ?? "").not.toMatch(ISO_INSTANT_MUSTER);
    // Serverwahrheit unveraendert am Seam: exakt die Id und der Instant der
    // Serverantwort, nichts Erfundenes.
    expect(erfolg.getAttribute("data-published-version-id")).toBe(VERSION_ID);
    expect(erfolg.getAttribute("data-published-at-utc")).toBe(PUBLISHED_AT);
    // Der ganze Baum bleibt sauber, auch mit sichtbarer Erfolgsleiste.
    expect(document.body.textContent ?? "").not.toMatch(UUID_MUSTER);
  });
});

describe("R2 — genau eine Statusmarke fuer den Planstand", () => {
  it("traegt im veroeffentlichbaren Entwurf genau EIN StatusBadge — das der Wochenansicht", async () => {
    rendern(
      gatewayMit(() => ({ ok: true, value: fensterMitEntwurf(WOCHE) })),
      true,
    );
    await screen.findByTestId("planungsfenster-liste");

    const marken = document.querySelectorAll(".eyt-status-badge");
    expect(marken).toHaveLength(1);
    expect(marken[0]?.getAttribute("data-testid")).toBe("planungsfenster-stand-abzeichen");

    // Der Seam des Publish-Bausteins bleibt: Testanker, `data-stand` und
    // Screenreader-Text existieren weiter — nur die zweite SICHTBARE Marke
    // ist weg.
    const seam = screen.getByTestId("planung-stand-marke");
    expect(seam.getAttribute("data-stand")).toBe("draft");
    expect(seam.textContent ?? "").toContain("Entwurf");
  });

  it("traegt im veroeffentlichten Stand genau EIN StatusBadge", async () => {
    rendern(
      gatewayMit(() => ({ ok: true, value: fensterVeroeffentlicht(WOCHE) })),
      false,
    );
    await screen.findByTestId("planungsfenster-liste");

    const marken = document.querySelectorAll(".eyt-status-badge");
    expect(marken).toHaveLength(1);
    expect(marken[0]?.getAttribute("data-testid")).toBe("planungsfenster-stand-abzeichen");
  });
});
