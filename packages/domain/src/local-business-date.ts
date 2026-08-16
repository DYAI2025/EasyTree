/**
 * Kalenderarithmetik auf {@link LocalBusinessDate} (EYT-95, REQ-004 —
 * Berechnungsvertrag V3).
 *
 * ## Warum das nicht in `planning-week.ts` steht
 *
 * Dort wohnt der Typ, aber jenes Modul beantwortet Kalenderwochen- und
 * Zonenfragen; hier stehen die beiden Primitive, die V3 für Satzgültigkeiten
 * verlangt. Das Muster ist im Paket bereits etabliert — `weekly-capacity.ts`
 * rechnet ebenso auf `PlanningWeek`, ohne den Typ zu besitzen.
 *
 * ## Warum {@link dayAfter} und nicht `23:59:59.999`
 *
 * Fachlich sind `validFrom` und `validTo` beide einschließend; intern
 * normalisiert der Vertrag auf `[validFrom, dayAfter(validTo))`. V3 verbietet
 * die naheliegenden Alternativen ausdrücklich: `23:59:59.999` erzeugen,
 * Kalendertage in UTC-Zeitpunkte wandeln, Sekunden oder Millisekunden vom
 * Folgezeitpunkt abziehen. Alle drei führen eine Zeitachse ein, wo eine
 * Kalenderachse gemeint ist — und damit eine zweite Intervallsemantik neben
 * der von `TimeInterval`. Der Nachfolger eines Kalendertages ist die einzige
 * zulässige Normalisierung.
 *
 * Kalendertage sind hier fachliche Einheiten, keine Zeitpunkte. Deshalb trägt
 * dieses Modul keine Zone: welcher Tag „heute" ist, entscheidet der Aufrufer.
 */

import type { LocalBusinessDate } from "./planning-week.js";

/**
 * Ordnet zwei Kalendertage: negativ, wenn `a` vor `b` liegt, `0` bei
 * Gleichheit, sonst positiv.
 *
 * Trägt jede Grenzentscheidung von V3 — ein Vergleich, der nur den Tag im
 * Monat betrachtet, hält den 31.12. für später als den 01.01. des Folgejahres.
 */
export function compareLocalBusinessDate(a: LocalBusinessDate, b: LocalBusinessDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/** Länge der zwölf Monate im Gemeinjahr. Der Februar wird unten korrigiert. */
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Gregorianische Schaltjahresregel — inklusive der 100er-Ausnahme und ihrer 400er-Ausnahme. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Wirft statt ein Ergebnis zurückzugeben: ein Monat ausserhalb 1..12 ist kein
 * erwarteter Fehlerfall, sondern ein Programmierfehler — dieselbe Entscheidung,
 * die der private Konstruktor von `TimeInterval` trifft. `LocalBusinessDate`
 * trägt bewusst keine Laufzeitvalidierung, deshalb kann sie hier ankommen.
 */
function daysInMonth(year: number, month: number): number {
  const days = DAYS_PER_MONTH[month - 1];
  if (days === undefined) {
    throw new RangeError(`Kalendermonat ausserhalb 1..12: ${month}`);
  }
  return month === 2 && isLeapYear(year) ? 29 : days;
}

/**
 * Der nächste Kalendertag, über Monats-, Jahres- und Schaltjahresgrenze hinweg.
 *
 * Reine Ganzzahlarithmetik, **ohne** `Date`: V3 verbietet ausdrücklich,
 * Kalendertage in UTC-Zeitpunkte zu wandeln. Der Umweg über `Date.UTC` wäre
 * genau das — auch wenn der Zeitpunkt nur vorübergehend entstünde — und würde
 * eine Zeitachse einführen, wo eine Kalenderachse gemeint ist.
 *
 * **Ein ueberzaehliger Tag wird normalisiert, nicht abgewiesen.** `dayAfter({2026, 2, 30})`
 * liefert den 1. Maerz. Das ist bewusst anders als bei einem Monat ausserhalb 1..12, der
 * laut abbricht: der Monat ist strukturell falsch, ein zu hoher Tag dagegen entsteht aus
 * einer Kalenderrechnung und faellt hier auf den naechsten wirklichen Tag. `LocalBusinessDate`
 * ist ein offenes Interface mit der Zusage „1–31"; der 30. Februar haelt sie ein und ist
 * trotzdem kein Kalendertag. Wer diese Eingabe ausschliessen will, tut das an der Grenze, an
 * der das Datum entsteht, nicht hier.
 */
export function dayAfter(date: LocalBusinessDate): LocalBusinessDate {
  if (date.day < daysInMonth(date.year, date.month)) {
    return { year: date.year, month: date.month, day: date.day + 1 };
  }
  if (date.month < 12) {
    return { year: date.year, month: date.month + 1, day: 1 };
  }
  return { year: date.year + 1, month: 1, day: 1 };
}

/**
 * Der vorherige Kalendertag — die sichtbare Naht zwischen zwei
 * Intervallsemantiken (EYT-109).
 *
 * ## Warum es diese Funktion gibt
 *
 * Im Repository leben zwei Lesarten von `validTo` nebeneinander, und beide sind
 * an ihrem Ort richtig. `rate-version.ts` liest sie EINSCHLIESSEND und
 * normalisiert intern mit {@link dayAfter} (V3);
 * `apps/api/src/modules/costs/domain/rate-effectivity.ts` vergleicht HALBOFFEN
 * (`businessDate < validTo`), genau wie der EXCLUDE-Constraint der Migration
 * 0013 die Ueberlappung ausschliesst. Fuer gespeicherte Zeilen entscheidet die
 * Datenbank, also gilt dort die halboffene Lesart.
 *
 * Der Snapshotpfad waehlt deshalb halboffen aus und muss die gewaehlte Zeile
 * danach in eine geprueft einschliessende `HourlyRateVersion` giessen. Diese
 * eine Umrechnung ist `dayBefore`: `validTo_einschliessend = dayBefore(valid_to)`,
 * und `null` bleibt `null`. Als benannte Funktion statt als `tag - 1` an der
 * Aufrufstelle, weil die naheliegende Subtraktion am Monats-, Jahres- und
 * Schaltjahresanfang falsch ist — der 01.08. haette dann den „0. August" zum
 * Vorgaenger — und dort niemandem auffiele. Eine Naht, die man sieht, kann man
 * pruefen.
 *
 * Reine Ganzzahlarithmetik, **ohne** `Date`, aus demselben Grund wie bei
 * {@link dayAfter}: V3 verbietet, Kalendertage in Zeitpunkte zu wandeln.
 *
 * ## Spiegelbild der Entscheidungen von {@link dayAfter}
 *
 * Ein Tag ausserhalb des Kalenders wird **normalisiert, nicht abgewiesen**: wo
 * `dayAfter` einen ueberzaehligen Tag auf den Ersten des Folgemonats schiebt,
 * faellt hier jedes `day <= 1` — also auch `0` oder negativ — auf den letzten
 * Tag des Vormonats. Beide Richtungen bilden dabei mehrere Eingaben auf dasselbe
 * Ergebnis ab (`dayAfter` schon beim 28.02. und beim 30.02. eines Gemeinjahrs);
 * das ist kein Versehen, sondern der Preis dafuer, hier nicht zu urteilen.
 *
 * Ein Monat ausserhalb 1..12 bricht dagegen laut ab. Die Pruefung steht bewusst
 * vor der ersten Verzweigung, obwohl die Monatslaenge dort noch nicht gebraucht
 * wird: ohne sie liefe `dayBefore({ 2026, 13, 5 })` still durch, waehrend
 * `dayAfter` derselben Eingabe abbricht — zwei Nachbarn mit verschiedener
 * Strenge waeren die schlechtere Ueberraschung.
 */
export function dayBefore(date: LocalBusinessDate): LocalBusinessDate {
  // Aufruf nur wegen der Monatspruefung; das Ergebnis wird hier nicht gebraucht.
  daysInMonth(date.year, date.month);
  if (date.day > 1) {
    return { year: date.year, month: date.month, day: date.day - 1 };
  }
  if (date.month > 1) {
    const vormonat = date.month - 1;
    return { year: date.year, month: vormonat, day: daysInMonth(date.year, vormonat) };
  }
  return { year: date.year - 1, month: 12, day: 31 };
}
