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
import { moneyOfMinorUnits, planCostAmount } from "./money.js";
import type { PlanCostAmount } from "./money.js";
import type { LocalBusinessDate } from "./planning-week.js";
import { selectRateVersion } from "./rate-version.js";
import type { HourlyRateVersion, RateSelectionError } from "./rate-version.js";

/** Regelversion. Jede Position und jeder Snapshot referenzieren sie (V1). */
export const COST_RULE_VERSION = "personnel-plan-cost-v1";

/**
 * Bei exakt 0,5 Cent wird auf den nächsthöheren Cent gerundet — nicht
 * bankübliches Runden.
 *
 * Der Name trägt seit V5.3 die Einschränkung, die vorher nur im Kommentar von
 * {@link roundHalfUp} stand: nachgewiesen ist die Regel **nur für nichtnegative
 * Werte**, und im Kostenpfad sind auch nur solche zulässig. „Negative Halbwerte
 * werden von null weg gerundet" wäre ein Überklaim — eine vorzeichenbehaftete
 * Rundungsprimitive gehört nicht zu Sprint 5 und wird auch nicht allein zum
 * Testen eingeführt.
 */
export const ROUNDING_MODE = "HALF_UP_NON_NEGATIVE";

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
export type CostPositionError = RateSelectionError;

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
/**
 * `HALF_UP` auf einem exakten Bruch, ganz in `bigint` (V1 Punkt 6).
 *
 * `floor((2·zähler + nenner) / (2·nenner))` — algebraisch dasselbe wie
 * `floor(zähler/nenner + 1/2)`, aber ohne je einen Bruch zu bilden. Der
 * Halbwert fällt damit nach oben: `5000,5 → 5001`. Bankübliches Runden
 * (`HALF_EVEN`) lieferte hier 5000, `Math.floor` ebenfalls — beide sind durch
 * V1 ausgeschlossen.
 *
 * **Vorbedingung: `numerator >= 0`.** Nur dann ist die Division in `bigint`
 * (die zur Null hin abschneidet) gleich `floor`. Die Vorbedingung ist keine
 * Bitte, sondern durch die Typen gesichert: `RATE_NEGATIVE` und
 * `QUANTITY_NEGATIVE` legen beide Faktoren an ihren einzigen Konstruktoren auf
 * `>= 0` fest. Käme trotzdem ein negativer Zähler an, bliebe das Ergebnis
 * negativ und `planCostAmount` weist es mit `COST_AMOUNT_NEGATIVE` ab — die von
 * V4 dafür vorgesehene Stelle, statt einer zweiten hier.
 */
function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

export function costOfDuration(
  rate: HourlyRateVersion,
  quantity: DurationMilliseconds,
): PlanCostAmount {
  // Ein einziges exaktes Produkt in `bigint`, kein Zwischenergebnis, keine
  // Zwischenrundung (V1 Punkt 4). `durationMinutes()` aus `time-interval.ts`
  // käme hier nie in Frage: es rechnet `durationMs / 60_000` und liefert bei
  // Millisekundenanteil einen Gleitkommawert.
  const numerator = rate.amountPerHour.minorUnits * quantity.milliseconds;
  const minorUnits = roundHalfUp(numerator, COST_RATE_DENOMINATOR);

  const validated = planCostAmount(moneyOfMinorUnits(minorUnits, rate.amountPerHour.currency));

  // V5.2: KEIN öffentlicher Fehlerzweig hier. Satz und Menge sind durch ihre
  // Konstruktoren nichtnegativ, `roundHalfUp` erhält das Vorzeichen — mit
  // zulässigen Eingaben kann diese Validierung nicht fehlschlagen. Ein
  // `{ ok: false }` nach aussen wäre Scheingenauigkeit: der Aufrufer müsste
  // einen Fall behandeln, den er nie sieht, und der Vertrag verspräche eine
  // Prüfung, die nichts prüft.
  //
  // Schlägt sie trotzdem fehl, ist eine Invariante verletzt und nicht eine
  // Eingabe falsch. Das ist fail-closed zu behandeln — lauter Abbruch, wie beim
  // Monatsbereich in `dayAfter`, nicht ein vom Nutzer korrigierbarer
  // Domainfehler. Die Defense in Depth bleibt an den zwei echten Grenzen:
  // `planCostAmount` (hier, als Prüfung) und der Snapshotgrenze in EYT-109.
  if (!validated.ok) {
    throw new RangeError(
      `Invariante verletzt: costOfDuration errechnete ${minorUnits} (${validated.error}). ` +
        `Satz und Menge sind nichtnegativ, dieses Ergebnis kann nicht aus zulaessigen Eingaben stammen.`,
    );
  }

  return validated.amount;
}

/**
 * Auswahl, Berechnung und Herkunft in einem Schritt — oder ein blockierendes
 * Ergebnis.
 *
 * Der Katalog wird **sofort** ausgewertet und nichts von ihm behalten: das
 * Ergebnis führt nur die aufgelöste Satzversion und den fertigen Betrag mit.
 * Eine spätere Ergänzung des Katalogs kann einen berechneten Stand deshalb
 * nicht rückwirkend verändern (AK5, Forward-Fix). Eine defensive Kopie der
 * Liste bringt darüber hinaus nichts — es gibt keinen Verweis, den sie
 * schützen könnte.
 */
export function computeCostPosition(input: CostPositionInput): CostPositionResult {
  const selected = selectRateVersion(input.versions, input.on);
  if (!selected.ok) return { ok: false, error: selected.error };

  // Seit V5.2 liefert `costOfDuration` den Betrag direkt: der einzige Weg, auf
  // dem die Positionserzeugung blockieren kann, ist die Satzauswahl.
  const amount = costOfDuration(selected.version, input.quantity);

  // Der Zeitpunkt wird als Zahl festgehalten und bei JEDEM Zugriff frisch
  // ausgegeben — dieselbe Bauart wie `TimeInterval.startUtc`. Ein einmal
  // kopiertes `Date` als Feld genügt nicht: der Empfänger hielte weiterhin
  // denselben veränderlichen Verweis, den auch der nächste Leser bekommt, und
  // ein `setUTCFullYear` darauf veränderte einen angeblich unveränderlichen
  // Stand rückwirkend.
  const computedAtMs = input.computedAt.getTime();

  return {
    ok: true,
    position: Object.freeze({
      // Eigene Hülle statt der Referenz des Aufrufers: die Position ist ein
      // historisch stabiler Stand (AK4/AK5), und die Felder werden hier einzeln
      // benannt, damit ein künftiges Feld an `CostSource` den Build bricht,
      // statt still zu fehlen.
      source: Object.freeze({
        planVersionId: input.source.planVersionId,
        assignmentId: input.source.assignmentId,
      }),
      rateVersionId: selected.version.rateVersionId,
      ruleVersion: COST_RULE_VERSION,
      amount,
      get computedAt(): Date {
        return new Date(computedAtMs);
      },
    }),
  };
}
