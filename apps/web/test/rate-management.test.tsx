/**
 * Die Satzhistorie zeigt die Abloesung sichtbar (EYT-108).
 *
 * ## Warum es diese Datei gibt
 *
 * Fuer `RateManagement` gab es bis EYT-108 KEINEN Test. Nichts wurde rot, wenn
 * die Tabelle eine Spalte verlor — und die Unveraenderlichkeit ist genau das,
 * was ein Mensch hier sehen koennen muss: dass die alte Version nicht
 * ueberschrieben, sondern geschlossen wurde.
 *
 * ## Die Fixtur ist die Gegenmutation
 *
 * Drei Versionen — abgelaufen, aktiv, kommend — die mittlere mit Vorgaenger.
 * Faellt eine Spalte weg, faellt eine Zusicherung. Ein dauerhafter Fall statt
 * einer Mutation, die man einspielt und wieder zuruecknimmt.
 *
 * ## Der Statusfehler, den diese Datei festhaelt
 *
 * Vorher entschied die Oberflaeche ueber `version.id === activeVersionId`. Der
 * Controller setzt `activeVersionId` aber auch bei Mehrdeutigkeit auf `null` —
 * eine Version, die der Server "aktiv" nennt, erschien dann als "abgelaufen".
 * Der letzte Fall unten haelt genau das fest.
 */
import type {
  CostsGateway,
  EmployeesForRates,
  GatewayResult,
  RateHistory,
  RateVersionDto,
} from "@easytree/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { RateManagement } from "../components/rate-management";
import { CostsGatewayProvider } from "../lib/costs-gateway-provider";

const MITARBEITER = "00000000-0000-4000-8000-0000004010a1";

const MITARBEITERLISTE: EmployeesForRates = {
  employees: [{ id: MITARBEITER, displayName: "Alpha Planerin", active: true }],
};

function version(teil: Partial<RateVersionDto> & Pick<RateVersionDto, "id">): RateVersionDto {
  return {
    employeeId: MITARBEITER,
    amountMinorUnits: "3850",
    currency: "EUR",
    validFrom: "2026-01-01",
    validTo: null,
    status: "aktiv",
    predecessorId: null,
    reason: "Erstanlage",
    createdAt: "2026-01-01T08:00:00.000Z",
    createdBy: "00000000-0000-4000-8000-00000000aaa1",
    ...teil,
  };
}

const V_ALT = version({
  id: "00000000-0000-4000-8000-00000053a001",
  validFrom: "2026-01-01",
  validTo: "2026-07-01",
  status: "abgelaufen",
  reason: "Erstanlage",
});
const V_AKTIV = version({
  id: "00000000-0000-4000-8000-00000053a002",
  amountMinorUnits: "4200",
  validFrom: "2026-07-01",
  validTo: "2027-01-01",
  status: "aktiv",
  predecessorId: V_ALT.id,
  reason: "Tariferhoehung",
});
const V_KOMMEND = version({
  id: "00000000-0000-4000-8000-00000053a003",
  amountMinorUnits: "4400",
  validFrom: "2027-01-01",
  validTo: null,
  status: "kommend",
  predecessorId: V_AKTIV.id,
  reason: "Tarifrunde 2027",
});

function gatewayMit(historie: RateHistory): CostsGateway {
  return {
    listEmployees: () =>
      Promise.resolve({ ok: true, value: MITARBEITERLISTE } as GatewayResult<EmployeesForRates>),
    rateHistory: () => Promise.resolve({ ok: true, value: historie } as GatewayResult<RateHistory>),
    createRateVersion: () => {
      throw new Error("in dieser Ansicht nicht benutzt");
    },
  };
}

async function zeigeHistorie(historie: RateHistory): Promise<void> {
  render(
    <CostsGatewayProvider gateway={gatewayMit(historie)}>
      <RateManagement />
    </CostsGatewayProvider>,
  );
  // Die Historie erscheint erst NACH der Auswahl einer Person — ohne sie
  // pruefte der Test eine leere Seite und waere aus dem falschen Grund rot.
  const auswahl = await screen.findByLabelText("Mitarbeiter auswählen");
  await userEvent.selectOptions(auswahl, MITARBEITER);
  await waitFor(() => expect(screen.getByTestId("satzhistorie")).toBeTruthy());
}

afterEach(cleanup);

describe("Satzhistorie macht die Abloesung sichtbar (EYT-108)", () => {
  it("zeigt Vorgaenger und Nachfolger mit allen Pflichtangaben", async () => {
    await zeigeHistorie({
      employeeId: MITARBEITER,
      activeVersionId: V_AKTIV.id,
      versions: [V_KOMMEND, V_AKTIV, V_ALT],
    });

    const zeilen = screen.getAllByTestId("satzversion");
    expect(zeilen).toHaveLength(3);

    // Der Beleg der Kette: "ersetzt Version vom <Startdatum des Vorgaengers>".
    // Das Datum, nicht die Id — eine UUID sagt einem Menschen nichts.
    const ersetzt = screen.getAllByTestId("ersetzt").map((z) => z.textContent);
    expect(ersetzt).toContain("ersetzt Version vom 2026-07-01");
    expect(ersetzt).toContain("ersetzt Version vom 2026-01-01");
    // Die aelteste Version ersetzt nichts — sonst waere die Spalte reine Deko.
    expect(ersetzt).toContain("—");

    // Der Vorgaenger ist sichtbar GESCHLOSSEN. Ohne diese Zusicherung koennte
    // `valid_to` verschwinden und die Ansicht saehe unveraendert aus.
    const bis = screen.getAllByTestId("gueltig-bis").map((z) => z.textContent);
    expect(bis).toContain("2026-07-01");

    expect(screen.getByText("Tariferhoehung")).toBeTruthy();
    expect(screen.getByText("42,00 €")).toBeTruthy();
  });

  it("nimmt den Status vom Server, nicht aus einem eigenen Vergleich", async () => {
    // `activeVersionId: null` bei einer Version, die der Server "aktiv" nennt:
    // genau der Fall, in dem der Controller wegen Mehrdeutigkeit keine aktive
    // Version benennen kann. Die alte Ansicht zeigte hier "abgelaufen".
    await zeigeHistorie({
      employeeId: MITARBEITER,
      activeVersionId: null,
      versions: [V_AKTIV],
    });
    expect(screen.getByText("aktiv")).toBeTruthy();
    expect(screen.queryByText("abgelaufen")).toBeNull();
  });

  it("nennt die Unveraenderlichkeit in der Tabellenbeschriftung", async () => {
    await zeigeHistorie({
      employeeId: MITARBEITER,
      activeVersionId: V_AKTIV.id,
      versions: [V_AKTIV],
    });
    const beschriftung = screen.getByTestId("satzhistorie").querySelector("caption");
    expect(beschriftung?.textContent).toContain("nie");
  });
});
