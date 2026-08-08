/**
 * Eigenschaftstests der Tagesallokation (EYT-109, S5-REQ-05).
 *
 * ## Warum zusaetzlich zu den Beispielfaellen
 *
 * `local-day-allocation.test.ts` prueft benannte Tage in benannten Zonen. Das
 * ist der Regressionsschutz, aber es sind endlich viele Punkte. Die tragende
 * Zusage — die Anteile summieren sich EXAKT auf die verstrichene Dauer — ist
 * eine Aussage ueber alle Einsaetze und alle Zonen. Sie laesst sich nur ueber
 * erzeugte Eingaben pruefen, und nur ueber ein volles Jahr: ein Generator, der
 * die Umstellungstermine nie trifft, kann ueber sie nichts sagen.
 *
 * ## Reproduzierbarkeit
 *
 * Fester Seed wie in `time-interval.property.test.ts`. Zwei Laeufe erzeugen
 * dieselben Faelle in derselben Reihenfolge; ein roter CI-Lauf ist lokal ohne
 * Zusatzargument wiederholbar.
 *
 * ## Wenn eine Eigenschaft faellt
 *
 * fast-check meldet das verkleinerte Gegenbeispiel, den `seed` und einen `path`.
 * Vorgehen — dieselbe Disziplin wie beim Geschwistertest:
 *
 *   1. Gegenbeispiel als BENANNTEN Fall nach `local-day-allocation.test.ts`
 *      uebernehmen. Ein Eigenschaftstest ist der Finder, nicht der
 *      Regressionsschutz; bleibt der Fall im Generator, haengt die Regression
 *      am Zufall.
 *   2. Erst danach den Fehler beheben.
 *   3. Den Seed NICHT anpassen, um den Fall loszuwerden. Wer ihn dreht, um
 *      einen roten Lauf loszuwerden, hat den Fehler nicht behoben, sondern
 *      versteckt.
 *
 * Zum Nachfahren eines gemeldeten Falls:
 *   fc.assert(prop, { seed: SEED, path: "<pfad aus der Meldung>" })
 *
 * ## Blockieren ist ein zulaessiger Ausgang
 *
 * An einer fehlenden oder doppelten lokalen Mitternacht MUSS die Funktion
 * blockieren. Solche Faelle koennen die Summeneigenschaft nicht verletzen, weil
 * es keine Anteile gibt — sie werden gezaehlt und uebersprungen. Damit das
 * Ueberspringen den Test nicht aushoehlt, wird die Zahl der wirklich
 * gemessenen Faelle unten eingefordert.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  allocateAcrossLocalDays,
  compareLocalBusinessDate,
  createTimeZone,
  dayAfter,
  localBusinessDate,
  TimeInterval,
} from "../src/index.js";
import type { IanaTimeZone } from "../src/index.js";

/**
 * Fester Seed. Aendern heisst: andere Faelle, andere Aussage. Wer ihn dreht,
 * um einen roten Lauf loszuwerden, versteckt einen Defekt.
 */
const SEED = 20260808;
const RUNS = 300;

const assertProperty = <T extends unknown[]>(property: fc.IProperty<T>): void => {
  fc.assert(property, { seed: SEED, numRuns: RUNS });
};

/**
 * Zonenauswahl. Bewusst NICHT nur Europe/Berlin:
 *
 *   - `UTC` — die Zone ohne Umstellung, in der Orts- und UTC-Tag zusammenfallen;
 *   - `Europe/Berlin` — Pilotzone, Umstellung um 02:00/03:00;
 *   - `America/Havana`, `America/Santiago`, `Asia/Beirut`, `Atlantic/Azores` —
 *     gemessene Zonen mit Umstellung um Mitternacht, also die einzigen, in
 *     denen die blockierenden Zweige ueberhaupt erreichbar sind;
 *   - `Australia/Lord_Howe` — Halbstundenumstellung;
 *   - `Pacific/Chatham` — Offset +12:45, kein Vielfaches einer Stunde.
 */
const ZONEN_IDS = [
  "UTC",
  "Europe/Berlin",
  "America/Havana",
  "America/Santiago",
  "Asia/Beirut",
  "Atlantic/Azores",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
] as const;

/** Bricht laut ab statt still weniger Zonen zu pruefen als der Kopf zusagt. */
function zone(id: string): IanaTimeZone {
  const gebaut = createTimeZone(id);
  if (!gebaut.ok) throw new Error(`Zone ${id} ist dieser Laufzeit unbekannt.`);
  return gebaut.timeZone;
}

const ZONEN: readonly IanaTimeZone[] = ZONEN_IDS.map(zone);

const YEAR_START_MS = Date.UTC(2026, 0, 1);
const YEAR_END_MS = Date.UTC(2026, 11, 31, 23, 59, 59, 999);

const instantMs = fc.integer({ min: YEAR_START_MS, max: YEAR_END_MS });
/** Eine Minute bis drei Tage — kurz genug fuer Tagschichten, lang genug fuer Mehrtagesfaelle. */
const dauerMsArb = fc.integer({ min: 60_000, max: 3 * 86_400_000 });
const zoneArb = fc.constantFrom(...ZONEN);

function intervall(startMs: number, dauerMs: number): TimeInterval {
  const gebaut = TimeInterval.create(new Date(startMs), new Date(startMs + dauerMs));
  if (!gebaut.ok) throw new Error(`Generator erzeugte ein ungueltiges Intervall: ${gebaut.error}`);
  return gebaut.interval;
}

describe("allocateAcrossLocalDays — Eigenschaften ueber erzeugte Eingaben", () => {
  it("kennt jede genannte Zone — sonst prueft dieser Test weniger als er behauptet", () => {
    expect(ZONEN).toHaveLength(ZONEN_IDS.length);
    expect(ZONEN_IDS.length).toBeGreaterThanOrEqual(8);
  });

  it("summiert die Anteile exakt auf die verstrichene Dauer", () => {
    // Die tragende Eigenschaft des ganzen Schnitts. Nicht naeherungsweise,
    // nicht nach Rundung — exakt, auch an den Tagen mit 23 oder 25 Stunden.
    let gemessen = 0;
    let blockiert = 0;
    assertProperty(
      fc.property(instantMs, dauerMsArb, zoneArb, (startMs, dauerMs, zeitzone) => {
        const ergebnis = allocateAcrossLocalDays(intervall(startMs, dauerMs), zeitzone);
        if (!ergebnis.ok) {
          blockiert += 1;
          return;
        }
        gemessen += 1;
        const summe = ergebnis.parts.reduce((a, teil) => a + teil.quantity.milliseconds, 0n);
        expect(summe).toBe(BigInt(dauerMs));
      }),
    );
    // Nicht-Leerlauf-Bremse: ohne diese Zeile waere die Eigenschaft auch dann
    // gruen, wenn die Funktion jeden Fall blockierte.
    expect(gemessen).toBeGreaterThan(RUNS / 2);
    expect(gemessen + blockiert).toBe(RUNS);
  });

  it("liefert die Tage streng aufsteigend und lueckenlos", () => {
    // Zwei Aussagen in einer: `compareLocalBusinessDate(vorher, nachher) < 0`
    // schliesst Wiederholungen und Ruecklaeufe aus, `dayAfter(vorher)` gleich
    // `nachher` schliesst uebersprungene Kalendertage aus. Die erste allein
    // liesse eine Luecke durchgehen, die zweite allein eine falsche Reihenfolge
    // nicht erkennen, wenn `dayAfter` symmetrisch falsch waere.
    let mehrteilig = 0;
    assertProperty(
      fc.property(instantMs, dauerMsArb, zoneArb, (startMs, dauerMs, zeitzone) => {
        const ergebnis = allocateAcrossLocalDays(intervall(startMs, dauerMs), zeitzone);
        if (!ergebnis.ok) return;
        const teile = ergebnis.parts;
        if (teile.length > 1) mehrteilig += 1;
        for (let i = 1; i < teile.length; i += 1) {
          const vorher = teile[i - 1];
          const nachher = teile[i];
          if (vorher === undefined || nachher === undefined) {
            throw new Error(`Anteil ${String(i)} fehlt, obwohl die Laenge ihn zusagt.`);
          }
          expect(compareLocalBusinessDate(vorher.date, nachher.date)).toBeLessThan(0);
          expect(dayAfter(vorher.date)).toEqual(nachher.date);
        }
      }),
    );
    // Ohne mehrteilige Faelle prueft die Schleife oben nichts.
    expect(mehrteilig).toBeGreaterThan(RUNS / 10);
  });

  it("erzeugt keinen leeren Anteil und verankert ersten und letzten Tag am Ortstag", () => {
    // Ein Anteil der Laenge null waere eine Snapshotzeile ueber null Stunden an
    // einem Tag, an dem nicht gearbeitet wurde.
    //
    // Die beiden Verankerungen sind der Eigenschaftsgegenstueck zum
    // unterscheidenden Beispielfall: der erste Anteil traegt den Ortstag des
    // Beginns, der letzte den Ortstag der letzten EINGESCHLOSSENEN Millisekunde
    // — das Intervall ist halboffen, also gehoert `endMs` selbst nicht mehr
    // dazu. Eine Implementierung ueber UTC-Tage verletzt beides.
    let gemessen = 0;
    assertProperty(
      fc.property(instantMs, dauerMsArb, zoneArb, (startMs, dauerMs, zeitzone) => {
        const interval = intervall(startMs, dauerMs);
        const ergebnis = allocateAcrossLocalDays(interval, zeitzone);
        if (!ergebnis.ok) return;
        gemessen += 1;
        const teile = ergebnis.parts;
        expect(teile.length).toBeGreaterThan(0);
        for (const teil of teile) {
          expect(teil.quantity.milliseconds).toBeGreaterThan(0n);
        }
        const erster = teile[0];
        const letzter = teile[teile.length - 1];
        if (erster === undefined || letzter === undefined) {
          throw new Error("Anteilsliste ist leer, obwohl die Laenge sie zusagt.");
        }
        expect(erster.date).toEqual(localBusinessDate(interval.startUtc, zeitzone));
        expect(letzter.date).toEqual(localBusinessDate(new Date(interval.endMs - 1), zeitzone));
      }),
    );
    expect(gemessen).toBeGreaterThan(RUNS / 2);
  });
});
