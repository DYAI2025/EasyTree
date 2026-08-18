/**
 * REQ-001 — autorisierter Einstieg in die Planungswerkbank (EYT-140, `AC-001`, `AC-002`).
 *
 * ## Kritische semantische Glaettung
 *
 * **Grenze:** `boundary` — Sitzung und Rechte kommen ueber `GET /auth/session`
 * vom Server; die Reise beginnt in der zusammengesetzten Shell.
 *
 * **These:** Die Anmeldung funktioniert. Sie ist `existing capability`
 * (`docs/traceability.md`, S6 Tabelle D): `login-form.tsx`, `app-shell.tsx` und
 * der CI-Job `auth-journey` beweisen sie gegen echtes GoTrue.
 *
 * **Gegenthese:** Ein Test waere gruen und der Planerin trotzdem nicht geholfen,
 * wenn die Anmeldung zwar gelingt, der Einstieg in die Werkbank aber ins Leere
 * fuehrt — weil `/planung` ohne technischen Parameter gar keine Aussage ueber
 * ZUGANG macht, sondern ueber die ADRESSE. Wer nicht angemeldet ist oder
 * `planning.read` nicht hat, liest heute „Kein gültiger Wochenschlüssel" statt
 * „nicht angemeldet" bzw. „kein Zugriff". Das ist keine Kleinigkeit: die
 * Nutzerin sucht dann einen Adressfehler, waehrend ihr in Wahrheit ein Recht
 * fehlt — und die Reise endet, ohne dass jemand merkt, warum.
 *
 * **Schaerfung:** Der Einstieg wird OHNE Parameter gefahren, und geprueft wird,
 * welche AUSSAGE dabei erscheint: Werkbank, Anmeldehinweis, Nichtwissen oder
 * Forbidden — je nach Sitzungslage. Diese Datei baut die Anmeldung nicht nach;
 * sie prueft, dass die vorhandene Zugangsaussage in der neuen Reise ANKOMMT.
 *
 * ## Was hier ausdruecklich NICHT geprueft wird
 *
 * Die serverseitige Autorisierung aus `AC-002`. Die liegt in
 * `apps/api/test/planning-access.test.ts` („lehnt eine Organisation ab, in der
 * das Subjekt nicht Mitglied ist") und in den `db-gates`-Zeilen; sie hier
 * nachzubauen hiesse, sie gegen eine Attrappe zu behaupten. Geprueft wird die
 * Client-Haelfte: sichtbare Navigation verleiht kein Recht, und ein fehlendes
 * Recht wird als solches benannt.
 *
 * ## Gegenmutation (Phase 1)
 *
 * Im Zugangswaechter `apps/web/components/planung-zugang.tsx` die Bedingung
 * `!hatRecht("planning.read")` auf `false` setzen → „nennt ein fehlendes
 * planning.read als fehlendes Recht" geht rot (statt der Forbidden-Aussage
 * erschiene die Werkbank). Heute nicht ausfuehrbar, weil der Waechter beim
 * parameterlosen Einstieg gar nicht erreicht wird — genau das ist der Befund.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigationZuruecksetzen } from "./helpers/navigation-attrappe";
import { antwort, netzLoesen, werkbankRendern } from "./helpers/werkbank";
import { fensterMitEntwurf, sitzungMit } from "./helpers/werkbank-daten";

vi.mock("next/navigation", async () => {
  const modul = await import("./helpers/navigation-attrappe");
  return modul.nextNavigationModul();
});

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

describe("REQ-001 / AC-001 — berechtigter Einstieg landet in der Werkbank", () => {
  it("zeigt einer Planerin mit planning.read die Werkbank statt eines Adressfehlers", async () => {
    werkbankRendern({
      sitzung: sitzungMit(["planning.read", "planning.write"]),
      fenster: (weekKey) => fensterMitEntwurf(weekKey),
    });

    expect(await screen.findByTestId("werkbank-woche-iso")).toBeTruthy();
    expect(screen.queryByTestId("planungsfenster-parameterfehler")).toBeNull();
    // Der Einstiegspunkt selbst traegt keinen technischen Parameter: die
    // Hauptnavigation fuehrt auf `/planung`, nicht auf `/planung?weekKey=…`.
    // Diese Haelfte ist auf `origin/master` bereits erfuellt; sie steht hier,
    // damit die Zusicherung „Einstieg ohne Parameter" vollstaendig ist und
    // nicht durch einen Navigationspunkt mit eingebauter Woche umgangen wird.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Planung" }).getAttribute("href")).toBe("/planung"),
    );
  });
});

describe("REQ-001 / AC-002 — fehlender Zugang wird als fehlender Zugang benannt", () => {
  it("nennt ein fehlendes planning.read als fehlendes Recht, nicht als Adressfehler", async () => {
    const netz = werkbankRendern({
      // Angemeldet, aber ohne Planungsrecht — der Fall, den eine sichtbare
      // Navigation niemals heilen darf.
      sitzung: sitzungMit(["costs.read"]),
      fenster: (weekKey) => fensterMitEntwurf(weekKey),
    });

    expect(await screen.findByTestId("planung-forbidden")).toBeTruthy();
    expect(screen.queryByTestId("planungsfenster-parameterfehler")).toBeNull();
    // Fail-closed: ohne Recht wird die Woche gar nicht erst angefragt.
    expect(netz.gefragteWochen()).toEqual([]);
  });

  it("blendet die Planung ohne planning.read aus der Hauptnavigation aus", async () => {
    werkbankRendern({
      sitzung: sitzungMit(["costs.read"]),
      fenster: (weekKey) => fensterMitEntwurf(weekKey),
    });

    await screen.findByTestId("planung-forbidden");
    expect(screen.queryByRole("link", { name: "Planung" })).toBeNull();
  });

  it("nennt eine fehlende Anmeldung als fehlende Anmeldung", async () => {
    const netz = werkbankRendern({
      sitzung: antwort(401, {}),
      fenster: (weekKey) => fensterMitEntwurf(weekKey),
    });

    expect(await screen.findByTestId("planung-unauthenticated")).toBeTruthy();
    expect(netz.gefragteWochen()).toEqual([]);
  });

  it("nennt eine ungeklaerte Sitzung als Nichtwissen, nicht als leere Woche", async () => {
    const netz = werkbankRendern({
      // 500: der Server hat nicht „abgemeldet" gesagt, sondern gar nichts
      // Verwertbares — der Anmeldezustand ist UNBEKANNT.
      sitzung: antwort(500, {}),
      fenster: (weekKey) => fensterMitEntwurf(weekKey),
    });

    expect(await screen.findByTestId("planung-sitzung-unbekannt")).toBeTruthy();
    expect(screen.queryByTestId("planungsfenster-leer")).toBeNull();
    expect(netz.gefragteWochen()).toEqual([]);
  });
});
