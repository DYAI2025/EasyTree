/**
 * Einsatzformular (EYT-92) — Schritt 2 der Nutzerreise.
 *
 * Geprueft wird, was eine Planerin tun kann und was das Formular VERHINDERT.
 * Die schaerfste Aussage ist die letzte Art: eine unvollstaendige Eingabe darf
 * keinen Schreibaufruf ausloesen. Dafuer zaehlt der Test die Aufrufe, statt
 * nur ein `disabled`-Attribut zu betrachten — ein Attribut ist Darstellung,
 * ein nicht erfolgter Aufruf ist Verhalten.
 *
 * ## Gegenmutationen
 *
 * 1. Entfernt man in `absenden` die Zeile `if (!vollstaendig || laeuft) return;`,
 *    wird „loest bei unvollstaendiger Eingabe keinen Schreibaufruf aus" rot.
 * 2. Ersetzt man `auswahl()` durch die Identitaet (kein `active`-Filter), wird
 *    „bietet inaktive Eintraege nicht zur Auswahl an" rot.
 * 3. Entfernt man den `keineAuswahl`-Zweig, wird „erklaert den Leerzustand" rot.
 * 4. Rechnet `zuIntervall` mit der Browserzone statt mit `fenster.timeZone`,
 *    wird „rechnet Wanduhrzeit in der Zone der ORGANISATION" rot, sobald die
 *    Testmaschine nicht in Europe/Berlin steht — deshalb prueft dieser Fall den
 *    UTC-Wert direkt und nicht ueber die Anzeige.
 */
import type { PlanningWindow } from "@easytree/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssignmentForm, zuIntervall } from "../components/assignment-form";

afterEach(cleanup);

const PERSON_A = "22222222-2222-4222-8222-222222222222";
const PERSON_INAKTIV = "22222222-2222-4222-8222-2222222222ff";
const BAUSTELLE_A = "33333333-3333-4333-8333-333333333333";

function fenster(overrides: Partial<PlanningWindow["resources"]> = {}): PlanningWindow {
  return {
    weekKey: "2026-W32",
    timeZone: "Europe/Berlin",
    assignments: [],
    sourceVersion: null,
    publishedVersionId: null,
    resources: {
      employees: [
        { id: PERSON_A, label: "Anna Berg", active: true },
        { id: PERSON_INAKTIV, label: "Bea Ausgeschieden", active: false },
      ],
      worksites: [{ id: BAUSTELLE_A, label: "Baustelle Nord", active: true }],
      ...overrides,
    },
  };
}

describe("AssignmentForm — Auswahl aus echten Serverdaten", () => {
  it("bietet die aktiven Beschaeftigten mit Namen an", () => {
    render(<AssignmentForm window={fenster()} onSubmit={vi.fn()} />);
    const feld = screen.getByTestId("feld-employee");
    expect(feld.textContent).toContain("Anna Berg");
  });

  it("bietet die aktiven Baustellen mit Namen an", () => {
    render(<AssignmentForm window={fenster()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("feld-worksite").textContent).toContain("Baustelle Nord");
  });

  it("bietet inaktive Eintraege NICHT zur Auswahl an", () => {
    // `resources` liefert sie mit, damit bestehende Zuweisungen ihren Namen
    // behalten. Fuer NEUE Einsaetze duerfen sie nicht waehlbar sein.
    render(<AssignmentForm window={fenster()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("feld-employee").textContent).not.toContain("Bea Ausgeschieden");
  });

  it("traegt die Serverid als Wert, nicht den Namen", () => {
    // Der Name ist Darstellung; abgesendet wird die Id, die auch in der
    // Datenbank steht (AK9).
    render(<AssignmentForm window={fenster()} onSubmit={vi.fn()} />);
    const optionen = screen.getByTestId("feld-employee").querySelectorAll("option");
    expect([...optionen].map((o) => o.getAttribute("value"))).toEqual(["", PERSON_A]);
  });

  it("bietet Datum, Beginn und Ende an", () => {
    render(<AssignmentForm window={fenster()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("feld-datum").getAttribute("type")).toBe("date");
    expect(screen.getByTestId("feld-beginn").getAttribute("type")).toBe("time");
    expect(screen.getByTestId("feld-ende").getAttribute("type")).toBe("time");
  });
});

describe("AssignmentForm — Leerzustand", () => {
  it("erklaert, warum ohne aktive Mitarbeitende nichts geplant werden kann", () => {
    render(<AssignmentForm window={fenster({ employees: [] })} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("einsatzformular-leer").textContent).toMatch(
      /keine aktiven Mitarbeitenden/i,
    );
    expect(screen.queryByTestId("einsatzformular")).toBeNull();
  });

  it("erklaert, warum ohne aktive Baustellen nichts geplant werden kann", () => {
    render(<AssignmentForm window={fenster({ worksites: [] })} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("einsatzformular-leer").textContent).toMatch(
      /keine aktiven Baustellen/i,
    );
  });

  it("nennt beide Luecken, wenn beides fehlt", () => {
    render(
      <AssignmentForm window={fenster({ employees: [], worksites: [] })} onSubmit={vi.fn()} />,
    );
    expect(screen.getByTestId("einsatzformular-leer").textContent).toMatch(
      /weder aktive Mitarbeitende noch aktive Baustellen/i,
    );
  });
});

describe("AssignmentForm — unvollstaendige Eingabe schreibt nicht", () => {
  it("loest ohne jede Eingabe keinen Schreibaufruf aus", async () => {
    const onSubmit = vi.fn();
    render(<AssignmentForm window={fenster()} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("loest bei nur teilweise gefuellter Eingabe keinen Schreibaufruf aus", async () => {
    const onSubmit = vi.fn();
    render(<AssignmentForm window={fenster()} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByTestId("feld-employee"), PERSON_A);
    await userEvent.selectOptions(screen.getByTestId("feld-worksite"), BAUSTELLE_A);
    // Datum, Beginn und Ende fehlen.
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("haelt die Schaltflaeche gesperrt, solange etwas fehlt", async () => {
    render(<AssignmentForm window={fenster()} onSubmit={vi.fn()} />);
    expect((screen.getByTestId("einsatz-speichern") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.selectOptions(screen.getByTestId("feld-employee"), PERSON_A);
    expect((screen.getByTestId("einsatz-speichern") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AssignmentForm — vollstaendige Eingabe", () => {
  async function fuelleVollstaendig(): Promise<void> {
    await userEvent.selectOptions(screen.getByTestId("feld-employee"), PERSON_A);
    await userEvent.selectOptions(screen.getByTestId("feld-worksite"), BAUSTELLE_A);
    await userEvent.type(screen.getByTestId("feld-datum"), "2026-08-03");
    await userEvent.type(screen.getByTestId("feld-beginn"), "08:00");
    await userEvent.type(screen.getByTestId("feld-ende"), "16:00");
  }

  it("sendet Ids und ein UTC-Intervall der ORGANISATIONSZONE", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<AssignmentForm window={fenster()} onSubmit={onSubmit} />);
    await fuelleVollstaendig();
    await userEvent.click(screen.getByTestId("einsatz-speichern"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      employeeId: PERSON_A,
      worksiteId: BAUSTELLE_A,
      // 08:00 Europe/Berlin im August ist 06:00 UTC — nicht 08:00 UTC und nicht
      // die Zone der Testmaschine.
      interval: { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T14:00:00.000Z" },
    });
  });

  it("leert das Formular nach erfolgreichem Speichern", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<AssignmentForm window={fenster()} onSubmit={onSubmit} />);
    await fuelleVollstaendig();
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    expect((screen.getByTestId("feld-employee") as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("feld-datum") as HTMLInputElement).value).toBe("");
  });

  it("zeigt den Serverbefund, wenn das Speichern scheitert", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      failure: "REJECTED",
      detail: "Diese Person ist in diesem Zeitraum bereits eingeplant.",
    });
    render(<AssignmentForm window={fenster()} onSubmit={onSubmit} />);
    await fuelleVollstaendig();
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    expect((await screen.findByTestId("einsatzformular-meldung")).textContent).toMatch(
      /bereits eingeplant/i,
    );
  });

  it("leert das Formular NICHT, wenn das Speichern scheitert", async () => {
    // Sonst muesste die Planerin alles neu eingeben, obwohl nichts gespeichert
    // wurde — und im schlechtesten Fall haelt sie den leeren Zustand fuer Erfolg.
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, failure: "REJECTED" });
    render(<AssignmentForm window={fenster()} onSubmit={onSubmit} />);
    await fuelleVollstaendig();
    await userEvent.click(screen.getByTestId("einsatz-speichern"));
    expect(await screen.findByTestId("einsatzformular-meldung")).not.toBeNull();
    expect((screen.getByTestId("feld-employee") as HTMLSelectElement).value).toBe(PERSON_A);
  });
});

describe("zuIntervall — Zeitrechnung ohne Oberflaeche", () => {
  const basis = { employeeId: PERSON_A, worksiteId: BAUSTELLE_A };

  it("rechnet Sommerzeit korrekt", () => {
    const r = zuIntervall(
      { ...basis, datum: "2026-08-03", beginn: "08:00", ende: "16:00" },
      "Europe/Berlin",
    );
    expect(r).toEqual({
      ok: true,
      startUtc: "2026-08-03T06:00:00.000Z",
      endUtc: "2026-08-03T14:00:00.000Z",
    });
  });

  it("lehnt ein Ende vor dem Beginn ab", () => {
    const r = zuIntervall(
      { ...basis, datum: "2026-08-03", beginn: "16:00", ende: "08:00" },
      "Europe/Berlin",
    );
    expect(r).toEqual({ ok: false, fehler: "ENDE_NICHT_NACH_BEGINN" });
  });

  it("lehnt ein Nullintervall ab", () => {
    const r = zuIntervall(
      { ...basis, datum: "2026-08-03", beginn: "08:00", ende: "08:00" },
      "Europe/Berlin",
    );
    expect(r).toEqual({ ok: false, fehler: "ENDE_NICHT_NACH_BEGINN" });
  });

  it("meldet die Sommerzeitluecke statt sie zu ueberspringen", () => {
    const r = zuIntervall(
      { ...basis, datum: "2026-03-29", beginn: "02:30", ende: "05:00" },
      "Europe/Berlin",
    );
    expect(r).toEqual({ ok: false, fehler: "ZEITPUNKT_EXISTIERT_NICHT" });
  });

  it("meldet die doppelte Stunde am Sommerzeitende", () => {
    const r = zuIntervall(
      { ...basis, datum: "2026-10-25", beginn: "02:30", ende: "05:00" },
      "Europe/Berlin",
    );
    expect(r).toEqual({ ok: false, fehler: "ZEITPUNKT_MEHRDEUTIG" });
  });

  it("meldet eine unbekannte Organisationszone, statt auf die Browserzone auszuweichen", () => {
    const r = zuIntervall(
      { ...basis, datum: "2026-08-03", beginn: "08:00", ende: "16:00" },
      "Mars/Olympus_Mons",
    );
    expect(r).toEqual({ ok: false, fehler: "ZONE_UNBEKANNT" });
  });
});
