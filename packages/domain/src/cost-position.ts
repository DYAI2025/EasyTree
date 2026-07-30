/**
 * Rundungsregel und persistierfähige Kostenposition (EYT-95, REQ-005 —
 * Berechnungsvertrag V1, V2, V4).
 *
 * ## Der Vertrag in drei Zeilen
 *
 * ```text
 * amountNumerator   = rateMinorUnitsPerHour × durationMilliseconds
 * amountDenominator = 3_600_000
 * amountMinorUnits  = roundHalfUp(amountNumerator / 3_600_000)
 * ```
 *
 * Zwischenergebnisse werden **nicht** gerundet. Gerundet wird genau einmal,
 * beim Erzeugen der persistenten Kostenposition — daher der Name von
 * {@link ROUNDING_STAGE}. Wer stattdessen zuerst einen Minutensatz rundet,
 * rechnet `round(100/60) × 7 = 14` statt `12` und wird wegabhängig.
 *
 * ## Warum die Regel hier fest steht und nicht konfigurierbar ist
 *
 * V1 erklärt sie ausdrücklich für nicht mandanten- oder nutzerkonfigurierbar.
 * Jede Position referenziert {@link COST_RULE_VERSION}; ein Wechsel läuft nur
 * über eine neue Regelversion und Forward-Fix, nie rückwirkend. Eine
 * einstellbare Rundung machte historische Beträge unerklärbar.
 *
 * ## Was hier bewusst nicht steht
 *
 * Mitternachtsteilung, IANA-Zonenallokation, Sommer-/Winterzeit und die
 * Summenerhaltung über lokale Kalendertage gehören laut PRD-Schnittgrenze zu
 * **EYT-109**. EYT-95 liefert nur die wiederverwendbaren exakten Primitive;
 * die Dauer kommt fertig als Millisekundenmenge herein.
 */

import type { DurationMilliseconds } from "./duration-milliseconds.js";
import type { AssignmentId, PlanVersionId, RateVersionId } from "./identifiers.js";
import type { PlanCostAmountError, PlanCostAmountResult, PlanCostAmount } from "./money.js";
import type { LocalBusinessDate } from "./planning-week.js";
import type { HourlyRateVersion, RateSelectionError } from "./rate-version.js";

/** Regelversion. Jede Position und jeder Snapshot referenzieren sie (V1). */
export const COST_RULE_VERSION = "personnel-plan-cost-v1";

/** Halbwert von null weg: `0,5 Cent → 1 Cent`. Nicht bankübliches Runden. */
export const ROUNDING_MODE = "HALF_UP";

/** Die eine Stelle, an der gerundet wird — der finale Betrag der Kostenposition. */
export const ROUNDING_STAGE = "COST_POSITION_FINAL_AMOUNT";

/** Millisekunden je Stunde. Nenner des Mengenbruchs aus V2. */
export const COST_RATE_DENOMINATOR = 3_600_000n;

/**
 * Herkunftsreferenz einer Kostenposition (AK4).
 *
 * Die Felder tragen die bereits vorhandenen Marken aus `identifiers.ts`
 * (EYT-46), nicht nacktes `string`: ein vertauschtes Argumentpaar aus zwei
 * UUIDs fiele sonst erst auf, wenn ein historischer Betrag auf die falsche
 * Planversion zeigt — und dann ist er nicht mehr erklärbar.
 *
 * Was EYT-95 weiterhin **nicht** festlegt, ist die fachliche Struktur: ob eine
 * Position später auf weitere Bezugsgrößen zeigt, entscheidet EYT-109 mit dem
 * Snapshot. Geprüft wird hier nur, dass die übergebene Referenz unverändert
 * wieder erscheint.
 */
export interface CostSource {
  readonly planVersionId: PlanVersionId;
  readonly assignmentId: AssignmentId;
}

/**
 * Berechneter, persistierfähiger Stand.
 *
 * Die vier Referenzfelder sind kein Beiwerk: ohne Quelle, Satzversion,
 * Regelversion und Erzeugungszeitpunkt lässt sich ein historischer Betrag
 * später nicht mehr erklären, und genau das verlangt AK4.
 */
export interface CostPosition {
  readonly source: CostSource;
  readonly rateVersionId: RateVersionId;
  readonly ruleVersion: typeof COST_RULE_VERSION;
  readonly amount: PlanCostAmount;
  readonly computedAt: Date;
}

/**
 * Eingabe der Berechnung.
 *
 * `computedAt` ist **Eingabe** und wird nicht im Inneren von der Uhr gelesen.
 * Nur so ist AK5 erfüllbar: dieselbe fachliche Eingabe ergibt zweimal dasselbe
 * Ergebnis, und eine Wiederholung kann keine Doppelwirkung erzeugen. Eine reine
 * Domainfunktion kennt ohnehin keine Uhr.
 */
export interface CostPositionInput {
  readonly source: CostSource;
  readonly versions: readonly HourlyRateVersion[];
  readonly on: LocalBusinessDate;
  readonly quantity: DurationMilliseconds;
  readonly computedAt: Date;
}

/**
 * Blockierende Ausgänge der Positionsberechnung.
 *
 * Bewusst die Vereinigung der bereits vergebenen Codes statt einer eigenen
 * Liste: eine zweite Benennung derselben Fehlerlage wäre ein zweiter Vertrag.
 */
export type CostPositionError = RateSelectionError | PlanCostAmountError;

export type CostPositionResult =
  | { readonly ok: true; readonly position: CostPosition }
  | { readonly ok: false; readonly error: CostPositionError };

/**
 * Betrag einer Menge zu einem Satz — die eine Rundung des Vertrags.
 *
 * Nimmt die geprüfte Satzversion und nicht bloß einen Geldwert entgegen, damit
 * der berechnete Betrag ohne Umweg auf eine belegbare Satzversion zurückführbar
 * bleibt.
 */
export function costOfDuration(
  rate: HourlyRateVersion,
  quantity: DurationMilliseconds,
): PlanCostAmountResult {
  void [rate, quantity];
  throw new Error("NOT_IMPLEMENTED");
}

/** Auswahl, Berechnung und Herkunft in einem Schritt — oder ein blockierendes Ergebnis. */
export function computeCostPosition(input: CostPositionInput): CostPositionResult {
  void input;
  throw new Error("NOT_IMPLEMENTED");
}
