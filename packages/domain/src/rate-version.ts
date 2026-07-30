/**
 * Versionierte Stundensätze und ihre eindeutige Auswahl an Intervallgrenzen
 * (EYT-95, REQ-004 — Berechnungsvertrag V3 und V4).
 *
 * ## Warum die Auswahl blockieren kann statt „die erste zu nehmen"
 *
 * Ein `versions.find(...)` liefert bei zwei überlappenden Sätzen klaglos den
 * erstbesten und erzeugt einen Betrag, den hinterher niemand belegen kann.
 * Genauso teuer ist die Gegenrichtung: eine Lücke im Satzkatalog als 0,00 EUR
 * darzustellen. Die Kostenansicht sieht dann vollständig aus und ist falsch —
 * niemand sucht nach einer Zeile, die scheinbar existiert. Beide Fälle sind
 * deshalb blockierende Ergebnisse mit eigenem Code und ohne Betrag.
 *
 * ## Warum `validTo` einschließend ist
 *
 * V3 legt die fachliche Oberfläche `[validFrom, validTo]` fest, beide
 * einschließend, `validTo = null` unbegrenzt. Daraus folgt beides, was sonst
 * gern verwechselt wird: `bis 30.06. / ab 01.07.` ist lückenlos und zulässig,
 * `bis 30.06. / ab 30.06.` ist eine Überlappung. Eine exklusiv gerechnete
 * Implementierung verliert bei jedem Satzwechsel genau einen Arbeitstag.
 */

import type { RateVersionId } from "./identifiers.js";
import { compareLocalBusinessDate } from "./local-business-date.js";
import type { Money } from "./money.js";
import type { LocalBusinessDate } from "./planning-week.js";

/** Was {@link hourlyRateVersion} entgegennimmt — noch ungeprüft. */
export interface HourlyRateVersionInput {
  readonly rateVersionId: RateVersionId;
  /** Satz je Stunde in Minor Units. `0` ist zulässig (V4) und nicht dasselbe wie „fehlt". */
  readonly amountPerHour: Money;
  /** Erster Gültigkeitstag, einschließend. */
  readonly validFrom: LocalBusinessDate;
  /** Letzter Gültigkeitstag, einschließend. `null` = unbegrenzt. */
  readonly validTo: LocalBusinessDate | null;
}

declare const hourlyRateVersionBrand: unique symbol;

/**
 * Geprüfte Satzversion. Nur über {@link hourlyRateVersion} erhältlich.
 *
 * Die Marke aus demselben Grund wie bei `TimeInterval`: ohne sie wäre die
 * geprüfte Version strukturell nicht von einem beliebigen Objektliteral zu
 * unterscheiden, ein negativer Satz oder ein verkehrtes Intervall käme an der
 * Prüfung vorbei bis in die Berechnung, und die Ablehnungsgründe unten wären
 * folgenlos.
 */
export interface HourlyRateVersion extends HourlyRateVersionInput {
  readonly [hourlyRateVersionBrand]: "HourlyRateVersion";
}

/** Ablehnungsgründe beim Anlegen einer Satzversion. */
export const RATE_VERSION_ERRORS = [
  /** V4: `Rate >= 0`. Ein negativer Satz erzeugte eine Gutschrift, die niemand angeordnet hat. */
  "RATE_NEGATIVE",
  /** Verkehrtes Gültigkeitsintervall — deckt keinen Tag ab und darf nicht still verschwinden. */
  "VALID_TO_BEFORE_VALID_FROM",
] as const;

export type RateVersionError = (typeof RATE_VERSION_ERRORS)[number];

export type HourlyRateVersionResult =
  | { readonly ok: true; readonly version: HourlyRateVersion }
  | { readonly ok: false; readonly error: RateVersionError };

/** Blockierende Ausgänge der Auswahl. Es gibt keinen dritten. */
export const RATE_SELECTION_ERRORS = [
  /** Kein Satz deckt den Stichtag. Niemals als 0,00 EUR darstellen. */
  "RATE_MISSING",
  /** Mehr als ein Satz deckt den Stichtag. Die Auswahl entscheidet nicht, sie blockiert. */
  "RATE_AMBIGUOUS",
] as const;

export type RateSelectionError = (typeof RATE_SELECTION_ERRORS)[number];

/** Der blockierende Zweig trägt bewusst weder Betrag noch Satzversion. */
export type RateSelectionResult =
  | { readonly ok: true; readonly version: HourlyRateVersion }
  | { readonly ok: false; readonly error: RateSelectionError };

/**
 * Ein Paar Satzversionen, deren Gültigkeitsintervalle sich überschneiden.
 *
 * Nur die Identität der beiden Beteiligten ist Vertrag. Eine Reihenfolge der
 * Paare untereinander sagt EYT-95 bewusst nicht zu — wer darauf baut, baut auf
 * ein Implementierungsdetail.
 */
export interface RateVersionOverlap {
  readonly first: RateVersionId;
  readonly second: RateVersionId;
}

/**
 * Die einzige Stelle, an der eine geprüfte {@link HourlyRateVersion} entsteht.
 *
 * Beide Prüfungen zusammen, nicht eine davon: Ein Konstruktor, der ein
 * verkehrtes Gültigkeitsintervall als geprüft ausgibt, ist fail-open — die
 * Marke behauptete dann eine Zusicherung, die nicht gilt, und der Fehler fiele
 * erst in der Auswahl auf, wo er als fehlender oder mehrdeutiger Satz erscheint
 * statt als das, was er ist.
 *
 * Die Reihenfolge der beiden Prüfungen ist **nicht** Vertrag (anders als bei
 * den Zahlengrenzen): Satz und Intervall sind voneinander unabhängig, und für
 * eine Eingabe, die beides verletzt, legt kein Test einen Vorrang fest.
 *
 * `validTo === validFrom` ist ein zulässiger Ein-Tages-Satz — deshalb `< 0` und
 * nicht `<= 0`.
 */
export function hourlyRateVersion(input: HourlyRateVersionInput): HourlyRateVersionResult {
  if (input.amountPerHour.minorUnits < 0n) return { ok: false, error: "RATE_NEGATIVE" };
  if (input.validTo !== null && compareLocalBusinessDate(input.validTo, input.validFrom) < 0) {
    return { ok: false, error: "VALID_TO_BEFORE_VALID_FROM" };
  }

  // `Object.freeze` aus demselben Grund wie bei `moneyOfMinorUnits`: an einem
  // geprüften Wert darf nachträglich weder ein Feld überschrieben noch eines
  // angehängt werden. Der Cast ist die Marke, nicht die Prüfung — die steht
  // vollständig darüber.
  return {
    ok: true,
    version: Object.freeze({
      rateVersionId: input.rateVersionId,
      amountPerHour: input.amountPerHour,
      validFrom: input.validFrom,
      validTo: input.validTo,
    }) as HourlyRateVersion,
  };
}

/** Die für `on` gültige Satzversion — oder ein blockierendes Ergebnis. */
export function selectRateVersion(
  versions: readonly HourlyRateVersion[],
  on: LocalBusinessDate,
): RateSelectionResult {
  void [versions, on];
  throw new Error("NOT_IMPLEMENTED");
}

/**
 * Alle überschneidenden Paare des Katalogs.
 *
 * Die Eingabereihenfolge darf über Blockieren oder Durchlassen nicht
 * entscheiden — und anders als bei `hasAnyOverlap` genügt es hier nicht,
 * sortiert nur Nachbarn zu vergleichen: eine lange Version kann zwei kurze
 * überspannen, ohne deren Nachbar zu sein.
 */
export function findRateVersionOverlaps(
  versions: readonly HourlyRateVersion[],
): readonly RateVersionOverlap[] {
  void versions;
  throw new Error("NOT_IMPLEMENTED");
}
