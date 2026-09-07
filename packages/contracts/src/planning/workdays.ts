/**
 * Automatische Werktagsableitung eines Einsatzes (EYT-120, D-005/D-006).
 *
 * ## Was diese Datei entscheidet
 *
 * Aus `startDate` und dem aktuellen Umfangsende — dem fachlichen `endDate` ODER dem
 * `planningHorizonDate` bei offenem Ende — entstehen die geplanten Arbeitstage:
 * Montag bis Freitag im INKLUSIVEN lokalen Zeitraum, ohne dass jemand einen Kalender
 * anfassen muss (`DEFAULT_WORKDAYS = MONDAY_TO_FRIDAY_AUTO`, Confluence 49119274 D-005).
 * Ein optionaler Override waehlt Vorgabetage ab und nimmt Wochenenden ausdruecklich auf.
 *
 * Formel, in dieser Reihenfolge:
 *
 *     effektiv = (alle Mo–Fr in [startDate, umfangsEnde]) − exclude + include
 *
 * Mengensemantik: Reihenfolge und Wiederholung innerhalb der Override-Listen aendern das
 * Ergebnis nicht, die Ausgabe ist aufsteigend sortiert und duplikatfrei. Derselbe Tag in
 * BEIDEN Listen ist mehrdeutig; die Entscheidung darueber faellt an der Kommandogrenze
 * (`CreateEngagementCommandSchema`), nicht hier — diese Rechnung erfindet keine Rangfolge,
 * sie folgt nur der Formel.
 *
 * ## Warum die Regel hier und nicht in `@easytree/domain` liegt
 *
 * Dieselbe Lage wie bei `iso-week.ts`: `@easytree/contracts` ist transport-only und fuehrt
 * `@easytree/domain` bewusst weder als Abhaengigkeit noch als Import (Architekturregel
 * `contracts-transport-only`). Die Kommandogrenze muss aber selbst wissen, ob ein Einsatz
 * ueberhaupt einen Arbeitstag ergibt — sonst entstuende ein leerer Einsatz, den
 * `EMPTY_ENGAGEMENT_NORMAL_FLOW = NOT_REQUIRED` ausschliesst.
 *
 * Damit daraus keine zweite, abweichende Werktagsregel wird, gibt es eine Domainfassung in
 * `apps/api/src/modules/planning/domain/engagement-range.ts` und einen Paritaetstest in
 * `apps/api/test/planning-engagement-range.test.ts` — er liegt dort, weil nur `apps/api`
 * beide Pakete sieht. Die beiden Fassungen rechnen ABSICHTLICH verschieden (hier ueber
 * UTC-Mitternacht, dort ueber reine Ganzzahlarithmetik mit `dayAfter`); eine gemeinsame
 * Fehlannahme faellt dadurch auf.
 *
 * ## Determinismus
 *
 * Keine Zeitzone, kein Locale, kein `Date.parse`, kein `now()`. Kalendertage werden nicht in
 * Zeitpunkte einer Zone umgerechnet, deshalb kennt diese Rechnung keine Sommerzeit — eine
 * Aufzaehlung ueber `+24h` auf einem Instant kippte an der Umstellung um einen Tag. Weiter
 * gezaehlt wird ueber `setUTCDate`, also ueber Kalenderfelder, nicht ueber Millisekunden.
 *
 * `Date.UTC(jahr, 0, 1)` bildet Jahre 0 bis 99 auf 1900+jahr ab — eine stille Verschiebung
 * um 1900 Jahre. Deshalb wird hier wie in `iso-week.ts` ausschliesslich ueber
 * `setUTCFullYear` gerechnet, das diese Umdeutung nicht kennt.
 */

const LOKALES_DATUM_MUSTER = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Untergrenze wie in `iso-week.ts` und `LocalDateSchema`: PostgreSQL kennt kein Jahr 0. */
const MIN_JAHR = 1;

/** Montag bis Freitag in der Zaehlung von `getUTCDay` (0 = Sonntag). */
const ERSTER_WERKTAG = 1;
const LETZTER_WERKTAG = 5;

/** Optionaler Kalender-Override. Beide Listen sind Mengen, keine Folgen. */
export interface EngagementCalendarOverrideInput {
  /** Ausdruecklich aufgenommene Tage — typischerweise Wochenenden. */
  readonly include: readonly string[];
  /** Abgewaehlte Vorgabetage. */
  readonly exclude: readonly string[];
}

/**
 * UTC-Mitternacht ohne die 1900-Umdeutung kleiner Jahreszahlen.
 *
 * `new Date(Date.UTC(50, 0, 1))` ergibt 1950. `setUTCFullYear(50, 0, 1)` ergibt das Jahr 50.
 */
function utcMitternacht(jahr: number, monat1bis12: number, tag: number): number {
  const d = new Date(0);
  d.setUTCFullYear(jahr, monat1bis12 - 1, tag);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Lokaler Kalendertag -> UTC-Mitternacht, mit vollstaendiger Pruefung.
 *
 * @throws {RangeError} bei falscher Form, Jahr 0 oder einem Tag, den es nicht gibt.
 * Dieselbe Haltung wie {@link import("./iso-week.js").isoWeekKeyOf}: eine Funktion, die aus
 * `2027-02-29` still den 1. Maerz macht, waere ein Leck in genau der Grenze, die sie zieht.
 */
function utcMitternachtVon(localDate: string, feld: string): number {
  const treffer = LOKALES_DATUM_MUSTER.exec(localDate);
  if (treffer === null) {
    throw new RangeError(`${feld}: ${localDate} ist kein lokales Datum im Format JJJJ-MM-TT.`);
  }
  const jahr = Number(treffer[1]);
  const monat = Number(treffer[2]);
  const tag = Number(treffer[3]);
  if (jahr < MIN_JAHR) {
    throw new RangeError(`${feld}: das Jahr 0000 gibt es nicht — Jahr >= ${MIN_JAHR}.`);
  }
  const utcMs = utcMitternacht(jahr, monat, tag);
  // Rueckweg: `setUTCFullYear` normalisiert 2027-02-29 still zum 1. Maerz.
  const zurueck = new Date(utcMs);
  if (
    zurueck.getUTCFullYear() !== jahr ||
    zurueck.getUTCMonth() !== monat - 1 ||
    zurueck.getUTCDate() !== tag
  ) {
    throw new RangeError(`${feld}: ${localDate} ist kein realer Kalendertag.`);
  }
  return utcMs;
}

function alsLokalesDatum(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/**
 * Die effektiven Arbeitstage eines Einsatzes im aktuellen Planungsumfang.
 *
 * @param startDate lokaler Beginn `JJJJ-MM-TT`, Pflicht.
 * @param rangeEnd das aktuelle Umfangsende: `endDate` bei bekanntem Ende, sonst
 * `planningHorizonDate`. Der Horizont ist NICHT das fachliche Ende (D-006) — welcher der
 * beiden Werte hier ankommt, entscheidet der Aufrufer.
 * @param override optionaler Kalender. Tage ausserhalb `[startDate, rangeEnd]` werden
 * ignoriert, damit diese Rechnung nie einen Tag ausserhalb des Umfangs erzeugt; die
 * Kommandogrenze lehnt sie zusaetzlich ab, statt sie still zu schlucken.
 * @returns aufsteigend sortierte, duplikatfreie lokale Kalendertage.
 * @throws {RangeError} wenn ein Wert kein realer Kalendertag ist oder `rangeEnd` vor
 * `startDate` liegt. Eine leere Liste waere hier die schlechtere Antwort: sie sieht aus wie
 * "keine Arbeitstage" und verdeckte einen vertauschten Zeitraum.
 */
export function deriveEffectiveWorkdays(
  startDate: string,
  rangeEnd: string,
  override?: EngagementCalendarOverrideInput,
): string[] {
  const vonMs = utcMitternachtVon(startDate, "startDate");
  const bisMs = utcMitternachtVon(rangeEnd, "rangeEnd");
  if (bisMs < vonMs) {
    throw new RangeError(
      `deriveEffectiveWorkdays: ${rangeEnd} liegt vor ${startDate} — kein Zeitraum.`,
    );
  }

  const effektiv = new Set<string>();
  // Weitergezaehlt ueber Kalenderfelder (`setUTCDate`), nicht ueber Millisekunden:
  // eine +24h-Schleife ist genau die Form, die an einer Zeitumstellung kippt.
  const laufend = new Date(vonMs);
  while (laufend.getTime() <= bisMs) {
    const wochentag = laufend.getUTCDay();
    if (wochentag >= ERSTER_WERKTAG && wochentag <= LETZTER_WERKTAG) {
      effektiv.add(alsLokalesDatum(laufend.getTime()));
    }
    laufend.setUTCDate(laufend.getUTCDate() + 1);
  }

  if (override !== undefined) {
    const imUmfang = (tag: string, feld: string): boolean => {
      const ms = utcMitternachtVon(tag, feld);
      return ms >= vonMs && ms <= bisMs;
    };
    // Erst abwaehlen, dann aufnehmen — die Formel aus D-005 in dieser Reihenfolge.
    for (const tag of override.exclude) {
      if (imUmfang(tag, "calendar.exclude")) effektiv.delete(tag);
    }
    for (const tag of override.include) {
      if (imUmfang(tag, "calendar.include")) effektiv.add(tag);
    }
  }

  // `sort()` ohne Vergleichsfunktion ordnet ueber Code-Units. Bei `JJJJ-MM-TT` ist das
  // chronologisch — und anders als `localeCompare` haengt es nicht an der Umgebung.
  return [...effektiv].sort();
}
