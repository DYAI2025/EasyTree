import { describe, expect, it } from "vitest";

import {
  createTimeInterval,
  durationMinutes,
  hasAnyOverlap,
  isAdjacent,
  overlaps,
  TIME_INTERVAL_ERRORS,
  type TimeInterval,
} from "../src/time-interval.js";

/** Kurzform fuer gueltige Intervalle im Test. Wirft, damit ein Testfehler auffaellt. */
function interval(startIso: string, endIso: string): TimeInterval {
  const result = createTimeInterval(new Date(startIso), new Date(endIso));
  if (!result.ok) throw new Error(`Fixture ungueltig: ${startIso}..${endIso} -> ${result.error}`);
  return result.interval;
}

function errorOf(start: Date | null | undefined, end: Date | null | undefined): string {
  const result = createTimeInterval(start, end);
  return result.ok ? "OK" : result.error;
}

describe("createTimeInterval — Ablehnungen", () => {
  it("verlangt einen Start", () => {
    expect(errorOf(null, new Date("2026-08-03T16:00:00Z"))).toBe("START_MISSING");
    expect(errorOf(undefined, new Date("2026-08-03T16:00:00Z"))).toBe("START_MISSING");
  });

  it("verlangt ein Ende", () => {
    expect(errorOf(new Date("2026-08-03T08:00:00Z"), null)).toBe("END_MISSING");
    expect(errorOf(new Date("2026-08-03T08:00:00Z"), undefined)).toBe("END_MISSING");
  });

  it("lehnt unbrauchbare Zeitpunkte ab", () => {
    expect(errorOf(new Date("kaputt"), new Date("2026-08-03T16:00:00Z"))).toBe("START_INVALID");
    expect(errorOf(new Date("2026-08-03T08:00:00Z"), new Date("kaputt"))).toBe("END_INVALID");
  });

  it("lehnt gleiche Zeiten ab — der 24-Stunden-Bug aus dem Prototyp", () => {
    // 07:00-07:00 galt dort als voller Tag. Hier ist es kein Intervall.
    const sameMoment = new Date("2026-08-03T07:00:00Z");
    expect(errorOf(sameMoment, new Date(sameMoment.getTime()))).toBe("START_EQUALS_END");
  });

  it("lehnt ein verkehrtes Intervall ab, statt es als Nachtschicht umzudeuten", () => {
    // 15:30 -> 07:00 am SELBEN Tag. Der Prototyp addierte hier 24 Stunden.
    expect(errorOf(new Date("2026-08-03T15:30:00Z"), new Date("2026-08-03T07:00:00Z"))).toBe(
      "END_BEFORE_START",
    );
  });

  it("lehnt schon eine Millisekunde Rueckwaertsdifferenz ab", () => {
    const start = new Date("2026-08-03T08:00:00.001Z");
    const end = new Date("2026-08-03T08:00:00.000Z");
    expect(errorOf(start, end)).toBe("END_BEFORE_START");
  });

  it("fuehrt jeden Fehlercode genau einmal", () => {
    expect(new Set(TIME_INTERVAL_ERRORS).size).toBe(TIME_INTERVAL_ERRORS.length);
  });
});

describe("createTimeInterval — Annahmen", () => {
  it("akzeptiert eine Millisekunde", () => {
    const result = createTimeInterval(
      new Date("2026-08-03T08:00:00.000Z"),
      new Date("2026-08-03T08:00:00.001Z"),
    );
    expect(result.ok).toBe(true);
  });

  it("akzeptiert eine Schicht ueber Mitternacht als aufsteigende Instants", () => {
    // Genau der Fall, den der Prototyp raten musste — hier ist er eindeutig,
    // weil das Datum mitkommt.
    const nightShift = interval("2026-08-03T15:30:00Z", "2026-08-04T07:00:00Z");
    expect(durationMinutes(nightShift)).toBe(15.5 * 60);
  });

  it("entkoppelt sich vom uebergebenen Date-Objekt", () => {
    const start = new Date("2026-08-03T08:00:00Z");
    const end = new Date("2026-08-03T16:00:00Z");
    const result = createTimeInterval(start, end);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    start.setUTCFullYear(1999);
    expect(result.interval.startUtc.toISOString()).toBe("2026-08-03T08:00:00.000Z");
  });
});

describe("durationMinutes", () => {
  it("rechnet exakt, ohne zu runden", () => {
    expect(durationMinutes(interval("2026-08-03T08:00:00Z", "2026-08-03T08:00:30Z"))).toBe(0.5);
    expect(durationMinutes(interval("2026-08-03T08:00:00Z", "2026-08-03T16:00:00Z"))).toBe(480);
  });

  it("zaehlt ueber die Sommerzeitluecke die tatsaechlich verstrichene Zeit", () => {
    // Europe/Berlin springt am 29.03.2026 von 02:00 auf 03:00 Ortszeit.
    // Ortszeitdifferenz 01:00 -> 04:00 sind scheinbar 3 h, verstrichen sind 2 h.
    const acrossGap = interval("2026-03-29T00:00:00Z", "2026-03-29T02:00:00Z");
    expect(durationMinutes(acrossGap)).toBe(120);
  });

  it("zaehlt ueber die doppelte Winterzeitstunde ebenso die verstrichene Zeit", () => {
    // 25.10.2026, 02:00 Ortszeit faellt zweimal an. In UTC bleibt es linear.
    const acrossFold = interval("2026-10-25T00:00:00Z", "2026-10-25T03:00:00Z");
    expect(durationMinutes(acrossFold)).toBe(180);
  });
});

describe("overlaps — halb-offen [start, end)", () => {
  const morning = interval("2026-08-03T08:00:00Z", "2026-08-03T12:00:00Z");

  it("erkennt echte Ueberschneidung", () => {
    expect(overlaps(morning, interval("2026-08-03T11:00:00Z", "2026-08-03T15:00:00Z"))).toBe(true);
  });

  it("laesst angrenzende Intervalle durch — sonst blockiert jeder Baustellenwechsel", () => {
    const afternoon = interval("2026-08-03T12:00:00Z", "2026-08-03T16:00:00Z");
    expect(overlaps(morning, afternoon)).toBe(false);
    expect(isAdjacent(morning, afternoon)).toBe(true);
  });

  it("erkennt eine Ueberschneidung von einer Millisekunde", () => {
    expect(overlaps(morning, interval("2026-08-03T11:59:59.999Z", "2026-08-03T16:00:00Z"))).toBe(
      true,
    );
  });

  it("erkennt vollstaendige Enthaltung in beide Richtungen", () => {
    const inner = interval("2026-08-03T09:00:00Z", "2026-08-03T10:00:00Z");
    expect(overlaps(morning, inner)).toBe(true);
    expect(overlaps(inner, morning)).toBe(true);
  });

  it("ist symmetrisch und selbstueberschneidend", () => {
    const other = interval("2026-08-03T10:00:00Z", "2026-08-03T14:00:00Z");
    expect(overlaps(morning, other)).toBe(overlaps(other, morning));
    expect(overlaps(morning, morning)).toBe(true);
  });

  it("meldet disjunkte Intervalle mit Luecke nicht", () => {
    expect(overlaps(morning, interval("2026-08-03T13:00:00Z", "2026-08-03T14:00:00Z"))).toBe(false);
  });

  it("trennt aufeinanderfolgende Naechte korrekt", () => {
    const night1 = interval("2026-08-03T22:00:00Z", "2026-08-04T06:00:00Z");
    const night2 = interval("2026-08-04T22:00:00Z", "2026-08-05T06:00:00Z");
    expect(overlaps(night1, night2)).toBe(false);
    expect(overlaps(night1, interval("2026-08-04T05:00:00Z", "2026-08-04T09:00:00Z"))).toBe(true);
  });
});

describe("hasAnyOverlap", () => {
  it("ist bei leerer Liste und Einzelintervall falsch", () => {
    expect(hasAnyOverlap([])).toBe(false);
    expect(hasAnyOverlap([interval("2026-08-03T08:00:00Z", "2026-08-03T12:00:00Z")])).toBe(false);
  });

  it("findet eine Ueberschneidung unabhaengig von der Eingabereihenfolge", () => {
    const a = interval("2026-08-03T08:00:00Z", "2026-08-03T12:00:00Z");
    const b = interval("2026-08-03T11:00:00Z", "2026-08-03T13:00:00Z");
    expect(hasAnyOverlap([a, b])).toBe(true);
    expect(hasAnyOverlap([b, a])).toBe(true);
  });

  it("findet eine Ueberschneidung mit einem umschliessenden Intervall, nicht nur mit Nachbarn", () => {
    // Sortiert nach Start liegt das lange Intervall vorn; die Ueberschneidung
    // mit dem dritten Element wird ueber den direkten Nachfolger gefunden.
    const long = interval("2026-08-03T06:00:00Z", "2026-08-03T20:00:00Z");
    const short1 = interval("2026-08-03T08:00:00Z", "2026-08-03T09:00:00Z");
    const short2 = interval("2026-08-03T18:00:00Z", "2026-08-03T19:00:00Z");
    expect(hasAnyOverlap([long, short1, short2])).toBe(true);
  });

  it("meldet eine lueckenlose Kette angrenzender Intervalle nicht", () => {
    expect(
      hasAnyOverlap([
        interval("2026-08-03T08:00:00Z", "2026-08-03T10:00:00Z"),
        interval("2026-08-03T10:00:00Z", "2026-08-03T12:00:00Z"),
        interval("2026-08-03T12:00:00Z", "2026-08-03T14:00:00Z"),
      ]),
    ).toBe(false);
  });
});

describe("Eigenschaftssweep — deterministisch, ohne Zufall", () => {
  // Bewusst kein fast-check: das waere eine neue Abhaengigkeit fuer ein Paket,
  // das ausdruecklich keine hat. Der Sweep ist vollstaendig aufgezaehlt und
  // damit reproduzierbar ohne Seed.
  const base = Date.UTC(2026, 7, 3, 8, 0, 0);
  const offsets = [-90, -60, -30, -1, 0, 1, 30, 60, 90, 240];

  it("Dauer ist immer positiv, und overlaps/isAdjacent schliessen sich aus", () => {
    let checked = 0;
    for (const aEnd of offsets) {
      for (const bStart of offsets) {
        for (const bEnd of offsets) {
          if (aEnd <= 0 || bEnd <= bStart) continue;
          const a = createTimeInterval(new Date(base), new Date(base + aEnd * 60_000));
          const b = createTimeInterval(
            new Date(base + bStart * 60_000),
            new Date(base + bEnd * 60_000),
          );
          if (!a.ok || !b.ok) continue;
          checked += 1;
          expect(durationMinutes(a.interval)).toBeGreaterThan(0);
          expect(durationMinutes(b.interval)).toBeGreaterThan(0);
          // Halb-offen: angrenzend und ueberschneidend schliessen sich aus.
          expect(overlaps(a.interval, b.interval) && isAdjacent(a.interval, b.interval)).toBe(
            false,
          );
          // Symmetrie.
          expect(overlaps(a.interval, b.interval)).toBe(overlaps(b.interval, a.interval));
          // hasAnyOverlap stimmt mit dem paarweisen Ergebnis ueberein.
          expect(hasAnyOverlap([a.interval, b.interval])).toBe(overlaps(a.interval, b.interval));
        }
      }
    }
    // Nicht-Leerlauf: der Sweep muss wirklich Faelle geprueft haben.
    expect(checked).toBeGreaterThan(100);
  });
});
