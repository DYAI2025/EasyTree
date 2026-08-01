/**
 * Welche Satzversion gilt an einem Geschaeftstag? (EYT-108, EYT-109)
 *
 * Rein, ohne Datenbank, ohne Zeitzone: die Eingabe ist bereits ein LOKALES
 * Geschaeftsdatum. Diese Datei rechnet keine Zeitzonen um — das ist Aufgabe
 * der Aufrufer (EYT-109), und eine zweite Umrechnung hier waere genau die
 * Doppelung, die `no-local-time-construction` verbietet.
 *
 * ## Halboffenes Intervall
 *
 * `[validFrom, validTo)` — derselbe Vertrag wie der EXCLUDE-Constraint in
 * Migration 0013. Ein nahtloser Anschluss (validTo == naechstes validFrom) ist
 * dadurch moeglich UND eindeutig.
 *
 * ## Warum "mehrdeutig" ein eigener Fall ist
 *
 * Die Datenbank verhindert Ueberlappung. Kaeme trotzdem eine mehrdeutige Menge
 * an (importierte Daten, kuenftig gelockerter Constraint), waere die stille
 * Auswahl der ersten Zeile ein falscher Betrag in einer Rechnung. Deshalb
 * AMBIGUOUS statt "nimm irgendeine" — und niemals 0,00 EUR (EYT-109).
 */
import type { RateVersionRecord } from "./rate-version";

export const RATE_EFFECTIVITY_PROBLEMS = ["RATE_NOT_FOUND", "RATE_AMBIGUOUS"] as const;
export type RateEffectivityProblem = (typeof RATE_EFFECTIVITY_PROBLEMS)[number];

export type EffectiveRateResult =
  | { readonly ok: true; readonly version: RateVersionRecord }
  | { readonly ok: false; readonly problem: RateEffectivityProblem };

/**
 * Die am `businessDate` wirksame Version.
 *
 * Datumsvergleich als Zeichenkette: `JJJJ-MM-TT` ist lexikografisch UND
 * chronologisch sortiert. Ein `new Date(...)` waere hier die schlechtere
 * Wahl — es macht aus einem Kalendertag einen Zeitpunkt in irgendeiner Zone.
 */
export function effectiveRateVersion(
  versions: readonly RateVersionRecord[],
  businessDate: string,
): EffectiveRateResult {
  const wirksam = versions.filter(
    (version) =>
      version.validFrom <= businessDate &&
      (version.validTo === null || businessDate < version.validTo),
  );
  if (wirksam.length === 0) return { ok: false, problem: "RATE_NOT_FOUND" };
  if (wirksam.length > 1) return { ok: false, problem: "RATE_AMBIGUOUS" };
  return { ok: true, version: wirksam[0] as RateVersionRecord };
}

/** Anzeigezustand einer Version relativ zum heutigen Geschaeftsdatum. */
export function rateVersionStatus(
  version: RateVersionRecord,
  businessDate: string,
): "aktiv" | "kommend" | "abgelaufen" {
  if (version.validFrom > businessDate) return "kommend";
  if (version.validTo !== null && version.validTo <= businessDate) return "abgelaufen";
  return "aktiv";
}
