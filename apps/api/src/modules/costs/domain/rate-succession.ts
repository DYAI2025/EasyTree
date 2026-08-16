/**
 * Darf dieser offene Stundensatz jetzt abgeloest werden? (EYT-108, Option A+)
 *
 * Rein, ohne Datenbank, ohne Nest. Die Funktion entscheidet das OB und liefert
 * den einen Wert, der sich am Vorgaenger aendern darf: seinen Endtag. Das WIE —
 * Sperre, Transaktion, Rechte — gehoert in den Adapter und wird dort gegen eine
 * echte Datenbank gemessen.
 *
 * ## Warum ueberhaupt eine eigene Regel
 *
 * Die Datenbank verhindert Ueberlappung (EXCLUDE, Migration 0013) und der
 * Adapter setzt `valid_to` nur, wenn es NULL ist. Beides sind aber
 * Tiefenverteidigung und liefern als Antwort einen Constraint-Fehler. Der
 * Aufrufer braucht eine fachliche Aussage: `STALE_VERSION` heisst "lade neu",
 * `NACHFOLGER_NICHT_SPAETER` heisst "waehle ein anderes Datum". Ein
 * 23P01-Fehlercode sagt beides nicht.
 *
 * ## Reihenfolge der Pruefungen ist Teil des Vertrags
 *
 * Der Name `STALE_ACTIVE_VERSION` ist bewusst der INTERNE aus
 * `rate-repository.port.ts`, nicht der Wire-Name `STALE_VERSION`. Der
 * Controller bildet den einen auf den anderen ab (`problemFor`), und zwei
 * verschiedene interne Namen fuer dieselbe Sache waeren genau die Doppelung,
 * die spaeter jemand falsch abbildet.
 *
 * `expectedActiveVersionId` wird ZUERST geprueft. Sind mehrere Regeln
 * verletzt, arbeitet der Aufrufer auf einer veralteten Ansicht — jede andere
 * Meldung liesse ihn glauben, er kenne die richtige Version.
 */
import { dayBefore } from "@easytree/domain";

import { formatLocalDate, parseLocalDate } from "./local-business-date-format";
import type { RateVersionRecord } from "./rate-version";

export const RATE_SUCCESSION_PROBLEMS = [
  "STALE_ACTIVE_VERSION",
  "VORGAENGER_BEREITS_GESCHLOSSEN",
  "NACHFOLGER_NICHT_SPAETER",
  "FREMDER_MITARBEITER",
] as const;
export type RateSuccessionProblem = (typeof RATE_SUCCESSION_PROBLEMS)[number];

/** Der gewuenschte Nachfolger, so weit er vor dem Anlegen bekannt ist. */
export interface RateSuccessorRequest {
  readonly employeeId: string;
  /** Lokales Geschaeftsdatum JJJJ-MM-TT. */
  readonly validFrom: string;
}

export interface RateSuccessionCommand {
  readonly vorgaenger: RateVersionRecord;
  readonly nachfolger: RateSuccessorRequest;
  /**
   * Die Version, die der Aufrufer fuer die aktive haelt.
   *
   * Optimistische Nebenlaeufigkeit: ohne diese Erwartung wuerden zwei
   * gleichzeitige Bearbeiter beide "den offenen Satz" abloesen, und der
   * zweite ueberschriebe die Absicht des ersten, ohne es zu merken.
   */
  readonly expectedActiveVersionId: string;
}

export type RateSuccessionResult =
  | { readonly ok: true; readonly validToDesVorgaengers: string }
  | { readonly ok: false; readonly problem: RateSuccessionProblem };

export function pruefeAbloesung(befehl: RateSuccessionCommand): RateSuccessionResult {
  const { vorgaenger, nachfolger, expectedActiveVersionId } = befehl;

  if (vorgaenger.id !== expectedActiveVersionId) {
    return { ok: false, problem: "STALE_ACTIVE_VERSION" };
  }
  if (vorgaenger.validTo !== null) {
    // Einmaligkeit: eine geschlossene Version wird nie wieder angefasst.
    return { ok: false, problem: "VORGAENGER_BEREITS_GESCHLOSSEN" };
  }
  if (nachfolger.employeeId !== vorgaenger.employeeId) {
    return { ok: false, problem: "FREMDER_MITARBEITER" };
  }
  // Zeichenkettenvergleich, kein `Date`: `JJJJ-MM-TT` ist lexikografisch UND
  // chronologisch sortiert, und ein Kalendertag darf hier nicht zu einem
  // Zeitpunkt in irgendeiner Zone werden (dieselbe Begruendung wie in
  // `rate-effectivity.ts`).
  if (nachfolger.validFrom <= vorgaenger.validFrom) {
    return { ok: false, problem: "NACHFOLGER_NICHT_SPAETER" };
  }

  // Der Vorgaenger endet am Tag VOR dem Beginn des Nachfolgers: lueckenlos und
  // ueberlappungsfrei unter der einschliessenden Lesart von EYT-95. Nicht frei
  // waehlbar — ein Tag frueher risse eine Luecke, ein Tag spaeter eine
  // Ueberlappung.
  //
  // `dayBefore` ist hier ein KALENDERSCHRITT, keine Datenbankuebersetzung: die
  // Regel kennt nur fachliche Tage. Dass daraus im Adapter wieder
  // `nachfolger.validFrom` als DB-Wert wird, ist die Leistung von
  // `validToZuDbEnde` und nicht die dieser Zeile — und deshalb steht sie hier
  // und nicht dort (EYT-109 D1).
  return {
    ok: true,
    validToDesVorgaengers: formatLocalDate(dayBefore(parseLocalDate(nachfolger.validFrom))),
  };
}
