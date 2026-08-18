/**
 * REQ-005 und REQ-006 — Veroeffentlichen und Kostenuebergang (EYT-140,
 * `AC-008` – `AC-011`).
 *
 * ## Kritische semantische Glaettung
 *
 * **Grenze:** `boundary` — Publish ist ein Serverkommando, der Kostenzugang
 * haengt an serverseitig aufgeloesten Rechten.
 *
 * **These (REQ-005):** Der Publish-Command funktioniert. `existing capability`:
 * `planning-publish-action.tsx`, `db-gates` · `[planning-publish]`.
 *
 * **These (REQ-006):** Die Kostengrenze funktioniert. `existing capability`:
 * `kosten-zugang.tsx`, `db-gates` · `[cost-access]`.
 *
 * **Gegenthese:** Beide Tests waeren gruen und der Planerin trotzdem nicht
 * geholfen, wenn die Werkbank nach dem Veroeffentlichen aussaehe wie davor —
 * dann veroeffentlicht sie ein zweites Mal, oder sie glaubt, es habe nicht
 * geklappt. Und die Kostenreise endet, bevor sie beginnt: nach dem Publish
 * fuehrt kein Weg nach `/kosten`, ausser man kennt die Adresse. Genau das ist
 * heute der Zustand — `docs/traceability.md` S6 Tabelle D nennt fuer REQ-006
 * ausdruecklich „den Uebergang aus der Planung heraus bedienbar machen".
 * Schaerfste Fassung: die Ablehnung wird als Erfolg gelesen, weil die
 * Statusmarke schon auf „Veroeffentlicht" steht, waehrend der Server abgelehnt
 * hat.
 *
 * **Schaerfung:** Der Uebergang wird in der PLANUNGSFLAECHE gesucht, nicht nur
 * in der Hauptnavigation. Und der Ablehnungsfall prueft nicht nur, dass eine
 * Fehlermeldung erscheint, sondern zugleich, dass NIRGENDWO ein
 * veroeffentlichter Zustand behauptet wird — Statusmarke, Erfolgsleiste und die
 * Versionszeile werden einzeln geprueft.
 *
 * ## Was hier NICHT geprueft wird
 *
 * Dass der Server die Veroeffentlichung wirklich durchfuehrt, dass die
 * Konfliktregel greift und dass `costs.read` serverseitig durchgesetzt wird.
 * Das beweisen `apps/api/test/planning-conflict.test.ts`,
 * `apps/api/test/costs/cost-access.policy.test.ts` sowie die `db-gates`-Zeilen
 * `[planning-publish]`, `[planning-invariants]` und `[cost-access]`. `AC-011`
 * verlangt zusaetzlich, dass HTML- und RSC-Antwort keine Kostenwerte tragen —
 * das ist eine Server-Aussage und gehoert in `auth-journey`, nicht nach jsdom;
 * siehe Befundliste im Abschlussbericht.
 *
 * ## Gegenmutationen (Phase 1)
 *
 * 1. `apps/web/components/planning-publish-action.tsx:152-153` — `stand` fest
 *    auf `"published"` setzen → „behauptet nach einer Ablehnung keinen
 *    veroeffentlichten Zustand" geht rot.
 * 2. `apps/web/components/planning-publish-action.tsx:260` — `onVeroeffentlicht`
 *    im Erfolgszweig nicht mehr rufen → „zeigt nach dem Veroeffentlichen den
 *    veroeffentlichten Serverstand" geht rot, weil das erneute Lesen ausbleibt.
 * 3. In der Werkbank den Kostenuebergang ohne Rechtepruefung rendern →
 *    „zeigt ohne costs.read keinen Kostenuebergang" geht rot.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigationZuruecksetzen } from "./helpers/navigation-attrappe";
import { antwort, netzLoesen, werkbankRendern, type Netzprotokoll } from "./helpers/werkbank";
import {
  ENTWURF_VERSION,
  EINSATZ_VOM_SERVER,
  VEROEFFENTLICHTE_VERSION,
  fensterMitEntwurf,
  fensterVeroeffentlicht,
  sitzungMit,
} from "./helpers/werkbank-daten";

vi.mock("next/navigation", async () => {
  const modul = await import("./helpers/navigation-attrappe");
  return modul.nextNavigationModul();
});

const MITTWOCH_KW34 = new Date("2026-08-19T12:00:00.000Z");
const PLANUNGSRECHTE = ["planning.read", "planning.write", "planning.publish"];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MITTWOCH_KW34);
  navigationZuruecksetzen();
});

afterEach(() => {
  cleanup();
  netzLoesen();
  vi.useRealTimers();
});

/** Woche mit Entwurf; nach erfolgreichem Publish liefert der Server sie veroeffentlicht. */
function werkbankMitPublish(erfolgreich: boolean, rechte = PLANUNGSRECHTE): Netzprotokoll {
  let veroeffentlicht = false;
  return werkbankRendern({
    sitzung: sitzungMit(rechte),
    fenster: (weekKey) =>
      veroeffentlicht
        ? fensterVeroeffentlicht(weekKey)
        : fensterMitEntwurf(weekKey, [
            {
              id: EINSATZ_VOM_SERVER,
              startUtc: "2026-08-18T06:00:00.000Z",
              endUtc: "2026-08-18T14:00:00.000Z",
            },
          ]),
    veroeffentlichen: (befehl) => {
      if (!erfolgreich) {
        return antwort(409, {
          type: "urn:easytree:planning:blocking-conflict",
          title: "Konflikt",
          status: 409,
          detail: "Der Entwurf enthaelt eine blockierende Ueberschneidung.",
          correlationId: "test",
        });
      }
      veroeffentlicht = true;
      return {
        versionId: VEROEFFENTLICHTE_VERSION,
        weekKey: befehl.weekKey,
        publishedAtUtc: "2026-08-19T12:00:00.000Z",
        assignmentIds: [EINSATZ_VOM_SERVER],
      };
    },
  });
}

describe("REQ-005 / AC-008 — Veroeffentlichen aus der Werkbank heraus", () => {
  it("bietet die Veroeffentlichung im parameterlosen Einstieg an", async () => {
    werkbankMitPublish(true);

    await screen.findByTestId("werkbank-woche-iso");
    expect(await screen.findByTestId("planung-veroeffentlichen")).toBeTruthy();
    // Vorher ist der Stand als Entwurf benannt — Text, nicht nur Farbe.
    expect(screen.getByTestId("planung-stand-marke").textContent ?? "").toContain("Entwurf");
  });

  it("sendet das Publish-Kommando mit der erwarteten Version des SERVERstands", async () => {
    const netz = werkbankMitPublish(true);
    await screen.findByTestId("werkbank-woche-iso");

    await userEvent.click(await screen.findByTestId("planung-veroeffentlichen"));

    await waitFor(() => expect(netz.aufrufeAn("/api/v1/planung/versionen")).toHaveLength(1));
    const kommando = netz.aufrufeAn("/api/v1/planung/versionen")[0]?.koerper as {
      weekKey: string;
      expectedVersionId: string | null;
    };
    expect(kommando.weekKey).toBe("2026-W34");
    expect(kommando.expectedVersionId).toBe(ENTWURF_VERSION);
  });

  it("zeigt nach dem Veroeffentlichen den veroeffentlichten Serverstand, textlich unterscheidbar", async () => {
    werkbankMitPublish(true);
    await screen.findByTestId("werkbank-woche-iso");

    await userEvent.click(await screen.findByTestId("planung-veroeffentlichen"));

    await waitFor(() =>
      expect(screen.getByTestId("planungsfenster-stand").getAttribute("data-stand")).toBe(
        "veroeffentlicht",
      ),
    );
    expect(screen.getByTestId("planung-stand-marke").textContent ?? "").toContain("Veröffentlicht");
    expect(
      screen.getByTestId("planungsfenster-version").getAttribute("data-published-version-id"),
    ).toBe(VEROEFFENTLICHTE_VERSION);
  });
});

describe("REQ-005 / AC-009 — eine Ablehnung sieht nirgends nach Erfolg aus", () => {
  it("behauptet nach einer Ablehnung keinen veroeffentlichten Zustand", async () => {
    werkbankMitPublish(false);
    await screen.findByTestId("werkbank-woche-iso");

    await userEvent.click(await screen.findByTestId("planung-veroeffentlichen"));

    const fehler = await screen.findByTestId("planung-publish-fehler");
    expect(fehler.getAttribute("data-problem")).toBe("blocking-conflict");
    expect(screen.queryByTestId("planung-publish-erfolg")).toBeNull();
    expect(screen.getByTestId("planung-stand-marke").textContent ?? "").toContain("Entwurf");
    expect(screen.getByTestId("planungsfenster-stand").getAttribute("data-stand")).toBe("entwurf");
    expect(
      screen.getByTestId("planungsfenster-version").getAttribute("data-published-version-id"),
    ).toBe("");
  });
});

describe("REQ-006 / AC-010, AC-011 — der Kostenuebergang haengt am Recht", () => {
  it("bietet mit costs.read einen Uebergang aus der Planungsflaeche nach /kosten", async () => {
    werkbankMitPublish(true, [...PLANUNGSRECHTE, "costs.read"]);
    await screen.findByTestId("werkbank-woche-iso");

    await userEvent.click(await screen.findByTestId("planung-veroeffentlichen"));
    await waitFor(() =>
      expect(screen.getByTestId("planungsfenster-stand").getAttribute("data-stand")).toBe(
        "veroeffentlicht",
      ),
    );

    const uebergang = await screen.findByTestId("werkbank-kostenuebergang");
    expect(uebergang.getAttribute("href")?.startsWith("/kosten")).toBe(true);
    // Und die Hauptnavigation fuehrt den Bereich ebenfalls — beides zusammen
    // ist der „verstaendliche Uebergang" aus AC-010.
    expect(screen.getByRole("link", { name: "Kosten" })).toBeTruthy();
  });

  it("zeigt ohne costs.read keinen Kostenuebergang, keine Betraege und ruft keine Kostenroute", async () => {
    const netz = werkbankMitPublish(true, PLANUNGSRECHTE);
    await screen.findByTestId("werkbank-woche-iso");

    await userEvent.click(await screen.findByTestId("planung-veroeffentlichen"));
    await waitFor(() =>
      expect(screen.getByTestId("planungsfenster-stand").getAttribute("data-stand")).toBe(
        "veroeffentlicht",
      ),
    );

    expect(screen.queryByTestId("werkbank-kostenuebergang")).toBeNull();
    expect(screen.queryByRole("link", { name: "Kosten" })).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("€");
    expect(netz.aufrufe.filter((a) => a.pfad.startsWith("/api/v1/kosten"))).toEqual([]);
  });
});
