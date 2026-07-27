import { describe, expect, it } from "vitest";

import {
  durationMinutes,
  hasAnyOverlap,
  isAdjacent,
  overlaps,
  TIME_INTERVAL_ERRORS,
  TimeInterval,
} from "../src/time-interval.js";

/** Kurzform fuer gueltige Intervalle im Test. Wirft, damit ein Testfehler auffaellt. */
function interval(startIso: string, endIso: string): TimeInterval {
  const result = TimeInterval.create(new Date(startIso), new Date(endIso));
  if (!result.ok) throw new Error(`Fixture ungueltig: ${startIso}..${endIso} -> ${result.error}`);
  return result.interval;
}

function errorOf(start: Date | null | undefined, end: Date | null | undefined): string {
  const result = TimeInterval.create(start, end);
  return result.ok ? "OK" : result.error;
}

describe("TimeInterval.create — Ablehnungen", () => {
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

describe("TimeInterval.create — Annahmen", () => {
  it("akzeptiert eine Millisekunde", () => {
    const result = TimeInterval.create(
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
    const result = TimeInterval.create(start, end);
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

  const berlin = (d: Date): string =>
    new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);

  it("Sommerzeitluecke: Wanduhr springt 3 h, verstrichen sind 2 h", () => {
    // Ohne die Ortszeit-Zusicherung waere das nur eine UTC-Rechnung, die an
    // JEDEM Datum gleich ausginge und ueber DST nichts beweist.
    const acrossGap = interval("2026-03-29T00:00:00Z", "2026-03-29T02:00:00Z");
    expect(berlin(acrossGap.startUtc)).toBe("01:00");
    expect(berlin(acrossGap.endUtc)).toBe("04:00");
    expect(durationMinutes(acrossGap)).toBe(120);
  });

  it("doppelte Winterzeitstunde: Wanduhr springt 2 h, verstrichen sind 3 h", () => {
    const acrossFold = interval("2026-10-25T00:00:00Z", "2026-10-25T03:00:00Z");
    expect(berlin(acrossFold.startUtc)).toBe("02:00");
    expect(berlin(acrossFold.endUtc)).toBe("04:00");
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

  it("findet die Ueberschneidung eines umschliessenden Intervalls", () => {
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
  // Dieser Sweep bleibt: er ist vollstaendig aufgezaehlt und damit ohne Seed
  // reproduzierbar. Was er NICHT kann, ist etwas ausserhalb seines Rasters
  // finden — er verlaesst den August nie und sagt ueber Zeitumstellungen,
  // Jahreswechsel oder Millisekundengrenzen nichts.
  //
  // Hier stand frueher "Bewusst kein fast-check: das waere eine neue
  // Abhaengigkeit fuer ein Paket, das ausdruecklich keine hat." Das Argument
  // galt fuer `dependencies` und nicht fuer `devDependencies`: der
  // Architekturtest `domain-allowlist` hat als Geltungsbereich
  // `packages/domain/src/`, nicht `test/`. Das ausgelieferte Paket bleibt
  // abhaengigkeitsfrei. Die erzeugten Faelle stehen jetzt in
  // test/time-interval.property.test.ts (EYT-61 AK7).
  const base = Date.UTC(2026, 7, 3, 8, 0, 0);
  const offsets = [-90, -60, -30, -1, 0, 1, 30, 60, 90, 240];

  it("Dauer ist immer positiv, und overlaps/isAdjacent schliessen sich aus", () => {
    let checked = 0;
    for (const aEnd of offsets) {
      for (const bStart of offsets) {
        for (const bEnd of offsets) {
          if (aEnd <= 0 || bEnd <= bStart) continue;
          const a = TimeInterval.create(new Date(base), new Date(base + aEnd * 60_000));
          const b = TimeInterval.create(
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

describe("Faelschungssicherheit — die Loecher des ersten Entwurfs", () => {
  // Der erste Entwurf war ein `interface` mit Symbol-Brand. Alle drei folgenden
  // Angriffe liefen dagegen mit gruenem `tsc --noEmit` durch: Spread lieferte
  // durationMinutes === -600, ein Nulllaengen-Intervall war fuer jede
  // Ueberlappungspruefung unsichtbar, und eine Mutation nach der Validierung
  // liess einen erkannten Konflikt wieder verschwinden. Fail-open.
  const good = interval("2026-08-03T08:00:00Z", "2026-08-03T18:00:00Z");

  it("laesst sich nicht per Spread faelschen", () => {
    const forged = {
      ...good,
      startUtc: new Date("2026-08-03T18:00:00Z"),
      endUtc: new Date("2026-08-03T08:00:00Z"),
    };
    // @ts-expect-error Private Felder machen den Typ nominal — ein strukturell
    // gleiches Objekt ist kein TimeInterval.
    const asInterval: TimeInterval = forged;
    // Zur Laufzeit traegt der Spread keinen Zustand: er liegt in #startMs/#endMs.
    expect(Object.keys(forged)).toEqual(["startUtc", "endUtc"]);
    expect(asInterval).not.toBeInstanceOf(TimeInterval);
  });

  it("faellt bei Object.assign laut aus, statt still kein Konflikt zu melden", () => {
    // Object.assign ist die eine Luecke, die die nominale Typisierung NICHT
    // schliesst: TypeScript typisiert das Ergebnis als Schnittmenge, also gilt
    // es als TimeInterval. Zur Laufzeit fehlen die privaten Felder. Ohne
    // Laufzeitpruefung waere startMs `undefined`, jeder Vergleich `false` und
    // `overlaps` meldete "kein Konflikt" — fail-open. Deshalb: TypeError.
    const forged: TimeInterval = Object.assign({}, good, { endUtc: good.startUtc });
    expect(forged).not.toBeInstanceOf(TimeInterval);
    expect(() => overlaps(forged, good)).toThrow(TypeError);
    expect(() => durationMinutes(forged)).toThrow(TypeError);
    expect(() => hasAnyOverlap([good, forged])).toThrow(TypeError);
  });

  it("gibt nach aussen nur Kopien — Mutation kann ein geprueftes Intervall nicht brechen", () => {
    const before = durationMinutes(good);
    good.endUtc.setUTCFullYear(1999);
    expect(durationMinutes(good)).toBe(before);
    expect(good.endUtc.toISOString()).toBe("2026-08-03T18:00:00.000Z");
  });

  it("liefert bei jedem Zugriff ein neues Date", () => {
    expect(good.startUtc).not.toBe(good.startUtc);
    expect(good.startUtc.getTime()).toBe(good.startUtc.getTime());
  });

  it("ist eingefroren", () => {
    expect(Object.isFrozen(good)).toBe(true);
  });

  it("serialisiert verlustfrei und laeuft fuer den Rueckweg wieder durch create", () => {
    const json = JSON.parse(JSON.stringify(good)) as { startUtc: string; endUtc: string };
    expect(json).toEqual({
      startUtc: "2026-08-03T08:00:00.000Z",
      endUtc: "2026-08-03T18:00:00.000Z",
    });
    const revived = TimeInterval.create(new Date(json.startUtc), new Date(json.endUtc));
    expect(revived.ok).toBe(true);
    if (revived.ok) expect(durationMinutes(revived.interval)).toBe(durationMinutes(good));
  });
});

describe("hasAnyOverlap gegen einen Brute-Force-Orakel", () => {
  // Der Nachbarvergleich ist im Modulkommentar begruendet, aber ein Beweis im
  // Kommentar ist kein Test. Hier laeuft er gegen eine offensichtlich korrekte
  // O(n^2)-Referenz ueber alle Tripel eines aufgezaehlten Rasters.
  function oracle(list: readonly TimeInterval[]): boolean {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a !== undefined && b !== undefined && overlaps(a, b)) return true;
      }
    }
    return false;
  }

  it("stimmt auf allen Tripeln des Rasters mit dem Orakel ueberein", () => {
    const base = Date.UTC(2026, 7, 3, 8, 0, 0);
    const bounds = [0, 30, 60, 90, 120];
    const all: TimeInterval[] = [];
    for (const s of bounds) {
      for (const e of bounds) {
        if (e <= s) continue;
        const r = TimeInterval.create(new Date(base + s * 60_000), new Date(base + e * 60_000));
        if (r.ok) all.push(r.interval);
      }
    }
    expect(all.length).toBeGreaterThan(5);

    let compared = 0;
    for (const a of all) {
      for (const b of all) {
        for (const c of all) {
          const list = [a, b, c];
          expect(hasAnyOverlap(list)).toBe(oracle(list));
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(500);
  });
});

describe("Konstruktor haelt die Invariante auch aus JavaScript", () => {
  // `private constructor` ist reine TypeScript-Erasure. Aus JS oder ueber
  // Reflection bleibt `new TimeInterval(ende, start)` moeglich, und so ein
  // Objekt besteht jeden instanceof-Test — der Laufzeit-Guard haette es also
  // durchgelassen. Deshalb steht die Invariante im Konstruktor selbst.
  const Ctor = TimeInterval as unknown as new (startMs: number, endMs: number) => TimeInterval;
  const base = Date.UTC(2026, 7, 3, 8, 0, 0);

  it("lehnt eine verkehrte Reihenfolge ab", () => {
    expect(() => new Ctor(base + 3_600_000, base)).toThrow(RangeError);
  });

  it("lehnt ein Nulllaengen-Intervall ab", () => {
    expect(() => new Ctor(base, base)).toThrow(RangeError);
  });

  it("lehnt nicht endliche Werte ab", () => {
    expect(() => new Ctor(Number.NaN, base)).toThrow(RangeError);
    expect(() => new Ctor(base, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("akzeptiert eine gueltige Reihenfolge", () => {
    const direct = new Ctor(base, base + 60_000);
    expect(durationMinutes(direct)).toBe(1);
    expect(direct).toBeInstanceOf(TimeInterval);
  });
});
