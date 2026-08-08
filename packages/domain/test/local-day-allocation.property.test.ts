/**
 * Eigenschaftstests der Tagesallokation (EYT-109, S5-REQ-05).
 *
 * ## Warum zusaetzlich zu den Beispielfaellen
 *
 * `local-day-allocation.test.ts` prueft benannte Tage in benannten Zonen. Das
 * ist der Regressionsschutz, aber es sind endlich viele Punkte. Die tragende
 * Zusage — die Anteile summieren sich EXAKT auf die verstrichene Dauer — ist
 * eine Aussage ueber alle Einsaetze und alle Zonen. Sie laesst sich nur ueber
 * erzeugte Eingaben pruefen.
 *
 * ## Warum der Generator zu den Umstellungen hin verzerrt ist
 *
 * Die erste Fassung zog den Startinstant gleichverteilt ueber 2026 und waehlte
 * die Zone unabhaengig davon. Gemessen bei `SEED`/`RUNS` wie unten: von 300
 * Faellen kreuzten **zwei** ueberhaupt einen Offsetwechsel, **kein einziger**
 * deckte einen 23- oder 25-Stunden-Tag vollstaendig ab, und **kein einziger**
 * blockierte. Der Dateikopf behauptete damit eine Abdeckung, die allein aus den
 * beiden handgeschriebenen Berlin-Beispielen kam. Das ist genau die Klasse
 * Fehler, die dieser Schnitt sonst faengt.
 *
 * Behoben wird das durch Verzerrung, nicht durch mehr Laeufe: die Offsetwechsel
 * werden zur Ladezeit aus `Intl` GEMESSEN (keine abgeschriebene Liste, die
 * still veraltet), und ein Teil der Faelle startet im Fenster ±36 Stunden um
 * einen Wechsel. Entscheidend ist die KOPPLUNG von Zone und Zeitpunkt: eine
 * unabhaengig gezogene Zone traf den Wechsel einer anderen Zone und aenderte
 * gemessen nichts (2 -> 2). Erst das Paar wirkt (2 -> 26).
 *
 * Jede so erzeugte Reichweite wird unten eingefordert. Was nicht eingefordert
 * ist, wird auch nicht behauptet.
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
 * Ueberspringen den Test nicht aushoehlt, wird unten sowohl die Zahl der
 * gemessenen als auch die der blockierten Faelle eingefordert.
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

const STUNDE_MS = 3_600_000;
const TAG_MS = 86_400_000;

/**
 * Zonenauswahl. Bewusst NICHT nur Europe/Berlin:
 *
 *   - `UTC` — die Zone ohne Umstellung, in der Orts- und UTC-Tag zusammenfallen;
 *   - `Europe/Berlin` — Pilotzone, Umstellung um 02:00/03:00;
 *   - `America/Havana`, `America/Santiago`, `Asia/Beirut`, `Atlantic/Azores` —
 *     gemessene Zonen mit Umstellung um Mitternacht, also die einzigen, in
 *     denen die blockierenden Zweige ueberhaupt erreichbar sind;
 *   - `Australia/Lord_Howe` — Halbstundenumstellung, erzeugt 23,5-Stunden-Tage;
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

/**
 * Offset einer Zone zu einem Instant, in Minuten.
 *
 * Eigene kleine Fassung statt Import: `zonenOffsetMs` ist in `planning-week.ts`
 * absichtlich nicht exportiert. Ein Test, der sie sich selbst baut, misst
 * ausserdem unabhaengig von der Implementierung, die er umgibt.
 */
const formate = new Map<string, Intl.DateTimeFormat>();
function offsetMinuten(ms: number, zeitzone: IanaTimeZone): number {
  let format = formate.get(zeitzone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zeitzone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formate.set(zeitzone, format);
  }
  const teile = new Map(format.formatToParts(new Date(ms)).map((teil) => [teil.type, teil.value]));
  const lies = (typ: Intl.DateTimeFormatPartTypes): number => {
    const wert = teile.get(typ);
    if (wert === undefined) throw new Error(`Intl lieferte keinen Teil "${typ}".`);
    return Number.parseInt(wert, 10);
  };
  const alsUtc = new Date(0);
  alsUtc.setUTCFullYear(lies("year"), lies("month") - 1, lies("day"));
  alsUtc.setUTCHours(lies("hour"), lies("minute"), 0, 0);
  return Math.round((alsUtc.getTime() - (ms - (ms % 60_000))) / 60_000);
}

/**
 * Die Offsetwechsel einer Zone im Jahr 2026 — gemessen, nicht abgeschrieben.
 *
 * Grobraster von zwoelf Stunden, dann binaere Suche auf die Minute. Zwoelf
 * Stunden genuegen, weil keine Zone 2026 zweimal binnen eines halben Tages
 * umstellt; eine abgeschriebene Konstantenliste waere dagegen genau so lange
 * richtig, bis die Zonendatenbank sich bewegt — und danach still falsch.
 */
function offsetwechsel2026(zeitzone: IanaTimeZone): number[] {
  const SCHRITT_MS = 12 * STUNDE_MS;
  const gefunden: number[] = [];
  let vorher = offsetMinuten(YEAR_START_MS, zeitzone);
  for (let t = YEAR_START_MS + SCHRITT_MS; t <= YEAR_END_MS; t += SCHRITT_MS) {
    const jetzt = offsetMinuten(t, zeitzone);
    if (jetzt === vorher) continue;
    let unten = t - SCHRITT_MS;
    let oben = t;
    while (oben - unten > 60_000) {
      const mitte = unten + Math.floor((oben - unten) / 2);
      if (offsetMinuten(mitte, zeitzone) === vorher) unten = mitte;
      else oben = mitte;
    }
    gefunden.push(oben - (oben % 60_000));
    vorher = jetzt;
  }
  return gefunden;
}

/** Nur die Zonen, die 2026 ueberhaupt umstellen — UTC faellt hier heraus. */
const ZONEN_MIT_WECHSEL: readonly (readonly [IanaTimeZone, readonly number[]])[] = ZONEN.map(
  (zeitzone) => [zeitzone, offsetwechsel2026(zeitzone)] as const,
).filter(([, wechsel]) => wechsel.length > 0);

const WECHSEL_GESAMT = ZONEN_MIT_WECHSEL.reduce((summe, [, w]) => summe + w.length, 0);

/** Ein Paar aus Zone und Startinstant — gleichverteilt ueber das Jahr. */
const gleichverteiltesPaar = fc.tuple(
  fc.constantFrom(...ZONEN),
  fc.integer({ min: YEAR_START_MS, max: YEAR_END_MS }),
);

/**
 * Ein Paar, dessen Startinstant im Fenster ±36 Stunden um einen Offsetwechsel
 * GENAU DIESER Zone liegt. Die Kopplung ist der Punkt — siehe Dateikopf.
 */
const paarNaheUmstellung = fc.constantFrom(...ZONEN_MIT_WECHSEL).chain(([zeitzone, wechsel]) =>
  fc.tuple(
    fc.constant(zeitzone),
    fc
      .constantFrom(...wechsel)
      .chain((t) => fc.integer({ min: t - 36 * STUNDE_MS, max: t + 36 * STUNDE_MS })),
  ),
);

const zoneUndStart = fc.oneof(gleichverteiltesPaar, paarNaheUmstellung);
/** Eine Minute bis drei Tage — kurz genug fuer Tagschichten, lang genug fuer Mehrtagesfaelle. */
const dauerMsArb = fc.integer({ min: 60_000, max: 3 * TAG_MS });

function intervall(startMs: number, dauerMs: number): TimeInterval {
  const gebaut = TimeInterval.create(new Date(startMs), new Date(startMs + dauerMs));
  if (!gebaut.ok) throw new Error(`Generator erzeugte ein ungueltiges Intervall: ${gebaut.error}`);
  return gebaut.interval;
}

describe("allocateAcrossLocalDays — Eigenschaften ueber erzeugte Eingaben", () => {
  it("kennt jede genannte Zone und misst ihre Offsetwechsel — sonst prueft dieser Test weniger als er behauptet", () => {
    expect(ZONEN).toHaveLength(ZONEN_IDS.length);
    expect(ZONEN_IDS.length).toBeGreaterThanOrEqual(8);
    // Gemessen 08.08.2026: sieben der acht Zonen stellen 2026 zweimal um, UTC
    // gar nicht — also vierzehn Wechsel. Faellt die Messung aus (kaputtes
    // Grobraster, veraenderte Zonendatenbank), waere die Verzerrung unten
    // wirkungslos und dieser Test der einzige Ort, an dem das auffiele.
    expect(ZONEN_MIT_WECHSEL.length).toBe(ZONEN_IDS.length - 1);
    expect(WECHSEL_GESAMT).toBeGreaterThanOrEqual(12);
  });

  it("summiert die Anteile exakt auf die verstrichene Dauer", () => {
    // Die tragende Eigenschaft des ganzen Schnitts. Nicht naeherungsweise,
    // nicht nach Rundung — exakt, auch an den Tagen mit 23 oder 25 Stunden.
    //
    // Die Zaehler unten belegen, dass genau diese Tage vorkommen. Ohne sie
    // waere der Satz im Dateikopf eine Behauptung ueber Faelle, die der
    // Generator nie erzeugt.
    let gemessen = 0;
    let blockiert = 0;
    const blockCodes = new Set<string>();
    let vollerTagKuerzer = 0;
    let vollerTagLaenger = 0;

    assertProperty(
      fc.property(zoneUndStart, dauerMsArb, ([zeitzone, startMs], dauerMs) => {
        const ergebnis = allocateAcrossLocalDays(intervall(startMs, dauerMs), zeitzone);
        if (!ergebnis.ok) {
          blockiert += 1;
          blockCodes.add(ergebnis.error);
          return;
        }
        gemessen += 1;
        const teile = ergebnis.parts;
        const summe = teile.reduce((a, teil) => a + teil.quantity.milliseconds, 0n);
        expect(summe).toBe(BigInt(dauerMs));

        // Ein Anteil, der weder der erste noch der letzte ist, deckt einen
        // Ortstag VOLLSTAENDIG ab. Nur dort ist die Tageslaenge sichtbar.
        for (let i = 1; i < teile.length - 1; i += 1) {
          const teil = teile[i];
          if (teil === undefined) throw new Error(`Anteil ${String(i)} fehlt.`);
          const ms = teil.quantity.milliseconds;
          if (ms < BigInt(TAG_MS)) vollerTagKuerzer += 1;
          if (ms > BigInt(TAG_MS)) vollerTagLaenger += 1;
        }
      }),
    );

    // Nicht-Leerlauf-Bremsen. Gemessen 08.08.2026 bei diesem Seed:
    // gemessen=286, blockiert=14 (10x NONEXISTENT, 4x AMBIGUOUS),
    // volle Tage: 23 h x7, 23,5 h x5, 24 h x169, 25 h x5.
    // Die Schranken liegen bewusst deutlich darunter — sie sollen einen
    // wirkungslos gewordenen Generator melden, nicht bei jeder Bewegung der
    // Zonendatenbank umschlagen.
    expect(gemessen).toBeGreaterThan(RUNS / 2);
    expect(gemessen + blockiert).toBe(RUNS);
    expect(blockiert).toBeGreaterThanOrEqual(3);
    expect([...blockCodes].sort()).toEqual(["DAY_BOUNDARY_AMBIGUOUS", "DAY_BOUNDARY_NONEXISTENT"]);
    expect(vollerTagKuerzer).toBeGreaterThanOrEqual(3);
    expect(vollerTagLaenger).toBeGreaterThanOrEqual(3);
  });

  it("liefert die Tage streng aufsteigend und lueckenlos", () => {
    // Zwei Aussagen in einer: `compareLocalBusinessDate(vorher, nachher) < 0`
    // schliesst Wiederholungen und Ruecklaeufe aus, `dayAfter(vorher)` gleich
    // `nachher` schliesst uebersprungene Kalendertage aus. Die erste allein
    // liesse eine Luecke durchgehen, die zweite allein eine falsche Reihenfolge
    // nicht erkennen, wenn `dayAfter` symmetrisch falsch waere.
    let mehrteilig = 0;
    assertProperty(
      fc.property(zoneUndStart, dauerMsArb, ([zeitzone, startMs], dauerMs) => {
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
    // Die beiden Verankerungen sind das Eigenschaftsgegenstueck zum
    // unterscheidenden Beispielfall: der erste Anteil traegt den Ortstag des
    // Beginns, der letzte den Ortstag der letzten EINGESCHLOSSENEN Millisekunde
    // — das Intervall ist halboffen, also gehoert `endMs` selbst nicht mehr
    // dazu. Eine Umsetzung ueber UTC-Tage verletzt beides; die Summeneigenschaft
    // kann sie dagegen NICHT sehen, weil auch eine UTC-Tageskette von Anfang bis
    // Ende teleskopiert. Deshalb ist diese Eigenschaft und nicht jene der
    // Nachweis gegen die naheliegende falsche Umsetzung.
    let gemessen = 0;
    assertProperty(
      fc.property(zoneUndStart, dauerMsArb, ([zeitzone, startMs], dauerMs) => {
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
