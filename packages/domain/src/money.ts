/**
 * Geldbetrag in EUR-Minor-Units und die Vorzeichengrenze zum Plan-Kostenbetrag
 * (EYT-95, REQ-005 — Berechnungsvertrag V1 und V4).
 *
 * ## Warum `bigint` und nicht `number`
 *
 * V2 rechnet `rateMinorUnitsPerHour × durationMilliseconds`. Bereits ein
 * gewöhnlicher Stundensatz mal einer mehrtägigen Dauer verlässt den sicheren
 * Ganzzahlbereich von `number` (2^53); dort ist eine ganze Zahl nicht mehr
 * eindeutig, und „verlustfrei" wird stillschweigend falsch. `minorUnits` ist
 * deshalb `bigint` — Vertragsbestandteil, nicht Geschmacksfrage.
 *
 * ## Warum `Money` ein Vorzeichen tragen darf, ein Plan-Kostenbetrag aber nicht
 *
 * V4 trennt beides ausdrücklich: Differenzen, Vergleiche und Abweichungen
 * brauchen ein Vorzeichen, ein persistierbarer Plan-Kostenbetrag nicht. Die
 * Grenze liegt deshalb an {@link planCostAmount} und nicht schon an
 * {@link moneyOfMinorUnits}. Negative Korrektur- und Stornobuchungen brauchen
 * laut V4 einen eigenen fachlichen Typ; sie dürfen nicht nebenbei dadurch
 * entstehen, dass hier ein Vorzeichen durchrutscht.
 *
 * ## Zwei Verfeinerungen, zwei Grenzen (V5.6)
 *
 * {@link PlanCostAmount} ist ein **Ergebnis**, {@link HourlyRateAmount} eine
 * **Eingabe**. Beide sind nichtnegative Geldbeträge, tragen aber eigene Marken,
 * damit sie nicht gegeneinander austauschbar sind: ein Stundensatz, der
 * versehentlich als Positionsbetrag persistiert wird, wäre kein Typfehler mehr,
 * sondern ein falscher Betrag in der Buchhaltung.
 */

/**
 * V1 legt genau eine Währung fest. Die Liste ist eingefroren, damit eine
 * zweite Währung nicht nebenbei entsteht: sobald es zwei gibt, muss jemand
 * über Mischbeträge, Umrechnungskurs und Rundungszeitpunkt entscheiden.
 */
export const CURRENCIES = ["EUR"] as const;

export type Currency = (typeof CURRENCIES)[number];

/** Exakter Geldbetrag. Vorzeichenoffen (V4) — die Grenze zieht {@link planCostAmount}. */
export interface Money {
  readonly minorUnits: bigint;
  readonly currency: Currency;
}

/**
 * Ablehnungsgründe an der Zahlengrenze. Die Reihenfolge dieser Liste spiegelt
 * die Prüfreihenfolge in {@link moneyFromNumber} und ist Teil des Vertrags:
 * `Number.isSafeInteger(NaN)` ist ebenfalls `false`, wer die Sicherheitsprüfung
 * vorzieht, meldet für `NaN` den falschen Code.
 */
export const MONEY_ERRORS = [
  /**
   * `NaN` oder `Infinity`.
   *
   * Eigener Code, nicht in `AMOUNT_NOT_INTEGER` gefaltet: `toDurationMilliseconds`
   * meldet für dieselbe Eingabeklasse laut V2b `QUANTITY_NOT_FINITE`, und zwei
   * benachbarte Grenzen dürfen denselben Fall nicht verschieden benennen. Die
   * Codes werden Teil des HTTP-Vertrags, sobald EYT-105 Beträge annimmt — dann
   * wäre die Asymmetrie nicht mehr geräuschlos korrigierbar.
   */
  "AMOUNT_NOT_FINITE",
  /** Endlich, aber gebrochen. Ein halber Cent ist kein Geldbetrag. */
  "AMOUNT_NOT_INTEGER",
  /** Ganzzahlig, aber jenseits von 2^53 — als `number` nicht mehr eindeutig. */
  "AMOUNT_NOT_SAFE_INTEGER",
] as const;

export type MoneyError = (typeof MONEY_ERRORS)[number];

export type MoneyResult =
  { readonly ok: true; readonly money: Money } | { readonly ok: false; readonly error: MoneyError };

declare const planCostAmountBrand: unique symbol;

/**
 * Nichtnegativer, persistierfähiger Plan-Kostenbetrag (V4).
 *
 * Die Marke ist nicht Zierrat: ohne sie wäre `PlanCostAmount` strukturell
 * identisch mit {@link Money}, jeder beliebige — auch negative — Betrag wäre
 * zuweisbar, und die Domänengrenze aus V4 stünde nur im Kommentar. Zur Laufzeit
 * existiert die Marke nicht; der einzige Weg zu einem Wert ist
 * {@link planCostAmount}.
 */
export interface PlanCostAmount extends Money {
  readonly [planCostAmountBrand]: "PlanCostAmount";
}

export const PLAN_COST_AMOUNT_ERRORS = [
  /** V4: `PersistedPlanCostAmount >= 0`. Defense in Depth hinter Menge und Satz. */
  "COST_AMOUNT_NEGATIVE",
] as const;

export type PlanCostAmountError = (typeof PLAN_COST_AMOUNT_ERRORS)[number];

/**
 * Ergebnis mit Fehler im Rückgabetyp statt als Ausnahme — dieselbe Entscheidung
 * wie bei `TimeIntervalResult` und `GatewayResult` (ADR-001 §5). Der
 * blockierende Zweig trägt bewusst **kein** `amount`: ein Ergebnis, das
 * gleichzeitig fehlschlägt und einen lesbaren Geldwert mitführt, lädt dazu ein,
 * den Fehler zu übersehen und den Betrag zu verwenden.
 */
export type PlanCostAmountResult =
  | { readonly ok: true; readonly amount: PlanCostAmount }
  | { readonly ok: false; readonly error: PlanCostAmountError };

/**
 * Betrag aus bereits geprüften Minor Units.
 *
 * Ein `bigint` ist immer endlich und ganzzahlig, und `Money` ist laut V4
 * vorzeichenoffen — es bleibt nichts zu prüfen, weshalb diese Funktion kein
 * Ergebnisobjekt braucht. `Object.freeze` aus demselben Grund wie bei
 * `TimeInterval`: ein herausgereichter Betrag, den der Empfänger überschreiben
 * kann, ist kein unveränderlicher Wert.
 */
export function moneyOfMinorUnits(minorUnits: bigint, currency: Currency): Money {
  return Object.freeze({ minorUnits, currency });
}

/**
 * Die einzige Stelle, an der ein ungeprüftes `number` aus JSON oder Datenbank
 * hereinkommt — das Geld-Gegenstück zu `toDurationMilliseconds` und aus
 * demselben Grund fail-closed.
 *
 * Ein halber Cent ist kein Geldbetrag; wer ihn annimmt und rundet, hat eine
 * zweite, undokumentierte Rundungsstufe eingeführt (V1 Punkt 5). Oberhalb von
 * 2^53 ist eine Ganzzahl als `number` nicht mehr eindeutig — `BigInt` nähme sie
 * klaglos an und die Herkunft des Betrags wäre nicht mehr rekonstruierbar.
 *
 * Bewusst **keine** Vorzeichenprüfung: V4 lässt ein Vorzeichen an `Money` zu.
 * Die Grenze zieht erst {@link planCostAmount}.
 */
export function moneyFromNumber(value: number, currency: Currency): MoneyResult {
  if (!Number.isFinite(value)) return { ok: false, error: "AMOUNT_NOT_FINITE" };
  if (!Number.isInteger(value)) return { ok: false, error: "AMOUNT_NOT_INTEGER" };
  if (!Number.isSafeInteger(value)) return { ok: false, error: "AMOUNT_NOT_SAFE_INTEGER" };

  return { ok: true, money: moneyOfMinorUnits(BigInt(value), currency) };
}

/**
 * Exakte Addition in Minor Units.
 *
 * **Kein Währungsvergleich** (V5.4-korrigiert). Zwei gültig konstruierte
 * {@link Money}-Werte können keine unterschiedlichen Währungen besitzen —
 * {@link Currency} hat genau einen Bewohner. Ein Vergleich hier wäre ein toter
 * Zweig, und ein `throw` statt eines Ergebniszweigs ändert daran nichts: es
 * verschiebt nur die Form, nicht die Erreichbarkeit.
 *
 * Die Laufzeitsicherheit kommt stattdessen aus der Kette
 * {@link costCurrencyFromUnknown} → gebrandeter Wert → keine öffentliche
 * unvalidierte Konstruktion → `z.literal("EUR")` → `CHECK (currency = 'EUR')`.
 * Ein trotz dieser Grenzen gefälschtes Objekt ist eine Invariantenverletzung,
 * kein fachlicher Währungsfehler.
 */
export function addMoney(augend: Money, addend: Money): Money {
  return moneyOfMinorUnits(augend.minorUnits + addend.minorUnits, augend.currency);
}

/** Exakte Differenz. Das Ergebnis darf negativ sein (V4) — siehe Kopfkommentar. */
export function subtractMoney(minuend: Money, subtrahend: Money): Money {
  return moneyOfMinorUnits(minuend.minorUnits - subtrahend.minorUnits, minuend.currency);
}

/**
 * Übergang vom vorzeichenoffenen Betrag zum persistierfähigen Plan-Kostenbetrag (V4).
 *
 * Der Cast ist die Marke, nicht die Prüfung — die steht vollständig darüber.
 * Der Wert wird nicht neu erzeugt: jeder {@link Money} stammt aus
 * {@link moneyOfMinorUnits} und ist damit bereits eingefroren.
 */
export function planCostAmount(money: Money): PlanCostAmountResult {
  if (money.minorUnits < 0n) return { ok: false, error: "COST_AMOUNT_NEGATIVE" };

  return { ok: true, amount: money as PlanCostAmount };
}

/**
 * Summe bereits gerundeter Positionsbeträge (V1 Punkt 7 und 8).
 *
 * Die Signatur nimmt {@link PlanCostAmount} und nicht Menge plus Satz entgegen,
 * weil genau darin die Regel steckt: eine Summe entsteht ausschließlich durch
 * Addition der schon gerundeten Beträge und nie durch Neuberechnung aus den
 * ungerundeten Ausgangswerten. Was hier nicht hereinkommt, kann auch nicht
 * versehentlich ein zweites Mal gerundet werden.
 */
export function sumPlanCostAmounts(amounts: readonly PlanCostAmount[]): PlanCostAmountResult {
  // V5.1: Die leere Summe ist `PlanCostAmount(0n, "EUR")`. Sprint 5 erlaubt
  // ausschliesslich EUR-Plan-Personalkosten, deshalb hat die leere Menge eine
  // eindeutige additive Identität — das ist entschieden, nicht ausgelegt.
  // Kein Währungsvergleich (V5.4-korrigiert): alle Beträge sind EUR, weil
  // `Currency` genau einen Bewohner hat. Ein Vergleich wäre ein toter Zweig.
  let total = 0n;
  for (const amount of amounts) total += amount.minorUnits;

  // V5.1: Der Nullbetrag läuft durch DENSELBEN Validator wie jeder andere
  // Betrag — kein Sonderweg an der Vorzeichengrenze vorbei.
  return planCostAmount(moneyOfMinorUnits(total, CURRENCIES[0]));
}

declare const hourlyRateAmountBrand: unique symbol;

/**
 * Nichtnegativer Stundensatz in einer unterstützten Währung (V5.6).
 *
 * Eigene Marke neben {@link PlanCostAmount}, weil es eine andere Grenze ist:
 * ein Plan-Kostenbetrag ist ein Ergebnis, ein Stundensatz eine Eingabe. Beide
 * sind nichtnegativ, aber sie dürfen nicht gegeneinander austauschbar sein.
 */
export interface HourlyRateAmount extends Money {
  readonly [hourlyRateAmountBrand]: "HourlyRateAmount";
}

export const HOURLY_RATE_AMOUNT_ERRORS = [
  /**
   * V4: `Rate >= 0`. Ein negativer Satz erzeugte eine Gutschrift, die niemand
   * angeordnet hat. Der Code hat mit V5.6 die Grenze gewechselt — er kam bis
   * dahin aus `hourlyRateVersion` und gehört jetzt hierher, an die Stelle, die
   * den Rohwert prüft.
   */
  "RATE_NEGATIVE",
] as const;

export type HourlyRateAmountError = (typeof HOURLY_RATE_AMOUNT_ERRORS)[number];

/**
 * Erfolgsschlüssel `rate`.
 *
 * „Analog zu `planCostAmount`/`PlanCostAmountResult`" ist hier als **Form**
 * umgesetzt — diskriminierte Union, blockierender Zweig ohne Wert —, beim
 * Schlüsselnamen aber nicht: `rate` sagt, was der Wert ist, und unterscheidet
 * ihn beim Auspacken vom Plan-Kostenbetrag. Beide Testdateien führen ihn so.
 */
export type HourlyRateAmountResult =
  | { readonly ok: true; readonly rate: HourlyRateAmount }
  | { readonly ok: false; readonly error: HourlyRateAmountError };

/**
 * Die einzige Stelle, an der ein Geldbetrag zum geprüften Stundensatz wird
 * (V5.6, Schicht 1: primitive Eingaben werden **vor** dem Factory-Aufruf
 * validiert).
 *
 * Ein Satz von `0` ist zulässig und bleibt von `RATE_MISSING` unterscheidbar
 * (V4) — deshalb `< 0n` und nicht `<= 0n`.
 *
 * **Keine Währungsprüfung** (V5.4-korrigiert): ein {@link Money} trägt bereits
 * eine gültige {@link Currency}, und die hat genau einen Bewohner. Die Währung
 * wird dort geprüft, wo sie ungeprüft ankommt — an
 * {@link costCurrencyFromUnknown}, nicht hier im getypten Kern.
 */
export function hourlyRateAmount(money: Money): HourlyRateAmountResult {
  if (money.minorUnits < 0n) return { ok: false, error: "RATE_NEGATIVE" };

  return { ok: true, rate: money as HourlyRateAmount };
}

/**
 * Ergebnis der Währungsprüfung an einer Systemgrenze.
 *
 * Die Union steht bewusst **inline** statt hinter einer benannten Fehlerliste:
 * bei genau einem Code kann keine verwaiste Konstante entstehen, und eine
 * Liste mit einem Eintrag liesse die Waisenprüfung leer laufen.
 */
export type CostCurrencyResult =
  | { readonly ok: true; readonly value: "EUR" }
  | { readonly ok: false; readonly error: "UNSUPPORTED_COST_CURRENCY" };

/**
 * Die Währungsgrenze für ungeprüfte Werte (V5.4-korrigiert).
 *
 * Ungeprüfte Währungen entstehen ausschliesslich an Systemgrenzen: HTTP/JSON,
 * PostgreSQL, importierte Daten, später Queue- oder Connector-Payloads. **Dort**
 * gehört die Prüfung hin — dasselbe Muster, das {@link moneyFromNumber} und
 * `toDurationMilliseconds` bereits tragen: der getypte Kern ist
 * unerreichbar-by-construction, die untrusted Grenze ist prüfbar und testbar.
 *
 * ## Warum kein `toUpperCase()`
 *
 * Es wird **ausschliesslich** der exakte String `"EUR"` angenommen. `"eur"`
 * stillschweigend hochzuschreiben wäre eine Datenkorrektur an einer
 * Systemgrenze: was in falscher Schreibweise ankommt, stammt aus einer Quelle,
 * die den Vertrag nicht einhält, und das gehört gemeldet, nicht repariert. Eine
 * Normalisierung hier verdeckt genau den Fehler, den diese Funktion finden soll.
 *
 * Die `typeof`-Prüfung ist **beweisbar redundant** und steht nur als Absicht da.
 * Gemessen: eine Gegenmutation, die sie entfernt, lässt alle 210 Tests grün — es
 * gibt keinen Wert, den sie fängt und der strikte Vergleich nicht. Auch
 * `new String("EUR") !== "EUR"` ist `true`, weil Objekt und Primitive nie strikt
 * gleich sind. Sie bleibt trotzdem stehen: sie benennt am Aufrufort, dass hier
 * wirklich alles ankommen kann — `null` aus JSON, `""` aus einer leeren Spalte,
 * `42` aus einem Mapping-Fehler. Wer sie streicht, verliert keine Prüfung,
 * sondern eine Lesehilfe.
 *
 * Eine frühere Fassung dieses Kommentars behauptete, die Testfälle `{}` und `42`
 * würden „genau diese Hälfte" messen. Das ist falsch und war ungemessen: beide
 * Werte scheitern schon am strikten Vergleich.
 */
export function costCurrencyFromUnknown(value: unknown): CostCurrencyResult {
  if (typeof value !== "string" || value !== "EUR") {
    return { ok: false, error: "UNSUPPORTED_COST_CURRENCY" };
  }

  return { ok: true, value };
}
