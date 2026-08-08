/**
 * Beispielfaelle der Tagesallokation (EYT-109, S5-REQ-05).
 *
 * ## Was hier belegt werden muss
 *
 * `allocateAcrossLocalDays` ist die tragende Rechnung des Tageskosten-Schnitts.
 * Alles danach — Snapshotzeilen, Tagessummen, der Excel-Export aus EYT-110 —
 * ist falsch, wenn sie falsch ist, und zwar auf eine Weise, die plausibel
 * aussieht. Deshalb ist jeder Fall hier so gewaehlt, dass eine NAHELIEGENDE
 * FALSCHE Implementierung nachweislich etwas anderes liefert:
 *
 *   - UTC-Tag statt Ortstag (Fall "ordnet ... dem ORTSTAG zu");
 *   - Wanduhrdifferenz statt verstrichener Dauer (die beiden Umstellungstage);
 *   - Vorabberechnung der Tagesgrenze auch dann, wenn sie gar nicht gebraucht
 *     wird (die beiden "blockiert nicht"-Faelle);
 *   - stilles Waehlen eines Zweiges an einer kaputten Mitternacht (die beiden
 *     blockierenden Faelle).
 *
 * ## Die Zonen und Daten sind gemessen, nicht angenommen
 *
 * Gemessen am 08.08.2026 gegen die Zonendatenbank dieser Laufzeit (Node
 * v24.16.0), indem das 52-Stunden-Fenster um den jeweiligen UTC-Tag im
 * Minutenraster abgetastet und gezaehlt wurde, wie oft die lokale Wanduhr
 * `00:00` des gesuchten Kalendertages zeigt:
 *
 *   | Zone             | Datum      | Treffer | Bedeutung             |
 *   | ---------------- | ---------- | ------- | --------------------- |
 *   | America/Santiago | 2026-09-06 | 0       | Mitternacht fehlt     |
 *   | America/Havana   | 2026-03-08 | 0       | Mitternacht fehlt     |
 *   | Asia/Beirut      | 2026-03-29 | 0       | Mitternacht fehlt     |
 *   | America/Havana   | 2026-11-01 | 2       | Mitternacht doppelt   |
 *   | Atlantic/Azores  | 2026-10-25 | 2       | Mitternacht doppelt   |
 *   | Europe/Berlin    | 2026-03-29 | 1       | eindeutig             |
 *   | Europe/Berlin    | 2026-10-25 | 1       | eindeutig             |
 *
 * Europe/Berlin stellt um 02:00/03:00 um und erreicht die beiden blockierenden
 * Zweige deshalb NIE. Genau darum stehen fremde Zonen hier: die Pilotzone kann
 * sie nicht belegen, und ein unbelegter Zweig ist eine Behauptung.
 */
import { describe, expect, it } from "vitest";

import {
  allocateAcrossLocalDays,
  createTimeZone,
  EUROPE_BERLIN,
  LOCAL_DAY_ALLOCATION_ERRORS,
  TimeInterval,
} from "../src/index.js";
import type { IanaTimeZone, LocalDayAllocationResult } from "../src/index.js";

const STUNDE = 3_600_000n;

function intervall(startIso: string, endeIso: string): TimeInterval {
  const gebaut = TimeInterval.create(new Date(startIso), new Date(endeIso));
  if (!gebaut.ok) throw new Error(`Testfixture ungueltig: ${gebaut.error}`);
  return gebaut.interval;
}

/** Zone aus einer Kennung — bricht laut ab, statt den Fall still zu ueberspringen. */
function zone(id: string): IanaTimeZone {
  const gebaut = createTimeZone(id);
  if (!gebaut.ok) throw new Error(`Zone ${id} ist dieser Laufzeit unbekannt.`);
  return gebaut.timeZone;
}

/** Tage und Mengen in einer vergleichbaren Form — liest sich als Tabelle. */
function tabelle(ergebnis: LocalDayAllocationResult): { tag: string; stunden: number }[] {
  if (!ergebnis.ok) throw new Error(`Erwartet war ein Ergebnis, erhalten: ${ergebnis.error}`);
  return ergebnis.parts.map((teil) => ({
    tag: `${String(teil.date.year)}-${String(teil.date.month).padStart(2, "0")}-${String(teil.date.day).padStart(2, "0")}`,
    stunden: Number(teil.quantity.milliseconds) / 3_600_000,
  }));
}

function summeMs(ergebnis: LocalDayAllocationResult): bigint {
  if (!ergebnis.ok) throw new Error(`Erwartet war ein Ergebnis, erhalten: ${ergebnis.error}`);
  return ergebnis.parts.reduce((summe, teil) => summe + teil.quantity.milliseconds, 0n);
}

describe("allocateAcrossLocalDays — innerhalb eines Ortstages", () => {
  it("laesst einen Einsatz innerhalb eines lokalen Tages ungeteilt", () => {
    // 2026-08-03 08:00–16:00 Europe/Berlin (UTC+2).
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-08-03T06:00:00.000Z", "2026-08-03T14:00:00.000Z"),
      EUROPE_BERLIN,
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.parts).toHaveLength(1);
    expect(ergebnis.parts[0]?.date).toEqual({ year: 2026, month: 8, day: 3 });
    expect(ergebnis.parts[0]?.quantity.milliseconds).toBe(8n * STUNDE);
  });

  it("ordnet einer UTC-Zuordnung widersprechend dem ORTSTAG zu", () => {
    // 2026-08-02T22:30Z ist in Europe/Berlin bereits Montag, der 3. August,
    // 00:30 Uhr. Gemessen: der Instant zeigt dort `2026-08-03 00:30`.
    //
    // Das ist der unterscheidende Gegenfall. Wer den UTC-Tag nimmt, liefert
    // ZWEI Anteile — 2. August (1,5 h) und 3. August (6,5 h) — und traegt die
    // halbe Nachtschicht auf einem Arbeitstag ein, an dem vor Ort niemand
    // gearbeitet hat.
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-08-02T22:30:00.000Z", "2026-08-03T06:30:00.000Z"),
      EUROPE_BERLIN,
    );
    expect(tabelle(ergebnis)).toEqual([{ tag: "2026-08-03", stunden: 8 }]);
  });
});

describe("allocateAcrossLocalDays — ueber lokale Mitternacht", () => {
  it("teilt an der lokalen Mitternacht auf zwei Kalendertage", () => {
    // 2026-08-03 22:00 – 2026-08-04 02:00 Europe/Berlin.
    // Gemessene Mitternacht des 4. August: 2026-08-03T22:00:00Z.
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-08-03T20:00:00.000Z", "2026-08-04T00:00:00.000Z"),
      EUROPE_BERLIN,
    );
    expect(tabelle(ergebnis)).toEqual([
      { tag: "2026-08-03", stunden: 2 },
      { tag: "2026-08-04", stunden: 2 },
    ]);
    expect(summeMs(ergebnis)).toBe(4n * STUNDE);
  });

  it("verteilt einen Einsatz ueber vier Ortstage in aufsteigender Reihenfolge", () => {
    // Beginnt 2026-08-03 00:30 Ortszeit und endet 2026-08-06 06:00 Ortszeit.
    // Beweist die Schleife, nicht nur den Zweitagesfall — und zugleich, dass
    // der ERSTE Tag der 3. ist und nicht der 2. (UTC-Tag des Beginns).
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-08-02T22:30:00.000Z", "2026-08-06T04:00:00.000Z"),
      EUROPE_BERLIN,
    );
    expect(tabelle(ergebnis)).toEqual([
      { tag: "2026-08-03", stunden: 23.5 },
      { tag: "2026-08-04", stunden: 24 },
      { tag: "2026-08-05", stunden: 24 },
      { tag: "2026-08-06", stunden: 6 },
    ]);
    expect(summeMs(ergebnis)).toBe(77n * STUNDE + 1_800_000n);
  });
});

describe("allocateAcrossLocalDays — Sommerzeitumstellung", () => {
  it("erhaelt die Summe ueber den Sommerzeitbeginn — der Ortstag hat 23 Stunden", () => {
    // Europe/Berlin springt am 2026-03-29 von 02:00 auf 03:00.
    // Gemessene Mitternachten: 29.03. = 2026-03-28T23:00Z, 30.03. = 2026-03-29T22:00Z.
    // Der 29. Maerz ist zwischen diesen beiden Instants also 23 Stunden lang.
    //
    // Wer die Wanduhrdifferenz nimmt, traegt dort 24 Stunden ein und erfindet
    // eine Stunde Personalkosten.
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-03-28T20:00:00.000Z", "2026-03-30T02:00:00.000Z"),
      EUROPE_BERLIN,
    );
    expect(tabelle(ergebnis)).toEqual([
      { tag: "2026-03-28", stunden: 3 },
      { tag: "2026-03-29", stunden: 23 },
      { tag: "2026-03-30", stunden: 4 },
    ]);
    // Die tragende Zusicherung: verstrichene Dauer, nicht Wanduhrdifferenz.
    expect(summeMs(ergebnis)).toBe(30n * STUNDE);
  });

  it("erhaelt die Summe ueber das Sommerzeitende — der Ortstag hat 25 Stunden", () => {
    // Europe/Berlin springt am 2026-10-25 von 03:00 auf 02:00.
    // Gemessene Mitternachten: 25.10. = 2026-10-24T22:00Z, 26.10. = 2026-10-25T23:00Z.
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-10-24T20:00:00.000Z", "2026-10-26T02:00:00.000Z"),
      EUROPE_BERLIN,
    );
    expect(tabelle(ergebnis)).toEqual([
      { tag: "2026-10-24", stunden: 2 },
      { tag: "2026-10-25", stunden: 25 },
      { tag: "2026-10-26", stunden: 3 },
    ]);
    expect(summeMs(ergebnis)).toBe(30n * STUNDE);
  });
});

describe("allocateAcrossLocalDays — kaputte Tagesgrenze", () => {
  it("blockiert, wenn die lokale Mitternacht in der Zone nicht existiert", () => {
    // America/Santiago beginnt die Sommerzeit am 2026-09-06 um 24:00 des
    // Vortages: die Uhr springt von 00:00 auf 01:00, den Zeitpunkt
    // `2026-09-06 00:00` gibt es dort nicht. Gemessen: 0 Treffer.
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-09-05T20:00:00.000Z", "2026-09-06T20:00:00.000Z"),
      zone("America/Santiago"),
    );
    expect(ergebnis).toEqual({ ok: false, error: "DAY_BOUNDARY_NONEXISTENT" });
  });

  it("blockiert auch in America/Havana und Asia/Beirut an ihrer fehlenden Mitternacht", () => {
    // Zwei weitere gemessene Zonen mit Umstellung um Mitternacht. Ein einziger
    // Beleg liesse offen, ob der Zweig an einer Eigenheit von Santiago haengt.
    expect(
      allocateAcrossLocalDays(
        intervall("2026-03-07T20:00:00.000Z", "2026-03-08T20:00:00.000Z"),
        zone("America/Havana"),
      ),
    ).toEqual({ ok: false, error: "DAY_BOUNDARY_NONEXISTENT" });
    expect(
      allocateAcrossLocalDays(
        intervall("2026-03-28T20:00:00.000Z", "2026-03-29T20:00:00.000Z"),
        zone("Asia/Beirut"),
      ),
    ).toEqual({ ok: false, error: "DAY_BOUNDARY_NONEXISTENT" });
  });

  it("blockiert, wenn die lokale Mitternacht zweimal vorkommt", () => {
    // America/Havana beendet die Sommerzeit am 2026-11-01 um 01:00 -> 00:00.
    // Gemessen: `2026-11-01 00:00` existiert zweimal, um 04:00Z und 05:00Z.
    // Eine stille Wahl verschoebe die ganze Nachtschicht um eine Stunde.
    const ergebnis = allocateAcrossLocalDays(
      intervall("2026-10-31T20:00:00.000Z", "2026-11-01T20:00:00.000Z"),
      zone("America/Havana"),
    );
    expect(ergebnis).toEqual({ ok: false, error: "DAY_BOUNDARY_AMBIGUOUS" });
  });

  it("blockiert auch in Atlantic/Azores an ihrer doppelten Mitternacht", () => {
    expect(
      allocateAcrossLocalDays(
        intervall("2026-10-24T20:00:00.000Z", "2026-10-25T20:00:00.000Z"),
        zone("Atlantic/Azores"),
      ),
    ).toEqual({ ok: false, error: "DAY_BOUNDARY_AMBIGUOUS" });
  });

  it("blockiert NICHT, wenn die kaputte Mitternacht gar nicht gebraucht wird", () => {
    // Beide Einsaetze liegen vollstaendig innerhalb des Tages VOR der kaputten
    // Grenze. Eine Implementierung, die die naechste Tagesgrenze berechnet,
    // bevor sie prueft, ob sie ueberhaupt gebraucht wird, blockiert hier
    // faelschlich — und eine ganz normale Tagschicht in Santiago waere nicht
    // abrechenbar.
    const santiago = allocateAcrossLocalDays(
      intervall("2026-09-05T12:00:00.000Z", "2026-09-05T15:00:00.000Z"),
      zone("America/Santiago"),
    );
    expect(tabelle(santiago)).toEqual([{ tag: "2026-09-05", stunden: 3 }]);

    const havanna = allocateAcrossLocalDays(
      intervall("2026-10-31T20:00:00.000Z", "2026-10-31T23:00:00.000Z"),
      zone("America/Havana"),
    );
    expect(tabelle(havanna)).toEqual([{ tag: "2026-10-31", stunden: 3 }]);
  });
});

describe("LOCAL_DAY_ALLOCATION_ERRORS", () => {
  it("fuehrt jeden Tagesgrenzen-Fehlercode genau einmal und erreicht jeden", () => {
    expect(LOCAL_DAY_ALLOCATION_ERRORS.length).toBe(new Set(LOCAL_DAY_ALLOCATION_ERRORS).size);
    expect([...LOCAL_DAY_ALLOCATION_ERRORS].sort()).toEqual([
      "DAY_BOUNDARY_AMBIGUOUS",
      "DAY_BOUNDARY_NONEXISTENT",
    ]);

    // Erreichbarkeit, nicht nur Auflistung: jeder Code wird von einer konkreten
    // Eingabe erzeugt. Eine Liste mit einem Code, den nichts ausloest, waere
    // eine Zusage ohne Beleg.
    const erzeugt = new Set(
      [
        allocateAcrossLocalDays(
          intervall("2026-09-05T20:00:00.000Z", "2026-09-06T20:00:00.000Z"),
          zone("America/Santiago"),
        ),
        allocateAcrossLocalDays(
          intervall("2026-10-31T20:00:00.000Z", "2026-11-01T20:00:00.000Z"),
          zone("America/Havana"),
        ),
      ]
        .filter((ergebnis) => !ergebnis.ok)
        .map((ergebnis) => (ergebnis.ok ? "" : ergebnis.error)),
    );
    expect([...erzeugt].sort()).toEqual([...LOCAL_DAY_ALLOCATION_ERRORS].sort());
  });
});
