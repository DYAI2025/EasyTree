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
 * ## Skelettrümpfe (EYT-95, Phase 2)
 *
 * Jede rechnende Funktion wirft `NOT_IMPLEMENTED`. Ein plausibler Rückgabewert
 * wäre ein versteckter Defaultwert und machte Tests zufällig grün — genau das
 * verbietet die PRD unter „Grenzen des compile-enabling Skeletts". Das
 * `void [...]` hält die Parameter am Leben, ohne einen Wert zu erfinden.
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
 * Ablehnungsgründe an der Zahlengrenze. Stabile Codes — sie werden Teil des
 * API-Vertrags, sobald EYT-105 Beträge über HTTP annimmt.
 */
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

export function addMoney(augend: Money, addend: Money): Money {
  void [augend, addend];
  throw new Error("NOT_IMPLEMENTED");
}

export function subtractMoney(minuend: Money, subtrahend: Money): Money {
  void [minuend, subtrahend];
  throw new Error("NOT_IMPLEMENTED");
}

/** Übergang vom vorzeichenoffenen Betrag zum persistierfähigen Plan-Kostenbetrag (V4). */
export function planCostAmount(money: Money): PlanCostAmountResult {
  void money;
  throw new Error("NOT_IMPLEMENTED");
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
  void amounts;
  throw new Error("NOT_IMPLEMENTED");
}
