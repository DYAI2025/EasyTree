/**
 * Eigenschaftstests mit erzeugten Eingaben (EYT-61 AK7).
 *
 * ## Warum zusaetzlich zum vorhandenen Sweep
 *
 * `time-interval.test.ts` enthaelt einen deterministischen Sweep ueber ein
 * festes Raster von Minutenoffsets um EINEN Augustinstant. Der ist wertvoll und
 * bleibt, aber er kann nichts finden, was ausserhalb seines Rasters liegt — und
 * er verlaesst den August nie. Ueber Zeitumstellungen, Jahreswechsel oder
 * Millisekundengrenzen sagt er nichts.
 *
 * Der Kommentar dort lautete "Bewusst kein fast-check: das waere eine neue
 * Abhaengigkeit fuer ein Paket, das ausdruecklich keine hat." Das Argument war
 * richtig fuer `dependencies` und falsch fuer `devDependencies`: der
 * Architekturtest (`domain-allowlist`) hat als Geltungsbereich
 * `packages/domain/src/`, nicht `test/`, und die Tests dort importieren
 * ohnehin `vitest`. Die Abhaengigkeitsfreiheit des ausgelieferten Pakets
 * bleibt unberuehrt. EYT-61 AK7 verlangt Eigenschaftstests ausdruecklich.
 *
 * ## Reproduzierbarkeit (AK7 woertlich)
 *
 * Jeder Lauf verwendet denselben festen Seed. Zwei Laeufe erzeugen damit
 * dieselben Faelle in derselben Reihenfolge — ein roter Lauf in CI ist lokal
 * ohne Zusatzangabe wiederholbar.
 *
 * ## Wenn ein Eigenschaftstest faellt (AK7 "dokumentieren den Fehlerfall")
 *
 * fast-check meldet drei Dinge: das verkleinerte Gegenbeispiel, den `seed` und
 * einen `path`. Der Pfad zeigt auf genau diesen einen Fall. Vorgehen:
 *
 *   1. Gegenbeispiel aus der Fehlermeldung in einen normalen `it`-Test in
 *      `time-interval.test.ts` uebernehmen. Ein Eigenschaftstest ist der
 *      Finder, nicht der Regressionsschutz — der gehoert als benannter Fall
 *      in die Beispielsuite, sonst haengt die Regression am Zufall.
 *   2. Erst danach den Fehler beheben.
 *   3. Den Seed NICHT anpassen, um den Fall loszuwerden.
 *
 * Zum gezielten Nachfahren eines gemeldeten Falls dient `path`:
 *   fc.assert(prop, { seed: SEED, path: "<pfad aus der Meldung>" })
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  durationMinutes,
  durationMs,
  EUROPE_BERLIN,
  hasAnyOverlap,
  isAdjacent,
  isoWeekOfLocalDate,
  localBusinessDate,
  overlaps,
  planningWeekKey,
  planningWeekOf,
  TimeInterval,
} from "../src/index.js";

/**
 * Fester Seed. Aendern heisst: andere Faelle, andere Aussage. Wer ihn dreht,
 * um einen roten Lauf loszuwerden, hat den Fehler nicht behoben, sondern
 * versteckt.
 */
const SEED = 20260727;
const RUNS = 300;

const assertProperty = <T extends unknown[]>(property: fc.IProperty<T>): void => {
  fc.assert(property, { seed: SEED, numRuns: RUNS });
};

/**
 * Zeitfenster der Erzeugung: ein volles Jahr um beide Umstellungen von 2026.
 *
 * Bewusst NICHT der August. Ein Generator, der die Umstellungstermine nie
 * trifft, kann ueber sie auch nichts aussagen — genau die Schwaeche, die der
 * bestehende Sweep hat.
 */
const YEAR_START_MS = Date.UTC(2026, 0, 1);
const YEAR_END_MS = Date.UTC(2026, 11, 31, 23, 59, 59, 999);

const instantMs = fc.integer({ min: YEAR_START_MS, max: YEAR_END_MS });

/** Eine positive Dauer von 1 ms bis 30 Tagen. */
const durationMsArb = fc.integer({ min: 1, max: 30 * 86_400_000 });

/** Ein garantiert gueltiges Intervall — start < end ist per Konstruktion wahr. */
const validInterval = fc.tuple(instantMs, durationMsArb).map(([startMs, span]): TimeInterval => {
  const result = TimeInterval.create(new Date(startMs), new Date(startMs + span));
  if (!result.ok) {
    throw new Error(`Generator erzeugte ein ungueltiges Intervall: ${result.error}`);
  }
  return result.interval;
});

describe("TimeInterval — Eigenschaften ueber erzeugte Eingaben", () => {
  it("akzeptiert genau dann, wenn start echt vor end liegt", () => {
    assertProperty(
      fc.property(instantMs, instantMs, (aMs, bMs) => {
        const result = TimeInterval.create(new Date(aMs), new Date(bMs));
        // Zwei Richtungen in einer Eigenschaft: das Ergebnis muss dem
        // Vergleich folgen, nicht nur "manchmal" fehlschlagen.
        expect(result.ok).toBe(aMs < bMs);
      }),
    );
  });

  it("liefert immer eine echt positive Dauer", () => {
    assertProperty(
      fc.property(validInterval, (interval) => {
        expect(durationMs(interval)).toBeGreaterThan(0);
        expect(durationMinutes(interval)).toBeGreaterThan(0);
      }),
    );
  });

  it("rechnet Minuten ohne Rundung aus Millisekunden", () => {
    assertProperty(
      fc.property(validInterval, (interval) => {
        expect(durationMinutes(interval)).toBe(durationMs(interval) / 60_000);
      }),
    );
  });

  it("ist symmetrisch in overlaps", () => {
    assertProperty(
      fc.property(validInterval, validInterval, (a, b) => {
        expect(overlaps(a, b)).toBe(overlaps(b, a));
      }),
    );
  });

  it("schliesst Ueberschneidung und Angrenzen gegenseitig aus", () => {
    // Das ist die Halboffenheit als Eigenschaft: ein Baustellenwechsel um
    // 12:00 ist entweder ein Wechsel oder ein Konflikt, niemals beides.
    assertProperty(
      fc.property(validInterval, validInterval, (a, b) => {
        expect(overlaps(a, b) && isAdjacent(a, b)).toBe(false);
      }),
    );
  });

  it("ueberschneidet sich nie mit dem unmittelbar anschliessenden Intervall", () => {
    assertProperty(
      fc.property(validInterval, durationMsArb, (a, span) => {
        const next = TimeInterval.create(a.endUtc, new Date(a.endMs + span));
        expect(next.ok).toBe(true);
        if (!next.ok) return;
        expect(overlaps(a, next.interval)).toBe(false);
        expect(isAdjacent(a, next.interval)).toBe(true);
      }),
    );
  });

  it("stimmt in hasAnyOverlap mit dem paarweisen Orakel ueberein", () => {
    // hasAnyOverlap sortiert und vergleicht nur Nachbarn. Das ist die
    // Optimierung, die falsch sein KANN — deshalb gegen die naive
    // O(n^2)-Referenz gepruefte Eigenschaft statt gegen Beispiele.
    assertProperty(
      fc.property(fc.array(validInterval, { minLength: 0, maxLength: 8 }), (intervals) => {
        const oracle = intervals.some((a, i) => intervals.some((b, j) => i < j && overlaps(a, b)));
        expect(hasAnyOverlap(intervals)).toBe(oracle);
      }),
    );
  });

  it("kopiert startUtc und endUtc defensiv", () => {
    assertProperty(
      fc.property(validInterval, (interval) => {
        const borrowed = interval.startUtc;
        borrowed.setUTCFullYear(1999);
        expect(interval.startUtc.getUTCFullYear()).not.toBe(1999);
      }),
    );
  });
});

describe("Planungswoche — Eigenschaften ueber ein ganzes Jahr", () => {
  it("liefert immer einen wohlgeformten Wochenschluessel", () => {
    assertProperty(
      fc.property(validInterval, (interval) => {
        expect(planningWeekKey(planningWeekOf(interval, EUROPE_BERLIN))).toMatch(
          /^\d{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/,
        );
      }),
    );
  });

  it("ordnet zwei Instants desselben Ortstages derselben Woche zu", () => {
    // Zwei zufaellige Instants aus einem ganzen Jahr liegen fast nie am selben
    // Ortstag. Ohne Gegenmassnahme waere dieser Test zu ueber 99 Prozent
    // Leerlauf und trotzdem gruen. Deshalb: der zweite Instant entsteht als
    // kleiner Versatz zum ersten, und die Zahl der Faelle, in denen der Tag
    // wirklich gleich war, wird gezaehlt und eingefordert.
    //
    // Der Versatz reicht bis 25 Stunden, damit die Umstellungssonntage
    // erfasst werden: an ihnen ist der Ortstag 23 bzw. 25 Stunden lang.
    let sameDayCases = 0;
    assertProperty(
      fc.property(
        instantMs,
        fc.integer({ min: -25 * 3_600_000, max: 25 * 3_600_000 }),
        (aMs, shift) => {
          const dayA = localBusinessDate(new Date(aMs), EUROPE_BERLIN);
          const dayB = localBusinessDate(new Date(aMs + shift), EUROPE_BERLIN);
          if (dayA.year !== dayB.year || dayA.month !== dayB.month || dayA.day !== dayB.day) {
            return;
          }
          sameDayCases++;
          expect(planningWeekKey(isoWeekOfLocalDate(dayA))).toBe(
            planningWeekKey(isoWeekOfLocalDate(dayB)),
          );
        },
      ),
    );
    // Die eigentliche Aussage des Tests haengt an dieser Zeile: ohne sie waere
    // er auch dann gruen, wenn localBusinessDate jeden Instant auf einen
    // eigenen Tag legte.
    expect(sameDayCases).toBeGreaterThan(RUNS / 10);
  });

  it("bleibt in der Wochenzuordnung monoton", () => {
    // Ein spaeterer Instant darf nie in eine frueher sortierende Woche fallen.
    // Ein Vorzeichenfehler in der ISO-Rechnung faellt genau hier auf.
    assertProperty(
      fc.property(instantMs, instantMs, (aMs, bMs) => {
        const [earlier, later] = aMs <= bMs ? [aMs, bMs] : [bMs, aMs];
        const keyEarlier = planningWeekKey(
          isoWeekOfLocalDate(localBusinessDate(new Date(earlier), EUROPE_BERLIN)),
        );
        const keyLater = planningWeekKey(
          isoWeekOfLocalDate(localBusinessDate(new Date(later), EUROPE_BERLIN)),
        );
        expect(keyEarlier <= keyLater).toBe(true);
      }),
    );
  });
});
