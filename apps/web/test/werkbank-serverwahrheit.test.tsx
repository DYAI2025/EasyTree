/**
 * REQ-003 und REQ-004 — Serverwahrheit in der Werkbank (EYT-140, `AC-005` – `AC-007`).
 *
 * ## Kritische semantische Glaettung
 *
 * **Grenze:** `boundary` — jede Aussage dieser Datei entsteht aus einer Antwort
 * ueber die HTTP-Grenze.
 *
 * **These (REQ-003):** Die Planungsansicht zeigt echte Serverdaten. Das ist
 * `existing capability` — `planning-window-view.tsx`, bewiesen vom CI-Job
 * `read-through` gegen echte API und echtes PostgreSQL.
 *
 * **These (REQ-004):** Das Einsatzformular schreibt ueber den realen
 * autorisierten Pfad. Das ist `partial capability`: was fehlt, ist der Beleg
 * fuer die automatische Rueckbestaetigung des Serverzustands (`AC-007`).
 *
 * **Gegenthese:** Ein Test waere gruen und der Planerin trotzdem nicht geholfen,
 * wenn die Werkbank zwar Serverdaten zeigt, der Schreibvorgang aber an einer
 * ANDEREN Woche haengt als der, die sie gerade ansieht — dann verschwindet ihr
 * Einsatz aus der Anzeige, obwohl er gespeichert wurde. Zweite Fassung: nach dem
 * Speichern zeigt die Liste, was der Client abgeschickt hat, statt was der
 * Server danach fuehrt; eine parallele Aenderung anderer Planerinnen bleibt
 * unsichtbar, und zwei Menschen planen auf verschiedenen Staenden.
 *
 * **Schaerfung:** Der Schreibvorgang laeuft in einer Woche, zu der zuvor
 * NAVIGIERT wurde — nicht in der Einstiegswoche. Und die Rueckbestaetigung wird
 * an einer Zuweisung gemessen, die AUSSCHLIESSLICH das erneute Lesen kennt
 * (`EINSATZ_FREMD`): sie steht in keiner Antwort des eigenen Schreibaufrufs, ist
 * also aus keinem Clientzustand herleitbar. Zeigt die Liste sie, wurde wirklich
 * neu gelesen.
 *
 * ## Was hier NICHT geprueft wird
 *
 * Dass der Server die Zuweisung dauerhaft speichert und die Mandantengrenze
 * haelt. Das beweisen `db-gates` (`[planning-write]`, `[planning-invariants]`)
 * und `read-through`. Hier wird die Client-Haelfte geprueft: dass die Werkbank
 * ausschliesslich den bestaetigten Serverstand anzeigt.
 *
 * ## Gegenmutationen (Phase 1)
 *
 * 1. `apps/web/components/planning-window-view.tsx:205` — `setNachladen((n) => n + 1)`
 *    im Erfolgszweig von `speichern` entfernen → „zeigt nach dem Speichern den
 *    erneut gelesenen Serverstand" geht rot, weil `EINSATZ_FREMD` nie erscheint.
 * 2. In `speichern` (`:188-191`) `weekKey` durch eine Konstante ersetzen →
 *    „schreibt in die Woche, die auf dem Schirm steht" geht rot.
 * 3. `apps/web/components/planning-window-view.tsx:143-147` — bei `!result.ok`
 *    ein leeres Fenster statt des Fehlerzustands setzen → „zeigt einen Ausfall
 *    als Ausfall" geht rot.
 *
 * Alle drei sind heute nicht ausfuehrbar, weil der parameterlose Einstieg fehlt
 * und die Tests schon davor rot sind.
 */
import { IDEMPOTENCY_HEADER, type CreateAssignmentCommand } from "@easytree/contracts";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigationZuruecksetzen } from "./helpers/navigation-attrappe";
import { antwort, netzLoesen, werkbankRendern, type Netzprotokoll } from "./helpers/werkbank";
import {
  BAUSTELLE_ID,
  EINSATZ_FREMD,
  EINSATZ_NEU_VOM_SERVER,
  EINSATZ_VOM_SERVER,
  PERSON_ID,
  fensterMitEntwurf,
  sitzungMit,
} from "./helpers/werkbank-daten";

vi.mock("next/navigation", async () => {
  const modul = await import("./helpers/navigation-attrappe");
  return modul.nextNavigationModul();
});

const MITTWOCH_KW34 = new Date("2026-08-19T12:00:00.000Z");
const RECHTE = ["planning.read", "planning.write"];

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

/**
 * Ein Bedienelement, gleich ob es als Schaltflaeche oder Link umgesetzt ist.
 *
 * Wortgleich mit dem Helfer in `wochennavigation.test.tsx` und dem Selektor in
 * `e2e/planungswerkbank.spec.ts`. Bis zum 19.08.2026 stand an der einen
 * Aufrufstelle unten stattdessen `getByRole("button", …)` — die einzige Stelle
 * im ganzen Vertragssatz, die sich auf eine Rolle festlegte. Die Zusicherung
 * war nie die Rolle, sondern das Ergebnis: es wird eine Woche vorwaerts
 * geblaettert und in DIE Woche geschrieben. Geaendert am 19.08.2026 auf
 * Entscheidung des Product Owners — sichtbar jetzt statt still spaeter —, weil
 * die Umsetzung in M4 `next/link` gewaehlt hat und die Zeile damit dauerhaft
 * aus dem falschen Grund rot bliebe.
 */
function bedienelement(name: string): HTMLElement {
  const treffer = [
    ...screen.queryAllByRole("button", { name }),
    ...screen.queryAllByRole("link", { name }),
  ];
  if (treffer.length !== 1) {
    throw new Error(
      `Erwartet: genau ein Bedienelement „${name}“ (Schaltflaeche oder Link). Gefunden: ${treffer.length}.`,
    );
  }
  return treffer[0] as HTMLElement;
}

const VORHANDEN = {
  id: EINSATZ_VOM_SERVER,
  startUtc: "2026-08-18T06:00:00.000Z",
  endUtc: "2026-08-18T14:00:00.000Z",
};

describe("REQ-003 / AC-005 — angezeigt wird, was der Server geantwortet hat", () => {
  it("zeigt die Zuweisung des Servers mit deren serverseitiger Id", async () => {
    werkbankRendern({
      sitzung: sitzungMit(RECHTE),
      fenster: (weekKey) => fensterMitEntwurf(weekKey, [VORHANDEN]),
    });

    const liste = await screen.findByTestId("planungsfenster-liste");
    const zeilen = liste.querySelectorAll("[data-assignment-id]");
    expect([...zeilen].map((z) => z.getAttribute("data-assignment-id"))).toEqual([
      EINSATZ_VOM_SERVER,
    ]);
    // Der Name stammt aus `resources` derselben Antwort — nicht aus einer
    // zweiten Quelle und nicht aus der Id.
    expect(liste.textContent ?? "").toContain("Anna Serverstand");
  });

  it("zeigt einen Ausfall als Ausfall, nicht als leere Woche", async () => {
    werkbankRendern({
      sitzung: sitzungMit(RECHTE),
      fenster: () => antwort(503, {}),
    });

    const fehler = await screen.findByTestId("planungsfenster-fehler");
    expect(fehler.getAttribute("data-failure")).toBe("UNAVAILABLE");
    expect(screen.queryByTestId("planungsfenster-leer")).toBeNull();
  });

  it("verwirft eine vertragswidrige Antwort, statt sie als Wochenplan zu zeigen", async () => {
    werkbankRendern({
      sitzung: sitzungMit(RECHTE),
      // 200 mit einer Form, die `PlanningWindowSchema` nicht erfuellt: genau der
      // Fall, den ein halb ausgerollter Server oder ein Proxy erzeugt.
      fenster: () => antwort(200, { weekKey: "2026-W34", assignments: "viele" }),
    });

    const fehler = await screen.findByTestId("planungsfenster-fehler");
    expect(fehler.getAttribute("data-failure")).toBe("CONTRACT_VIOLATION");
  });
});

describe("REQ-004 / AC-006, AC-007 — Schreiben in die angesehene Woche, danach der Serverstand", () => {
  /** Formular ausfuellen und absenden. Datum liegt in der ANGESEHENEN Woche. */
  async function einsatzAnlegen(datum: string): Promise<void> {
    await userEvent.selectOptions(screen.getByTestId("feld-employee"), PERSON_ID);
    await userEvent.selectOptions(screen.getByTestId("feld-worksite"), BAUSTELLE_ID);
    await userEvent.type(screen.getByTestId("feld-datum"), datum);
    await userEvent.type(screen.getByTestId("feld-beginn"), "08:00");
    await userEvent.type(screen.getByTestId("feld-ende"), "16:00");
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
  }

  function werkbankMitSchreibpfad(): {
    netz: Netzprotokoll;
    gesendet: CreateAssignmentCommand[];
  } {
    const gesendet: CreateAssignmentCommand[] = [];
    let geschrieben = false;
    const netz = werkbankRendern({
      sitzung: sitzungMit(RECHTE),
      fenster: (weekKey) =>
        fensterMitEntwurf(
          weekKey,
          geschrieben
            ? [
                VORHANDEN,
                {
                  id: EINSATZ_NEU_VOM_SERVER,
                  startUtc: "2026-08-25T06:00:00.000Z",
                  endUtc: "2026-08-25T14:00:00.000Z",
                },
                // Diese Zuweisung entstand waehrend des Schreibvorgangs an
                // anderer Stelle. Sie kann NUR ueber ein erneutes Lesen
                // sichtbar werden.
                {
                  id: EINSATZ_FREMD,
                  startUtc: "2026-08-26T06:00:00.000Z",
                  endUtc: "2026-08-26T14:00:00.000Z",
                },
              ]
            : [VORHANDEN],
        ),
      einsatzAnlegen: (befehl) => {
        gesendet.push(befehl);
        geschrieben = true;
        return {
          id: EINSATZ_NEU_VOM_SERVER,
          employeeId: befehl.employeeId,
          worksiteId: befehl.worksiteId,
          interval: befehl.interval,
        };
      },
    });
    return { netz, gesendet };
  }

  it("schreibt in die Woche, die auf dem Schirm steht — nicht in die Einstiegswoche", async () => {
    const { gesendet } = werkbankMitSchreibpfad();
    await screen.findByTestId("werkbank-woche-iso");

    await userEvent.click(bedienelement("Nächste Woche"));
    await waitFor(() =>
      expect(screen.getByTestId("werkbank-woche-iso").textContent ?? "").toContain("2026-W35"),
    );
    await einsatzAnlegen("2026-08-25");

    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]?.weekKey).toBe("2026-W35");
    expect(gesendet[0]?.interval.startUtc.startsWith("2026-08-25")).toBe(true);
  });

  it("schickt den Schreibaufruf mit Idempotenzschluessel ueber den Vertragsclient", async () => {
    const { netz } = werkbankMitSchreibpfad();
    await screen.findByTestId("werkbank-woche-iso");

    await einsatzAnlegen("2026-08-19");

    await waitFor(() => expect(netz.aufrufeAn("/api/v1/planung/einsaetze")).toHaveLength(1));
    const schreiben = netz.aufrufeAn("/api/v1/planung/einsaetze")[0];
    expect(schreiben?.methode).toBe("POST");
    expect(schreiben?.kopf[IDEMPOTENCY_HEADER] ?? "").not.toBe("");
  });

  it("zeigt nach dem Speichern den erneut gelesenen Serverstand, nicht die eigene Eingabe", async () => {
    const { netz } = werkbankMitSchreibpfad();
    await screen.findByTestId("werkbank-woche-iso");

    await einsatzAnlegen("2026-08-19");

    await waitFor(() => {
      const liste = screen.getByTestId("planungsfenster-liste");
      const ids = [...liste.querySelectorAll("[data-assignment-id]")].map((z) =>
        z.getAttribute("data-assignment-id"),
      );
      // Beide neuen Zuweisungen stehen da — die eigene UND die fremde. Die
      // fremde ist der Beweis: sie kann nur aus einem zweiten Lesevorgang
      // stammen.
      expect(ids).toContain(EINSATZ_NEU_VOM_SERVER);
      expect(ids).toContain(EINSATZ_FREMD);
    });

    // Und die Reihenfolge stimmt: erst schreiben, dann lesen.
    const reihenfolge = netz.aufrufe.map((a) => `${a.methode} ${a.pfad}`);
    const schreibIndex = reihenfolge.indexOf("POST /api/v1/planung/einsaetze");
    const leseIndexDanach = reihenfolge.indexOf("GET /api/v1/planung/fenster", schreibIndex + 1);
    expect(schreibIndex).toBeGreaterThanOrEqual(0);
    expect(leseIndexDanach).toBeGreaterThan(schreibIndex);
  });

  it("uebernimmt keine clientseitig erzeugte Id in die Anzeige", async () => {
    const { netz } = werkbankMitSchreibpfad();
    await screen.findByTestId("werkbank-woche-iso");

    await einsatzAnlegen("2026-08-19");
    await waitFor(() =>
      expect(screen.getByTestId("planungsfenster-liste").textContent ?? "").not.toBe(""),
    );

    const schluessel = netz.aufrufeAn("/api/v1/planung/einsaetze")[0]?.kopf[IDEMPOTENCY_HEADER];
    const liste = within(screen.getByTestId("planungsfenster-liste"));
    const ids = liste
      .getAllByRole("listitem")
      .map((zeile) => zeile.getAttribute("data-assignment-id"));
    expect(ids).not.toContain(schluessel);
    expect(ids.every((id) => id !== null && id !== "")).toBe(true);
  });
});
