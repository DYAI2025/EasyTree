/**
 * REQ-002 — Wochennavigation der Planungswerkbank (EYT-140, `AC-003`, `AC-004`).
 *
 * ## Kritische semantische Glaettung
 *
 * **Grenze:** `boundary` — die Woche wird ueber das Netz beim Server geholt;
 * die Reise beginnt an einer Adresse.
 *
 * **These:** `/planung` zeigt eine Woche. Das tut es heute schon — sobald jemand
 * `?weekKey=2026-W34` in die Adresse schreibt.
 *
 * **Gegenthese:** Ein Test waere gruen und der Planerin trotzdem nicht geholfen,
 * wenn die Navigation zwar existiert, die angezeigte Woche aber aus dem
 * Clientzustand stammt, waehrend der Server nach einer anderen gefragt wurde —
 * oder gar nicht gefragt wurde. Sie blaettert dann durch eine erfundene Woche.
 * Zweite Fassung derselben Gegenthese: die Navigation ist da, aber nur solange
 * die Adresse stimmt; ein fehlerhafter Link bleibt eine Sackgasse ohne Ausweg.
 *
 * **Schaerfung:** Jede Zusicherung hier prueft ZWEI Dinge zugleich — was auf dem
 * Schirm steht UND welche Woche ueber die HTTP-Grenze angefordert wurde. Eine
 * Anzeige ohne passenden Serveraufruf faellt durch, ein Serveraufruf ohne
 * passende Anzeige ebenso. Und der Ausweg aus dem Parameterfehler ist eine
 * eigene Zusicherung.
 *
 * ## Was die Umsetzung hierfuer bereitstellen muss
 *
 * Beobachtbar, nicht vorgeschrieben ist der Weg: Clientzustand, `router.push`
 * oder `<Link>` sind alle zulaessig (siehe `helpers/navigation-attrappe.ts`).
 * Erwartet werden
 *   - Bedienelemente mit den zugaenglichen Namen „Vorherige Woche",
 *     „Nächste Woche" und „Heute“ (Schaltflaeche oder Link),
 *   - `data-testid="werkbank-woche-iso"` mit dem ISO-Wochenschluessel,
 *   - `data-testid="werkbank-woche-bereich"` mit Montag und Sonntag der Woche
 *     als Datum (`TT.MM.JJJJ`).
 *
 * ## Gegenmutation (Phase 1, nach der Umsetzung auszufuehren)
 *
 * In der Wochenableitung der Werkbank den aus der Uhr berechneten Schluessel
 * durch die Konstante `"2026-W32"` ersetzen → „zeigt ohne technischen Parameter
 * die laufende Woche" geht rot. Zweite: den Aufruf `Nächste Woche` auf
 * `+0 Wochen` setzen → „blaettert eine Woche vorwaerts" geht rot.
 *
 * Beide sind heute NICHT ausfuehrbar: es gibt keine Wochenableitung und keine
 * Navigation, die man mutieren koennte. Genau das ist der Befund, den dieser
 * Test festhaelt (`docs/traceability.md`, `TRC-S6-002`).
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigationZuruecksetzen } from "./helpers/navigation-attrappe";
import { netzLoesen, werkbankRendern } from "./helpers/werkbank";
import { fensterLeer, sitzungMit } from "./helpers/werkbank-daten";

vi.mock("next/navigation", async () => {
  const modul = await import("./helpers/navigation-attrappe");
  return modul.nextNavigationModul();
});

/**
 * Mittwoch, 12:00 UTC. Bewusst Wochenmitte und Mittag: in jeder Zeitzone
 * zwischen UTC-12 und UTC+14 liegt dieser Zeitpunkt in derselben ISO-Woche.
 * Ein Test, der an der Maschinenzeitzone haengt, misst die Umgebung.
 */
const MITTWOCH_KW34 = new Date("2026-08-19T12:00:00.000Z");

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

const RECHTE = ["planning.read", "planning.write", "planning.publish"];

function werkbank(anfangsSuche = "") {
  return werkbankRendern(
    { sitzung: sitzungMit(RECHTE), fenster: (weekKey) => fensterLeer(weekKey) },
    anfangsSuche,
  );
}

/** Ein Bedienelement, gleich ob es als Schaltflaeche oder Link umgesetzt ist. */
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

async function angezeigteWoche(): Promise<string> {
  const marke = await screen.findByTestId("werkbank-woche-iso");
  return marke.textContent ?? "";
}

describe("REQ-002 / AC-003 — Einstieg ohne technischen Parameter", () => {
  it("zeigt ohne technischen Parameter die laufende Woche mit vollstaendigem Datumsbereich", async () => {
    werkbank();

    expect(await angezeigteWoche()).toContain("2026-W34");
    const bereich = screen.getByTestId("werkbank-woche-bereich").textContent ?? "";
    // Montag und Sonntag der ISO-Woche 34/2026, unabhaengig ermittelt
    // (`python3 -c "date(2026,8,17).isocalendar()"` → 2026-W34-1).
    expect(bereich).toContain("17.08.2026");
    expect(bereich).toContain("23.08.2026");
  });

  it("ruft ohne technischen Parameter kein Parameterfehler-Ersatzbild auf", async () => {
    werkbank();

    await screen.findByTestId("werkbank-woche-iso");
    expect(screen.queryByTestId("planungsfenster-parameterfehler")).toBeNull();
  });

  it("fragt den Server nach genau der abgeleiteten Woche", async () => {
    const netz = werkbank();

    await waitFor(() => expect(netz.gefragteWochen()).toEqual(["2026-W34"]));
  });

  it("bietet die drei Bedienelemente mit zugaenglichen Namen an", async () => {
    werkbank();

    await screen.findByTestId("werkbank-woche-iso");
    for (const name of ["Vorherige Woche", "Nächste Woche", "Heute"]) {
      expect(bedienelement(name)).toBeTruthy();
    }
  });
});

describe("REQ-002 / AC-004 — Blaettern ohne weekKey-Eingabe", () => {
  it("blaettert eine Woche vorwaerts und fragt den Server danach", async () => {
    const netz = werkbank();
    await screen.findByTestId("werkbank-woche-iso");

    await userEvent.click(bedienelement("Nächste Woche"));

    await waitFor(async () => expect(await angezeigteWoche()).toContain("2026-W35"));
    expect(screen.getByTestId("werkbank-woche-bereich").textContent ?? "").toContain("24.08.2026");
    expect(netz.gefragteWochen()).toContain("2026-W35");
  });

  it("blaettert eine Woche rueckwaerts und fragt den Server danach", async () => {
    const netz = werkbank();
    await screen.findByTestId("werkbank-woche-iso");

    await userEvent.click(bedienelement("Vorherige Woche"));

    await waitFor(async () => expect(await angezeigteWoche()).toContain("2026-W33"));
    expect(screen.getByTestId("werkbank-woche-bereich").textContent ?? "").toContain("10.08.2026");
    expect(netz.gefragteWochen()).toContain("2026-W33");
  });

  it("kehrt mit „Heute“ zur laufenden Woche zurueck", async () => {
    werkbank();
    await screen.findByTestId("werkbank-woche-iso");

    await userEvent.click(bedienelement("Nächste Woche"));
    await waitFor(async () => expect(await angezeigteWoche()).toContain("2026-W35"));
    await userEvent.click(bedienelement("Heute"));

    await waitFor(async () => expect(await angezeigteWoche()).toContain("2026-W34"));
  });

  it("ueberschreitet den Jahreswechsel vorwaerts richtig (2026-W53 → 2027-W01)", async () => {
    // 2026 hat 53 ISO-Wochen; 2026-W53 laeuft vom 28.12.2026 bis 03.01.2027.
    vi.setSystemTime(new Date("2026-12-30T12:00:00.000Z"));
    const netz = werkbank();
    await waitFor(async () => expect(await angezeigteWoche()).toContain("2026-W53"));

    await userEvent.click(bedienelement("Nächste Woche"));

    await waitFor(async () => expect(await angezeigteWoche()).toContain("2027-W01"));
    expect(screen.getByTestId("werkbank-woche-bereich").textContent ?? "").toContain("04.01.2027");
    expect(netz.gefragteWochen()).toContain("2027-W01");
  });

  it("ueberschreitet den Jahreswechsel rueckwaerts richtig (2026-W01 → 2025-W52)", async () => {
    // 2026-W01 beginnt am 29.12.2025; die Vorwoche ist 2025-W52 ab 22.12.2025.
    vi.setSystemTime(new Date("2025-12-31T12:00:00.000Z"));
    const netz = werkbank();
    await waitFor(async () => expect(await angezeigteWoche()).toContain("2026-W01"));

    await userEvent.click(bedienelement("Vorherige Woche"));

    await waitFor(async () => expect(await angezeigteWoche()).toContain("2025-W52"));
    expect(screen.getByTestId("werkbank-woche-bereich").textContent ?? "").toContain("22.12.2025");
    expect(netz.gefragteWochen()).toContain("2025-W52");
  });
});

describe("REQ-002 / AC-003 — der Parameterfehler bleibt eine Aussage, aber keine Sackgasse", () => {
  it("lehnt einen unmoeglichen Wochenschluessel weiterhin sichtbar ab", async () => {
    const netz = werkbank("?weekKey=2026-W99");

    expect(await screen.findByTestId("planungsfenster-parameterfehler")).toBeTruthy();
    // Der Kern der bestehenden Regel: KEIN stiller Ausweichwert. Eine Umsetzung,
    // die bei ungueltiger Eingabe einfach die laufende Woche laedt, zeigt der
    // Planerin eine andere Woche als die, die im Link stand.
    expect(netz.gefragteWochen()).toEqual([]);
  });

  it("laesst die Planerin aus dem Parameterfehler heraus zur laufenden Woche zurueck", async () => {
    const netz = werkbank("?weekKey=2026-W99");
    await screen.findByTestId("planungsfenster-parameterfehler");

    await userEvent.click(bedienelement("Heute"));

    await waitFor(async () => expect(await angezeigteWoche()).toContain("2026-W34"));
    expect(netz.gefragteWochen()).toEqual(["2026-W34"]);
  });
});
