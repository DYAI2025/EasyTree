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
 * ## Warum es eine Klasse mit privaten Feldern ist
 *
 * Der erste Entwurf war ein `interface` mit einem Symbol-Brand. Das hielt
 * **nicht**, nachgewiesen mit grünem `tsc --noEmit`, ohne Cast und ohne `any`:
 *
 * ```ts
 * const forged: TimeInterval = { ...good, startUtc: spaeter, endUtc: frueher };
 * durationMinutes(forged); // -600
 * ```
 *
 * Object-Spread trägt symbolische Eigenschaften mit, also auch das Brand — nur
 * die Daten nicht. Zusätzlich schützte `readonly startUtc: Date` bloss die
 * Referenz: `interval.endUtc.setUTCFullYear(1999)` liess eine geprüfte
 * Überschneidung nachträglich verschwinden. Beides war fail-open, also exakt
 * die Fehlerart, die dieses Modul verhindern soll.
 *
 * Deshalb jetzt:
 *
 * 1. **Private Felder (`#startMs`/`#endMs`) statt öffentlicher Properties.**
 *    TypeScript typisiert Klassen mit privaten Feldern nominal — ein
 *    strukturell gleiches Objektliteral, ein Spread oder ein `Object.assign`
 *    ist nicht zuweisbar. Der Konstruktor ist privat; der einzige Weg zu einer
 *    Instanz ist {@link TimeInterval.create}.
 * 2. **Millisekunden statt `Date` als Zustand.** Zahlen sind unveränderlich.
 *    `startUtc`/`endUtc` geben bei jedem Zugriff eine **frische Kopie** zurück,
 *    also gibt es keinen Alias, über den ein geprüftes Intervall nachträglich
 *    kaputtgehen könnte.
 * 3. **`Object.freeze` im Konstruktor**, damit auch reines JavaScript ohne
 *    Typprüfung nichts anhängen oder überschreiben kann.
 *
 * Dadurch teilen Dauer und Überlappung ein Modell, weil es kein zweites geben
 * *kann* — nicht, weil eine Konvention es verlangt.
 *
 * ## UTC-Instants statt Tageszeiten
 *
 * Die Prototyplogik konnte `15:30–07:00` nur deshalb umdeuten, weil ihr das
 * Datum fehlte. Wer hier zwei Instants übergibt, hat den Kalendertag bereits
 * entschieden; `end < start` kann daher nur noch ein tatsächlich verkehrtes
 * Intervall sein. Die Zweideutigkeit verschwindet, statt geregelt zu werden.
 *
 * ## Halb-offen `[start, end)`
 *
 * `08:00–12:00` und `12:00–16:00` grenzen aneinander, sie überschneiden sich
 * nicht — sonst blockierte jeder Baustellenwechsel am selben Tag die
 * Veröffentlichung. (`docs/audit/INTEGRATION_ARCHITECTURE.md`, „Zeit- und
 * Veröffentlichungsregeln")
 *
 * ## Ausdrücklich nicht hier
 *
 * - **Ist das Nachtarbeit?** Kalenderfrage, braucht IANA-Zeitzone und lokales
 *   Geschäftsdatum aus EYT-86. Dieses Modul entscheidet Wohlgeformtheit, nicht
 *   Erlaubnis.
 * - **Obergrenze für die Dauer.** Weder PRD noch ADR nennen eine; eine hier
 *   erfundene Grenze wäre geraten. Bewusst unbegrenzt, bis EYT-74/EYT-86 eine
 *   fachliche Grenze festlegen — ein 30-Tage-Einsatz ist heute wohlgeformt.
 * - **Deserialisierung.** {@link TimeInterval.toJSON} ist definiert, ein
 *   stillschweigendes Wiederbeleben aus JSON gibt es bewusst nicht: der Weg
 *   zurück führt über {@link TimeInterval.create}, damit gelesene Daten
 *   dieselbe Prüfung durchlaufen wie geschriebene (relevant ab EYT-45/EYT-47).
 */

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

/** Was {@link TimeInterval.create} entgegennimmt — bewusst auch `null`/`undefined`. */
export type MaybeInstant = Date | null | undefined;

export type TimeIntervalResult =
  | { readonly ok: true; readonly interval: TimeInterval }
  | { readonly ok: false; readonly error: TimeIntervalError };

function isValidDate(value: MaybeInstant): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Wohlgeformtes, halb-offenes Intervall `[startUtc, endUtc)` mit
 * `startUtc < endUtc`. Nur über {@link TimeInterval.create} erhältlich.
 */
export class TimeInterval {
  readonly #startMs: number;
  readonly #endMs: number;

  /**
   * `private` ist eine reine TypeScript-Angabe und wird beim Emit geloescht —
   * aus JavaScript oder ueber Reflection bleibt `new TimeInterval(ende, start)`
   * moeglich, und so ein Objekt besteht jeden `instanceof`-Test. Die Invariante
   * steht deshalb hier, nicht nur in {@link TimeInterval.create}: sie ist eine
   * Eigenschaft jeder Instanz, unabhaengig vom Weg dorthin.
   *
   * Wirft statt ein Ergebnis zurueckzugeben, weil dieser Pfad kein erwarteter
   * Fehlerfall ist, sondern ein Programmierfehler. Den erwarteten Fall bedient
   * {@link TimeInterval.create} mit einem Fehlercode.
   */
  private constructor(startMs: number, endMs: number) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new RangeError("TimeInterval verlangt endliche Millisekundenwerte.");
    }
    if (endMs <= startMs) {
      throw new RangeError(
        `TimeInterval verlangt start < end (halb-offen), erhalten start=${startMs} end=${endMs}.`,
      );
    }
    this.#startMs = startMs;
    this.#endMs = endMs;
    Object.freeze(this);
  }

  /**
   * Die einzige Stelle, an der ein {@link TimeInterval} entsteht.
   *
   * Gibt ein Ergebnisobjekt zurück statt zu werfen: der Aufrufer muss den
   * Fehlerfall behandeln, und der Fehlercode ist maschinenlesbar für die
   * API-Antwort. Ein `throw` liesse sich mit einem `try`/`catch` versehentlich
   * verschlucken — genau der Weg, auf dem fail-closed zu fail-open wird.
   */
  static create(start: MaybeInstant, end: MaybeInstant): TimeIntervalResult {
    if (start === null || start === undefined) return { ok: false, error: "START_MISSING" };
    if (end === null || end === undefined) return { ok: false, error: "END_MISSING" };
    if (!isValidDate(start)) return { ok: false, error: "START_INVALID" };
    if (!isValidDate(end)) return { ok: false, error: "END_INVALID" };

    const startMs = start.getTime();
    const endMs = end.getTime();
    if (startMs === endMs) return { ok: false, error: "START_EQUALS_END" };
    if (endMs < startMs) return { ok: false, error: "END_BEFORE_START" };

    return { ok: true, interval: new TimeInterval(startMs, endMs) };
  }

  /** Startzeitpunkt als UTC-Instant. Jeder Zugriff liefert eine frische Kopie. */
  get startUtc(): Date {
    return new Date(this.#startMs);
  }

  /** Endzeitpunkt als UTC-Instant, exklusiv. Jeder Zugriff liefert eine frische Kopie. */
  get endUtc(): Date {
    return new Date(this.#endMs);
  }

  /** Startzeitpunkt in Millisekunden seit Epoch. */
  get startMs(): number {
    return this.#startMs;
  }

  /** Endzeitpunkt in Millisekunden seit Epoch, exklusiv. */
  get endMs(): number {
    return this.#endMs;
  }

  /**
   * Serialisierbare Form. Ohne diese Methode ergaebe `JSON.stringify` `{}`,
   * weil der Zustand in privaten Feldern liegt — ein stiller Datenverlust.
   * Der Rueckweg fuehrt bewusst wieder ueber {@link TimeInterval.create}.
   */
  toJSON(): { readonly startUtc: string; readonly endUtc: string } {
    return {
      startUtc: new Date(this.#startMs).toISOString(),
      endUtc: new Date(this.#endMs).toISOString(),
    };
  }
}

/**
 * Letzte Bastion gegen ein Objekt, das nur *typseitig* ein Intervall ist.
 *
 * Private Felder machen den Typ nominal, aber `Object.assign(target, quelle)`
 * typisiert TypeScript als **Schnittmenge** — `Object.assign({}, gutesIntervall,
 * { endUtc: x })` gilt damit als `TimeInterval`, obwohl zur Laufzeit ein nacktes
 * Objekt ohne `#startMs` herauskommt. Ohne diese Pruefung waere `startMs` dort
 * `undefined`, jeder Vergleich `undefined < zahl` ergaebe `false`, und
 * `overlaps` meldete brav „kein Konflikt": fail-open.
 *
 * Ein `instanceof` kostet nichts und macht daraus einen lauten Fehler.
 */
function assertInterval(value: TimeInterval, role: string): void {
  if (!(value instanceof TimeInterval)) {
    throw new TypeError(
      `${role} ist kein geprueftes TimeInterval. Instanzen entstehen ausschliesslich ueber TimeInterval.create().`,
    );
  }
}

/** Dauer in Millisekunden. Immer > 0, weil `start < end` zugesichert ist. */
export function durationMs(interval: TimeInterval): number {
  assertInterval(interval, "interval");
  return interval.endMs - interval.startMs;
}

/**
 * Dauer in Minuten, exakt — kein Runden.
 *
 * Da UTC-Instants verwendet werden, ist die Dauer ueber eine Zeitumstellung
 * hinweg die tatsaechlich verstrichene Zeit: eine Schicht ueber die
 * Sommerzeitluecke dauert eine Stunde weniger als die Ortszeitdifferenz
 * suggeriert. Das ist beabsichtigt — geplant und bezahlt wird verstrichene Zeit.
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
  assertInterval(a, "a");
  assertInterval(b, "b");
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/** Grenzen die Intervalle exakt aneinander, ohne Ueberschneidung und ohne Luecke? */
export function isAdjacent(a: TimeInterval, b: TimeInterval): boolean {
  assertInterval(a, "a");
  assertInterval(b, "b");
  return a.endMs === b.startMs || b.endMs === a.startMs;
}

/**
 * Ueberschneiden sich irgendzwei Intervalle der Liste?
 *
 * Sortiert nach Startzeitpunkt und vergleicht nur Nachbarn. Das genuegt:
 * ueberschneidet sich ein Intervall `a` mit einem spaeteren `c`, dann gilt fuer
 * jedes dazwischenliegende `b` mit `a.start <= b.start <= c.start` bereits
 * `b.start < a.end` (denn `b.start <= c.start < a.end`) und `b.end > a.start`
 * (denn `b.end > b.start >= a.start`) — also ueberschneidet sich `a` auch mit
 * seinem direkten Nachfolger. Ein Verstoss kann keinen Nachbarn ueberspringen.
 */
export function hasAnyOverlap(intervals: readonly TimeInterval[]): boolean {
  intervals.forEach((entry, index) => assertInterval(entry, `intervals[${index}]`));
  const sorted = [...intervals].sort((x, y) => x.startMs - y.startMs);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous === undefined || current === undefined) continue;
    if (overlaps(previous, current)) return true;
  }
  return false;
}
