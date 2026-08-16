/**
 * Die EINZIGE Umrechnung zwischen der halboffenen Datenbank und der
 * einschliessenden Fachwelt (EYT-109 D1).
 *
 * ## Warum es diese Datei gibt
 *
 * Die Datenbank fuehrt `[valid_from, valid_to)` (Migration 0013,
 * `daterange(..., '[)')`), der abgenommene Vertrag EYT-95 fuehrt
 * `[validFrom, validTo]` einschliessend. Vor EYT-109 D1 reichte das Repository
 * `valid_to` roh nach oben durch, und die Oberflaeche zeigte unter „Gueltig
 * bis" einen Tag, an dem der Satz schon nicht mehr galt.
 *
 * ## Warum sie in `infrastructure/` liegt und nicht in `domain/`
 *
 * Ihr Existenzgrund ist eine Eigenschaft der SPEICHERUNG, nicht der
 * Fachlichkeit: ohne den `daterange`-Constraint aus Migration 0013 gaebe es sie
 * nicht. In `domain/` waere sie ein Datenbankbegriff in der innersten Schicht.
 * Der Architekturtest erzwingt das ohnehin in der Gegenrichtung —
 * `domain-allowlist` laesst Domaenencode nicht nach `infrastructure/` greifen,
 * womit ein Leck nach unten strukturell unmoeglich ist.
 *
 * Es gibt genau VIER Aufrufstellen, alle in `rate-repository.pg.ts`; der
 * statische Waechter `rate-boundary-single-site.test.ts` faellt rot, sobald
 * eine fuenfte in `application/` oder `interface/` entsteht.
 *
 * ## Warum `dayBefore`/`dayAfter` und nicht `tag ± 1`
 *
 * Die naheliegende Subtraktion ist am Monats-, Jahres- und Schaltjahresanfang
 * falsch — der 01.08. haette den „0. August" zum Vorgaenger — und fiele dort
 * niemandem auf. `@easytree/domain` rechnet das ohne `Date`, weil V3
 * ausdruecklich verbietet, Kalendertage in Zeitpunkte zu wandeln.
 */
import { dayAfter, dayBefore } from "@easytree/domain";

import { formatLocalDate, parseLocalDate } from "../domain/local-business-date-format";

/** DB-exklusives Ende -> letzter wirksamer Tag. `null` bleibt unbegrenzt. */
export function dbEndeZuValidTo(dbValidTo: string | null): string | null {
  return dbValidTo === null ? null : formatLocalDate(dayBefore(parseLocalDate(dbValidTo)));
}

/** Letzter wirksamer Tag -> DB-exklusives Ende. `null` bleibt unbegrenzt. */
export function validToZuDbEnde(validTo: string | null): string | null {
  return validTo === null ? null : formatLocalDate(dayAfter(parseLocalDate(validTo)));
}
