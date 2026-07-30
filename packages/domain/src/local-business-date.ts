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

/** Der nächste Kalendertag, über Monats-, Jahres- und Schaltjahresgrenze hinweg. */
export function dayAfter(date: LocalBusinessDate): LocalBusinessDate {
  void date;
  throw new Error("NOT_IMPLEMENTED");
}
