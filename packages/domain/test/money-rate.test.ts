/**
 * Beispiel- und Grenzfalltests fuer den Money-, Rate- und Rundungsvertrag
 * (EYT-95, REQ-004/REQ-005).
 *
 * Massgeblich ist `docs/prd/sprint-5-daily-cost-export.prd.md`, Abschnitt
 * "Berechnungsvertrag (PO-Entscheidungen vom 30.07.2026, verbindlich)" — V1
 * bis V4. Diese Datei ist die zweite Fassung: die erste rechnete in Minuten
 * mit `number`, was V2 ausdruecklich ausschliesst.
 *
 * ## Der Vertrag in drei Zeilen (V1, V2)
 *
 *   amountNumerator   = rateMinorUnitsPerHour x durationMilliseconds
 *   amountDenominator = 3_600_000
 *   amountMinorUnits  = roundHalfUp(amountNumerator / 3_600_000)
 *
 * Kanonische Menge ist die ganzzahlige Millisekunde, nicht die Minute.
 * Zwischenergebnisse werden NICHT gerundet; gerundet wird genau einmal, beim
 * Erzeugen der persistenten Kostenposition (`ROUNDING_STAGE`). Multiplikation
 * und Division laufen in `bigint`.
 *
 * ## Diese Datei entsteht VOR dem Produktionscode
 *
 * Nichts vom importierten Vertrag existiert in `src/`. Der Lauf scheitert
 * deshalb an der Aufloesung — nach PO-Weisung §4 ein SCHWACHER Rotnachweis,
 * der als solcher gemeldet und nicht als erfuellt gebucht wird.
 *
 * ## Scopegrenze EYT-95 / EYT-109 (unveraendert)
 *
 * Keine Zeitzone, keine Mitternachtsteilung, kein DST, keine Summenerhaltung
 * ueber lokale Kalendertage. Kalendertage sind reine (Jahr, Monat, Tag)-Tripel;
 * Dauern sind reine Millisekundenmengen. Die Ableitung der Dauer aus
 * Assignment-Intervallen gehoert laut PRD-Tabelle "Evidenz-Eigentum" zu EYT-109.
 *
 * ## Keine Gleitkommaarithmetik in den Erwartungswerten
 *
 * Erwartete Betraege stehen als `bigint`-Literal, die exakte Herleitung steht
 * daneben. Wo verglichen statt gesetzt wird, wird kreuzmultipliziert
 * (`betrag * 3_600_000n` gegen `satz * ms`) statt geteilt. Alle Literale sind
 * gegen eine Referenzrechnung geprueft, nicht von Hand geschaetzt.
 */
import { describe, expect, it } from "vitest";

import {
  addMoney,
  compareLocalBusinessDate,
  computeCostPosition,
  COST_RATE_DENOMINATOR,
  COST_RULE_VERSION,
  costCurrencyFromUnknown,
  costOfDuration,
  CURRENCIES,
  dayAfter,
  durationMilliseconds,
  findRateVersionOverlaps,
  HOURLY_RATE_AMOUNT_ERRORS,
  hourlyRateAmount,
  hourlyRateVersion,
  MONEY_ERRORS,
  moneyFromNumber,
  moneyOfMinorUnits,
  PLAN_COST_AMOUNT_ERRORS,
  planCostAmount,
  QUANTITY_ERRORS,
  RATE_SELECTION_ERRORS,
  RATE_VERSION_ERRORS,
  ROUNDING_MODE,
  ROUNDING_STAGE,
  selectRateVersion,
  subtractMoney,
  sumPlanCostAmounts,
  toDurationMilliseconds,
  unsafeIdentifier,
  COST_POSITION_INPUT_ERRORS,
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

// ---------------------------------------------------------------------------
// Testhilfen — klein, zonenfrei, ohne Gleitkomma
// ---------------------------------------------------------------------------

/** Eine Minute in Millisekunden. Nur Lesbarkeit der Fixtures, nie Rechenweg. */
const MIN = 60_000n;

/** Kalendertag als Literal. `LocalBusinessDate` ist strukturell, keine Zone noetig. */
const day = (year: number, month: number, dayOfMonth: number): LocalBusinessDate => ({
  year,
  month,
  day: dayOfMonth,
});

const rateId = (value: string): RateVersionId => unsafeIdentifier<RateVersionId>(value);

/** Nichtnegative Millisekundenmenge oder lauter Abbruch — nie stillschweigend. */
const ms = (value: bigint): DurationMilliseconds => {
  const quantity = durationMilliseconds(value);
  if (!quantity.ok) throw new Error(`Fixture: Menge ${value} abgelehnt: ${quantity.error}`);
  return quantity.quantity;
};

/**
 * Nichtnegativer Stundensatz oder lauter Abbruch (V5.6).
 *
 * Seit V5.6 nimmt `hourlyRateVersion` nur noch bereits validierte, gebrandete
 * Werte entgegen; die Vorzeichenpruefung sitzt an `hourlyRateAmount`. Diese
 * Fixture ist die EINE Stelle, an der die Schichtung durchlaufen wird — aendert
 * sich die Grenze noch einmal, aendert sich nur diese Funktion.
 */
const rateAmount = (minorUnitsPerHour: bigint) => {
  const result = hourlyRateAmount(moneyOfMinorUnits(minorUnitsPerHour, "EUR"));
  if (!result.ok) throw new Error(`Fixture: Satz ${minorUnitsPerHour} abgelehnt: ${result.error}`);
  return result.rate;
};

/** Gueltige Satzversion oder lauter Abbruch. */
const validRate = (
  id: string,
  minorUnitsPerHour: bigint,
  validFrom: LocalBusinessDate,
  validTo: LocalBusinessDate | null,
): HourlyRateVersion => {
  const version = hourlyRateVersion({
    rateVersionId: rateId(id),
    amountPerHour: rateAmount(minorUnitsPerHour),
    validFrom,
    validTo,
  });
  if (!version.ok) throw new Error(`Fixture: Satzversion ${id} abgelehnt: ${version.error}`);
  return version.version;
};

/**
 * Betrag aus einem Kostenergebnis.
 *
 * Bewusst tolerant gegenueber BEIDEN Rueckgabeformen. V5.2 schafft den
 * unerreichbaren Fehlerzweig von `costOfDuration` ab; damit hat die Funktion
 * keinen erreichbaren Fehlerausgang mehr und sollte den Betrag direkt liefern.
 * Diese Formaussage steht als EINE benannte Zusicherung weiter unten
 * ("liefert den Betrag direkt, ohne unerreichbaren Fehlerzweig") — nicht
 * fuenfzehnmal verstreut in jedem Rundungstest. Der Helfer bleibt deshalb
 * formunabhaengig, damit ein Formwechsel genau eine Zeile rot macht und nicht
 * die halbe Datei.
 */
const amountOf = (result: unknown): PlanCostAmount => {
  if (result !== null && typeof result === "object" && "ok" in result) {
    const typed = result as { ok: true; amount: PlanCostAmount } | { ok: false; error: string };
    if (!typed.ok) throw new Error(`Erwartet: Erfolg. Bekommen: ${typed.error}`);
    return typed.amount;
  }
  return result as PlanCostAmount;
};

const minorUnitsOf = (result: unknown): bigint => amountOf(result).minorUnits;

/**
 * Herkunftsreferenz im Sinne von AK4. EYT-95 legt das Innenleben fachlich NICHT
 * fest — geprueft wird nur, dass die uebergebene Referenz unveraendert wieder
 * erscheint.
 *
 * Die FORM ist trotzdem verbindlich und in beiden Testdateien identisch: echte
 * UUIDs, gebaut ueber die vorhandenen Marken `PlanVersionId` und `AssignmentId`.
 * Solange eine Datei Platzhalter wie "p" uebergibt, kann `CostSource` seine
 * Felder nicht branden, ohne diese Datei zu brechen — die Marke bliebe fuer
 * immer aus. Mit dieser Form ist die Verschaerfung von `string` auf die beiden
 * Bezeichnerarten eine reine Typaenderung in `src/`, ohne Testanpassung.
 */
const SOURCE: CostSource = {
  planVersionId: unsafeIdentifier<PlanVersionId>("11111111-1111-4111-8111-111111111111"),
  assignmentId: unsafeIdentifier<AssignmentId>("22222222-2222-4222-8222-222222222222"),
};

// ---------------------------------------------------------------------------
// Money — exakte Minor Units, Vorzeichen offen (AK1, V1, V4)
// ---------------------------------------------------------------------------

describe("Money — exakte EUR-Minor-Units (AK1, V1)", () => {
  it("fuehrt Minor Units als bigint und gibt sie unveraendert zurueck", () => {
    // 45,00 EUR = 4500 Minor Units. `bigint` ist nicht Geschmack, sondern V2:
    // eine `number`-Darstellung faellt spaetestens beim Zwischenprodukt
    // (Satz x Millisekunden) aus dem sicheren Ganzzahlbereich.
    // Gegenmutation: `minorUnits` als `number` fuehren -> `toBe(4500n)` faellt,
    // weil `Object.is(4500, 4500n)` falsch ist, rot.
    const money = moneyOfMinorUnits(4500n, "EUR");
    expect(money.minorUnits).toBe(4500n);
    expect(typeof money.minorUnits).toBe("bigint");
    expect(money.currency).toBe("EUR");
  });

  it("nimmt an der Zahlengrenze einen sicheren ganzzahligen Betrag an", () => {
    // Der Gegenpol zu den drei Ablehnungen darunter. Ohne ihn bleibt die
    // Mutation "lehne pauschal alles ab" gruen — derselbe Fehler, den N1 auf
    // der Mengenseite verhindert. Eine Grenze, die nichts durchlaesst, ist
    // keine Grenze, sondern eine Mauer: die Kostenrechnung bekaeme nie einen
    // Betrag aus Datenbank oder JSON.
    // Gegenmutation: `moneyFromNumber` pauschal ok:false liefern lassen -> rot.
    const result = moneyFromNumber(4500, "EUR");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.money.minorUnits).toBe(4500n);
    expect(typeof result.money.minorUnits).toBe("bigint");
    expect(result.money.currency).toBe("EUR");
  });

  it("lehnt an der Zahlengrenze einen gebrochenen Betrag ab", () => {
    // `moneyFromNumber` ist die einzige Stelle, an der ein ungeprueftes `number`
    // aus JSON oder Datenbank hereinkommt. Ein halber Cent ist kein Geldbetrag;
    // wer ihn annimmt und rundet, hat eine zweite, undokumentierte Rundungsstufe
    // eingefuehrt — genau das verbietet V1 Punkt 5.
    // Gegenmutation: `Math.round` in `moneyFromNumber` -> ok:true, rot.
    const result = moneyFromNumber(4500.5, "EUR");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("AMOUNT_NOT_INTEGER");
  });

  it("lehnt an der Zahlengrenze NaN und Infinity als nicht endlich ab", () => {
    // Keine erfundenen Fehlermodi: genau das liefert eine vorgelagerte
    // Gleitkommarechnung (0/0, Ueberlauf). V1 Punkt 3 schliesst
    // Gleitkommaarithmetik aus, also muss ihr Ergebnis an der Grenze scheitern.
    //
    // `AMOUNT_NOT_FINITE` ist ein eigener Code, nicht in `AMOUNT_NOT_INTEGER`
    // gefaltet: `toDurationMilliseconds` meldet fuer dieselbe Eingabeklasse laut
    // V2b `QUANTITY_NOT_FINITE`, und zwei benachbarte Grenzen duerfen denselben
    // Fall nicht verschieden benennen. Die Codes werden Teil des HTTP-Vertrags,
    // sobald EYT-105 Betraege annimmt — dann waere die Asymmetrie nicht mehr
    // geraeuschlos korrigierbar.
    //
    // Damit gilt fuer `moneyFromNumber` dieselbe Reihenfolge wie in V2b:
    // endlich -> ganzzahlig -> sicher. `Number.isSafeInteger(NaN)` ist
    // ebenfalls falsch, deshalb ist die Reihenfolge nicht beliebig.
    // Gegenmutation: Endlichkeitspruefung entfernen -> NaN faellt in den
    // Ganzzahlzweig und meldet AMOUNT_NOT_INTEGER, rot.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = moneyFromNumber(value, "EUR");
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toBe("AMOUNT_NOT_FINITE");
    }
  });

  it("benennt nicht endliche und gebrochene Betraege unterscheidbar", () => {
    // Dieselbe Vertragsergaenzung, aber typunabhaengig formuliert: NaN und 4500,5
    // sind zwei verschiedene Eingabeklassen und muessen zwei verschiedene Codes
    // liefern. Diese Zusicherung bleibt auch dann gueltig, wenn der PO sich fuer
    // einen anderen Namen als `AMOUNT_NOT_FINITE` entscheidet.
    // Gegenmutation: beide Klassen auf einen Code zusammenlegen -> rot.
    const nichtEndlich = moneyFromNumber(Number.NaN, "EUR");
    const gebrochen = moneyFromNumber(4500.5, "EUR");
    expect(nichtEndlich.ok).toBe(false);
    expect(gebrochen.ok).toBe(false);
    if (nichtEndlich.ok || gebrochen.ok) return;
    expect(nichtEndlich.error).not.toBe(gebrochen.error);
  });

  it("lehnt an der Zahlengrenze einen Betrag jenseits der sicheren Ganzzahl ab", () => {
    // Oberhalb von 2^53 ist eine Ganzzahl als `number` nicht mehr eindeutig:
    // `MAX_SAFE_INTEGER + 2` ist von `+ 1` nicht unterscheidbar. Genau hier
    // endet "verlustfrei", und genau deshalb rechnet der Kern in `bigint`.
    // Gegenmutation: `Number.isSafeInteger` durch `Number.isInteger` ersetzen
    // -> Wert wird angenommen, rot.
    const result = moneyFromNumber(Number.MAX_SAFE_INTEGER + 2, "EUR");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("AMOUNT_NOT_SAFE_INTEGER");
  });

  it("fuehrt genau eine Waehrung und traegt sie am Betrag mit", () => {
    // V1: `CURRENCY = "EUR"`. Die eingefrorene Liste ist der Testanker — eine
    // zweite Waehrung laesst sich nicht nebenbei einfuehren, ohne dass jemand
    // ueber Mischbetraege entscheidet.
    // Gegenmutation: zweite Waehrung in CURRENCIES ohne Mischverbot -> rot.
    expect([...CURRENCIES]).toEqual(["EUR"]);
  });

  it("addiert zwei Betraege exakt in Minor Units", () => {
    // 45,00 EUR + 0,01 EUR = 45,01 EUR. Als Gleitkommazahl waere 45 + 0.01
    // bereits 45.010000000000005.
    // Gegenmutation: Addition ueber Euro-Gleitkommawerte -> 4500 oder 4502, rot.
    const summe = addMoney(moneyOfMinorUnits(4500n, "EUR"), moneyOfMinorUnits(1n, "EUR"));
    expect(summe.minorUnits).toBe(4501n);
  });

  it("zieht einen kleineren Betrag exakt ab", () => {
    // POSITIVRICHTUNG der Subtraktion: der gewoehnliche Fall, in dem der
    // Minuend groesser ist. 2,50 EUR - 1,00 EUR = 1,50 EUR.
    // Gegenmutation: Operanden vertauschen (`subtrahend - minuend`) -> -150n
    // statt 150n, rot.
    const delta = subtractMoney(moneyOfMinorUnits(250n, "EUR"), moneyOfMinorUnits(100n, "EUR"));
    expect(delta.minorUnits).toBe(150n);
  });

  it("laesst bei der Subtraktion ein negatives Delta zu", () => {
    // V4 ausdruecklich: `Money` darf intern ein Vorzeichen tragen, damit
    // Differenzen, Vergleiche und Abweichungen modellierbar bleiben. Wer das
    // hier verbietet, macht spaetere Abweichungsrechnung unmoeglich.
    // Gegenmutation: Vorzeichen schon in `Money` verbieten -> Wurf oder
    // abgeschnittene 0, rot.
    const delta = subtractMoney(moneyOfMinorUnits(100n, "EUR"), moneyOfMinorUnits(250n, "EUR"));
    expect(delta.minorUnits).toBe(-150n);
  });

  it("nimmt ein negatives Delta nicht als Plan-Kostenbetrag an", () => {
    // Die Domaenengrenze aus V4: vorzeichenoffener `Money` ja, aber kein
    // negativer Plan-Kostenbetrag. Das ist der Uebergang, an dem der Wert
    // persistierfaehig wird — und der einzige Ort, an dem
    // `COST_AMOUNT_NEGATIVE` ueberhaupt auftreten kann.
    // Gegenmutation: `planCostAmount` das Vorzeichen durchreichen lassen ->
    // ok:true mit -150, rot.
    const delta = subtractMoney(moneyOfMinorUnits(100n, "EUR"), moneyOfMinorUnits(250n, "EUR"));
    const result = planCostAmount(delta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("COST_AMOUNT_NEGATIVE");
  });

  it("nimmt einen nichtnegativen Betrag als Plan-Kostenbetrag an, einschliesslich null", () => {
    // Die Gegenrichtung. Ohne sie waere die Zeile darueber auch dann gruen,
    // wenn `planCostAmount` jeden Betrag ablehnte.
    // Gegenmutation: `> 0` statt `>= 0` fordern -> der zulaessige Nullbetrag
    // wird abgelehnt, rot.
    for (const value of [0n, 1n, 4500n]) {
      const result = planCostAmount(moneyOfMinorUnits(value, "EUR"));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.amount.minorUnits).toBe(value);
    }
  });
});

// ---------------------------------------------------------------------------
// V5.4-korrigiert — Waehrung an der untrusted Eingangsgrenze
// ---------------------------------------------------------------------------

/**
 * Warum diese Grenze ueberhaupt existiert — und warum sie die EINZIGE Stelle
 * ist, an der eine Waehrung noch abgelehnt werden kann.
 *
 * `Currency` ist das Einzelliteral `"EUR"`. Innerhalb der Domain ist ein
 * Waehrungskonflikt damit nicht konstruierbar, und jeder Vergleich zweier
 * `Money.currency` waere ein toter Zweig. Ungeprueft sind Waehrungen nur dort,
 * wo sie von aussen hereinkommen: HTTP/JSON, PostgreSQL, Importe. Genau dort
 * — und nur dort — sitzt die Pruefung.
 *
 * Dasselbe Muster tragen `moneyFromNumber` und `toDurationMilliseconds`
 * bereits: der getypte Kern ist unerreichbar-by-construction, die untrusted
 * Grenze ist prueffbar und wird geprueft.
 *
 * Diese Testgruppe ist die Lehre aus dem gemessenen Befund: eine
 * Gegenmutation, die BEIDE alten Waehrungswaechter abschaltete, liess das
 * Testergebnis unveraendert. Die Regeln waren von keinem Test gemessen. Die
 * Faelle unten sind gemessen.
 */
describe("Waehrung — untrusted Eingangsgrenze (V5.4-korrigiert)", () => {
  it("nimmt genau den String EUR an", () => {
    // Der Gegenpol zu den Ablehnungen darunter. Ohne ihn bliebe "lehne jede
    // Waehrung ab" gruen — dieselbe Luecke, die auf vier anderen Grenzen schon
    // aufgefallen ist.
    // Gegenmutation: pauschal ok:false liefern -> rot.
    const result = costCurrencyFromUnknown("EUR");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("EUR");
  });

  it("lehnt eine fremde Waehrung ab", () => {
    // Gegenmutation: Pruefung entfernen und jeden String durchlassen -> rot.
    const result = costCurrencyFromUnknown("USD");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("UNSUPPORTED_COST_CURRENCY");
  });

  it("lehnt Kleinschreibung ab, statt still zu normalisieren", () => {
    // Der wichtigste der Ablehnungsfaelle. `"eur".toUpperCase()` ist die
    // naheliegende Bequemlichkeit — und sie waere eine stillschweigende
    // Datenkorrektur an einer Systemgrenze. Was als `"eur"` ankommt, stammt
    // aus einer Quelle, die den Vertrag nicht einhaelt; das gehoert gemeldet,
    // nicht repariert.
    // Gegenmutation: `value.toUpperCase() === "EUR"` pruefen -> ok:true, rot.
    const result = costCurrencyFromUnknown("eur");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("UNSUPPORTED_COST_CURRENCY");
  });

  it("lehnt jeden Nicht-String und den leeren String ab", () => {
    // `unknown` heisst wirklich unknown: aus JSON kommt `null`, aus einer
    // leeren Spalte `""`, aus einem Mapping-Fehler `42` oder `{}`. Alle vier
    // nennt der Vertrag ausdruecklich.
    // KEINE Gegenmutation zur `typeof`-Haelfte: sie ist beweisbar redundant.
    // Gemessen (siehe money.ts): entfernt man sie, bleiben alle 210 Tests gruen —
    // es gibt keinen Wert, den sie faengt und der strikte Vergleich nicht, auch
    // `new String("EUR") !== "EUR"` ist true. Diese Faelle messen den strikten
    // Vergleich, nicht die Typpruefung.
    for (const value of ["", null, undefined, 42, {}]) {
      const result = costCurrencyFromUnknown(value);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toBe("UNSUPPORTED_COST_CURRENCY");
    }
  });
});

// ---------------------------------------------------------------------------
// Menge — nichtnegative ganzzahlige Millisekunden (V2, V4)
// ---------------------------------------------------------------------------

describe("Menge — nichtnegative ganzzahlige Millisekunden (V2, V4)", () => {
  it("nimmt null Millisekunden als zulaessige Menge an", () => {
    // V4 woertlich: "durationMilliseconds = 0 ist eine zulaessige Nullmenge".
    // Kein Fehler, kein Sonderweg — eine Menge von null ergibt spaeter einen
    // deterministischen Nullbetrag.
    // Gegenmutation: `> 0` fordern -> QUANTITY_NEGATIVE fuer 0, rot.
    const quantity = durationMilliseconds(0n);
    expect(quantity.ok).toBe(true);
    if (!quantity.ok) return;
    expect(quantity.quantity.milliseconds).toBe(0n);
  });

  it("lehnt eine negative Dauer ab", () => {
    // V4: `Quantity >= 0 sonst QUANTITY_NEGATIVE`. `end < start` ist ein
    // Intervallfehler VOR der Kostenberechnung; hier faengt die Kosten-Domaene
    // ihn trotzdem ab, statt sich auf den Aufrufer zu verlassen.
    // Gegenmutation: Vorzeichenpruefung entfernen -> ok:true mit -1, rot.
    const quantity = durationMilliseconds(-1n);
    expect(quantity.ok).toBe(false);
    if (quantity.ok) return;
    expect(quantity.error).toBe("QUANTITY_NEGATIVE");
  });
});

// ---------------------------------------------------------------------------
// V2b — Sicherheitsgrenze vor BigInt
// ---------------------------------------------------------------------------

/**
 * V2b nennt vier verbotene Konvertierungen, die je einzeln abzuweisen sind.
 *
 * Drei davon WERFEN in `BigInt()` von selbst — `BigInt(7.5)`, `BigInt(NaN)` und
 * `BigInt(Infinity)` sind alle ein `RangeError`. Der vierte ist der gefaehrliche:
 * `BigInt(Number.MAX_SAFE_INTEGER + 2)` wirft NICHT, sondern liefert klaglos
 * `9007199254740992n` — einen plausibel aussehenden, aber nicht mehr eindeutig
 * herleitbaren Wert. Genau deshalb steht `Number.isSafeInteger` im Vertrag und
 * nicht nur ein `try/catch` um die Konvertierung.
 *
 * Reihenfolge der Pruefungen ist deshalb Teil des Vertrags und nicht beliebig:
 * endlich -> ganzzahlig -> nichtnegativ -> sicher. Wer `isSafeInteger` zuerst
 * prueft, meldet fuer `NaN` faelschlich QUANTITY_NOT_SAFE_INTEGER, weil
 * `Number.isSafeInteger(NaN)` ebenfalls falsch ist.
 */
describe("Sicherheitsgrenze vor BigInt — toDurationMilliseconds (V2b)", () => {
  it("nimmt einen sicheren ganzzahligen Wert an und konvertiert ihn exakt", () => {
    // Die Gegenrichtung zu den vier Ablehnungen. Ohne sie waeren alle vier auch
    // dann gruen, wenn die Grenze pauschal ALLES abwiese — und die
    // Kostenrechnung bekaeme nie eine Menge.
    // Gegenmutation: pauschal ablehnen -> ok:false, rot.
    const result = toDurationMilliseconds(1_830_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quantity.milliseconds).toBe(1_830_000n);
    expect(typeof result.quantity.milliseconds).toBe("bigint");
  });

  it("weist eine gebrochene Zahl ab, statt sie zu konvertieren", () => {
    // Schnittstellenfalle: `durationMinutes()` aus `time-interval.ts` rechnet
    // `durationMs / 60_000` und liefert bei Millisekundenanteil einen
    // Gleitkommawert. V2 verbietet diesen Weg im Kostenpfad; der statische
    // Waechter dazu gehoert nach `apps/api/test/**` (siehe Bericht) — hier
    // steht die Laufzeitgrenze.
    // Gegenmutation: Menge vor der Konvertierung runden -> ok:true, rot.
    // Zweite Gegenmutation: `BigInt(value)` ungeschuetzt aufrufen -> RangeError
    // statt eines benannten Fehlercodes, rot.
    const result = toDurationMilliseconds(450_000.5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("QUANTITY_NOT_INTEGER");
  });

  it("weist NaN ab, statt zu konvertieren", () => {
    // NaN ist das Ergebnis von 0/0 und damit genau das, was eine vorgelagerte
    // Gleitkommarechnung liefert.
    // Gegenmutation: Endlichkeitspruefung entfernen -> `BigInt(NaN)` wirft
    // RangeError statt QUANTITY_NOT_FINITE, rot.
    const result = toDurationMilliseconds(Number.NaN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("QUANTITY_NOT_FINITE");
  });

  it("weist Infinity ab, statt zu konvertieren", () => {
    // Zweiter Fall derselben Klasse, vom PO ausdruecklich einzeln gelistet.
    // Gegenmutation: Endlichkeitspruefung entfernen -> `BigInt(Infinity)` wirft
    // RangeError statt QUANTITY_NOT_FINITE, rot.
    const result = toDurationMilliseconds(Number.POSITIVE_INFINITY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("QUANTITY_NOT_FINITE");
  });

  it("weist einen unsicheren Number-Wert ab, obwohl BigInt ihn klaglos annaehme", () => {
    // DER gefaehrliche der vier Faelle. `Number.MAX_SAFE_INTEGER + 2` ist eine
    // ganze Zahl (`Number.isInteger` ist wahr) und nichtnegativ — die ersten
    // drei Pruefungen lassen ihn durch. `BigInt(...)` wirft nicht, sondern
    // liefert 9007199254740992n. Der Wert ist ab hier nicht mehr eindeutig auf
    // seine Herkunft zurueckfuehrbar, und die "verlustfreie" Rechnung ist
    // stillschweigend falsch geworden.
    // Gegenmutation: `Number.isSafeInteger` weglassen und nur `try/catch` um
    // `BigInt(value)` legen -> ok:true, rot.
    const result = toDurationMilliseconds(Number.MAX_SAFE_INTEGER + 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("QUANTITY_NOT_SAFE_INTEGER");
  });

  it("weist eine negative Zahl an derselben Grenze ab", () => {
    // Dieselbe Vorzeichenregel wie auf der bigint-Seite (V4), aber am
    // Zahleneingang — sonst haette der Vertrag zwei Eingaenge mit zwei
    // verschiedenen Regeln.
    // Gegenmutation: Vorzeichenpruefung nur auf der bigint-Seite fuehren ->
    // ok:true mit -1n, rot.
    const result = toDurationMilliseconds(-1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("QUANTITY_NEGATIVE");
  });

  it("traegt die Differenz zweier Epoch-Millisekunden ueber ein realistisches Einsatzintervall", () => {
    // V2b woertlich: "Die Differenz zweier Epoch-Millisekunden ist fuer
    // realistische Einsatzintervalle sicher darstellbar — diese Annahme ist zu
    // pruefen und darf nicht still vorausgesetzt werden."
    //
    // Gemessen wird hier die OBERE Haelfte der Annahme: ein volles Jahr am
    // Stueck (366 Tage = 31.622.400.000 ms) muss die Grenze passieren. Das ist
    // keine Konstante gegen sich selbst, sondern faengt eine zu ENG gesetzte
    // Grenze: wer intern auf 32 Bit begrenzt, scheitert hier, denn
    // 31.622.400.000 ist rund fuenfzehnmal groesser als 2^31.
    // Gegenmutation: Grenze auf `value <= 2 ** 31` verschaerfen -> rot.
    const start = Date.UTC(2026, 0, 1);
    const end = Date.UTC(2027, 0, 2);
    const differenz = end - start;

    expect(differenz).toBeGreaterThan(2 ** 31);
    const result = toDurationMilliseconds(differenz);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quantity.milliseconds).toBe(BigInt(differenz));
  });

  it("weist die Differenz zweier extremer Epoch-Zeitpunkte fail-closed ab", () => {
    // Die UNTERE Haelfte derselben Annahme, und der Grund, warum sie eine
    // Annahme ist und keine Tatsache: `Date` stellt +/- 8.64e15 ms dar, die
    // Spanne zwischen beiden Enden ist 1,728e16 — GROESSER als
    // Number.MAX_SAFE_INTEGER (9,007e15). Die Differenz zweier gueltiger
    // Date-Werte kann also sehr wohl unsicher werden. Sie ist damit kein
    // hypothetischer Ueberlauf, sondern mit echten Date-Objekten erreichbar.
    // Gegenmutation: obere Schranke weglassen -> BigInt nimmt den unsicheren
    // Wert klaglos an, ok:true, rot.
    const maxDate = 8.64e15;
    const differenz = maxDate - -maxDate;

    expect(Number.isSafeInteger(differenz)).toBe(false);
    const result = toDurationMilliseconds(differenz);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("QUANTITY_NOT_SAFE_INTEGER");
  });
});

// ---------------------------------------------------------------------------
// Rundungsregel und Berechnung (V1, V2)
// ---------------------------------------------------------------------------

describe("Berechnung und Rundung — HALF_UP, genau einmal (V1, V2)", () => {
  const from = day(2026, 1, 1);

  it("benennt Regelversion, Rundungsmodus und Rundungsstufe fest", () => {
    // V1 legt diese Werte verbindlich fest und erklaert sie ausdruecklich fuer
    // NICHT mandanten- oder nutzerkonfigurierbar. Jede Position referenziert
    // die Regelversion; ein Wechsel laeuft nur ueber neue Regelversion und
    // Forward-Fix.
    // Gegenmutation: die Regel ueber Konfiguration oder Umgebungsvariable
    // einstellbar machen -> mindestens einer dieser Werte weicht ab, rot.
    // V5.3: der Modus heisst `HALF_UP_NON_NEGATIVE`, nicht `HALF_UP`. Das ist
    // keine Kosmetik, sondern die Ruecknahme eines Ueberklaims: "Halbwert von
    // null weg" ist im Kostenpfad nicht beobachtbar, weil Menge und Satz beide
    // nichtnegativ sind. Der Name sagt jetzt genau so viel, wie nachgewiesen ist.
    expect(COST_RULE_VERSION).toBe("personnel-plan-cost-v1");
    expect(ROUNDING_MODE).toBe("HALF_UP_NON_NEGATIVE");
    expect(ROUNDING_STAGE).toBe("COST_POSITION_FINAL_AMOUNT");
    expect(COST_RATE_DENOMINATOR).toBe(3_600_000n);
  });

  it("liefert den Betrag direkt, ohne unerreichbaren Fehlerzweig", () => {
    // V5.2: bei validierter nichtnegativer Menge und validiertem nichtnegativem
    // Satz kann die Multiplikation keinen negativen Betrag ergeben. Ein
    // oeffentlicher Result-Zweig, der mit zulaessigen Eingaben nie eintritt,
    // ist Scheingenauigkeit — er zwingt jeden Aufrufer zu einer Fallunter-
    // scheidung, die nie greift, und taeuscht Sorgfalt vor.
    //
    // Diese eine Zusicherung haelt die FORM fest. Die uebrigen Rundungstests
    // benutzen bewusst einen formunabhaengigen Helfer, damit ein Formwechsel
    // hier auffaellt und nicht fuenfzehnmal.
    // Gegenmutation: `costOfDuration` weiter ein `{ ok, amount }` zurueckgeben
    // lassen -> rot.
    const rate = validRate("r-form", 10_000n, from, null);
    const ergebnis: unknown = costOfDuration(rate, ms(30n * MIN));

    expect(ergebnis).not.toHaveProperty("ok");
    expect(ergebnis).toHaveProperty("minorUnits");
    expect((ergebnis as PlanCostAmount).minorUnits).toBe(5_000n);
  });

  it("rechnet eine volle Stunde exakt", () => {
    // 100,01 EUR/h x 60 min: 10001 x 3_600_000 / 3_600_000 = 10001. Kein
    // Rundungsschritt beteiligt — dieser Fall trennt Einheitenfehler von
    // Rundungsfehlern.
    // Gegenmutation: den Satz als Minuten- oder Millisekundensatz lesen ->
    // vollkommen andere Groessenordnung, rot.
    const rate = validRate("r-stunde", 10_001n, from, null);
    expect(minorUnitsOf(costOfDuration(rate, ms(60n * MIN)))).toBe(10_001n);
  });

  it("rechnet dreissig Minuten exakt", () => {
    // 100,00 EUR/h x 30 min: 10000 x 1_800_000 / 3_600_000 = 5000 = 50,00 EUR.
    // Gegenmutation: Nenner auf 60_000 (Minuten) aendern -> 300000, rot.
    const rate = validRate("r-30", 10_000n, from, null);
    expect(minorUnitsOf(costOfDuration(rate, ms(30n * MIN)))).toBe(5_000n);
  });

  it("rundet einen exakten halben Cent auf den naechsthoeheren Cent", () => {
    // Das Beispiel aus V2 woertlich: 10.001 Cent/h x 1.800.000 ms
    // = 18.001.800.000 / 3.600.000 = 5.000,5 -> 5.001 Cent = 50,01 EUR.
    // Dies ist der eine Fall, der HALF_UP von HALF_EVEN trennt: 5000 ist
    // gerade, bankuebliches Runden lieferte 5000.
    //
    // Der Testname sagt seit V5.3 genau das, was gemessen wird — "von null weg"
    // waere ein Ueberklaim, denn ein negativer Halbwert kommt im Kostenpfad
    // nicht vor und wird hier auch nicht geprueft.
    // Gegenmutation: HALF_EVEN statt HALF_UP_NON_NEGATIVE -> 5000, rot.
    // Zweite Gegenmutation: `Math.floor` -> 5000, rot.
    const rate = validRate("r-halb", 10_001n, from, null);
    expect(minorUnitsOf(costOfDuration(rate, ms(30n * MIN)))).toBe(5_001n);
  });

  it("rechnet dreissig Minuten und dreissig Sekunden ohne Minutenraster", () => {
    // 100,00 EUR/h x 1.830.000 ms = 18.300.000.000 / 3.600.000 = 5083,33...
    // -> 5083. Sekundenanteile werden weder verworfen noch auf die Minute
    // gerundet: V2 sagt ausdruecklich, die minutengenaue UI-Eingabe zwinge die
    // Geldarithmetik nicht dazu.
    // Gegenmutation: Menge auf volle Minuten abschneiden -> 5000, rot.
    const rate = validRate("r-30-30", 10_000n, from, null);
    expect(minorUnitsOf(costOfDuration(rate, ms(1_830_000n)))).toBe(5_083n);
  });

  it("rechnet siebeneinhalb Minuten exakt", () => {
    // Unter dem Minutenvertrag war 7,5 eine abzulehnende gebrochene Menge.
    // Unter V2 sind das schlicht 450.000 ms, und die Rechnung geht exakt auf:
    // 10000 x 450_000 / 3_600_000 = 1250 = 12,50 EUR (100 EUR/h x 0,125 h).
    // Genau dafuer ist die Millisekunde die kanonische Einheit.
    // Gegenmutation: Menge auf volle Minuten abschneiden -> 1166 oder 1167, rot.
    const rate = validRate("r-7-5", 10_000n, from, null);
    expect(minorUnitsOf(costOfDuration(rate, ms(450_000n)))).toBe(1_250n);
  });

  it("rechnet eine einzelne Millisekunde zu null Cent", () => {
    // 10000 x 1 / 3.600.000 = 0,00277... -> 0. Kein Fehler, kein aufgerundeter
    // Cent: die kleinste Menge ergibt bei realistischen Saetzen null.
    // Gegenmutation: pauschal aufrunden -> 1, rot.
    const rate = validRate("r-1ms", 10_000n, from, null);
    expect(minorUnitsOf(costOfDuration(rate, ms(1n)))).toBe(0n);
  });

  it("rechnet null Millisekunden zu einem deterministischen Nullbetrag", () => {
    // V4: die zulaessige Nullmenge ergibt einen gueltigen Nullbetrag, kein
    // blockierendes Ergebnis. Unterscheidbar bleibt sie vom fehlenden Satz
    // ueber `RATE_MISSING`, nicht ueber den Betrag.
    // Gegenmutation: Nullmenge als Fehler behandeln -> ok:false, rot.
    const rate = validRate("r-0ms", 10_000n, from, null);
    expect(minorUnitsOf(costOfDuration(rate, ms(0n)))).toBe(0n);
    expect(minorUnitsOf(costOfDuration(rate, ms(0n)))).toBe(0n);
  });

  it("rundet nicht auf einem Minuten- oder Sekundensatz", () => {
    // 100 Cent/h x 420.000 ms (7 min) = 42.000.000 / 3.600.000 = 11,666... -> 12.
    // Wer zuerst den Minutensatz rundet, rechnet round(100/60) = 2 und danach
    // 2 x 7 = 14. V1 Punkt 4 verbietet jedes Zwischenrunden.
    // Gegenmutation: Minutensatz vorab runden -> 14, rot.
    const rate = validRate("r-spaet", 100n, from, null);
    expect(minorUnitsOf(costOfDuration(rate, ms(7n * MIN)))).toBe(12n);
  });

  it("liefert fuer denselben exakten Bruch denselben Betrag, unabhaengig vom Rechenweg", () => {
    // Zwei Wege zum selben Produkt 42.000.000: (100 Cent/h, 7 min) und
    // (700 Cent/h, 1 min). Beide muessen 12 liefern. Eine Implementierung, die
    // zwischendurch auf den Minutensatz rundet, liefert 14 und 12 — sie ist
    // wegabhaengig und faellt hier auf.
    // Gegenmutation: Minutensatz vorab runden -> 14 gegen 12, rot.
    const langsam = validRate("r-weg-a", 100n, from, null);
    const schnell = validRate("r-weg-b", 700n, from, null);
    expect(minorUnitsOf(costOfDuration(langsam, ms(7n * MIN)))).toBe(12n);
    expect(minorUnitsOf(costOfDuration(schnell, ms(1n * MIN)))).toBe(12n);
  });

  it("rechnet eine sehr lange, zulaessige Dauer exakt", () => {
    // 99.999.999 volle Stunden zu 10.001 Cent je Stunde. Weil die Dauer ein
    // ganzzahliges Vielfaches einer Stunde ist, ist das Ergebnis von Hand
    // ableitbar: Satz x Stunden = 10.001 x 99.999.999 = 1.000.099.989.999.
    //
    // Der Punkt ist das ZWISCHENPRODUKT: 10.001 x 359.999.996.400.000 liegt bei
    // rund 3,6e18 und damit weit ausserhalb des sicheren Ganzzahlbereichs von
    // `number`. Deshalb steht in V2 `bigint`.
    // Gegenmutation: `minorUnits` als `number` fuehren -> `toBe(...n)` faellt,
    // weil `Object.is(1000099989999, 1000099989999n)` falsch ist, rot.
    const stunden = 99_999_999n;
    const rate = validRate("r-lang", 10_001n, from, null);
    const dauer = ms(stunden * 3_600_000n);

    expect(minorUnitsOf(costOfDuration(rate, dauer))).toBe(10_001n * stunden);
    // Dokumentiert, dass dieser Fall den sicheren Bereich wirklich verlaesst —
    // ohne diese Zeile waere unklar, ob der Test die Grenze ueberhaupt beruehrt.
    expect(Number.isSafeInteger(10_001 * Number(stunden * 3_600_000n))).toBe(false);
  });

  it("bleibt auch dort exakt, wo eine Gleitkommarechnung nachweislich driftet", () => {
    // Maschinell gesuchter Gegenfall (kein von Hand geratener Wert): fuer
    // Satz 10.007 Cent/h und 999.300.489.657.140 ms liegt das exakte Produkt
    // 20 unterhalb einer exakten Haelfte. Die Gleitkommadarstellung schiebt es
    // darueber, und `Math.round(satz * ms / 3_600_000)` liefert einen Cent zu
    // viel.
    //
    // Geprueft wird bewusst KEIN Magic-Number-Erwartungswert, sondern die
    // Kreuzmultiplikationsschranke: der Betrag darf hoechstens eine halbe
    // Minor Unit vom exakten Bruch abweichen. Gemessen: die exakte Rechnung
    // haelt 1.799.980, die Gleitkommarechnung verfehlt mit 1.800.020.
    // Gegenmutation: Zwischenprodukt in `number` bilden -> Schranke gerissen, rot.
    const satz = 10_007n;
    const dauerMs = 999_300_489_657_140n;
    const rate = validRate("r-drift", satz, from, null);

    const betrag = minorUnitsOf(costOfDuration(rate, ms(dauerMs)));
    const abweichung = betrag * COST_RATE_DENOMINATOR - satz * dauerMs;
    const abstand = abweichung < 0n ? -abweichung : abweichung;
    expect(abstand).toBeLessThanOrEqual(COST_RATE_DENOMINATOR / 2n);
  });

  it("bildet Summen ausschliesslich aus den bereits gerundeten Positionsbetraegen", () => {
    // V1 Punkt 7 und 8, und der teuerste Buchhaltungsfehler der ganzen Regel.
    // Drei Positionen zu je 7 Minuten bei 100,00 EUR/h:
    //   je Position exakt 11,666... -> gerundet 1167 Cent
    //   Summe der gerundeten Positionen = 3 x 1167 = 3501 Cent = 35,01 EUR
    //   Rundung der exakten Gesamtmenge = 21 min   = 3500 Cent = 35,00 EUR
    // Die beiden Wege sind um einen Cent verschieden, und der Vertrag schreibt
    // den ersten vor. Ohne diesen Test bleibt die Regel Prosa.
    // Gegenmutation: Gesamtsumme aus der ungerundeten Gesamtmenge rechnen ->
    // 3500, rot.
    const rate = validRate("r-summe", 10_000n, from, null);
    const position = amountOf(costOfDuration(rate, ms(7n * MIN)));
    expect(position.minorUnits).toBe(1_167n);

    const summe = sumPlanCostAmounts([position, position, position]);
    expect(summe.ok).toBe(true);
    if (!summe.ok) return;
    expect(summe.amount.minorUnits).toBe(3_501n);
    // Und ausdruecklich NICHT der Wert, den eine Neuberechnung aus der
    // ungerundeten Gesamtmenge liefern wuerde:
    expect(summe.amount.minorUnits).not.toBe(minorUnitsOf(costOfDuration(rate, ms(21n * MIN))));
  });

  it("summiert eine leere Menge zu null Euro", () => {
    // V5.1: die leere Summe hat eine eindeutige additive Identitaet, weil
    // Sprint 5 ausschliesslich EUR kennt. Vorher war das offen — ein Vertrag,
    // der hier wirft oder `null` liefert, zwingt jeden Aufrufer zu einer
    // Sonderbehandlung fuer den haeufigsten Fall der Welt: eine Baustelle ohne
    // Positionen.
    //
    // Ausdruecklich mitgeprueft: der Nullbetrag laeuft durch DENSELBEN
    // Validator wie jeder andere Betrag — er kommt als gueltiger
    // PlanCostAmount heraus, nicht als roher Sonderwert.
    // Gegenmutation: leere Menge werfen oder ok:false liefern lassen -> rot.
    // Zweite Gegenmutation: `{ minorUnits: 0n, currency: "EUR" }` am Validator
    // vorbei konstruieren -> die Marke fehlt, der Typ passt nicht mehr.
    const summe = sumPlanCostAmounts([]);
    expect(summe.ok).toBe(true);
    if (!summe.ok) return;
    expect(summe.amount.minorUnits).toBe(0n);
    expect(summe.amount.currency).toBe("EUR");
    // Derselbe Wert, den der regulaere Validator fuer 0 liefert.
    const ueberValidator = planCostAmount(moneyOfMinorUnits(0n, "EUR"));
    expect(ueberValidator.ok).toBe(true);
    if (!ueberValidator.ok) return;
    expect(summe.amount).toEqual(ueberValidator.amount);
  });
});

// ---------------------------------------------------------------------------
// Satzversionsauswahl an Intervallgrenzen (AK3, V3)
// ---------------------------------------------------------------------------

describe("Satzversion — Gueltigkeit einschliessend, intern halboffen (AK3, V3)", () => {
  it("waehlt am ersten Gueltigkeitstag bereits die Version", () => {
    // "gueltig ab" ist einschliessend. Der Grenztag selbst gehoert dazu — die
    // haeufigste Off-by-one-Stelle des Vertrags.
    // Gegenmutation: `>` statt `>=` bei validFrom -> RATE_MISSING, rot.
    const rate = validRate("r-start", 4500n, day(2026, 7, 1), null);
    const result = selectRateVersion([rate], day(2026, 7, 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version.rateVersionId).toBe(rate.rateVersionId);
  });

  it("waehlt am Tag vor dem ersten Gueltigkeitstag noch nicht", () => {
    // Gegenrichtung derselben Grenze. Ohne sie waere die Zeile darueber auch
    // dann gruen, wenn die Auswahl jedes Datum akzeptierte.
    // Gegenmutation: validFrom-Pruefung entfernen -> ok:true, rot.
    const rate = validRate("r-start", 4500n, day(2026, 7, 1), null);
    const result = selectRateVersion([rate], day(2026, 6, 30));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("RATE_MISSING");
  });

  it("laesst die Kette bis 30.06. / ab 01.07. lueckenlos und ueberlappungsfrei zu", () => {
    // V3 woertlich: "bis 30.06. / ab 01.07. ist lueckenlos und zulaessig".
    // `validTo` ist fachlich EINSCHLIESSEND; intern normalisiert der Vertrag auf
    // `[validFrom, dayAfter(validTo))`. Beide Grenztage treffen genau eine
    // Version, kein Tag doppelt, kein Tag leer.
    // Gegenmutation: `validTo` exklusiv rechnen -> der 30.06. faellt in die
    // Luecke, rot.
    const alt = validRate("r-alt", 4500n, day(2026, 1, 1), day(2026, 6, 30));
    const neu = validRate("r-neu", 4700n, day(2026, 7, 1), null);
    const versions = [alt, neu];

    const letzterAlterTag = selectRateVersion(versions, day(2026, 6, 30));
    const ersterNeuerTag = selectRateVersion(versions, day(2026, 7, 1));
    expect(letzterAlterTag.ok && ersterNeuerTag.ok).toBe(true);
    if (!letzterAlterTag.ok || !ersterNeuerTag.ok) return;
    expect(letzterAlterTag.version.rateVersionId).toBe(alt.rateVersionId);
    expect(ersterNeuerTag.version.rateVersionId).toBe(neu.rateVersionId);
    expect(findRateVersionOverlaps(versions)).toEqual([]);
  });

  it("wertet die Kette bis 30.06. / ab 30.06. als Ueberlappung", () => {
    // V3 woertlich: "bis 30.06. / ab 30.06. ist eine Ueberlappung". Der
    // Ein-Tages-Ueberhang ist der Fall, den eine exklusiv gerechnete
    // Implementierung fuer harmlos haelt — und er erzeugt fuer genau einen Tag
    // zwei gueltige Saetze.
    // Gegenmutation: Ueberlappung mit `<` statt `<=` pruefen -> leer, rot.
    const alt = validRate("r-alt", 4500n, day(2026, 1, 1), day(2026, 6, 30));
    const neu = validRate("r-neu", 4700n, day(2026, 6, 30), null);
    expect(findRateVersionOverlaps([alt, neu])).toHaveLength(1);

    const amGrenztag = selectRateVersion([alt, neu], day(2026, 6, 30));
    expect(amGrenztag.ok).toBe(false);
    if (amGrenztag.ok) return;
    expect(amGrenztag.error).toBe("RATE_AMBIGUOUS");
  });

  it("meldet zwei ueberlappende Versionen als blockierend statt die erste zu nehmen", () => {
    // A laeuft bis 31.07., B beginnt am 01.07. Der 15.07. ist doppelt gedeckt.
    // `versions.find(...)` liefert klaglos die erste und erzeugt einen Betrag,
    // den niemand belegen kann.
    // Gegenmutation: Auswahl auf `find` umstellen -> ok:true, rot.
    const a = validRate("r-a", 4500n, day(2026, 1, 1), day(2026, 7, 31));
    const b = validRate("r-b", 4700n, day(2026, 7, 1), null);
    const result = selectRateVersion([a, b], day(2026, 7, 15));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("RATE_AMBIGUOUS");
  });

  it("findet die Ueberlappung auch dann, wenn die Versionen unsortiert kommen", () => {
    // Die Eingabereihenfolge darf ueber Blockieren oder Durchlassen nicht
    // entscheiden. Wer nur benachbarte Paare vergleicht, ohne zu sortieren,
    // uebersieht genau das.
    // Gegenmutation: Sortierschritt entfernen -> leer, rot.
    const a = validRate("r-a", 4500n, day(2026, 1, 1), day(2026, 7, 31));
    const b = validRate("r-b", 4700n, day(2026, 7, 1), null);
    expect(findRateVersionOverlaps([b, a])).toHaveLength(1);
  });

  it("deckt mit unbegrenztem Ende auch weit spaetere Daten ab", () => {
    // V3: `validTo = null` ist unbegrenzt. Eine Implementierung, die `null`
    // heimlich auf "heute" oder das Jahresende normalisiert, faellt hier auf.
    // Gegenmutation: `null` auf ein festes Enddatum abbilden -> RATE_MISSING
    // fuer 2099, rot.
    const rate = validRate("r-offen", 4500n, day(2026, 1, 1), null);
    const result = selectRateVersion([rate], day(2099, 12, 31));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version.rateVersionId).toBe(rate.rateVersionId);
  });

  it("meldet eine Luecke als blockierend und niemals als null Euro", () => {
    // WERTPRUEFUNG. Der teuerste Fehler des Tickets: A endet am 30.06.,
    // B beginnt am 01.08., gefragt ist der 15.07. Liefert der Vertrag hier
    // stillschweigend 0,00 EUR, sieht die Kostenansicht vollstaendig aus und
    // ist falsch — niemand sucht nach einer Position, die es scheinbar gibt.
    // Gegenmutation: Rueckfall auf `moneyOfMinorUnits(0n, "EUR")` -> ok:true
    // mit Betrag 0, rot.
    const a = validRate("r-a", 4500n, day(2026, 1, 1), day(2026, 6, 30));
    const b = validRate("r-b", 4700n, day(2026, 8, 1), null);
    const result = selectRateVersion([a, b], day(2026, 7, 15));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("RATE_MISSING");
    // Ein blockierendes Ergebnis darf keinen lesbaren Geldwert mitfuehren.
    expect(result).not.toHaveProperty("amount");
  });

  it("unterscheidet den ausdruecklichen Nullsatz vom fehlenden Satz", () => {
    // V4 woertlich: "Ein Satz von 0 ist zulaessig und bleibt von RATE_MISSING
    // unterscheidbar." Beide zeigen dem Menschen 0,00 EUR und bedeuten das
    // Gegenteil — bewusst unentgeltlich gegen fehlende Datenpflege.
    // Gegenmutation: Nullsatz wie fehlenden behandeln -> RATE_MISSING, rot.
    const nullsatz = validRate("r-null", 0n, day(2026, 1, 1), null);
    const gewaehlt = selectRateVersion([nullsatz], day(2026, 7, 15));
    expect(gewaehlt.ok).toBe(true);
    if (!gewaehlt.ok) return;
    expect(gewaehlt.version.amountPerHour.minorUnits).toBe(0n);
    expect(minorUnitsOf(costOfDuration(gewaehlt.version, ms(480n * MIN)))).toBe(0n);

    const fehlt = selectRateVersion([], day(2026, 7, 15));
    expect(fehlt.ok).toBe(false);
    if (fehlt.ok) return;
    expect(fehlt.error).toBe("RATE_MISSING");
  });

  it("nimmt eine Satzversion mit gueltigem Intervall an", () => {
    // Der Gegenpol zu den beiden Ablehnungen darunter. Ohne ihn bliebe die
    // Mutation "lehne jede Satzversion ab" gruen — dieselbe Luecke, die auf der
    // Money- und der Mengenseite schon einmal aufgefallen ist. Zugleich die
    // Positivrichtung, die das Invariantenregister fuer `hourlyRateVersion`
    // verlangt.
    // Gegenmutation: `hourlyRateVersion` pauschal ok:false liefern lassen -> rot.
    const version = hourlyRateVersion({
      rateVersionId: rateId("r-gueltig"),
      amountPerHour: rateAmount(4500n),
      validFrom: day(2026, 1, 1),
      validTo: day(2026, 6, 30),
    });
    expect(version.ok).toBe(true);
    if (!version.ok) return;
    expect(version.version.rateVersionId).toBe(rateId("r-gueltig"));
    expect(version.version.amountPerHour.minorUnits).toBe(4500n);
    expect(version.version.validFrom).toEqual(day(2026, 1, 1));
    expect(version.version.validTo).toEqual(day(2026, 6, 30));
  });

  it("lehnt einen negativen Stundensatz ab", () => {
    // V4: `Rate >= 0 sonst RATE_NEGATIVE`. Ein negativer Satz erzeugte eine
    // Gutschrift, die niemand angeordnet hat. Stornobuchungen brauchen laut V4
    // einen eigenen fachlichen Typ und duerfen nicht nebenbei entstehen.
    //
    // V5.6 hat die GRENZE verschoben, nicht die Regel: die Pruefung sitzt jetzt
    // am gebrandeten Satzkonstruktor `hourlyRateAmount`, nicht mehr in
    // `hourlyRateVersion`. Die Factory bekommt gar keinen unvalidierten Betrag
    // mehr zu sehen, und es entsteht keine willkuerliche Priorisierung
    // mehrerer roher Eingabefehler.
    // Gegenmutation: Vorzeichenpruefung entfernen -> ok:true, rot.
    const amount = hourlyRateAmount(moneyOfMinorUnits(-1n, "EUR"));
    expect(amount.ok).toBe(false);
    if (amount.ok) return;
    expect(amount.error).toBe("RATE_NEGATIVE");
  });

  it("nimmt einen nichtnegativen Stundensatz an, einschliesslich null", () => {
    // Der Gegenpol, damit "lehne jeden Satz ab" nicht gruen bleibt — dieselbe
    // Luecke, die bei `moneyFromNumber`, `toDurationMilliseconds` und
    // `hourlyRateVersion` schon dreimal aufgefallen ist. Der ausdrueckliche
    // Nullsatz ist laut V4 zulaessig und bleibt von RATE_MISSING unterscheidbar.
    // Gegenmutation: `hourlyRateAmount` pauschal ok:false liefern lassen -> rot.
    for (const value of [0n, 4500n]) {
      const amount = hourlyRateAmount(moneyOfMinorUnits(value, "EUR"));
      expect(amount.ok).toBe(true);
      if (!amount.ok) continue;
      expect(amount.rate.minorUnits).toBe(value);
    }
  });

  it("lehnt eine Version ab, deren gueltig-bis vor gueltig-ab liegt", () => {
    // Ein verkehrtes Intervall deckt kein Datum ab und wuerde je nach
    // Implementierung entweder still verschwinden oder jedes Datum treffen.
    // Dieselbe Entscheidung, die `TimeInterval.create` fuer END_BEFORE_START
    // trifft.
    // Gegenmutation: Pruefung entfernen -> ok:true, rot.
    const version = hourlyRateVersion({
      rateVersionId: rateId("r-verkehrt"),
      amountPerHour: rateAmount(4500n),
      validFrom: day(2026, 7, 1),
      validTo: day(2026, 6, 30),
    });
    expect(version.ok).toBe(false);
    if (version.ok) return;
    expect(version.error).toBe("VALID_TO_BEFORE_VALID_FROM");
  });

  it("ordnet zwei Kalendertage desselben Monats und erkennt Gleichheit", () => {
    // POSITIVRICHTUNG des Vergleichers: die gewoehnliche Ordnung innerhalb
    // eines Monats, plus der Gleichheitsfall, an dem jede Grenzentscheidung
    // "gilt am Stichtag selbst" haengt.
    // Gegenmutation: `a.day - b.day` durch `b.day - a.day` ersetzen (Vorzeichen
    // drehen) -> die Ordnung kehrt sich um, rot.
    expect(compareLocalBusinessDate(day(2026, 7, 1), day(2026, 7, 2))).toBeLessThan(0);
    expect(compareLocalBusinessDate(day(2026, 7, 2), day(2026, 7, 1))).toBeGreaterThan(0);
    expect(compareLocalBusinessDate(day(2026, 7, 1), day(2026, 7, 1))).toBe(0);
  });

  it("widerlegt die Tagesnummer als Ordnungskriterium", () => {
    // NEGATIVRICHTUNG: der unterscheidende Gegenfall im Sinne des
    // Invariantenregisters — die naheliegende falsche Implementierung liefert
    // hier nachweislich etwas anderes. In beiden Paaren ist die TAGESZAHL des
    // frueheren Datums groesser (31 > 1, 30 > 1); wer nur `day` vergleicht,
    // bekommt beide Male das falsche Vorzeichen. Der Fall ist nicht
    // theoretisch: die Satzketten aus V3 wechseln genau an Monatsgrenzen.
    // Gegenmutation: nur `day` vergleichen -> beide Zeilen rot.
    expect(compareLocalBusinessDate(day(2026, 12, 31), day(2027, 1, 1))).toBeLessThan(0);
    expect(compareLocalBusinessDate(day(2026, 6, 30), day(2026, 7, 1))).toBeLessThan(0);
  });

  it("bildet den Folgetag innerhalb des Monats und ueber die Monatsgrenze", () => {
    // POSITIVRICHTUNG. `dayAfter` ist laut V3 die EINZIGE zulaessige
    // Normalisierung nach halboffen. Ausdruecklich verboten sind:
    // `23:59:59.999` erzeugen, Kalendertage in UTC-Zeitpunkte wandeln,
    // Millisekunden vom Folgezeitpunkt abziehen. Getestet wird die
    // Kalenderarithmetik selbst; dass kein Zeitpunkt gebaut wird, kann nur ein
    // statischer Waechter zeigen (siehe Bericht).
    // Gegenmutation: `dayAfter` die Eingabe unveraendert zurueckgeben lassen
    // -> beide Zeilen rot.
    expect(dayAfter(day(2026, 7, 15))).toEqual(day(2026, 7, 16));
    expect(dayAfter(day(2026, 6, 30))).toEqual(day(2026, 7, 1));
  });

  it("widerlegt die blosse Tagesinkrementierung an Jahres- und Schaltjahresgrenze", () => {
    // NEGATIVRICHTUNG: drei Faelle, in denen `day + 1` bzw. ein fester
    // Februar nachweislich etwas anderes liefert.
    //   31.12.2026 -> `day + 1` ergaebe den 32.12.2026
    //   28.02.2028 -> "Februar hat 28 Tage" ergaebe den 01.03., richtig ist
    //                 der 29.02., denn 2028 ist ein Schaltjahr
    //   29.02.2028 -> nur ein echter Kalender kommt hier auf den 01.03.
    // Gegenmutation: `{ ...date, day: date.day + 1 }` -> erste Zeile rot.
    // Zweite Gegenmutation: Februar fest mit 28 Tagen -> zweite Zeile rot.
    expect(dayAfter(day(2026, 12, 31))).toEqual(day(2027, 1, 1));
    expect(dayAfter(day(2028, 2, 28))).toEqual(day(2028, 2, 29));
    expect(dayAfter(day(2028, 2, 29))).toEqual(day(2028, 3, 1));
  });
});

// ---------------------------------------------------------------------------
// V5.5 — kanonische, deduplizierte Ueberlappungsstruktur
// ---------------------------------------------------------------------------

/**
 * Bis V5.5 pruefte die Suite an dieser Stelle nur die LAENGE des Ergebnisses,
 * nie seinen Inhalt — ein Validator, der die Ueberlappung zwar findet, aber die
 * falsche Spanne oder eine zufaellige Paarreihenfolge meldet, waere gruen
 * geblieben. V5.5 gibt der Struktur vier Felder und eine kanonische Ordnung;
 * hier stehen die fuenf vom PO benannten Mindesttests.
 *
 * Kette fuer die ersten drei Faelle:
 *   A  gueltig 01.01.2026 bis 31.07.2026  ->  intern [01.01.2026, 01.08.2026)
 *   B  gueltig ab 01.07.2026, offen       ->  intern [01.07.2026, unbegrenzt)
 *   Schnitt = [01.07.2026, 01.08.2026)
 */
describe("Satzversionsueberlappung — kanonische Paarstruktur (V5.5)", () => {
  const a = () => validRate("r-a", 4500n, day(2026, 1, 1), day(2026, 7, 31));
  const b = () => validRate("r-b", 4700n, day(2026, 7, 1), null);

  it("meldet zwei ueberlappende Versionen als genau ein Element mit voller Spanne", () => {
    // Der Inhalt, nicht nur die Anzahl: `overlapFrom` ist einschliessend der
    // erste doppelt gedeckte Tag, `overlapEndExclusive` die interne halboffene
    // Grenze — also der Folgetag des letzten doppelt gedeckten Tages.
    // Gegenmutation: `overlapEndExclusive` auf `validTo` statt auf
    // `dayAfter(validTo)` setzen -> 31.07. statt 01.08., rot.
    // Zweite Gegenmutation: Paarreihenfolge nach Eingabeindex statt nach
    // `validFrom` -> firstVersionId falsch, rot.
    expect(findRateVersionOverlaps([a(), b()])).toEqual([
      {
        firstVersionId: rateId("r-a"),
        secondVersionId: rateId("r-b"),
        overlapFrom: day(2026, 7, 1),
        overlapEndExclusive: day(2026, 8, 1),
      },
    ]);
  });

  it("meldet dasselbe ungeordnete Paar kein zweites Mal", () => {
    // A ueberlappt B und B ueberlappt A sind DIESELBE Tatsache. Eine naive
    // Doppelschleife ueber alle geordneten Paare meldet sie zweimal und
    // verdoppelt damit jede Konfliktanzeige in der spaeteren Oberflaeche.
    // Gegenmutation: `i < j` durch `i !== j` ersetzen -> zwei Elemente, rot.
    expect(findRateVersionOverlaps([a(), b()])).toHaveLength(1);
  });

  it("liefert unabhaengig von der Eingabereihenfolge dasselbe Ergebnis", () => {
    // Die Eingabereihenfolge ist ein Zufall der Datenbankabfrage und darf
    // weder ueber das Finden noch ueber die Paarordnung entscheiden.
    //
    // ACHTUNG, gemessene Korrektur: diese Zusicherung verglich frueher
    // `findRateVersionOverlaps([b, a])` mit `findRateVersionOverlaps([a, b])` —
    // also die Funktion mit sich selbst. Ein Konstantenstub `return []` liess
    // sie gruen, waehrend sechs Geschwistertests rot wurden. Verglichen wird
    // jetzt gegen ein festes Literal, das denselben vier Feldern genuegt wie
    // der Anker weiter oben.
    // Gegenmutation: Sortierschritt entfernen -> Reihenfolge schlaegt durch, rot.
    expect(findRateVersionOverlaps([b(), a()])).toEqual([
      {
        firstVersionId: rateId("r-a"),
        secondVersionId: rateId("r-b"),
        overlapFrom: day(2026, 7, 1),
        overlapEndExclusive: day(2026, 8, 1),
      },
    ]);
  });

  it("meldet benachbarte, nicht ueberlappende Intervalle gar nicht", () => {
    // bis 30.06. / ab 01.07. ist laut V3 lueckenlos UND ueberlappungsfrei —
    // intern [.., 01.07.) und [01.07., ..). Der Beruehrungspunkt ist keine
    // Ueberlappung. Wer die halboffene Grenze als geschlossen rechnet, meldet
    // hier faelschlich einen Konflikt und blockiert eine zulaessige Kette.
    // Gegenmutation: Ueberlappung mit `<=` auf der Exklusivgrenze pruefen ->
    // ein Element, rot.
    const alt = validRate("r-alt", 4500n, day(2026, 1, 1), day(2026, 6, 30));
    const neu = validRate("r-neu", 4700n, day(2026, 7, 1), null);
    expect(findRateVersionOverlaps([alt, neu])).toEqual([]);
  });

  it("traegt bei zwei offenen Intervallen die kanonische Endgrenze null", () => {
    // Zwei unbegrenzte Versionen ueberlappen ab dem spaeteren Beginn bis
    // unendlich. `null` ist dafuer der kanonische Wert — kein erfundenes
    // Maximaldatum, kein 9999-12-31.
    // Gegenmutation: offenes Ende auf ein festes Maximaldatum abbilden -> rot.
    const offenA = validRate("r-offen-a", 4500n, day(2026, 1, 1), null);
    const offenB = validRate("r-offen-b", 4700n, day(2026, 7, 1), null);
    expect(findRateVersionOverlaps([offenA, offenB])).toEqual([
      {
        firstVersionId: rateId("r-offen-a"),
        secondVersionId: rateId("r-offen-b"),
        overlapFrom: day(2026, 7, 1),
        overlapEndExclusive: null,
      },
    ]);
  });

  it("ordnet bei gleichem Beginn nach der Satzversions-ID", () => {
    // Die zweite Haelfte der kanonischen Ordnung: `validFrom`, DANN ID. Ohne
    // den Nachrang waere die Paarordnung bei gleichem Beginn undefiniert und
    // das Ergebnis nicht mehr vergleichbar — genau das, was der Test darueber
    // ueber die Eingabereihenfolge zusichert.
    // Gegenmutation: nur nach `validFrom` sortieren -> bei gleichem Beginn
    // entscheidet die Eingabereihenfolge, rot.
    //
    // ACHTUNG, gemessene Korrektur: geprueft wurde frueher nur die Reihenfolge
    // `[zweite, erste]`. Ohne Nachrang liefert die Sortierung dort zufaellig
    // dasselbe Paar — die Mutation `aFirst = byStart < 0` liess alle 210 Tests
    // gruen. Erst BEIDE Eingabereihenfolgen gegen dasselbe Literal trennen die
    // kanonische Ordnung von der Eingabereihenfolge.
    const zweite = validRate("r-z", 4500n, day(2026, 1, 1), null);
    const erste = validRate("r-a", 4700n, day(2026, 1, 1), null);
    const erwartet = { first: rateId("r-a"), second: rateId("r-z") };
    for (const eingabe of [
      [zweite, erste],
      [erste, zweite],
    ]) {
      const [treffer] = findRateVersionOverlaps(eingabe);
      expect(treffer?.firstVersionId, `Eingabereihenfolge entschied ueber firstVersionId`).toBe(
        erwartet.first,
      );
      expect(treffer?.secondVersionId, `Eingabereihenfolge entschied ueber secondVersionId`).toBe(
        erwartet.second,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Herkunft, Wiederholbarkeit, historische Stabilitaet (AK4, AK5)
// ---------------------------------------------------------------------------

describe("Kostenposition — Herkunft und historische Stabilitaet (AK4, AK5)", () => {
  const on = day(2026, 7, 15);
  const computedAt = new Date("2026-07-30T08:00:00.000Z");

  const eingabe = (versions: readonly HourlyRateVersion[]) => ({
    source: SOURCE,
    versions,
    on,
    quantity: ms(480n * MIN),
    computedAt,
  });

  it("traegt Quelle, Regelversion, Satzversion und Erzeugungszeitpunkt im Ergebnis", () => {
    // AK4 woertlich, und V1: "Jeder Snapshot und jede Position referenzieren
    // die Regelversion." Ohne diese vier Felder laesst sich ein historischer
    // Betrag spaeter nicht mehr erklaeren.
    // Gegenmutation: `rateVersionId` aus dem Ergebnis entfernen -> rot.
    const rate = validRate("r-1", 4500n, day(2026, 1, 1), null);
    const result = computeCostPosition(eingabe([rate]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.position.rateVersionId).toBe(rate.rateVersionId);
    expect(result.position.ruleVersion).toBe(COST_RULE_VERSION);
    expect(result.position.source).toEqual(SOURCE);
    expect(result.position.computedAt.getTime()).toBe(computedAt.getTime());
    // 4500 Cent/h x 480 min = 4500 x 28.800.000 / 3.600.000 = 36000 Cent.
    expect(result.position.amount.minorUnits).toBe(36_000n);
  });

  it("liefert bei identischem fachlichem Input zweimal dasselbe Ergebnis", () => {
    // AK5. Nur erfuellbar, wenn der Erzeugungszeitpunkt EINGABE ist und nicht
    // im Inneren von der Uhr gelesen wird — eine reine Domainfunktion kennt
    // keine Uhr. Das ist zugleich die Bedingung dafuer, dass eine Wiederholung
    // keine Doppelwirkung erzeugen kann.
    // Gegenmutation: verborgener Zustand im Inneren — ein Zaehler, ein Cache oder eine
    // Mutation der Eingabeliste -> die beiden Ergebnisse weichen ab, rot. NICHT `new Date()`:
    // zwei unmittelbar aufeinanderfolgende Aufrufe liefern in aller Regel dieselbe
    // Millisekunde, diesen Test macht die Uhr also nicht zuverlaessig rot. Sie faengt der
    // Nachbartest, der computedAt gegen die uebergebene Fixture haelt.
    const rate = validRate("r-1", 4500n, day(2026, 1, 1), null);
    expect(computeCostPosition(eingabe([rate]))).toEqual(computeCostPosition(eingabe([rate])));
  });

  it("bleibt unveraendert, wenn der Satzkatalog danach ergaenzt wird", () => {
    // Historische Stabilitaet und Forward-Fix: eine spaeter angelegte
    // Satzversion darf einen bereits berechneten Stand nicht ruecklaufend
    // veraendern. Der Katalog wird NACH der Berechnung veraendert — eine
    // Implementierung, die die uebergebene Liste festhaelt und erst beim Lesen
    // auswertet, faellt hier auf.
    // Gegenmutation: Ergebnis lazy aus der referenzierten Liste berechnen
    // (Getter statt Wert) -> der alte Stand aendert sich mit, rot.
    const alt = validRate("r-alt", 4500n, day(2026, 1, 1), day(2026, 6, 30));
    const gueltig = validRate("r-gueltig", 4700n, day(2026, 7, 1), day(2026, 7, 31));
    const katalog: HourlyRateVersion[] = [alt, gueltig];

    const stand = computeCostPosition(eingabe(katalog));
    expect(stand.ok).toBe(true);
    if (!stand.ok) return;
    // 4700 Cent/h x 480 min = 4700 x 28.800.000 / 3.600.000 = 37600 Cent.
    expect(stand.position.amount.minorUnits).toBe(37_600n);

    katalog.push(validRate("r-korrektur", 9900n, day(2026, 7, 1), day(2026, 7, 31)));

    expect(stand.position.amount.minorUnits).toBe(37_600n);
    expect(stand.position.rateVersionId).toBe(gueltig.rateVersionId);
  });

  it("fuehrt jeden Positionseingabe-Fehlercode genau einmal und erreicht jeden", () => {
    // Wie bei den fuenf anderen Listen: Doppelfreiheit UND Erreichbarkeit. Ein
    // Code, der im Vertrag steht, in der Typunion erscheint, von Aufrufern
    // behandelt wird und nie eintritt, ist die teurere Haelfte des Defekts.
    // Gegenmutation: zweiten Code ohne ausloesende Eingabe aufnehmen -> rot.
    expect(new Set(COST_POSITION_INPUT_ERRORS).size).toBe(COST_POSITION_INPUT_ERRORS.length);
    const rate = validRate("r-1", 4500n, day(2026, 1, 1), null);
    const erreicht = new Set<string>();
    for (const zeitpunkt of [new Date("kaputt")]) {
      const r = computeCostPosition({
        source: SOURCE,
        versions: [rate],
        on: day(2026, 7, 1),
        quantity: ms(3_600_000n),
        computedAt: zeitpunkt,
      });
      if (!r.ok) erreicht.add(r.error);
    }
    expect([...erreicht].sort()).toEqual([...COST_POSITION_INPUT_ERRORS].sort());
  });

  it("blockiert eine Position mit ungueltigem Erzeugungszeitpunkt", () => {
    // `new Date("kaputt")` ist ein gueltig GETYPTES Date mit `getTime() === NaN`
    // — kein Typsystem-Umweg noetig, es entsteht beim Parsen eines kaputten
    // JSON-Feldes von selbst. Ohne Pruefung entstuende eine Position, die
    // vollstaendig aussieht und deren Erzeugungszeitpunkt `Invalid Date` ist;
    // AK4 verlangt ihn gerade, damit ein historischer Betrag spaeter erklaerbar
    // bleibt. `TimeInterval.create` weist denselben Fall mit START_INVALID ab —
    // gleiche Grenze, gleiche Behandlung.
    // Gegenmutation: Pruefung entfernen -> ok:true mit Invalid Date, rot.
    const rate = validRate("r-1", 4500n, day(2026, 1, 1), null);
    const ergebnis = computeCostPosition({
      source: SOURCE,
      versions: [rate],
      on: day(2026, 7, 1),
      quantity: ms(3_600_000n),
      computedAt: new Date("kaputt"),
    });
    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.error).toBe("COMPUTED_AT_INVALID");
  });

  it("kopiert den Erzeugungszeitpunkt defensiv", () => {
    // Gleiche Begruendung wie bei `TimeInterval.startUtc`: ein `Date` ist
    // veraenderlich, und ein herausgereichter Verweis macht einen angeblich
    // unveraenderlichen Stand veraenderbar.
    // Gegenmutation: dieselbe Date-Instanz zurueckgeben -> rot.
    const rate = validRate("r-1", 4500n, day(2026, 1, 1), null);
    const result = computeCostPosition(eingabe([rate]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const geliehen = result.position.computedAt;
    geliehen.setUTCFullYear(1999);
    expect(result.position.computedAt.getUTCFullYear()).not.toBe(1999);
  });

  it("blockiert die Position, wenn am Stichtag kein Satz gilt", () => {
    // Die Kette bis nach oben: ein fehlender Satz darf nicht erst in der
    // Anzeige auffallen, sondern muss die Position selbst verhindern.
    // Gegenmutation: bei RATE_MISSING eine Position mit Betrag 0 erzeugen ->
    // ok:true, rot.
    const rate = validRate("r-1", 4500n, day(2026, 1, 1), day(2026, 6, 30));
    const result = computeCostPosition(eingabe([rate]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("RATE_MISSING");
    expect(result).not.toHaveProperty("position");
  });
});

// ---------------------------------------------------------------------------
// Fehlercodelisten
// ---------------------------------------------------------------------------

/**
 * Muster von `TIME_INTERVAL_ERRORS` in `time-interval.test.ts`, um eine zweite
 * Messung erweitert.
 *
 * Jede Liste wird auf ZWEI Defekte geprueft, und der zweite ist der wichtigere:
 *
 *   1. **Doppelfrei.** Ein zweimal aufgefuehrter Code laesst eine Fehlerlage
 *      doppelt benannt erscheinen und macht jede Vollzaehligkeitsaussage wertlos.
 *   2. **Erreichbar.** Jeder Code der Liste wird von einer konkreten Eingabe
 *      wirklich erzeugt. Ein verwaister Code ist kein Schoenheitsfehler: er
 *      steht im Vertrag, erscheint in der Typunion, wird von Aufrufern
 *      behandelt — und tritt nie ein. Umgekehrt zwingt diese Messung dazu, fuer
 *      jeden NEUEN Code eine ausloesende Eingabe zu benennen, statt ihn nur in
 *      die Liste zu schreiben.
 *
 * Verglichen wird gegen die Liste selbst, nicht gegen ein Literal: so passt
 * sich der Test einer bewussten Vertragsaenderung an und schlaegt trotzdem an,
 * wenn Liste und Verhalten auseinanderlaufen.
 */
describe("Fehlercodelisten — doppelfrei und vollstaendig erreichbar", () => {
  /** Sammelt die tatsaechlich aufgetretenen Codes einer Reihe von Eingaben. */
  const beobachte = (ergebnisse: readonly { ok: boolean }[]): string[] => {
    const codes = new Set<string>();
    for (const ergebnis of ergebnisse) {
      const typed = ergebnis as { ok: true } | { ok: false; error: string };
      if (!typed.ok) codes.add(typed.error);
    }
    return [...codes].sort();
  };

  it("fuehrt CURRENCY_MISMATCH in keiner oeffentlichen Fehlerliste", () => {
    // V5.4-korrigiert: der Code entfaellt in Sprint 5 vollstaendig, weil zwei
    // gueltig konstruierte `Money`-Werte keine unterschiedlichen Waehrungen
    // haben koennen. Ausdruecklich OHNE Ausnahme fuer "strukturell
    // unerreichbare Codes" — eine solche Ausnahme wuerde genau den
    // Waisenvalidator schwaechen, der den Befund sichtbar gemacht hat.
    //
    // Diese Zusicherung ist die Sperre gegen ein stilles Wiedereinfuehren:
    // sie prueft alle sechs oeffentlichen Listen auf einmal, nicht nur die,
    // in der der Code frueher stand.
    // Gegenmutation: `CURRENCY_MISMATCH` in irgendeine dieser Listen
    // zurueckschreiben -> rot.
    const alleCodes = [
      ...MONEY_ERRORS,
      ...QUANTITY_ERRORS,
      ...PLAN_COST_AMOUNT_ERRORS,
      ...HOURLY_RATE_AMOUNT_ERRORS,
      ...RATE_VERSION_ERRORS,
      ...RATE_SELECTION_ERRORS,
    ] as readonly string[];
    expect(alleCodes).not.toContain("CURRENCY_MISMATCH");
    // Nicht-Leerlauf-Bremse: waeren die Listen leer oder falsch importiert,
    // waere die Zeile darueber trivial gruen.
    expect(alleCodes.length).toBeGreaterThan(8);
  });

  it("fuehrt jeden Money-Fehlercode genau einmal und erreicht jeden", () => {
    // Gegenmutation: einen vierten Code in MONEY_ERRORS aufnehmen, ohne eine
    // Eingabe zu benennen, die ihn ausloest -> rot.
    // Zweite Gegenmutation: `AMOUNT_NOT_FINITE` doppelt eintragen -> rot.
    expect(new Set(MONEY_ERRORS).size).toBe(MONEY_ERRORS.length);
    expect(
      beobachte([
        moneyFromNumber(Number.NaN, "EUR"),
        moneyFromNumber(Number.POSITIVE_INFINITY, "EUR"),
        moneyFromNumber(4500.5, "EUR"),
        moneyFromNumber(Number.MAX_SAFE_INTEGER + 2, "EUR"),
      ]),
    ).toEqual([...MONEY_ERRORS].sort());
  });

  it("fuehrt jeden Mengen-Fehlercode genau einmal und erreicht jeden", () => {
    // Die vier Faelle aus V2b, je einer je Code — dieselben vier, die oben
    // einzeln geprueft werden, hier als Vollstaendigkeitsaussage ueber die Liste.
    // Gegenmutation: einen fuenften Code in QUANTITY_ERRORS aufnehmen, ohne
    // ausloesende Eingabe -> rot.
    expect(new Set(QUANTITY_ERRORS).size).toBe(QUANTITY_ERRORS.length);
    expect(
      beobachte([
        toDurationMilliseconds(Number.NaN),
        toDurationMilliseconds(450_000.5),
        toDurationMilliseconds(-1),
        toDurationMilliseconds(Number.MAX_SAFE_INTEGER + 2),
      ]),
    ).toEqual([...QUANTITY_ERRORS].sort());
  });

  it("fuehrt jeden Plan-Kostenbetrag-Fehlercode genau einmal und erreicht jeden", () => {
    // Nur ein Code, und genau das ist die Aussage: die Domaenengrenze aus V4
    // kennt einen einzigen Ablehnungsgrund. Kaeme ein zweiter hinzu, muesste
    // jemand eine Eingabe dafuer benennen.
    // Gegenmutation: einen zweiten Code aufnehmen, ohne ausloesende Eingabe -> rot.
    expect(new Set(PLAN_COST_AMOUNT_ERRORS).size).toBe(PLAN_COST_AMOUNT_ERRORS.length);
    expect(beobachte([planCostAmount(moneyOfMinorUnits(-1n, "EUR"))])).toEqual([
      ...PLAN_COST_AMOUNT_ERRORS,
    ]);
  });

  it("fuehrt jeden Satzversions-Fehlercode genau einmal und erreicht jeden", () => {
    // Seit V5.6 prueft die Factory nur noch RELATIONALE Invarianten; die
    // Vorzeichenpruefung ist an `hourlyRateAmount` gewandert. Die Liste ist
    // damit kuerzer geworden — und genau das misst diese Zeile: bliebe
    // `RATE_NEGATIVE` hier stehen, waere er ein verwaister Code, weil die
    // Factory ihn nicht mehr erzeugen kann.
    // Gegenmutation: `RATE_NEGATIVE` in RATE_VERSION_ERRORS belassen -> rot,
    // weil keine Eingabe der Factory ihn noch ausloest.
    expect(new Set(RATE_VERSION_ERRORS).size).toBe(RATE_VERSION_ERRORS.length);
    expect(
      beobachte([
        hourlyRateVersion({
          rateVersionId: rateId("r-verkehrt"),
          amountPerHour: rateAmount(4500n),
          validFrom: day(2026, 7, 1),
          validTo: day(2026, 6, 30),
        }),
      ]),
    ).toEqual([...RATE_VERSION_ERRORS].sort());
  });

  it("fuehrt jeden Stundensatz-Fehlercode genau einmal und erreicht jeden", () => {
    // Die Grenze aus V5.6. Erreichbar — und damit zulaessig — ist genau
    // `RATE_NEGATIVE`.
    //
    // `UNSUPPORTED_COST_CURRENCY` stand hier vorruebergehend und war NICHT
    // ausloesbar: `hourlyRateAmount` nimmt einen bereits getypten `Money`, und
    // `Currency` ist `"EUR"`. V5.4-korrigiert hat den Code an die untrusted
    // Eingangsgrenze verschoben, wo er echt erreichbar ist (siehe die
    // Waehrungsgruppe weiter oben). Steht er wieder hier, ist er eine Waise.
    // Gegenmutation: einen zweiten Code aufnehmen, ohne ausloesende Eingabe -> rot.
    expect(new Set(HOURLY_RATE_AMOUNT_ERRORS).size).toBe(HOURLY_RATE_AMOUNT_ERRORS.length);
    expect(beobachte([hourlyRateAmount(moneyOfMinorUnits(-1n, "EUR"))])).toEqual(
      [...HOURLY_RATE_AMOUNT_ERRORS].sort(),
    );
  });

  it("fuehrt jeden Satzauswahl-Fehlercode genau einmal und erreicht jeden", () => {
    // Die beiden blockierenden Ausgaenge der Auswahl. Dass es genau zwei sind
    // und keinen dritten "stillschweigend null Euro"-Ausgang, ist die
    // eigentliche Zusage von REQ-005.
    // Gegenmutation: einen dritten Code aufnehmen, ohne ausloesende Eingabe -> rot.
    const a = validRate("r-a", 4500n, day(2026, 1, 1), day(2026, 7, 31));
    const b = validRate("r-b", 4700n, day(2026, 7, 1), null);
    expect(new Set(RATE_SELECTION_ERRORS).size).toBe(RATE_SELECTION_ERRORS.length);
    expect(
      beobachte([
        selectRateVersion([], day(2026, 7, 15)),
        selectRateVersion([a, b], day(2026, 7, 15)),
      ]),
    ).toEqual([...RATE_SELECTION_ERRORS].sort());
  });
});
