/**
 * Welche Satzversion gilt an einem Geschaeftstag? (EYT-108, EYT-109)
 *
 * Rein, ohne Datenbank, ohne Zeitzone: die Eingabe ist bereits ein LOKALES
 * Geschaeftsdatum. Diese Datei rechnet keine Zeitzonen um — das ist Aufgabe
 * der Aufrufer (EYT-109), und eine zweite Umrechnung hier waere genau die
 * Doppelung, die `no-local-time-construction` verbietet.
 *
 * ## Diese Funktion ENTSCHEIDET nicht mehr selbst — sie uebersetzt und delegiert
 *
 * Vor EYT-109 D1 stand hier eine zweite, handgeschriebene Intervallregel
 * (`businessDate < validTo`, halboffen), waehrend `@easytree/domain` dieselbe
 * Frage einschliessend beantwortete. Zwei Regeln fuer dieselbe Sache sind genau
 * ein Widerspruch zu viel; der abgenommene Vertrag EYT-95 (Jira-Kommentar
 * 11425: „`validTo` ist einschliessend, intern kanonisch halboffen
 * `[validFrom, dayAfter(validTo))`") ist die Autoritaet.
 *
 * Diese Datei ist deshalb nur noch eine BRUECKE:
 *   1. fachliche `RateVersionRecord`s -> gepruefte `HourlyRateVersion`s
 *   2. Auswahl durch `@easytree/domain::selectRateVersion` — die EINZIGE Regel
 *   3. Rueckabbildung auf die Fehlercodes, die dieses Modul nach aussen fuehrt
 *
 * Sie liefert BEIDE Formen zurueck: `version` fuer Id, Historie und DTO,
 * `checked` fuer `costOfDuration`. Ohne `checked` muesste die Montage ein
 * zweites Mal konvertieren — und eine zweite Konvertierung ist eine zweite
 * Gelegenheit, sich um einen Tag zu irren.
 *
 * ## Warum "mehrdeutig" ein eigener Fall ist
 *
 * Die Datenbank verhindert Ueberlappung. Kaeme trotzdem eine mehrdeutige Menge
 * an (importierte Daten, kuenftig gelockerter Constraint), waere die stille
 * Auswahl der ersten Zeile ein falscher Betrag in einer Rechnung. Deshalb
 * AMBIGUOUS statt "nimm irgendeine" — und niemals 0,00 EUR (EYT-109). Kein
 * `versions.find(...)`: das liefert bei zwei deckenden Saetzen klaglos den
 * erstbesten und erzeugt einen Betrag, den hinterher niemand belegen kann.
 */
import {
  hourlyRateAmount,
  hourlyRateVersion,
  moneyOfMinorUnits,
  selectRateVersion,
  unsafeIdentifier,
} from "@easytree/domain";
import type { HourlyRateVersion, RateVersionId } from "@easytree/domain";

import { parseLocalDate } from "./local-business-date-format";
import type { RateVersionRecord } from "./rate-version";

export const RATE_EFFECTIVITY_PROBLEMS = [
  "RATE_NOT_FOUND",
  "RATE_AMBIGUOUS",
  /**
   * Eine gespeicherte Satzzeile passiert die Domaenenfactory nicht — negativer
   * Betrag oder `validTo` vor `validFrom`. Mit den Checks aus Migration 0013
   * unerreichbar; der Zweig steht trotzdem, weil ein `!` an dieser Stelle eine
   * Pruefung BEHAUPTEN wuerde, die niemand ausfuehrt.
   */
  "RATE_INVALID",
] as const;
export type RateEffectivityProblem = (typeof RATE_EFFECTIVITY_PROBLEMS)[number];

export type EffectiveRateResult =
  | {
      readonly ok: true;
      /** Die gewaehlte Zeile — fuer Id, Historie und DTO. */
      readonly version: RateVersionRecord;
      /** Dieselbe Version, geprueft — fuer `costOfDuration` (EYT-95). */
      readonly checked: HourlyRateVersion;
    }
  | { readonly ok: false; readonly problem: RateEffectivityProblem };

/**
 * Die am `businessDate` wirksame Version — oder ein blockierendes Ergebnis.
 *
 * `businessDate` und `record.validFrom`/`record.validTo` sind Kalendertage in
 * der Textform `JJJJ-MM-TT` und tragen seit EYT-109 D1 ALLE dieselbe
 * einschliessende Bedeutung. Ein `new Date(...)` waere hier die schlechtere
 * Wahl — es machte aus einem Kalendertag einen Zeitpunkt in irgendeiner Zone.
 */
export function effectiveRateVersion(
  versions: readonly RateVersionRecord[],
  businessDate: string,
): EffectiveRateResult {
  // Alle Zeilen, nicht nur eine Vorauswahl: `selectRateVersion` muss
  // Mehrdeutigkeit ueber den GESAMTEN Katalog erkennen koennen. Eine vorherige
  // Filterung waere eine dritte Intervallregel durch die Hintertuer.
  const geprueft: HourlyRateVersion[] = [];
  const nachId = new Map<string, RateVersionRecord>();

  for (const record of versions) {
    // `hourlyRateAmount` und `hourlyRateVersion` sind BEIDE Result-Factories,
    // nicht direkte Konstruktoren. Das Ergebnis auszupacken statt `!` zu
    // schreiben ist der Unterschied zwischen einer Pruefung und ihrer
    // Behauptung (`money.ts:266`, `rate-version.ts:138`).
    const satzBetrag = hourlyRateAmount(
      moneyOfMinorUnits(BigInt(record.amountMinorUnits), record.currency),
    );
    if (!satzBetrag.ok) return { ok: false, problem: "RATE_INVALID" };

    // KEIN `dayBefore` mehr: `record.validTo` ist seit EYT-109 D1 bereits der
    // letzte wirksame Tag — dieselbe Lesart, die `HourlyRateVersion` fuehrt.
    // Ein `dayBefore` hier waere die doppelte Umrechnung aus Risiko R1.
    const version = hourlyRateVersion({
      rateVersionId: unsafeIdentifier<RateVersionId>(record.id),
      amountPerHour: satzBetrag.rate,
      validFrom: parseLocalDate(record.validFrom),
      validTo: record.validTo === null ? null : parseLocalDate(record.validTo),
    });
    if (!version.ok) return { ok: false, problem: "RATE_INVALID" };

    geprueft.push(version.version);
    nachId.set(record.id, record);
  }

  const gewaehlt = selectRateVersion(geprueft, parseLocalDate(businessDate));
  if (!gewaehlt.ok) {
    // Die EINZIGE Stelle, an der die Domaenennamen auf die Modulnamen treffen.
    // `RATE_MISSING` heisst hier `RATE_NOT_FOUND`, weil dieser Name bereits in
    // `SNAPSHOT_ASSEMBLY_PROBLEMS`, im Controller und im Vertrag steht; ihn zu
    // aendern waere eine Vertragsaenderung ohne fachlichen Anlass.
    return {
      ok: false,
      problem: gewaehlt.error === "RATE_MISSING" ? "RATE_NOT_FOUND" : "RATE_AMBIGUOUS",
    };
  }

  const record = nachId.get(gewaehlt.version.rateVersionId);
  if (record === undefined) {
    // Unerreichbar: jede gepruefte Version stammt aus `nachId`. LAUT abbrechen
    // statt still `RATE_NOT_FOUND` zu liefern — ein Waechter, der bei internem
    // Fehler in die fachliche Richtung faellt, verbirgt genau den Fall, den er
    // melden soll (gleiche Konvention wie `findRateVersionOverlaps`).
    throw new RangeError(
      `Invariante verletzt: gewaehlte Satzversion ${gewaehlt.version.rateVersionId} hat keine Ausgangszeile.`,
    );
  }
  return { ok: true, version: record, checked: gewaehlt.version };
}

/** Anzeigezustand einer Version relativ zum heutigen Geschaeftsdatum. */
export function rateVersionStatus(
  version: RateVersionRecord,
  businessDate: string,
): "aktiv" | "kommend" | "abgelaufen" {
  if (version.validFrom > businessDate) return "kommend";
  // EYT-109 D1: `validTo` ist der LETZTE wirksame Tag. `<=` waere hier der
  // Ein-Tages-Fehler — die Version erschiene an ihrem eigenen letzten
  // Gueltigkeitstag bereits als abgelaufen.
  if (version.validTo !== null && version.validTo < businessDate) return "abgelaufen";
  return "aktiv";
}
