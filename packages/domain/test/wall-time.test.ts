/**
 * Wanduhrzeit -> UTC (EYT-92).
 *
 * Sobald ein Mensch Datum, Beginn und Ende EINGIBT, entsteht genau die
 * Umrechnung, die `docs/audit/INTEGRATION_ARCHITECTURE.md` verlangt und die es
 * im Repository bisher nur in einer Richtung gab. Diese Suite fixiert die
 * Gegenrichtung — vor allem an den zwei Tagen im Jahr, an denen sie bricht.
 *
 * ## Gegenmutationen
 *
 * 1. Ersetzt man in `utcInstantOfLocalWallTime` den zweiten Korrekturschritt
 *    durch den ersten (`zweiterVersuch = ersterVersuch`), wird
 *    „Sommerzeitbeginn, 03:30" rot: der Offset des Naeherungswerts stammt noch
 *    aus der Winterzeit, das Ergebnis liegt eine Stunde daneben.
 * 2. Entfernt man die Rueckleseprobe `zeigtGewuenschteZeit` und gibt
 *    `zweiterVersuch` unbesehen zurueck, wird „02:30 existiert nicht" rot —
 *    die Funktion erfindet dann still einen Zeitpunkt.
 * 3. Ersetzt man die Mehrdeutigkeitspruefung durch „nimm den ersten Treffer",
 *    wird „02:30 am Rueckstellungstag ist mehrdeutig" rot.
 */
import { describe, expect, it } from "vitest";

import {
  EUROPE_BERLIN,
  localBusinessDate,
  utcInstantOfLocalWallTime,
  type LocalWallTime,
} from "../src/planning-week.js";

const wall = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): LocalWallTime => ({ date: { year, month, day }, hour, minute });

describe("utcInstantOfLocalWallTime — regulaere Tage", () => {
  it("rechnet Winterzeit mit +01:00", () => {
    const r = utcInstantOfLocalWallTime(wall(2026, 1, 15, 8, 0), EUROPE_BERLIN);
    expect(r.ok).toBe(true);
    expect(r.ok && r.instant.toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });

  it("rechnet Sommerzeit mit +02:00", () => {
    const r = utcInstantOfLocalWallTime(wall(2026, 8, 3, 8, 0), EUROPE_BERLIN);
    expect(r.ok).toBe(true);
    expect(r.ok && r.instant.toISOString()).toBe("2026-08-03T06:00:00.000Z");
  });

  it("legt Mitternacht Ortszeit auf den VORTAG in UTC", () => {
    // Genau der Fall aus dem Dateikopf von planning-week.ts: wer die Woche aus
    // startUtc ableitet, legt diese Schicht in die falsche Woche.
    const r = utcInstantOfLocalWallTime(wall(2026, 8, 3, 0, 30), EUROPE_BERLIN);
    expect(r.ok).toBe(true);
    expect(r.ok && r.instant.toISOString()).toBe("2026-08-02T22:30:00.000Z");
  });

  it("ist die exakte Umkehrung von localBusinessDate", () => {
    for (const monat of [1, 3, 4, 6, 7, 10, 11, 12]) {
      const r = utcInstantOfLocalWallTime(wall(2026, monat, 15, 14, 45), EUROPE_BERLIN);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(localBusinessDate(r.instant, EUROPE_BERLIN)).toEqual({
        year: 2026,
        month: monat,
        day: 15,
      });
    }
  });
});

describe("utcInstantOfLocalWallTime — Sommerzeitbeginn 2026-03-29", () => {
  // Europe/Berlin springt von 02:00 auf 03:00. 02:00–02:59 existiert nicht.
  it("meldet 02:30 als nicht existierend statt einen Zeitpunkt zu erfinden", () => {
    const r = utcInstantOfLocalWallTime(wall(2026, 3, 29, 2, 30), EUROPE_BERLIN);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("NONEXISTENT_LOCAL_TIME");
  });

  it("meldet 02:00 als nicht existierend", () => {
    const r = utcInstantOfLocalWallTime(wall(2026, 3, 29, 2, 0), EUROPE_BERLIN);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("NONEXISTENT_LOCAL_TIME");
  });

  it("rechnet 01:30 davor noch mit +01:00", () => {
    const r = utcInstantOfLocalWallTime(wall(2026, 3, 29, 1, 30), EUROPE_BERLIN);
    expect(r.ok).toBe(true);
    expect(r.ok && r.instant.toISOString()).toBe("2026-03-29T00:30:00.000Z");
  });

  it("rechnet 03:30 danach schon mit +02:00", () => {
    // Gegenmutation 1 macht genau diesen Fall rot.
    const r = utcInstantOfLocalWallTime(wall(2026, 3, 29, 3, 30), EUROPE_BERLIN);
    expect(r.ok).toBe(true);
    expect(r.ok && r.instant.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
});

describe("utcInstantOfLocalWallTime — Sommerzeitende 2026-10-25", () => {
  // Die Uhr springt von 03:00 auf 02:00 zurueck. 02:00–02:59 existiert zweimal.
  it("meldet 02:30 als mehrdeutig statt still eine Stunde zu waehlen", () => {
    const r = utcInstantOfLocalWallTime(wall(2026, 10, 25, 2, 30), EUROPE_BERLIN);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("AMBIGUOUS_LOCAL_TIME");
  });

  it("rechnet 01:30 davor eindeutig mit +02:00", () => {
    const r = utcInstantOfLocalWallTime(wall(2026, 10, 25, 1, 30), EUROPE_BERLIN);
    expect(r.ok).toBe(true);
    expect(r.ok && r.instant.toISOString()).toBe("2026-10-24T23:30:00.000Z");
  });

  it("rechnet 03:30 danach eindeutig mit +01:00", () => {
    const r = utcInstantOfLocalWallTime(wall(2026, 10, 25, 3, 30), EUROPE_BERLIN);
    expect(r.ok).toBe(true);
    expect(r.ok && r.instant.toISOString()).toBe("2026-10-25T02:30:00.000Z");
  });
});

describe("utcInstantOfLocalWallTime — abgelehnte Eingaben", () => {
  it("lehnt Jahr 0 ab, wie isoWeekOfLocalDate", () => {
    expect(() => utcInstantOfLocalWallTime(wall(0, 1, 1, 8, 0), EUROPE_BERLIN)).toThrow(RangeError);
  });

  it("lehnt Stunde 24 ab", () => {
    expect(() => utcInstantOfLocalWallTime(wall(2026, 8, 3, 24, 0), EUROPE_BERLIN)).toThrow(
      RangeError,
    );
  });

  it("lehnt Minute 60 ab", () => {
    expect(() => utcInstantOfLocalWallTime(wall(2026, 8, 3, 8, 60), EUROPE_BERLIN)).toThrow(
      RangeError,
    );
  });
});
