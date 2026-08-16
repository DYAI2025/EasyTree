/**
 * `JJJJ-MM-TT` <-> {@link LocalBusinessDate} — die Textform eines Kalendertages
 * (EYT-109).
 *
 * Bewusst KEINE Aussage ueber Intervallgrenzen: hier steht nichts ueber
 * halboffen oder einschliessend, ueber `valid_to` oder ueber PostgreSQL. Das
 * sind zwei verschiedene Dinge, und sie sind frueher deshalb verwechselt
 * worden, weil sie in derselben Funktion standen. Die Intervallgrenze
 * uebersetzt `infrastructure/rate-interval-boundary.ts`, und nur die.
 *
 * Liegt in `domain/`, weil drei Domaenendateien sie brauchen
 * (`rate-effectivity`, `rate-succession`, `cost-snapshot-assembly`) und
 * `domain-allowlist` Domaenencode verbietet, nach `infrastructure/` zu greifen.
 *
 * `@easytree/domain` exportiert bewusst KEINE solche Funktion:
 * `LocalBusinessDate` ist ein offenes Interface ohne Laufzeitvalidierung, und
 * das Paket sagt dazu ausdruecklich „wer diese Eingabe ausschliessen will, tut
 * das an der Grenze, an der das Datum entsteht" (`local-business-date.ts`).
 * Diese Grenze ist hier: die Zeichenkette kommt aus `date`-Spalten, die
 * PostgreSQL bereits als Kalendertag geprueft hat, oder aus dem
 * `BusinessDateSchema` des Vertrags.
 *
 * Nie ueber `Date`: das machte aus einem Kalendertag einen Zeitpunkt in
 * irgendeiner Zone — genau das verbietet `no-local-time-construction.test.ts`.
 */
import type { LocalBusinessDate } from "@easytree/domain";

export function formatLocalDate(date: LocalBusinessDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${String(date.year).padStart(4, "0")}-${mm}-${dd}`;
}

export function parseLocalDate(iso: string): LocalBusinessDate {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}
