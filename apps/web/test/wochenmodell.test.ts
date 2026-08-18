/**
 * REQ-002 / `AC-003`, `AC-004` — die reine Wochenableitung an der Web-Grenze (EYT-140 M3).
 *
 * ## Warum diese Datei `wochenmodell.test.ts` heisst und nicht `wochennavigation.test.ts`
 *
 * Der Plan verlangt in M3 `apps/web/test/wochennavigation.test.ts`. Unter
 * `apps/web/test/` liegt jedoch bereits `wochennavigation.test.tsx` — der
 * Abnahmevertrag, den M4 erfuellt. Beide Namen unterscheiden sich nur in der
 * Endung, und ein `vitest`-Pfadfilter ist ein SUBSTRING-Vergleich auf dem
 * Dateipfad: `test/wochennavigation.test.ts` ist ein Teilstring von
 * `test/wochennavigation.test.tsx`. Gemessen am 18.08.2026, vor dem Anlegen
 * dieser Datei:
 *
 *     $ pnpm --filter @easytree/web exec vitest run test/wochennavigation.test.ts
 *     FAIL  test/wochennavigation.test.tsx > ...
 *     Test Files  1 failed (1)
 *
 * Das Fertigkriterium des Meilensteins lautet `Test Files  1 passed`. Unter dem
 * Plannamen ist es also nicht erreichbar, solange der M4-Vertrag rot ist — die
 * Umbenennung ist damit keine Kosmetik, sondern die Bedingung dafuer, dass M3
 * ueberhaupt messbar wird. Der Plan ist im selben Commit nachgezogen
 * (`plumbline-touches` und die `Create:`-Zeile).
 *
 * ## Was hier geprueft wird — und was NICHT reicht
 *
 * Aus M2 ist eine Lehre uebernommen: dort war ein Sweep ueber 520 Schritte
 * gegen eine gleichfoermige Tagesverschiebung blind, weil seine Zusicherungen
 * Zugehoerigkeit und Abstand pinnten, aber nicht die absolute Lage. Jede
 * Erwartung hier ist deshalb ein LITERAL — kein Aufruf von
 * `shiftPlanningWeek`, `planningWeekDateRange` oder `planningWeekKey`. Ein Test,
 * der seine Erwartung mit denselben Funktionen berechnet, die er prueft,
 * vergleicht eine Reimplementierung mit sich selbst und bleibt bei jedem
 * gemeinsamen Fehler gruen.
 *
 * Die Literale sind am 18.08.2026 unabhaengig gegen das gebaute
 * `packages/domain/dist` und `packages/contracts/dist` gerechnet worden, nicht
 * im Kopf gesetzt.
 *
 * Der Jahreswechsel ist der Fall, der zaehlt: **2026 hat 53 ISO-Wochen**, 2025
 * und 2027 haben 52. Genau dort trennt sich eine Rechnung ueber den Montag von
 * einem `isoWeek ± 1`, das in der Jahresmitte fehlerfrei aussieht.
 */
import { EUROPE_BERLIN, createTimeZone } from "@easytree/domain";
import type { IanaTimeZone } from "@easytree/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wochenmodell } from "../lib/wochennavigation";
import type { Wochenmodell } from "../lib/wochennavigation";

/**
 * Engt das Modell auf den Wochenfall ein und scheitert LAUT, wenn es
 * fehlerhaft ist. Ohne diesen Umweg wuerde ein `expect(modell.schluessel)` auf
 * dem Fehlerzweig zu `undefined === undefined` degenerieren, sobald jemand die
 * Erwartung ebenfalls auf `undefined` setzt.
 */
function alsWoche(modell: Wochenmodell): Extract<Wochenmodell, { art: "woche" }> {
  if (modell.art !== "woche") {
    throw new Error(`Erwartet: art="woche". Erhalten: art="${modell.art}".`);
  }
  return modell;
}

/** Ein Zeitpunkt, der in Europe/Berlin sicher in der Woche 2026-W32 liegt. */
const IN_W32 = new Date("2026-08-05T10:00:00Z");

const UTC: IanaTimeZone = (() => {
  const ergebnis = createTimeZone("UTC");
  if (!ergebnis.ok) throw new Error("Zone UTC nicht konstruierbar.");
  return ergebnis.timeZone;
})();

afterEach(() => {
  vi.useRealTimers();
});

describe("wochenmodell — der Parameter aus der URL", () => {
  it("weist einen mehrfach angegebenen Parameter als fehlerhaft zurueck", () => {
    // Next liefert ein Array genau dann, wenn `weekKey` mehrfach in der Adresse
    // steht. Ein stilles Reduzieren auf den ersten Wert waere eine Antwort auf
    // eine Frage, die so nicht gestellt wurde — die bestehende Regel aus
    // `app/planung/page.tsx` wird uebernommen, nicht aufgeweicht.
    expect(
      wochenmodell({
        weekKeyAusUrl: ["2026-W32", "2026-W33"],
        jetzt: IN_W32,
        zone: EUROPE_BERLIN,
      }).art,
    ).toBe("fehlerhaft");

    // Auch ein einelementiges Array bleibt eine Mehrfachangabe: eine einmalige
    // Angabe kommt als Zeichenkette an, nie als Array.
    expect(
      wochenmodell({ weekKeyAusUrl: ["2026-W32"], jetzt: IN_W32, zone: EUROPE_BERLIN }).art,
    ).toBe("fehlerhaft");
  });

  it.each([
    ["2026-W54", "Woche jenseits von 53"],
    ["2026-W00", "Woche null"],
    ["2025-W53", "53. Woche in einem Jahr mit 52"],
    ["26-W32", "zweistelliges Jahr"],
    ["2026-w32", "kleines w"],
    ["", "leere Zeichenkette"],
    ["heute", "gar kein Schluessel"],
  ])("weist %s als fehlerhaft zurueck (%s)", (roh) => {
    expect(wochenmodell({ weekKeyAusUrl: roh, jetzt: IN_W32, zone: EUROPE_BERLIN }).art).toBe(
      "fehlerhaft",
    );
  });

  it("nimmt einen gueltigen Schluessel an, statt ihn zu ueberschreiben", () => {
    // Die angezeigte Woche ist die ANGEFORDERTE, nicht die laufende. Ein
    // Rueckfall auf `heute` waere die stille Variante: die Planerin saehe eine
    // plausible Woche, aber nicht die, die sie aufgerufen hat.
    const modell = alsWoche(
      wochenmodell({ weekKeyAusUrl: "2026-W10", jetzt: IN_W32, zone: EUROPE_BERLIN }),
    );
    expect(modell.schluessel).toBe("2026-W10");
  });
});

describe("wochenmodell — welche Woche `heute` ist", () => {
  it("leitet ohne Parameter die Woche aus `jetzt` und der genannten Zone ab", () => {
    const modell = alsWoche(
      wochenmodell({ weekKeyAusUrl: undefined, jetzt: IN_W32, zone: EUROPE_BERLIN }),
    );
    expect(modell.schluessel).toBe("2026-W32");
    expect(modell.istAktuelleWoche).toBe(true);
    expect(modell.heuteUrl).toBe("/planung?weekKey=2026-W32");
  });

  it("laesst die ZONE entscheiden, nicht UTC", () => {
    // 2026-08-02T22:30Z ist in Europe/Berlin (UTC+2) bereits Montag, der
    // 03.08.2026 00:30 — also Woche 32. In UTC ist es noch Sonntag, der
    // 02.08.2026 — Woche 31. Eine Implementierung, die den Zonenparameter
    // entgegennimmt und dann doch `getUTCDay` auf dem Instant rechnet, ist
    // genau hier rot und in jedem anderen Fall dieser Datei gruen.
    const grenze = new Date("2026-08-02T22:30:00Z");

    expect(
      alsWoche(wochenmodell({ weekKeyAusUrl: undefined, jetzt: grenze, zone: EUROPE_BERLIN }))
        .schluessel,
    ).toBe("2026-W32");

    expect(
      alsWoche(wochenmodell({ weekKeyAusUrl: undefined, jetzt: grenze, zone: UTC })).schluessel,
    ).toBe("2026-W31");
  });

  it("legt den 1. Januar 2027 noch in 2026-W53", () => {
    // Die Donnerstagsregel, absolut gepinnt. Wer das ISO-Jahr aus
    // `getFullYear()` nimmt, schreibt hier `2027-...` und faellt durch.
    expect(
      alsWoche(
        wochenmodell({
          weekKeyAusUrl: undefined,
          jetzt: new Date("2027-01-01T12:00:00Z"),
          zone: EUROPE_BERLIN,
        }),
      ).schluessel,
    ).toBe("2026-W53");

    expect(
      alsWoche(
        wochenmodell({
          weekKeyAusUrl: undefined,
          jetzt: new Date("2026-12-31T12:00:00Z"),
          zone: EUROPE_BERLIN,
        }),
      ).schluessel,
    ).toBe("2026-W53");
  });

  it("liest keine Uhr, sondern ausschliesslich den uebergebenen Zeitpunkt", () => {
    // Die Systemzeit wird auf einen Zeitpunkt gestellt, der in einer voellig
    // anderen Woche liegt. Bleibt das Ergebnis 2026-W32, kann die Funktion
    // `new Date()` nicht gelesen haben. Diese Zusicherung ist der Grund, warum
    // `jetzt` ueberhaupt ein Parameter ist.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2000-06-15T08:00:00Z"));

    const modell = alsWoche(
      wochenmodell({ weekKeyAusUrl: undefined, jetzt: IN_W32, zone: EUROPE_BERLIN }),
    );
    expect(modell.schluessel).toBe("2026-W32");
    expect(modell.heuteUrl).toBe("/planung?weekKey=2026-W32");
  });

  it("zeigt mit `heuteUrl` auf die LAUFENDE Woche, nicht auf die angezeigte", () => {
    // Eine Implementierung, die `heuteUrl` aus dem angezeigten Schluessel baut,
    // ist in jedem Fall gruen, in dem beide gleich sind — und macht die
    // Schaltflaeche „Heute" zu einem Link auf sich selbst.
    const modell = alsWoche(
      wochenmodell({ weekKeyAusUrl: "2026-W10", jetzt: IN_W32, zone: EUROPE_BERLIN }),
    );
    expect(modell.schluessel).toBe("2026-W10");
    expect(modell.heuteUrl).toBe("/planung?weekKey=2026-W32");
    expect(modell.istAktuelleWoche).toBe(false);
  });

  it("meldet `istAktuelleWoche`, wenn der explizite Schluessel die laufende Woche ist", () => {
    const modell = alsWoche(
      wochenmodell({ weekKeyAusUrl: "2026-W32", jetzt: IN_W32, zone: EUROPE_BERLIN }),
    );
    expect(modell.istAktuelleWoche).toBe(true);
  });
});

describe("wochenmodell — die Nachbarwochen, absolut", () => {
  // Die Tabelle pinnt die LAGE, nicht den Abstand. Eine Ableitung, die alle
  // Wochen gleichfoermig um eins verschiebt, erfuellt jede Abstandszusicherung
  // und faellt hier in jeder Zeile durch. Die Zeilen um den Jahreswechsel
  // 2026/2027 sind zusaetzlich asymmetrisch: vorherige und naechste liessen
  // sich nicht vertauschen, ohne dass es auffaellt.
  it.each([
    // schluessel   | vorherige   | naechste
    ["2026-W53", "2026-W52", "2027-W01"],
    ["2027-W01", "2026-W53", "2027-W02"],
    ["2026-W01", "2025-W52", "2026-W02"],
    ["2025-W52", "2025-W51", "2026-W01"],
    ["2026-W32", "2026-W31", "2026-W33"],
  ])("verlinkt von %s auf %s zurueck und auf %s vorwaerts", (schluessel, vorher, nachher) => {
    const modell = alsWoche(
      wochenmodell({ weekKeyAusUrl: schluessel, jetzt: IN_W32, zone: EUROPE_BERLIN }),
    );
    expect(modell.schluessel).toBe(schluessel);
    expect(modell.vorherigeUrl).toBe(`/planung?weekKey=${vorher}`);
    expect(modell.naechsteUrl).toBe(`/planung?weekKey=${nachher}`);
  });

  it("behandelt eine Woche ohne darstellbaren Nachbarn als fehlerhaft statt zu werfen", () => {
    // `shiftPlanningWeek` wirft ausserhalb der Vertragsgrenze 0001–9999
    // (gemessen: `9999-W52` vorwaerts und `0001-W01` rueckwaerts). Beide
    // Schluessel sind fuer sich gueltig und koennen in der Adresse stehen. Ein
    // durchgereichter `RangeError` wuerde die Server-Komponente sprengen; ein
    // halbes Modell mit einem Link, der nirgends hinfuehrt, waere die stille
    // Variante. Also: kein vollstaendiges Navigationsmodell, kein Modell.
    expect(
      wochenmodell({ weekKeyAusUrl: "9999-W52", jetzt: IN_W32, zone: EUROPE_BERLIN }).art,
    ).toBe("fehlerhaft");
    expect(
      wochenmodell({ weekKeyAusUrl: "0001-W01", jetzt: IN_W32, zone: EUROPE_BERLIN }).art,
    ).toBe("fehlerhaft");
  });
});

describe("wochenmodell — die Texte", () => {
  it.each([
    // schluessel | zeitraumText
    ["2026-W53", "28.12.2026 – 03.01.2027"],
    ["2026-W01", "29.12.2025 – 04.01.2026"],
    ["2026-W32", "03.08.2026 – 09.08.2026"],
  ])("nennt fuer %s den Zeitraum %s", (schluessel, erwartet) => {
    // Absolute Kalendertage mit fuehrenden Nullen. Die Zeile 2026-W53 faengt
    // zusaetzlich eine Vertauschung von Tag und Monat: „28.12." waere als
    // „12.28." unmoeglich, und „03.01.2027" wuerde vertauscht zu „01.03.2027".
    const modell = alsWoche(
      wochenmodell({ weekKeyAusUrl: schluessel, jetzt: IN_W32, zone: EUROPE_BERLIN }),
    );
    expect(modell.zeitraumText).toBe(erwartet);
  });

  it.each([
    ["2026-W01", "KW 01 · 2026"],
    ["2026-W53", "KW 53 · 2026"],
    ["2025-W52", "KW 52 · 2025"],
  ])("beschriftet %s als %s", (schluessel, erwartet) => {
    // 2026-W01 ist die tragende Zeile: ihr Montag ist der 29.12.2025. Wer das
    // Jahr aus dem Zeitraum statt aus der ISO-Woche nimmt, schreibt hier
    // „KW 01 · 2025".
    const modell = alsWoche(
      wochenmodell({ weekKeyAusUrl: schluessel, jetzt: IN_W32, zone: EUROPE_BERLIN }),
    );
    expect(modell.isoWochenText).toBe(erwartet);
  });
});
