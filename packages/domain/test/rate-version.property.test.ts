/**
 * Eigenschaftstests fuer den Money-, Rate- und Rundungsvertrag (EYT-95).
 *
 * Zugeordnet in `docs/plans/2026-07-30-sprint-5-daily-cost-export.md` Abschnitt 3,
 * Zeile "REQ-004/REQ-005 (EYT-95)" — Job `unit-tests`, Schritt `pnpm test`.
 * Die Beispiel- und Grenzfaelle desselben Vertrags stehen in
 * `money-rate.test.ts`; hier steht nur, was ueber ERZEUGTE Eingaben gilt.
 *
 * Massgeblich ist der Abschnitt "Berechnungsvertrag (PO-Entscheidungen vom
 * 30.07.2026, verbindlich)" der PRD, V1 bis V4. Diese Datei ist die zweite
 * Fassung: die erste rechnete in Minuten mit `number`, was V2 ausschliesst.
 *
 * ## Fester Seed (gleiche Regel wie `time-interval.property.test.ts`)
 *
 * Jeder Lauf verwendet denselben Seed. Ein roter Lauf in CI ist damit lokal
 * ohne Zusatzargument wiederholbar. Wer den Seed dreht, um einen roten Lauf
 * loszuwerden, hat den Fehler versteckt, nicht behoben. Faellt ein
 * Eigenschaftstest, gehoert das verkleinerte Gegenbeispiel als benannter Fall
 * nach `money-rate.test.ts` — ein Eigenschaftstest ist der Finder, nicht der
 * Regressionsschutz.
 *
 * ## Scopegrenze EYT-95 / EYT-109 (unveraendert)
 *
 * Alles hier ist ZONENFREI: ganzzahlige Millisekunden, ganzzahlige Minor Units,
 * Kalendertage als reine (Jahr, Monat, Tag)-Tripel. Keine IANA-Zone, keine
 * Mitternachtsteilung, kein DST, keine Summenerhaltung ueber lokale
 * Kalendertage — das ist EYT-109 und kommt spaeter in
 * `daily-cost-allocation.property.test.ts`. Die Aufteilungs-Eigenschaft weiter
 * unten ist bewusst reine Mengenarithmetik (`a + b` Millisekunden), damit sie
 * EYT-109 nicht vorwegnimmt und trotzdem die Driftgrenze der Rundungsregel misst.
 *
 * ## Keine Gleitkommaarithmetik in den Zusicherungen
 *
 * Kein Erwartungswert teilt durch 3_600_000. Stattdessen wird in `bigint`
 * kreuzmultipliziert: statt `betrag === satz * ms / 3_600_000` wird
 * `|betrag * 3_600_000n - satz * ms|` gegen `1_800_000n` geprueft.
 *
 * ## Was dieser Lauf heute NICHT beweist
 *
 * Zum Zeitpunkt des Schreibens existiert keiner der importierten Exporte. Der
 * erste Lauf scheitert an der Modulaufloesung — nach PO-Weisung §4 ein
 * SCHWACHER Rotnachweis. Verhaltensbezogen rot wird die Datei erst mit der
 * minimalen Skelett-Signatur aus dem QA-Bericht.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  addMoney,
  computeCostPosition,
  COST_RATE_DENOMINATOR,
  costOfDuration,
  durationMilliseconds,
  findRateVersionOverlaps,
  hourlyRateAmount,
  hourlyRateVersion,
  moneyFromNumber,
  moneyOfMinorUnits,
  selectRateVersion,
  sumPlanCostAmounts,
  toDurationMilliseconds,
  unsafeIdentifier,
} from "../src/index.js";
import type {
  AssignmentId,
  CostSource,
  DurationMilliseconds,
  HourlyRateVersion,
  LocalBusinessDate,
  PlanCostAmount,
  PlanVersionId,
  RateVersionId,
} from "../src/index.js";

/** Fester Seed. Aendern heisst: andere Faelle, andere Aussage. */
const SEED = 20260730;
const RUNS = 300;

const assertProperty = <T extends unknown[]>(property: fc.IProperty<T>): void => {
  fc.assert(property, { seed: SEED, numRuns: RUNS });
};

/**
 * Nenner des Vertrags (V2), hier als unabhaengiges Literal.
 *
 * Der Grund ist nicht Bequemlichkeit: `DENOMINATOR` baut weiter unten die
 * Halbwertfamilie (`HALF + k * DENOMINATOR`). Waere hier die importierte
 * Konstante eingesetzt, konstruierte der Generator IMMER exakte Halbwerte —
 * auch dann, wenn `src` den Nenner still auf 60_000 aenderte. Der Test bliebe
 * gruen und sagte ueber die Rundungsregel nichts mehr. Das lokale Literal ist
 * also der Massstab, nicht die Kopie.
 *
 * Damit dieser Massstab nicht seinerseits driftet, wird er einmal gegen die
 * Produktionskonstante gehalten — siehe die erste Zusicherung im
 * Rundungsblock.
 */
const DENOMINATOR = 3_600_000n;
const HALF = DENOMINATOR / 2n;

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

// ---------------------------------------------------------------------------
// Orakel und Hilfen — bewusst als ZWEITE, unabhaengige Implementierung
// ---------------------------------------------------------------------------

/**
 * Vergleich zweier Kalendertage, hier von Hand geschrieben statt aus `src/`
 * importiert. Ein Orakel, das die gepruefte Implementierung aufruft, bestaetigt
 * nur sich selbst.
 */
const cmpDay = (a: LocalBusinessDate, b: LocalBusinessDate): number =>
  a.year !== b.year ? a.year - b.year : a.month !== b.month ? a.month - b.month : a.day - b.day;

/**
 * Deckt eine Satzversion diesen Tag ab?
 *
 * V3 ist entschieden: `validFrom` und `validTo` sind beide EINSCHLIESSEND,
 * `validTo = null` ist unbegrenzt. Diese eine Funktion ist die Stelle, an der
 * die Semantik in den Eigenschaftstests steht.
 */
const covers = (version: HourlyRateVersion, on: LocalBusinessDate): boolean =>
  cmpDay(version.validFrom, on) <= 0 &&
  (version.validTo === null || cmpDay(on, version.validTo) <= 0);

/**
 * Ueberlappung zweier Gueltigkeitsintervalle nach der Formel aus V3:
 * `a.validFrom <= b.validTo AND b.validFrom <= a.validTo`, unbegrenzte Enden
 * beruecksichtigt. `bis 30.06. / ab 30.06.` faellt darunter, `bis 30.06. /
 * ab 01.07.` nicht.
 */
const rangesIntersect = (a: HourlyRateVersion, b: HourlyRateVersion): boolean => {
  const aStartsBeforeBEnds = b.validTo === null || cmpDay(a.validFrom, b.validTo) <= 0;
  const bStartsBeforeAEnds = a.validTo === null || cmpDay(b.validFrom, a.validTo) <= 0;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
};

/**
 * Kalendertag aus einem Tagesversatz.
 *
 * `Date.UTC` ist hier reine Kalenderarithmetik ohne Zone — es wird kein Instant
 * in eine Ortszeit uebersetzt, sondern nur ein Tripel (Jahr, Monat, Tag)
 * erzeugt. Damit bleibt die Datei innerhalb der EYT-95-Grenze.
 */
const BASE_MS = Date.UTC(2026, 0, 1);
const dayAt = (offsetDays: number): LocalBusinessDate => {
  const point = new Date(BASE_MS + offsetDays * 86_400_000);
  return { year: point.getUTCFullYear(), month: point.getUTCMonth() + 1, day: point.getUTCDate() };
};

/** Bis 10.000,00 EUR je Stunde, in Minor Units. */
const rateArb = fc.bigInt({ min: 0n, max: 1_000_000n });
/** Bis rund 27,7 Stunden in Millisekunden — Produkt bleibt weit unter 1e15. */
const msArb = fc.bigInt({ min: 0n, max: 100_000_000n });

/** Nichtnegative Menge oder lauter Abbruch. */
const quantityOf = (value: bigint): DurationMilliseconds => {
  const quantity = durationMilliseconds(value);
  if (!quantity.ok) throw new Error(`Generator: Menge abgelehnt (${quantity.error})`);
  return quantity.quantity;
};

interface RateSpec {
  readonly startOffset: number;
  readonly spanDays: number | null;
  readonly minorUnitsPerHour: bigint;
}

const rateSpecArb: fc.Arbitrary<RateSpec> = fc.record({
  startOffset: fc.integer({ min: 0, max: 400 }),
  spanDays: fc.option(fc.integer({ min: 0, max: 90 }), { nil: null }),
  minorUnitsPerHour: rateArb,
});

const buildVersion = (spec: RateSpec, index: number): HourlyRateVersion => {
  // V5.6: die Factory nimmt nur bereits validierte, gebrandete Werte — der
  // Generator durchlaeuft dieselbe Schichtung wie der Produktionsaufrufer.
  const amount = hourlyRateAmount(moneyOfMinorUnits(spec.minorUnitsPerHour, "EUR"));
  if (!amount.ok) throw new Error(`Generator: Satz abgelehnt (${amount.error})`);
  const built = hourlyRateVersion({
    rateVersionId: unsafeIdentifier<RateVersionId>(`gen-${index}`),
    amountPerHour: amount.rate,
    validFrom: dayAt(spec.startOffset),
    validTo: spec.spanDays === null ? null : dayAt(spec.startOffset + spec.spanDays),
  });
  if (!built.ok) throw new Error(`Generator: Satzversion abgelehnt (${built.error})`);
  return built.version;
};

/** Bis zu fuenf Versionen — genug fuer Luecken, Ueberlappungen und Eindeutigkeit. */
const catalogueArb: fc.Arbitrary<readonly HourlyRateVersion[]> = fc
  .array(rateSpecArb, { minLength: 0, maxLength: 5 })
  .map((specs) => specs.map(buildVersion));

const queryDayArb = fc.integer({ min: 0, max: 500 }).map(dayAt);

/** Einzelner gueltiger Satz mit offenem Ende — fuer die reinen Rechen-Eigenschaften. */
const openRate = (minorUnitsPerHour: bigint): HourlyRateVersion =>
  buildVersion({ startOffset: 0, spanDays: null, minorUnitsPerHour }, 0);

/** Betrag aus einem erfolgreichen Kostenergebnis; scheitert laut. */
const amountOf = (result: unknown): PlanCostAmount => {
  // Formunabhaengig, aus demselben Grund wie in `money-rate.test.ts`: V5.2
  // schafft den unerreichbaren Fehlerzweig von `costOfDuration` ab, damit
  // liefert die Funktion den Betrag direkt. Die Formaussage steht dort als eine
  // benannte Zusicherung ("liefert den Betrag direkt, ohne unerreichbaren
  // Fehlerzweig") und nicht verstreut in jeder Eigenschaft.
  if (result !== null && typeof result === "object" && "ok" in result) {
    const typed = result as { ok: true; amount: PlanCostAmount } | { ok: false; error: string };
    if (!typed.ok) throw new Error(`Erwartet: Erfolg. Bekommen: ${typed.error}`);
    return typed.amount;
  }
  return result as PlanCostAmount;
};

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

describe("Money — Eigenschaften ueber erzeugte Betraege (AK1, V1, V4)", () => {
  it("gibt jeden Minor-Unit-Betrag unveraendert zurueck, mit beiden Vorzeichen", () => {
    // V4: `Money` ist vorzeichenoffen. Ein Vertrag, der hier abschneidet oder
    // den Betrag ueber Euro-Gleitkomma fuehrt, faellt fuer die meisten
    // erzeugten Werte auf.
    // Gegenmutation: intern durch 100 teilen und beim Lesen multiplizieren ->
    // anderer Betrag, rot.
    assertProperty(
      fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), (minorUnits) => {
        const money = moneyOfMinorUnits(minorUnits, "EUR");
        expect(money.minorUnits).toBe(minorUnits);
        expect(typeof money.minorUnits).toBe("bigint");
      }),
    );
  });

  it("lehnt an der Zahlengrenze jeden nicht ganzzahligen Betrag ab", () => {
    // Die Eingabe wird bewusst als Gleitkommazahl gebaut — genau so entsteht
    // sie in der Wirklichkeit, naemlich aus einer vorgelagerten Division.
    // Gegenmutation: `Math.round` in `moneyFromNumber` -> ok:true, rot.
    assertProperty(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 1, max: 99 }),
        (whole, hundredths) => {
          const result = moneyFromNumber(whole + hundredths / 100, "EUR");
          expect(result.ok).toBe(false);
        },
      ),
    );
  });

  it("addiert assoziativ und exakt", () => {
    // Drei Betraege, zwei Klammerungen, ein Ergebnis. Eine Addition ueber
    // Euro-Gleitkommawerte ist NICHT assoziativ und faellt hier auf.
    // Gegenmutation: Summe ueber `Number(minorUnits) / 100` bilden und
    // zurueckskalieren -> die Klammerungen driften auseinander, rot.
    const betragArb = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });
    assertProperty(
      fc.property(betragArb, betragArb, betragArb, (x, y, z) => {
        const mx = moneyOfMinorUnits(x, "EUR");
        const my = moneyOfMinorUnits(y, "EUR");
        const mz = moneyOfMinorUnits(z, "EUR");
        const links = addMoney(addMoney(mx, my), mz);
        const rechts = addMoney(mx, addMoney(my, mz));
        expect(links.minorUnits).toBe(rechts.minorUnits);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Menge
// ---------------------------------------------------------------------------

describe("Menge — Eigenschaften ueber erzeugte Millisekunden (V2, V4)", () => {
  it("nimmt jede nichtnegative ganzzahlige Millisekundenmenge an", () => {
    // Einschliesslich null (V4: zulaessige Nullmenge).
    // Gegenmutation: `> 0` fordern -> die 0 wird abgelehnt, rot.
    assertProperty(
      fc.property(msArb, (value) => {
        const quantity = durationMilliseconds(value);
        expect(quantity.ok).toBe(true);
        if (!quantity.ok) return;
        expect(quantity.quantity.milliseconds).toBe(value);
      }),
    );
  });

  it("lehnt jede negative Dauer ab", () => {
    // V4: `Quantity >= 0 sonst QUANTITY_NEGATIVE`.
    // Gegenmutation: Vorzeichenpruefung entfernen -> ok:true, rot.
    assertProperty(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: -1n }), (value) => {
        const quantity = durationMilliseconds(value);
        expect(quantity.ok).toBe(false);
        if (quantity.ok) return;
        expect(quantity.error).toBe("QUANTITY_NEGATIVE");
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// V2b — Sicherheitsgrenze vor BigInt
// ---------------------------------------------------------------------------

describe("Sicherheitsgrenze vor BigInt — Eigenschaften (V2b)", () => {
  /** Epoch-Millisekunden von 2000-01-01 bis 2100-01-01 — der realistische Planungsraum. */
  const epochMsArb = fc.integer({
    min: Date.UTC(2000, 0, 1),
    max: Date.UTC(2100, 0, 1),
  });
  /** Bis 366 Tage am Stueck — grosszuegiger als jeder reale Einsatz. */
  const spanMsArb = fc.integer({ min: 0, max: 366 * 86_400_000 });

  it("nimmt die Differenz zweier realistischer Epoch-Zeitpunkte exakt an", () => {
    // V2b verlangt ausdruecklich, die Annahme zu PRUEFEN statt sie
    // vorauszusetzen. Das ist die obere Haelfte: der gesamte realistische
    // Planungsraum (2000 bis 2100, Spannen bis 366 Tage) muss die Grenze
    // passieren und exakt als bigint ankommen.
    //
    // Der Test ist keine Konstante gegen sich selbst: er faengt eine zu ENG
    // gesetzte Grenze. Der mitgezaehlte groesste Fall belegt, dass wirklich
    // lange Spannen erzeugt wurden und nicht nur Millisekundenkruemel.
    // Gegenmutation: Grenze auf `value <= 2 ** 31` verschaerfen -> rot, sobald
    // eine Spanne 24,8 Tage ueberschreitet.
    let groessteSpanne = 0;
    assertProperty(
      fc.property(epochMsArb, spanMsArb, (start, span) => {
        // Bewusst ueber den Endzeitpunkt gerechnet und nicht `span` direkt
        // genommen: geprueft werden soll die DIFFERENZ zweier Epoch-Werte,
        // genau so, wie sie aus einem Assignment-Intervall entsteht.
        const ende = start + span;
        const differenz = ende - start;
        expect(Number.isSafeInteger(differenz)).toBe(true);
        if (differenz > groessteSpanne) groessteSpanne = differenz;

        const result = toDurationMilliseconds(differenz);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.quantity.milliseconds).toBe(BigInt(differenz));
      }),
    );
    // Ohne diese Zeile waere der Test auch dann gruen, wenn der Generator nur
    // winzige Spannen erzeugte — dann sagte er ueber die Grenze nichts.
    expect(groessteSpanne).toBeGreaterThan(2 ** 31);
  });

  it("weist jede Zahl jenseits der sicheren Ganzzahl fail-closed ab", () => {
    // Die untere Haelfte derselben Annahme, verallgemeinert. Erzeugt werden
    // ausschliesslich Werte oberhalb von Number.MAX_SAFE_INTEGER — genau der
    // Bereich, in dem `BigInt()` NICHT wirft, sondern still einen nicht mehr
    // eindeutig herleitbaren Wert liefert.
    // Gegenmutation: `Number.isSafeInteger` weglassen und nur `try/catch` um
    // `BigInt(value)` legen -> ok:true, rot.
    assertProperty(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (offset) => {
        const unsicher = Number.MAX_SAFE_INTEGER + offset * 2;
        expect(Number.isSafeInteger(unsicher)).toBe(false);
        const result = toDurationMilliseconds(unsicher);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBe("QUANTITY_NOT_SAFE_INTEGER");
      }),
    );
  });

  it("weist jede gebrochene Zahl an der Grenze ab", () => {
    // Gegenmutation: vor der Konvertierung runden -> ok:true, rot.
    assertProperty(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 999 }),
        (ganze, tausendstel) => {
          const result = toDurationMilliseconds(ganze + tausendstel / 1000);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error).toBe("QUANTITY_NOT_INTEGER");
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Rundungsregel
// ---------------------------------------------------------------------------

describe("Rundungsregel — Eigenschaften ueber erzeugte Mengen (V1, V2)", () => {
  it("haelt den lokalen Massstab mit dem Nenner des Vertrags in Deckung", () => {
    // Keine Eigenschaft, sondern ein Driftwaechter — und die eine Zeile, die
    // das lokale Literal oben rechtfertigt. Aenderte `src` den Nenner, wuerde
    // die Halbwertfamilie weiter unten keine Halbwerte mehr erzeugen und
    // stillschweigend nichts mehr messen. Diese Zusicherung faellt vorher.
    // Gegenmutation: `COST_RATE_DENOMINATOR` in `src` auf 60_000n aendern -> rot.
    expect(COST_RATE_DENOMINATOR).toBe(DENOMINATOR);
  });

  it("bleibt hoechstens eine halbe Minor Unit vom exakten Bruch entfernt", () => {
    // DIE zentrale Rundungseigenschaft, kreuzmultipliziert statt geteilt:
    // exakt ist `satz * ms / 3_600_000`, also muss `betrag * 3_600_000`
    // hoechstens 1_800_000 vom Produkt abweichen. Abschneiden reisst diese
    // Schranke, sobald der Rest groesser als die Haelfte ist.
    // Gegenmutation: `/` ohne Rundung (bigint schneidet ab) -> rot.
    let gerundeteFaelle = 0;
    assertProperty(
      fc.property(rateArb, msArb, (satz, milliseconds) => {
        const betrag = amountOf(costOfDuration(openRate(satz), quantityOf(milliseconds)));
        const produkt = satz * milliseconds;
        if (produkt % DENOMINATOR !== 0n) gerundeteFaelle++;
        expect(abs(betrag.minorUnits * DENOMINATOR - produkt)).toBeLessThanOrEqual(HALF);
      }),
    );
    // Ohne diese Zeile waere der Test auch dann gruen, wenn ausschliesslich
    // glatt teilbare Faelle erzeugt wuerden — dann sagte er ueber Rundung nichts.
    expect(gerundeteFaelle).toBeGreaterThan(RUNS / 10);
  });

  it("rundet jeden exakten halben Cent auf den naechsthoeheren Cent", () => {
    // Gezielt konstruierte Halbwertfamilie: bei Satz 1 Cent/h und
    // ms = 1.800.000 + k * 3.600.000 ist das Produkt exakt k + 1/2. HALF_UP
    // liefert immer k + 1.
    //
    // Das trennt die Regel scharf von der Alternative: bankuebliches Runden
    // (HALF_EVEN) liefert fuer die GERADEN k den Wert k statt k + 1 — das ist
    // die Haelfte aller erzeugten Faelle. Ein zufaelliger Generator traefe
    // einen exakten Halbwert praktisch nie; deshalb wird er hier konstruiert.
    // Gegenmutation: HALF_EVEN statt HALF_UP -> rot bei jedem geraden k.
    // Zweite Gegenmutation: Abschneiden -> rot bei jedem k.
    const rate = openRate(1n);
    assertProperty(
      fc.property(fc.bigInt({ min: 0n, max: 1_000_000n }), (k) => {
        const milliseconds = HALF + k * DENOMINATOR;
        const betrag = amountOf(costOfDuration(rate, quantityOf(milliseconds)));
        expect(betrag.minorUnits).toBe(k + 1n);
      }),
    );
  });

  it("ist exakt, wo der Bruch aufgeht", () => {
    // Wo die Dauer ein ganzzahliges Vielfaches einer Stunde ist, darf keine
    // Abweichung entstehen — unabhaengig von der Rundungsregel.
    // Gegenmutation: pauschal aufrunden -> volle Stunden werden um eine Minor
    // Unit zu teuer, rot.
    assertProperty(
      fc.property(rateArb, fc.bigInt({ min: 0n, max: 100_000n }), (satz, stunden) => {
        const betrag = amountOf(costOfDuration(openRate(satz), quantityOf(stunden * DENOMINATOR)));
        expect(betrag.minorUnits).toBe(satz * stunden);
      }),
    );
  });

  it("haengt nur vom exakten Bruch ab, nicht vom Rechenweg", () => {
    // Derselbe exakte Bruch, zwei Wege: (satz * k, ms) und (satz, ms * k)
    // haben dasselbe Produkt und muessen denselben Betrag liefern. Wer
    // zwischendurch rundet, ist wegabhaengig.
    // Gegenmutation: Minutensatz vorab runden -> die Wege driften, rot.
    let nichtGlatteFaelle = 0;
    assertProperty(
      fc.property(
        fc.bigInt({ min: 0n, max: 100_000n }),
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: 1n, max: 10n }),
        (satz, milliseconds, k) => {
          const wegA = amountOf(costOfDuration(openRate(satz * k), quantityOf(milliseconds)));
          const wegB = amountOf(costOfDuration(openRate(satz), quantityOf(milliseconds * k)));
          if ((satz * k * milliseconds) % DENOMINATOR !== 0n) nichtGlatteFaelle++;
          expect(wegA.minorUnits).toBe(wegB.minorUnits);
        },
      ),
    );
    expect(nichtGlatteFaelle).toBeGreaterThan(RUNS / 10);
  });

  it("driftet beim Aufteilen einer Menge um hoechstens eine Minor Unit", () => {
    // ZONENFREI formuliert: `a + b` Millisekunden, kein Kalendertag, keine
    // Mitternacht — die kalendarische Fassung dieser Aussage ist EYT-109.
    // Gemessen wird nur die Rundungsregel: zwei Teilrundungen (je hoechstens
    // eine halbe Einheit) gegen eine Gesamtrundung ergeben hoechstens eine
    // ganze Einheit Unterschied.
    // Gegenmutation: Rundung auf einen Minutensatz vorziehen -> die Abweichung
    // waechst mit der Menge weit ueber 1, rot.
    let driftFaelle = 0;
    assertProperty(
      fc.property(rateArb, msArb, msArb, (satz, a, b) => {
        const rate = openRate(satz);
        const teilA = amountOf(costOfDuration(rate, quantityOf(a)));
        const teilB = amountOf(costOfDuration(rate, quantityOf(b)));
        const ganz = amountOf(costOfDuration(rate, quantityOf(a + b)));
        const summe = addMoney(teilA, teilB);
        const abweichung = abs(summe.minorUnits - ganz.minorUnits);
        if (abweichung !== 0n) driftFaelle++;
        expect(abweichung).toBeLessThanOrEqual(1n);
      }),
    );
    // Ohne Abweichung pruefte der Test nur Gleichheit und waere als
    // Driftschranke wertlos.
    expect(driftFaelle).toBeGreaterThan(0);
  });

  it("liefert fuer nichtnegative Menge und nichtnegativen Satz nie einen negativen Betrag", () => {
    // V4-Berechnungsinvariante: `quantity >= 0 · rate >= 0 ·
    // roundedPositionAmount >= 0`. Da beide Eingaben durch ihre Konstruktoren
    // bereits nichtnegativ sind, ist ein negatives Ergebnis nur noch durch
    // einen Rechen- oder Vorzeichenfehler erreichbar — genau dagegen ist
    // `COST_AMOUNT_NEGATIVE` Defense in Depth.
    // Gegenmutation: Vorzeichenfehler in der Rundung (Betrag negieren) -> rot.
    assertProperty(
      fc.property(rateArb, msArb, (satz, milliseconds) => {
        const betrag = amountOf(costOfDuration(openRate(satz), quantityOf(milliseconds)));
        expect(betrag.minorUnits >= 0n).toBe(true);
      }),
    );
  });

  it("summiert Positionen ohne erneutes Runden", () => {
    // V1 Punkt 7 und 8 als Eigenschaft: die Summe mehrerer Positionen ist
    // exakt die Addition der bereits gerundeten Betraege — nie eine
    // Neuberechnung aus der ungerundeten Gesamtmenge.
    // Gegenmutation: `sumPlanCostAmounts` aus den Ausgangswerten neu rechnen
    // lassen -> weicht in jedem Fall ab, in dem die Rundungen sich aufaddieren,
    // rot.
    let unterscheidbareFaelle = 0;
    assertProperty(
      fc.property(rateArb, fc.array(msArb, { minLength: 1, maxLength: 5 }), (satz, mengen) => {
        const rate = openRate(satz);
        const positionen = mengen.map((m) => amountOf(costOfDuration(rate, quantityOf(m))));

        const summe = sumPlanCostAmounts(positionen);
        expect(summe.ok).toBe(true);
        if (!summe.ok) return;

        const erwartet = positionen.reduce((acc, position) => acc + position.minorUnits, 0n);
        expect(summe.amount.minorUnits).toBe(erwartet);

        // Zaehlt, wie oft sich der vertragsgemaesse Weg vom verbotenen
        // unterscheidet. Ohne solche Faelle waere die Eigenschaft leer.
        const gesamtmenge = mengen.reduce((acc, m) => acc + m, 0n);
        const verboten = amountOf(costOfDuration(rate, quantityOf(gesamtmenge)));
        if (verboten.minorUnits !== erwartet) unterscheidbareFaelle++;
      }),
    );
    expect(unterscheidbareFaelle).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Satzversionsauswahl
// ---------------------------------------------------------------------------

describe("Satzversion — Eigenschaften ueber erzeugte Kataloge (AK3, V3)", () => {
  it("stimmt mit dem paarweisen Deckungsorakel ueberein", () => {
    // Das Orakel zaehlt schlicht, wie viele Versionen den Tag decken. Daraus
    // folgt das erlaubte Ergebnis vollstaendig: keine -> RATE_MISSING, genau
    // eine -> diese eine, mehrere -> RATE_AMBIGUOUS. Es gibt keinen vierten
    // Ausgang, insbesondere kein "die erste gewinnt".
    // Gegenmutation: Auswahl auf `versions.find(...)` umstellen -> der
    // Mehrdeutigkeitsfall liefert ok:true, rot.
    let ohne = 0;
    let genauEine = 0;
    let mehrdeutig = 0;

    assertProperty(
      fc.property(catalogueArb, queryDayArb, (versions, on) => {
        const treffer = versions.filter((version) => covers(version, on));
        const result = selectRateVersion(versions, on);

        if (treffer.length === 0) {
          ohne++;
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error).toBe("RATE_MISSING");
          return;
        }
        if (treffer.length === 1) {
          genauEine++;
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.version.rateVersionId).toBe(treffer[0]?.rateVersionId);
          return;
        }
        mehrdeutig++;
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBe("RATE_AMBIGUOUS");
      }),
    );

    // Alle drei Ausgaenge muessen wirklich vorgekommen sein. Ohne diese drei
    // Zeilen koennte der Generator zufaellig nur einen Fall erzeugen und der
    // Test waere gruen, ohne die Unterscheidung je geprueft zu haben.
    expect(ohne).toBeGreaterThan(0);
    expect(genauEine).toBeGreaterThan(0);
    expect(mehrdeutig).toBeGreaterThan(0);
  });

  it("stimmt in findRateVersionOverlaps mit dem paarweisen Orakel ueberein", () => {
    // Dieselbe Begruendung wie bei `hasAnyOverlap` in
    // `time-interval.property.test.ts`: eine Implementierung, die sortiert und
    // nur Nachbarn vergleicht, ist die Optimierung, die falsch sein KANN.
    // Das Orakel benutzt die Ueberlappungsformel aus V3 woertlich.
    // Gegenmutation: nur benachbarte Paare nach dem Sortieren vergleichen ->
    // eine lange Version, die zwei kurze ueberspannt, wird uebersehen, rot.
    // Seit V5.5 wird nicht mehr nur "gibt es eine Ueberlappung" verglichen,
    // sondern die ANZAHL ungeordneter Paare. Damit misst die Eigenschaft auch
    // die Deduplizierung: eine naive Doppelschleife ueber alle geordneten Paare
    // liefert doppelt so viele Elemente und faellt hier auf, waehrend die alte
    // Boolean-Fassung sie durchgelassen haette.
    let ueberlappendeKataloge = 0;
    assertProperty(
      fc.property(catalogueArb, (versions) => {
        const orakel = versions.reduce(
          (summe, a, i) => summe + versions.filter((b, j) => i < j && rangesIntersect(a, b)).length,
          0,
        );
        if (orakel > 0) ueberlappendeKataloge++;
        expect(findRateVersionOverlaps(versions).length).toBe(orakel);
      }),
    );
    expect(ueberlappendeKataloge).toBeGreaterThan(0);
  });

  it("liefert am ersten Gueltigkeitstag jeder einzelnen Version genau diese Version", () => {
    // Gezielt der Grenztag statt eines zufaelligen Datums: ein zufaelliges
    // Datum trifft `validFrom` fast nie, und genau dort sitzt der
    // Off-by-one-Fehler.
    // Gegenmutation: `>` statt `>=` -> RATE_MISSING am eigenen Starttag, rot.
    assertProperty(
      fc.property(rateSpecArb, (spec) => {
        const version = buildVersion(spec, 0);
        const result = selectRateVersion([version], version.validFrom);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.version.rateVersionId).toBe(version.rateVersionId);
      }),
    );
  });

  it("liefert am letzten Gueltigkeitstag jeder begrenzten Version noch diese Version", () => {
    // Die andere Grenze, und die eigentliche Aussage von V3: `validTo` ist
    // EINSCHLIESSEND. Eine exklusiv gerechnete Implementierung verliert genau
    // diesen einen Tag — bei einem Monatswechsel ein ganzer Arbeitstag ohne Satz.
    // Gegenmutation: `validTo` exklusiv rechnen -> RATE_MISSING, rot.
    let begrenzteFaelle = 0;
    assertProperty(
      fc.property(rateSpecArb, (spec) => {
        if (spec.spanDays === null) return;
        begrenzteFaelle += 1;
        const version = buildVersion(spec, 0);
        const result = selectRateVersion([version], dayAt(spec.startOffset + spec.spanDays));
        expect(result.ok).toBe(true);
      }),
    );
    // Nicht-Leerlauf-Bremse, wie bei jeder anderen gefilterten Eigenschaft dieser
    // Datei. Ohne sie wuerde die Zusicherung gruen bleiben, wenn `fc.option` nur
    // noch unbegrenzte Versionen erzeugt — dann prueft sie die einschliessende
    // Endgrenze gar nicht mehr.
    // Gegenmutation: `spanDays` im Generator auf `fc.constant(null)` stellen ->
    // die Eigenschaft laeuft leer und genau diese Zeile wird rot.
    expect(begrenzteFaelle).toBeGreaterThan(0);
  });

  it("liefert am Tag vor dem ersten Gueltigkeitstag kein Ergebnis", () => {
    // Gegenmutation: validFrom-Pruefung entfernen -> ok:true, rot.
    assertProperty(
      fc.property(rateSpecArb, (spec) => {
        const version = buildVersion(spec, 0);
        const result = selectRateVersion([version], dayAt(spec.startOffset - 1));
        expect(result.ok).toBe(false);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Kostenposition
// ---------------------------------------------------------------------------

describe("Kostenposition — Eigenschaften ueber erzeugte Eingaben (AK4, AK5)", () => {
  const computedAt = new Date("2026-07-30T08:00:00.000Z");
  /**
   * Dieselbe FORM wie in `money-rate.test.ts` — echte UUIDs ueber die
   * vorhandenen Marken, nicht die frueheren Platzhalter "p" und "a".
   * Solange eine der beiden Dateien Platzhalter uebergibt, kann `CostSource`
   * seine Felder nicht branden, ohne diese Datei zu brechen.
   */
  const SOURCE: CostSource = {
    planVersionId: unsafeIdentifier<PlanVersionId>("11111111-1111-4111-8111-111111111111"),
    assignmentId: unsafeIdentifier<AssignmentId>("22222222-2222-4222-8222-222222222222"),
  };

  it("erzeugt nie eine Position, wo kein Satz gilt", () => {
    // WERTPRUEFUNG: das ist der Schaden, den EYT-95 verhindern soll. Eine
    // Position mit 0,00 EUR aus einem fehlenden Satz sieht in der
    // Kostenansicht vollstaendig aus und ist falsch — niemand sucht nach einer
    // Zeile, die scheinbar existiert. Deshalb blockierend, nie stillschweigend
    // null Euro.
    // Gegenmutation: bei RATE_MISSING eine Position mit Betrag 0 erzeugen ->
    // ok:true, rot.
    let ungedeckteFaelle = 0;
    assertProperty(
      fc.property(catalogueArb, queryDayArb, msArb, (versions, on, milliseconds) => {
        if (versions.some((version) => covers(version, on))) return;
        ungedeckteFaelle++;
        const result = computeCostPosition({
          source: SOURCE,
          versions,
          on,
          quantity: quantityOf(milliseconds),
          computedAt,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBe("RATE_MISSING");
      }),
    );
    expect(ungedeckteFaelle).toBeGreaterThan(0);
  });

  it("liefert bei identischer Eingabe identische Ergebnisse", () => {
    // AK5 ueber erzeugte Eingaben. Nur erfuellbar, wenn die Funktion keine Uhr
    // liest und keinen versteckten Zustand fuehrt.
    // Gegenmutation: `new Date()` im Inneren lesen oder einen Zaehler
    // hochzaehlen -> die Ergebnisse unterscheiden sich, rot.
    assertProperty(
      fc.property(catalogueArb, queryDayArb, msArb, (versions, on, milliseconds) => {
        const eingabe = {
          source: SOURCE,
          versions,
          on,
          quantity: quantityOf(milliseconds),
          computedAt,
        };
        expect(computeCostPosition(eingabe)).toEqual(computeCostPosition(eingabe));
      }),
    );
  });

  it("nennt im Erfolgsfall die Satzversion, die das Orakel ausgewaehlt haette", () => {
    // Verbindet Auswahl und Berechnung: ein Betrag ohne belegbare Satzversion
    // ist nach AK4 wertlos, ein Betrag mit der FALSCHEN Satzversion ist
    // schlimmer als keiner.
    // Gegenmutation: im Ergebnis die erste statt der gewaehlten Version
    // eintragen -> rot, sobald mehr als eine Version im Katalog liegt.
    let erfolgsFaelle = 0;
    assertProperty(
      fc.property(catalogueArb, queryDayArb, msArb, (versions, on, milliseconds) => {
        const treffer = versions.filter((version) => covers(version, on));
        if (treffer.length !== 1) return;
        erfolgsFaelle++;
        const result = computeCostPosition({
          source: SOURCE,
          versions,
          on,
          quantity: quantityOf(milliseconds),
          computedAt,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.position.rateVersionId).toBe(treffer[0]?.rateVersionId);
      }),
    );
    expect(erfolgsFaelle).toBeGreaterThan(0);
  });
});
