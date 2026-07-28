/**
 * ISO-8601-Wochenschluessel: Pruefung mit Kalenderrechnung (EYT-88).
 *
 * ## Warum diese Datei existiert
 *
 * Das bisherige Muster `^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$` haelt `W00`, `W54`
 * und `W99` draussen, laesst aber `W53` in JEDEM Jahr durch. Die meisten Jahre
 * haben 52 ISO-Wochen; `2025-W53` bezeichnet keine reale Woche. Ein regulaerer
 * Ausdruck kann das nicht entscheiden — dafuer braucht es einen Kalender.
 *
 * ## Warum die Regel hier und nicht in `@easytree/domain` liegt
 *
 * `@easytree/contracts` ist transport-only und hat bewusst keine Abhaengigkeit
 * auf `@easytree/domain` (siehe Dateikopf von `planning/schemas.ts`). Die
 * Pruefung gehoert an die Transportgrenze, also hierhin. Damit daraus keine
 * zweite, abweichende Wochenregel wird, gibt es einen Paritaetstest gegen
 * `packages/domain/src/planning-week.ts` — er liegt in `apps/api/test/`, weil
 * nur `apps/api` beide Pakete sieht.
 *
 * ## Determinismus
 *
 * Keine Zeitzone, kein Locale, kein `Date.parse`, kein `now()`. Gerechnet wird
 * ausschliesslich mit UTC-Millisekunden. Dieselbe Eingabe ergibt auf jeder
 * Maschine dasselbe Ergebnis — Voraussetzung dafuer, dass die SQL-Seite
 * dieselben Vektoren akzeptiert und ablehnt.
 *
 * ## Jahresgrenzen, und warum sie eng sind
 *
 * `Date.UTC(jahr, 0, 1)` bildet Jahre 0 bis 99 auf 1900+jahr ab — eine stille
 * Verschiebung um 1900 Jahre. Deshalb wird hier ausschliesslich ueber
 * `setUTCFullYear` gerechnet, das diese Umdeutung nicht kennt.
 *
 * Das Jahr `0000` wird auf BEIDEN Seiten abgelehnt: PostgreSQL kennt kein Jahr
 * null (der Kalender geht von 1 v. Chr. direkt auf 1 n. Chr.), `make_date(0,…)`
 * schlaegt fehl. JavaScript kennt es. Statt diese Divergenz stillschweigend
 * bestehen zu lassen, ist der Wert hier ungueltig — dieselbe Entscheidung wie
 * in der SQL-Funktion.
 */

const TAG_MS = 86_400_000;

/** Untergrenze: PostgreSQL kennt kein Jahr 0. Siehe Dateikopf. */
const MIN_ISO_JAHR = 1;
/** Obergrenze: vierstelliges Jahr im Schluesselformat. */
const MAX_ISO_JAHR = 9999;

const SCHLUESSEL_MUSTER = /^(\d{4})-W(\d{2})$/;

/** Eine ISO-Woche, wie sie aus einem gueltigen Schluessel hervorgeht. */
export interface IsoWeek {
  readonly isoYear: number;
  /** 1–53. */
  readonly isoWeek: number;
}

/**
 * UTC-Mitternacht ohne die 1900-Umdeutung kleiner Jahreszahlen.
 *
 * `new Date(Date.UTC(50, 0, 1))` ergibt 1950. `setUTCFullYear(50, 0, 1)` ergibt
 * das Jahr 50. Der Unterschied ist der Grund, warum hier nicht der bequemere
 * Weg steht.
 */
function utcMitternacht(jahr: number, monat1bis12: number, tag: number): number {
  const d = new Date(0);
  d.setUTCFullYear(jahr, monat1bis12 - 1, tag);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** Wochentag in ISO-Zaehlung: 1 = Montag … 7 = Sonntag. */
function isoWochentag(utcMs: number): number {
  return ((new Date(utcMs).getUTCDay() + 6) % 7) + 1;
}

function istSchaltjahr(jahr: number): boolean {
  return (jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0;
}

/**
 * Wie viele ISO-Wochen ein Jahr hat.
 *
 * Genau dann 53, wenn der 1. Januar ein Donnerstag ist, oder wenn es ein
 * Schaltjahr ist und der 1. Januar ein Mittwoch. Beides folgt aus der
 * Donnerstagsregel: Woche 1 ist die Woche mit dem ersten Donnerstag des Jahres.
 */
export function isoWochenImJahr(jahr: number): 52 | 53 {
  // Bereich pruefen, obwohl die Funktion intern nur von `parseIsoWeekKey` nach
  // dessen eigener Pruefung gerufen wird: sie ist oeffentlich exportiert, und
  // ein Aufrufer mit `jahr = 0` bekaeme sonst eine Antwort ueber einen
  // Kalender, den PostgreSQL nicht kennt. Eine stille Zahl waere schlimmer als
  // ein Fehler.
  if (!Number.isInteger(jahr) || jahr < MIN_ISO_JAHR || jahr > MAX_ISO_JAHR) {
    throw new RangeError(
      `isoWochenImJahr: Jahr ${jahr} liegt ausserhalb von ${MIN_ISO_JAHR}-${MAX_ISO_JAHR}.`,
    );
  }
  const jan1 = isoWochentag(utcMitternacht(jahr, 1, 1));
  if (jan1 === 4) return 53;
  if (jan1 === 3 && istSchaltjahr(jahr)) return 53;
  return 52;
}

/** UTC-Mitternacht des Montags einer ISO-Woche. */
function montagDerIsoWoche(isoYear: number, isoWeek: number): number {
  // Der 4. Januar liegt per Definition immer in Woche 1.
  const jan4 = utcMitternacht(isoYear, 1, 4);
  const montagWoche1 = jan4 - (isoWochentag(jan4) - 1) * TAG_MS;
  return montagWoche1 + (isoWeek - 1) * 7 * TAG_MS;
}

/** ISO-Jahr und -Woche eines UTC-Zeitpunkts. Donnerstag entscheidet das Jahr. */
function isoWocheVonUtc(utcMs: number): IsoWeek {
  const donnerstag = utcMs + (4 - isoWochentag(utcMs)) * TAG_MS;
  const isoYear = new Date(donnerstag).getUTCFullYear();
  const jan4 = utcMitternacht(isoYear, 1, 4);
  const montagWoche1 = jan4 - (isoWochentag(jan4) - 1) * TAG_MS;
  const isoWeek = Math.round((donnerstag - montagWoche1) / (7 * TAG_MS)) + 1;
  return { isoYear, isoWeek };
}

export type IsoWeekKeyResult =
  | { readonly ok: true; readonly week: IsoWeek }
  | { readonly ok: false; readonly reason: IsoWeekKeyProblem };

export const ISO_WEEK_KEY_PROBLEMS = [
  /** Passt nicht auf `YYYY-Www`. */
  "MALFORMED",
  /** Jahr ausserhalb der auf beiden Seiten darstellbaren Spanne. */
  "YEAR_OUT_OF_RANGE",
  /** Woche ausserhalb 01–53. */
  "WEEK_OUT_OF_RANGE",
  /** Woche 53 in einem Jahr, das nur 52 hat. */
  "WEEK_53_NOT_IN_YEAR",
  /** Rueckrechnung ergibt einen anderen Schluessel. */
  "ROUND_TRIP_MISMATCH",
] as const;

export type IsoWeekKeyProblem = (typeof ISO_WEEK_KEY_PROBLEMS)[number];

/**
 * Prueft einen Wochenschluessel vollstaendig und gibt die Woche zurueck.
 *
 * Die Rueckrechnung ist kein Zierrat: sie faengt jeden Fehler in der
 * Jahresgrenzenrechnung, den ein reiner Bereichstest nicht sieht. Wenn der aus
 * dem Schluessel berechnete Montag nicht wieder auf denselben Schluessel
 * fuehrt, stimmt die Rechnung nicht — unabhaengig davon, ob Jahr und Woche
 * einzeln plausibel aussehen.
 */
export function parseIsoWeekKey(kandidat: string): IsoWeekKeyResult {
  const treffer = SCHLUESSEL_MUSTER.exec(kandidat);
  if (treffer === null) return { ok: false, reason: "MALFORMED" };

  const isoYear = Number(treffer[1]);
  const isoWeek = Number(treffer[2]);

  if (isoYear < MIN_ISO_JAHR || isoYear > MAX_ISO_JAHR) {
    return { ok: false, reason: "YEAR_OUT_OF_RANGE" };
  }
  if (isoWeek < 1 || isoWeek > 53) {
    return { ok: false, reason: "WEEK_OUT_OF_RANGE" };
  }
  // Diese Pruefung ist REDUNDANT zur Rueckrechnung weiter unten, und das ist
  // Absicht — aber es war nicht geplant, sondern gemessen. Die Gegenmutation zu
  // EYT-88 hat sie entfernt, und die Tests blieben gruen: die Rueckrechnung
  // faengt denselben Fall, weil der Montag einer nicht existenten 53. Woche in
  // die erste Woche des Folgejahres faellt.
  //
  // Sie bleibt trotzdem stehen, aus einem Grund: sie liefert
  // `WEEK_53_NOT_IN_YEAR` statt `ROUND_TRIP_MISMATCH`. Der erste Wert sagt einem
  // Aufrufer, WAS falsch ist; der zweite sagt nur, dass die Rechnung nicht
  // aufgeht. Wer sie entfernt, verliert keine Sicherheit, aber eine Diagnose.
  if (isoWeek === 53 && isoWochenImJahr(isoYear) === 52) {
    return { ok: false, reason: "WEEK_53_NOT_IN_YEAR" };
  }

  const zurueck = isoWocheVonUtc(montagDerIsoWoche(isoYear, isoWeek));
  if (zurueck.isoYear !== isoYear || zurueck.isoWeek !== isoWeek) {
    return { ok: false, reason: "ROUND_TRIP_MISMATCH" };
  }

  return { ok: true, week: { isoYear, isoWeek } };
}

/** Kurzform fuer Stellen, die nur ja oder nein brauchen. */
export function isValidIsoWeekKey(kandidat: string): boolean {
  return parseIsoWeekKey(kandidat).ok;
}

/**
 * Formatiert eine ISO-Woche als Schluessel. Gegenstueck zu {@link parseIsoWeekKey}.
 *
 * Prueft die Eingabe, statt ihr zu vertrauen. `IsoWeek` ist ein reines
 * Interface — TypeScript haelt niemanden davon ab, `{ isoYear: 2025, isoWeek:
 * 53 }` zusammenzubauen, und die Funktion haette daraus klaglos `2025-W53`
 * erzeugt: einen Schluessel, den jede Pruefung dieses Moduls ablehnt. Eine
 * Formatierungsfunktion, die ungueltige Werte erzeugt, ist ein Leck in genau
 * der Grenze, die EYT-88 zieht.
 *
 * @throws {RangeError} wenn die Woche in ihrem ISO-Jahr nicht existiert.
 */
export function formatIsoWeekKey(week: IsoWeek): string {
  const kandidat = `${String(week.isoYear).padStart(4, "0")}-W${String(week.isoWeek).padStart(2, "0")}`;
  const geprueft = parseIsoWeekKey(kandidat);
  if (!geprueft.ok) {
    throw new RangeError(
      `formatIsoWeekKey: ${kandidat} bezeichnet keine reale ISO-Woche (${geprueft.reason}).`,
    );
  }
  return kandidat;
}
