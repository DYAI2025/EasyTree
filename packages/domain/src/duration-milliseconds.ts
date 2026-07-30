/**
 * Kanonische Mengeneinheit der Kostenrechnung: nichtnegative ganzzahlige
 * Millisekunden (EYT-95, REQ-005 — Berechnungsvertrag V2, V2b, V4).
 *
 * ## Warum Millisekunden und nicht Minuten
 *
 * `durationMinutes()` aus `time-interval.ts` rechnet `durationMs / 60_000` und
 * liefert bei Millisekundenanteil einen Gleitkommawert. V2 schließt diesen Weg
 * im Kostenpfad aus: Minuten und Stunden sind Darstellung, nicht Rechengrundlage.
 * Dass Planeinsätze in der UI minutengenau eingegeben werden, ist eine
 * Eingaberegel der Planungsdomäne — die Geldarithmetik verlässt sich nicht
 * ungeprüft darauf und verwirft keine Sekundenanteile.
 *
 * ## Warum `toDurationMilliseconds` hier bereits vollständig ist
 *
 * Sie ist keine Berechnung, sondern die Konvertierungsgrenze selbst, und die
 * PRD führt „sichere Konvertierungsgrenzen" ausdrücklich als erlaubten
 * Skelettbestandteil. Ohne sie wäre die Grenze eine Behauptung.
 */

declare const durationMillisecondsBrand: unique symbol;

/**
 * Geprüfte Menge. Die Marke verhindert, dass ein Objektliteral
 * `{ milliseconds: -1n }` als geprüfte Menge durchgeht — sonst wäre die
 * Vorzeichenregel aus V4 nur eine Empfehlung an den Aufrufer.
 */
export interface DurationMilliseconds {
  readonly milliseconds: bigint;
  readonly [durationMillisecondsBrand]: "DurationMilliseconds";
}

/**
 * Ablehnungsgründe der Mengengrenze. Die Reihenfolge dieser Liste spiegelt die
 * Prüfreihenfolge in {@link toDurationMilliseconds} und ist Teil des Vertrags,
 * nicht Kosmetik: `Number.isSafeInteger(NaN)` ist ebenfalls `false`, wer die
 * Sicherheitsprüfung vorzieht, meldet für `NaN` den falschen Code.
 */
export const QUANTITY_ERRORS = [
  /** `NaN` oder `Infinity` — das typische Ergebnis einer vorgelagerten Division. */
  "QUANTITY_NOT_FINITE",
  /** Endlich, aber gebrochen. Kein Runden an dieser Stelle (V1 Punkt 5). */
  "QUANTITY_NOT_INTEGER",
  /** V4: `Quantity >= 0`. `0` ist eine zulässige Nullmenge, `-1` nicht. */
  "QUANTITY_NEGATIVE",
  /** Ganzzahlig und nichtnegativ, aber jenseits von 2^53 — siehe unten. */
  "QUANTITY_NOT_SAFE_INTEGER",
] as const;

export type QuantityError = (typeof QUANTITY_ERRORS)[number];

export type DurationMillisecondsResult =
  | { readonly ok: true; readonly quantity: DurationMilliseconds }
  | { readonly ok: false; readonly error: QuantityError };

/**
 * Einzige Stelle, an der eine geprüfte Menge entsteht. Der Cast ist die Marke,
 * nicht die Prüfung — die steht bei jedem Aufrufer vollständig davor und ist
 * der Grund, warum er zulässig ist.
 */
function checkedQuantity(milliseconds: bigint): DurationMilliseconds {
  // Eingefroren wie `moneyOfMinorUnits` und `hourlyRateVersion`. Gemessen war
  // dieser Konstruktor als einziger der geprueften ohne `Object.freeze` — eine
  // Inkonsistenz, kein Datenleck: `readonly` macht die Zuweisung fuer getypte
  // Aufrufer zu einem Compilefehler (TS2540), und `typecheck` ist Pflichtjob.
  // Die Sperre gilt jetzt auch fuer ungetypte Aufrufer.
  return Object.freeze({ milliseconds }) as DurationMilliseconds;
}

/**
 * Menge aus einem `bigint`.
 *
 * Nur das Vorzeichen kann hier noch falsch sein: ein `bigint` ist immer endlich
 * und ganzzahlig, und eine obere Schranke gibt es nicht — genau dafür ist der
 * Typ gewählt. `0` ist laut V4 eine zulässige Nullmenge, deshalb `< 0n` und
 * nicht `<= 0n`.
 *
 * Der Ergebnistyp ist mit {@link toDurationMilliseconds} geteilt und deshalb
 * WEITER als noetig: aus einem `bigint` sind `QUANTITY_NOT_FINITE`,
 * `QUANTITY_NOT_INTEGER` und `QUANTITY_NOT_SAFE_INTEGER` nicht erzeugbar. Das
 * ist Bequemlichkeit, keine Zusicherung — wer hier `switch`t, behandelt drei
 * Faelle, die nie eintreten. Eine engere Union waere praeziser; sie wurde
 * bewusst nicht gebaut, weil ein zweiter Ergebnistyp fuer eine
 * Vorzeichenpruefung mehr Vertrag kostet als er traegt.
 */
export function durationMilliseconds(value: bigint): DurationMillisecondsResult {
  if (value < 0n) return { ok: false, error: "QUANTITY_NEGATIVE" };

  return { ok: true, quantity: checkedQuantity(value) };
}

/**
 * Sicherheitsgrenze vor `BigInt` (V2b), fail-closed.
 *
 * ## Warum ein `try`/`catch` um `BigInt(value)` nicht genügt
 *
 * Drei der vier verbotenen Konvertierungen werfen von selbst: `BigInt(7.5)`,
 * `BigInt(NaN)` und `BigInt(Infinity)` sind alle ein `RangeError`. Der vierte
 * ist der gefährliche — `BigInt(Number.MAX_SAFE_INTEGER + 2)` wirft **nicht**,
 * sondern liefert klaglos `9007199254740992n`. Der Wert sieht plausibel aus,
 * ist aber nicht mehr eindeutig auf seine Herkunft zurückführbar, und die
 * „verlustfreie" Rechnung ist ab hier stillschweigend falsch. Deshalb steht
 * `Number.isSafeInteger` im Vertrag und nicht bloß ein Auffangblock.
 *
 * Dass die Differenz zweier Epoch-Millisekunden „sicher darstellbar" ist, ist
 * laut V2b eine zu prüfende Annahme und keine Tatsache: `Date` stellt
 * ±8,64e15 ms dar, die Spanne zwischen beiden Enden ist 1,728e16 und damit
 * größer als `Number.MAX_SAFE_INTEGER`. Der unsichere Fall ist also mit echten
 * `Date`-Werten erreichbar, nicht bloß hypothetisch.
 */
export function toDurationMilliseconds(value: number): DurationMillisecondsResult {
  if (!Number.isFinite(value)) return { ok: false, error: "QUANTITY_NOT_FINITE" };
  if (!Number.isInteger(value)) return { ok: false, error: "QUANTITY_NOT_INTEGER" };
  if (value < 0) return { ok: false, error: "QUANTITY_NEGATIVE" };
  if (!Number.isSafeInteger(value)) return { ok: false, error: "QUANTITY_NOT_SAFE_INTEGER" };

  return { ok: true, quantity: checkedQuantity(BigInt(value)) };
}
