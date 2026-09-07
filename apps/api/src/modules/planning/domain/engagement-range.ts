/**
 * Einsatzzeitraum als reine Kalenderregel (EYT-120, D-003/D-005/D-006).
 *
 * ## Was hier steht — und was mit der Human-PO-Entscheidung vom 06.09.2026 wegfiel
 *
 * Der Einsatz besitzt lokale GESCHAEFTSDATEN als Grenzen, keine Uhrzeiten
 * (Confluence 49119274 D-003, `ENGAGEMENT_CLOCK_TIMES = NOT_REQUIRED`). Damit gibt es
 * keine Einsatzgrenze mehr, gegen die eine Arbeitszeit verstossen koennte, und keine
 * zeitgenaue Vergangenheitsregel. Entfallen sind deshalb `resolveEngagementBounds`,
 * `workingIntervalWithinBounds` und die Problemarten `ENGAGEMENT_START_IN_PAST` und
 * `ENGAGEMENT_END_NOT_AFTER_START` — die Datumsordnung `endDate >= startDate` gehoert
 * jetzt an die Kommandogrenze im Vertrag.
 *
 * Eine datumsgenaue Nachfolgeregel fuer "nicht in der Vergangenheit" wird hier NICHT
 * erfunden: die aeltere Formulierung war zeitgenau, und eine neue binaere Tagesregel
 * ist in den aktuellen EYT-120-Akzeptanzkriterien nicht entschieden
 * (`HUMAN_INPUT_REQUIRED`).
 *
 * Geblieben sind {@link resolveLocalDateTime} und {@link resolveWorkingInterval}: eine
 * OPTIONAL mitgegebene geplante Tagesarbeitszeit ist eine lokale Wanduhrzeit, die der
 * Server in der Organisationszeitzone aufloesen muss — an einer Sommerzeitgrenze
 * existiert sie nicht oder zweimal, und beides wird BENANNT, nie geraten. Es gibt hier
 * keine Funktion, die eine Arbeitszeit an eine Grenze anpasst: Clipping ist verboten.
 *
 * ## Warum {@link deriveEffectiveWorkdays} hier ein zweites Mal steht
 *
 * Dieselbe Lage wie bei der ISO-Wochenregel (`iso-week-parity.test.ts`):
 * `@easytree/contracts` ist transport-only und darf `@easytree/domain` nicht importieren,
 * die Kommandogrenze braucht die Regel aber selbst, um einen leeren Einsatz abzulehnen.
 * Zwei Fassungen sind deshalb unvermeidlich; die Klammer ist der Paritaetstest in
 * `apps/api/test/planning-engagement-range.test.ts`, denn nur `apps/api` sieht beide
 * Pakete.
 *
 * Die beiden Fassungen rechnen ABSICHTLICH verschieden: der Vertrag ueber UTC-Mitternacht
 * und `getUTCDay`, diese Fassung ueber reine Ganzzahlarithmetik mit `dayAfter` und der
 * Kongruenzformel von Sakamoto. Eine gemeinsame Fehlannahme faellt dadurch auf, statt sich
 * in beiden Kopien gleich zu verstecken. Kalendertage werden hier ueberhaupt nicht in
 * Zeitpunkte gewandelt — dieselbe Haltung wie `local-business-date.ts` (V3): keine
 * Zeitachse, wo eine Kalenderachse gemeint ist. Damit kennt diese Rechnung weder
 * Sommerzeit noch eine +24h-Schleife.
 */
import {
  compareLocalBusinessDate,
  dayAfter,
  utcInstantOfLocalWallTime,
  type IanaTimeZone,
  type LocalBusinessDate,
} from "@easytree/domain";

export interface LocalDateTimeInput {
  readonly date: string; // JJJJ-MM-TT, vertraglich geprueft
  readonly time: string; // HH:MM, vertraglich geprueft
}

export type EngagementRangeProblem =
  | { readonly kind: "LOCAL_TIME_NONEXISTENT"; readonly feld: string }
  | { readonly kind: "LOCAL_TIME_AMBIGUOUS"; readonly feld: string };

type Result<T> =
  ({ readonly ok: true } & T) | { readonly ok: false; readonly problem: EngagementRangeProblem };

function wallTimeParts(value: LocalDateTimeInput): {
  date: { year: number; month: number; day: number };
  hour: number;
  minute: number;
} {
  const [y, m, d] = value.date.split("-").map(Number);
  const [h, min] = value.time.split(":").map(Number);
  if ([y, m, d, h, min].some((n) => n === undefined || Number.isNaN(n))) {
    throw new Error("EYT-120: unvertragliche lokale Zeit erreichte die Domain.");
  }
  return {
    date: { year: y as number, month: m as number, day: d as number },
    hour: h as number,
    minute: min as number,
  };
}

/** Wanduhrzeit -> Instant, mit benanntem Feld im Fehlerfall. */
export function resolveLocalDateTime(
  value: LocalDateTimeInput,
  zone: IanaTimeZone,
  feld: string,
): Result<{ readonly instant: Date }> {
  const r = utcInstantOfLocalWallTime(wallTimeParts(value), zone);
  if (!r.ok) {
    return {
      ok: false,
      problem: {
        kind:
          r.error === "AMBIGUOUS_LOCAL_TIME" ? "LOCAL_TIME_AMBIGUOUS" : "LOCAL_TIME_NONEXISTENT",
        feld,
      },
    };
  }
  return { ok: true, instant: r.instant };
}

export interface WorkingInterval {
  readonly start: Date;
  readonly end: Date;
}

/**
 * OPTIONAL geplante Arbeitszeit eines Tages -> halb-offenes Instant-Intervall;
 * Sommerzeit faellt geschlossen, je Grenze benannt.
 *
 * Das Ergebnis wird gegen KEINE Einsatzgrenze geprueft — es gibt keine (D-003). Die
 * Arbeitszeit liegt innerhalb ihres lokalen Kalendertages, und das ist alles, was der
 * Einsatz ueber sie sagt.
 */
export function resolveWorkingInterval(
  localDate: string,
  workingTime: { readonly from: string; readonly to: string },
  zone: IanaTimeZone,
): Result<{ readonly interval: WorkingInterval }> {
  const von = resolveLocalDateTime(
    { date: localDate, time: workingTime.from },
    zone,
    `workingTime.from@${localDate}`,
  );
  if (!von.ok) return von;
  const bis = resolveLocalDateTime(
    { date: localDate, time: workingTime.to },
    zone,
    `workingTime.to@${localDate}`,
  );
  if (!bis.ok) return bis;
  return { ok: true, interval: { start: von.instant, end: bis.instant } };
}

/** Optionaler Kalender-Override (D-005). Beide Listen sind Mengen, keine Folgen. */
export interface EngagementCalendarOverride {
  /** Ausdruecklich aufgenommene Tage — typischerweise Wochenenden. */
  readonly include: readonly LocalBusinessDate[];
  /** Abgewaehlte Vorgabetage. */
  readonly exclude: readonly LocalBusinessDate[];
}

const TAGE_JE_MONAT = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function istSchaltjahr(jahr: number): boolean {
  return (jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0;
}

/**
 * Ist der Wert ein Tag, den der gregorianische Kalender kennt?
 *
 * `LocalBusinessDate` ist ein offenes Interface mit der Zusage „1–31"; der 30. Februar
 * haelt sie ein und ist trotzdem kein Kalendertag. `dayAfter` normalisiert ihn
 * ausdruecklich still — die Grenze zu ziehen ist Aufgabe des Aufrufers, und dieser hier
 * zieht sie, statt einen Tag aufzuzaehlen, den es nicht gibt.
 */
function istRealerKalendertag(datum: LocalBusinessDate): boolean {
  if (!Number.isInteger(datum.year) || datum.year < 1) return false;
  if (!Number.isInteger(datum.month) || datum.month < 1 || datum.month > 12) return false;
  if (!Number.isInteger(datum.day) || datum.day < 1) return false;
  const laenge = TAGE_JE_MONAT[datum.month - 1];
  if (laenge === undefined) return false;
  const tage = datum.month === 2 && istSchaltjahr(datum.year) ? 29 : laenge;
  return datum.day <= tage;
}

/** Verschiebungen der Kongruenzformel von Sakamoto, je Monat. */
const SAKAMOTO = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const;

/**
 * Wochentag eines Kalendertages, `0` = Sonntag … `6` = Samstag.
 *
 * Reine Ganzzahlarithmetik ueber die Kongruenzformel von Sakamoto — bewusst NICHT ueber
 * `Date`: die Vertragsfassung rechnet ueber `getUTCDay`, und zwei Fassungen mit demselben
 * Rechenweg pruefen einander nicht. Gueltig fuer den proleptisch gregorianischen Kalender
 * ab Jahr 1, was {@link istRealerKalendertag} zusichert.
 */
function wochentag(datum: LocalBusinessDate): number {
  const verschiebung = SAKAMOTO[datum.month - 1];
  if (verschiebung === undefined) {
    throw new RangeError(`Kalendermonat ausserhalb 1..12: ${datum.month}`);
  }
  const jahr = datum.month < 3 ? datum.year - 1 : datum.year;
  return (
    (jahr +
      Math.floor(jahr / 4) -
      Math.floor(jahr / 100) +
      Math.floor(jahr / 400) +
      verschiebung +
      datum.day) %
    7
  );
}

/** Sortierbarer Schluessel eines Kalendertages. Ganzzahl, kein formatierter String. */
function schluessel(datum: LocalBusinessDate): number {
  return datum.year * 10_000 + datum.month * 100 + datum.day;
}

const ERSTER_WERKTAG = 1; // Montag
const LETZTER_WERKTAG = 5; // Freitag

/**
 * Die effektiven Arbeitstage eines Einsatzes im aktuellen Planungsumfang (D-005).
 *
 * Formel, in dieser Reihenfolge:
 *
 *     effektiv = (alle Mo–Fr in [startDate, rangeEnd]) − exclude + include
 *
 * @param startDate lokaler Beginn, Pflicht.
 * @param rangeEnd das aktuelle Umfangsende: das fachliche `endDate`, sonst der
 * `planningHorizonDate`. Der Horizont ist NICHT das fachliche Ende (D-006) — welcher der
 * beiden Werte hier ankommt, entscheidet der Aufrufer.
 * @param override optionaler Kalender. Tage ausserhalb `[startDate, rangeEnd]` werden
 * ignoriert, damit diese Rechnung nie einen Tag ausserhalb des Umfangs erzeugt.
 * @returns aufsteigend sortierte, duplikatfreie Kalendertage.
 * @throws {RangeError} wenn ein Wert kein realer Kalendertag ist oder `rangeEnd` vor
 * `startDate` liegt. Eine leere Liste waere hier die schlechtere Antwort: sie saehe aus
 * wie "keine Arbeitstage" und verdeckte einen vertauschten Zeitraum.
 */
export function deriveEffectiveWorkdays(
  startDate: LocalBusinessDate,
  rangeEnd: LocalBusinessDate,
  override?: EngagementCalendarOverride,
): LocalBusinessDate[] {
  for (const [feld, wert] of [
    ["startDate", startDate],
    ["rangeEnd", rangeEnd],
  ] as const) {
    if (!istRealerKalendertag(wert)) {
      throw new RangeError(
        `${feld}: ${wert.year}-${wert.month}-${wert.day} ist kein realer Kalendertag.`,
      );
    }
  }
  if (compareLocalBusinessDate(rangeEnd, startDate) < 0) {
    throw new RangeError("deriveEffectiveWorkdays: rangeEnd liegt vor startDate — kein Zeitraum.");
  }

  const effektiv = new Map<number, LocalBusinessDate>();
  // Weitergezaehlt ueber `dayAfter`, also ueber Kalenderfelder: Monats-, Jahres- und
  // Schaltjahresgrenze sind dort entschieden und muessen hier nicht erneut geraten werden.
  let laufend: LocalBusinessDate = startDate;
  while (compareLocalBusinessDate(laufend, rangeEnd) <= 0) {
    const tag = wochentag(laufend);
    if (tag >= ERSTER_WERKTAG && tag <= LETZTER_WERKTAG) {
      effektiv.set(schluessel(laufend), laufend);
    }
    laufend = dayAfter(laufend);
  }

  if (override !== undefined) {
    const imUmfang = (datum: LocalBusinessDate, feld: string): boolean => {
      if (!istRealerKalendertag(datum)) {
        throw new RangeError(
          `${feld}: ${datum.year}-${datum.month}-${datum.day} ist kein realer Kalendertag.`,
        );
      }
      return (
        compareLocalBusinessDate(datum, startDate) >= 0 &&
        compareLocalBusinessDate(datum, rangeEnd) <= 0
      );
    };
    // Erst abwaehlen, dann aufnehmen — die Formel aus D-005 in dieser Reihenfolge.
    for (const datum of override.exclude) {
      if (imUmfang(datum, "calendar.exclude")) effektiv.delete(schluessel(datum));
    }
    for (const datum of override.include) {
      if (imUmfang(datum, "calendar.include")) effektiv.set(schluessel(datum), datum);
    }
  }

  return [...effektiv.entries()].sort(([a], [b]) => a - b).map(([, datum]) => datum);
}
