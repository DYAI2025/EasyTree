/**
 * Validiertes Zeitintervall (EYT-73, `FIND-004` High).
 *
 * ## Der Fehler, den dieses Modul unmöglich macht
 *
 * Die Prototypfunktion `calculateHours` addierte bei `end <= start` pauschal
 * 24 Stunden. Folgen: `07:00–07:00` galt als voller Tag, `15:30–07:00` wurde
 * still als Nachtschicht akzeptiert, fehlende Zeiten wurden ohne
 * Validierungsfehler als acht Stunden gewertet — und die Überlappungsprüfung
 * rechnete auf einer reinen Tageszeitachse, also nach einem anderen Modell als
 * die Dauerberechnung. Zwei Modelle, zwei Wahrheiten.
 *
 * ## Warum das hier strukturell nicht passieren kann
 *
 * 1. **Ein Intervall entsteht nur durch Validierung.** `TimeInterval` ist ein
 *    gebrandeter Typ; ihn erzeugt ausschliesslich {@link createTimeInterval}.
 *    {@link durationMinutes} und {@link overlaps} nehmen nichts anderes
 *    entgegen. Dauer und Überlappung teilen sich damit *ein* Modell, weil es
 *    kein zweites gibt — nicht, weil eine Konvention es verlangt.
 * 2. **UTC-Instants statt Tageszeiten.** Die Prototyplogik konnte
 *    `15:30–07:00` nur deshalb umdeuten, weil ihr das Datum fehlte. Wer hier
 *    zwei Instants übergibt, hat den Kalendertag bereits entschieden. Eine
 *    Schicht über Mitternacht ist eine normale aufsteigende Instantfolge;
 *    `end < start` kann daher nur noch ein tatsächlich verkehrtes Intervall
 *    sein und wird abgelehnt. Die Zweideutigkeit verschwindet, statt geregelt
 *    zu werden.
 * 3. **Halb-offen `[start, end)`.** So gilt `08:00–12:00` und `12:00–16:00`
 *    als angrenzend, nicht als Überschneidung — sonst blockierte jeder
 *    Baustellenwechsel am selben Tag die Veröffentlichung.
 *    (`docs/audit/INTEGRATION_ARCHITECTURE.md`, „Zeit- und
 *    Veröffentlichungsregeln")
 *
 * ## Ausdrücklich nicht hier
 *
 * - **Ist das Nachtarbeit?** Das ist keine Intervall-, sondern eine
 *   Kalenderfrage und braucht die IANA-Zeitzone plus das lokale Geschäftsdatum
 *   aus EYT-86. Dieses Modul entscheidet nur, ob ein Intervall *wohlgeformt*
 *   ist, nicht ob es *erlaubt* ist.
 * - **Obergrenze für die Dauer.** Weder PRD noch ADR nennen eine; eine hier
 *   erfundene Grenze wäre geraten. Offen für EYT-74/EYT-86.
 */

declare const timeIntervalBrand: unique symbol;

/**
 * Wohlgeformtes, halb-offenes Intervall `[startUtc, endUtc)` mit
 * `startUtc < endUtc`. Nur über {@link createTimeInterval} erhältlich.
 */
export interface TimeInterval {
  readonly startUtc: Date;
  readonly endUtc: Date;
  readonly [timeIntervalBrand]: "TimeInterval";
}

/** Ablehnungsgründe. Stabile Codes — sie werden Teil des API-Vertrags (EYT-47). */
export const TIME_INTERVAL_ERRORS = [
  /** Start fehlt. Der Prototyp nahm hier stillschweigend acht Stunden an. */
  "START_MISSING",
  /** Ende fehlt. Ebenfalls kein Standardwert. */
  "END_MISSING",
  /** Start ist kein gültiger Zeitpunkt (z. B. `new Date("kaputt")`). */
  "START_INVALID",
  /** Ende ist kein gültiger Zeitpunkt. */
  "END_INVALID",
  /** `start === end`. Ein Punkt ist kein Intervall — und keine 24 Stunden. */
  "START_EQUALS_END",
  /** `end < start`. Verkehrtes Intervall, nicht implizit „am nächsten Tag". */
  "END_BEFORE_START",
] as const;

export type TimeIntervalError = (typeof TIME_INTERVAL_ERRORS)[number];

export type TimeIntervalResult =
  | { readonly ok: true; readonly interval: TimeInterval }
  | { readonly ok: false; readonly error: TimeIntervalError };

/** Was `createTimeInterval` entgegennimmt — bewusst auch `null`/`undefined`. */
export type MaybeInstant = Date | null | undefined;

function isValidDate(value: MaybeInstant): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Die einzige Stelle, an der ein {@link TimeInterval} entsteht.
 *
 * Gibt ein Ergebnisobjekt zurück statt zu werfen: der Aufrufer muss den
 * Fehlerfall behandeln, und der Fehlercode ist maschinenlesbar für die
 * API-Antwort. Ein `throw` liesse sich mit einem `try`/`catch` versehentlich
 * verschlucken — genau der Weg, auf dem fail-closed zu fail-open wird.
 */
export function createTimeInterval(start: MaybeInstant, end: MaybeInstant): TimeIntervalResult {
  if (start === null || start === undefined) return { ok: false, error: "START_MISSING" };
  if (end === null || end === undefined) return { ok: false, error: "END_MISSING" };
  if (!isValidDate(start)) return { ok: false, error: "START_INVALID" };
  if (!isValidDate(end)) return { ok: false, error: "END_INVALID" };

  const startMs = start.getTime();
  const endMs = end.getTime();
  if (startMs === endMs) return { ok: false, error: "START_EQUALS_END" };
  if (endMs < startMs) return { ok: false, error: "END_BEFORE_START" };

  // Kopien: der Aufrufer darf sein Date nachtraeglich veraendern, das Intervall
  // bleibt davon unberuehrt.
  return {
    ok: true,
    interval: {
      startUtc: new Date(startMs),
      endUtc: new Date(endMs),
    } as TimeInterval,
  };
}

/** Dauer in Millisekunden. Immer > 0, weil `start < end` zugesichert ist. */
export function durationMs(interval: TimeInterval): number {
  return interval.endUtc.getTime() - interval.startUtc.getTime();
}

/**
 * Dauer in Minuten, exakt — kein Runden.
 *
 * Da UTC-Instants verwendet werden, ist die Dauer ueber eine Zeitumstellung
 * hinweg die tatsaechlich verstrichene Zeit: eine Schicht ueber die
 * Sommerzeitluecke dauert eine Stunde weniger als die Ortszeitdifferenz
 * suggeriert. Das ist beabsichtigt — bezahlt und geplant wird verstrichene Zeit.
 */
export function durationMinutes(interval: TimeInterval): number {
  return durationMs(interval) / 60_000;
}

/**
 * Ueberschneidung zweier Intervalle, halb-offen ausgewertet.
 *
 * `[08:00, 12:00)` und `[12:00, 16:00)` ueberschneiden sich NICHT — sie grenzen
 * aneinander. Siehe {@link isAdjacent}.
 */
export function overlaps(a: TimeInterval, b: TimeInterval): boolean {
  return a.startUtc.getTime() < b.endUtc.getTime() && b.startUtc.getTime() < a.endUtc.getTime();
}

/** Grenzen die Intervalle exakt aneinander, ohne Ueberschneidung und ohne Luecke? */
export function isAdjacent(a: TimeInterval, b: TimeInterval): boolean {
  return a.endUtc.getTime() === b.startUtc.getTime() || b.endUtc.getTime() === a.startUtc.getTime();
}

/**
 * Ueberschneiden sich irgendzwei Intervalle der Liste?
 *
 * Sortiert nach Startzeitpunkt und vergleicht nur Nachbarn — bei nach Start
 * sortierten Intervallen genuegt das: ueberschneidet sich ein Intervall mit
 * einem spaeteren, dann auch mit seinem direkten Nachfolger.
 */
export function hasAnyOverlap(intervals: readonly TimeInterval[]): boolean {
  const sorted = [...intervals].sort((x, y) => x.startUtc.getTime() - y.startUtc.getTime());
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous === undefined || current === undefined) continue;
    if (overlaps(previous, current)) return true;
  }
  return false;
}
