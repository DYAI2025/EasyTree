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
import { compareLocalBusinessDate, dayAfter } from "./local-business-date.js";
import type { HourlyRateAmount } from "./money.js";
import type { LocalBusinessDate } from "./planning-week.js";

/** Was {@link hourlyRateVersion} entgegennimmt — noch ungeprüft. */
export interface HourlyRateVersionInput {
  readonly rateVersionId: RateVersionId;
  /**
   * Satz je Stunde, **bereits geprüft** (V5.6 Schicht 2). `0` ist zulässig (V4)
   * und nicht dasselbe wie „fehlt". Dass hier {@link HourlyRateAmount} und
   * nicht `Money` steht, ist die ganze Aussage von V5.6: ein negativer Rohwert
   * erreicht diese Factory gar nicht mehr, deshalb muss sie ihn auch nicht
   * gegen einen zweiten Eingabefehler priorisieren.
   */
  readonly amountPerHour: HourlyRateAmount;
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

/**
 * Ablehnungsgründe beim Anlegen einer Satzversion — seit V5.6 **nur noch
 * relationale** Invarianten.
 *
 * `RATE_NEGATIVE` ist hier bewusst nicht mehr aufgeführt: der Code ist nicht
 * verschwunden, er hat die Grenze gewechselt und sitzt jetzt an
 * `hourlyRateAmount`, also dort, wo der Rohwert geprüft wird. Damit gibt es bei
 * mehrfach ungültigen Rohwerten keinen künstlich priorisierten Domainfehler
 * mehr — die Gateway- bzw. Zod-Grenze darf mehrere Feldfehler gleichzeitig
 * melden, und diese Factory bekommt solche Werte gar nicht erst.
 */
export const RATE_VERSION_ERRORS = [
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
 * Ein Paar Satzversionen, deren Gültigkeitsintervalle sich überschneiden, mit
 * dem überlappenden Bereich (V5.5).
 *
 * Kanonisch: `firstVersionId` und `secondVersionId` sind nach `validFrom`
 * sortiert, bei Gleichstand nach ID. Jedes **ungeordnete** Versionspaar
 * erscheint höchstens einmal — `A überlappt B` und `B überlappt A` sind
 * dasselbe Fundstück, nicht zwei.
 *
 * Bewusst **keine** berechneten Kosten und keine UI-Texte darin: das ist ein
 * Befund, keine Darstellung. Mitarbeiterbezug und handlungsorientierte
 * Aufbereitung ergänzt EYT-108.
 */
export interface RateVersionOverlap {
  readonly firstVersionId: RateVersionId;
  readonly secondVersionId: RateVersionId;
  /** Erster Tag, an dem beide Versionen gelten — einschliessend. */
  readonly overlapFrom: LocalBusinessDate;
  /** Interne halboffene Grenze; `null`, wenn beide Enden offen sind. */
  readonly overlapEndExclusive: LocalBusinessDate | null;
}

/**
 * Die einzige Stelle, an der eine geprüfte {@link HourlyRateVersion} entsteht.
 *
 * Seit V5.6 prüft sie **nur relationale** Invarianten — Beziehungen zwischen
 * bereits geprüften Feldern. Die Primitiven kommen validiert und gebrandet
 * herein ({@link HourlyRateAmount}), die Frage „ist der Satz negativ" stellt
 * sich hier also gar nicht mehr. Ein Konstruktor, der ein verkehrtes
 * Gültigkeitsintervall als geprüft ausgäbe, wäre trotzdem fail-open: die Marke
 * behauptete eine Zusicherung, die nicht gilt, und der Fehler fiele erst in der
 * Auswahl auf, wo er als fehlender oder mehrdeutiger Satz erscheint statt als
 * das, was er ist.
 *
 * **Überlappungen zwischen mehreren Versionen prüft diese Factory nicht** — das
 * ist keine Eigenschaft einer einzelnen Version, sondern eines Katalogs, und
 * gehört deshalb zu {@link findRateVersionOverlaps}.
 *
 * `validTo === validFrom` ist ein zulässiger Ein-Tages-Satz — deshalb `< 0` und
 * nicht `<= 0`.
 */
export function hourlyRateVersion(input: HourlyRateVersionInput): HourlyRateVersionResult {
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

/**
 * Exklusives Ende der kanonischen Halboffen-Form `[validFrom, dayAfter(validTo))`;
 * `null` heisst unbegrenzt (V3).
 *
 * Diese eine Funktion ist die **einzige** Stelle im Modul, an der die
 * Intervallsemantik steht. Deckung und Überlappung bauen beide darauf auf,
 * damit es keine zweite Lesart geben kann — V3 verlangt ausdrücklich, dass UI,
 * Domain Service, Datenbank-Constraint und Tests dieselbe Semantik führen.
 */
function exclusiveEnd(version: HourlyRateVersion): LocalBusinessDate | null {
  return version.validTo === null ? null : dayAfter(version.validTo);
}

/** Deckt die Version diesen Kalendertag ab? `validFrom` einschliessend. */
function coversDay(version: HourlyRateVersion, on: LocalBusinessDate): boolean {
  if (compareLocalBusinessDate(version.validFrom, on) > 0) return false;

  const end = exclusiveEnd(version);
  return end === null || compareLocalBusinessDate(on, end) < 0;
}

/**
 * Überschneiden sich die Gültigkeiten zweier Versionen?
 *
 * Halboffen ausgewertet, was der einschliessenden Formel aus V3
 * (`a.validFrom <= b.validTo && b.validFrom <= a.validTo`) für Kalendertage
 * genau entspricht: `bis 30.06. / ab 01.07.` grenzt lückenlos an,
 * `bis 30.06. / ab 30.06.` überlappt an einem Tag.
 */
function overlaps(a: HourlyRateVersion, b: HourlyRateVersion): boolean {
  const aEnd = exclusiveEnd(a);
  const bEnd = exclusiveEnd(b);
  const aStartsBeforeBEnds = bEnd === null || compareLocalBusinessDate(a.validFrom, bEnd) < 0;
  const bStartsBeforeAEnds = aEnd === null || compareLocalBusinessDate(b.validFrom, aEnd) < 0;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}

/**
 * Der überlappende Bereich zweier Versionen, in kanonischer Reihenfolge (V5.5).
 *
 * Die Sortierung nach `validFrom` und bei Gleichstand nach ID macht das
 * Ergebnis von der Eingabereihenfolge unabhängig — ohne sie lieferte
 * `[a, b]` ein anderes Fundstück als `[b, a]`, und ein Vergleich zweier Läufe
 * wäre wertlos.
 *
 * Der überlappende Bereich ist der Schnitt beider halboffener Intervalle:
 * Beginn ist der spätere der beiden Starttage, Ende die frühere der beiden
 * exklusiven Grenzen. `null` heisst „beide Enden offen", nicht „unbekannt".
 */
function canonicalOverlap(a: HourlyRateVersion, b: HourlyRateVersion): RateVersionOverlap {
  const byStart = compareLocalBusinessDate(a.validFrom, b.validFrom);
  const aFirst = byStart !== 0 ? byStart < 0 : a.rateVersionId <= b.rateVersionId;
  const [first, second] = aFirst ? [a, b] : [b, a];

  const firstEnd = exclusiveEnd(first);
  const secondEnd = exclusiveEnd(second);
  const earlierEnd =
    firstEnd === null
      ? secondEnd
      : secondEnd === null
        ? firstEnd
        : compareLocalBusinessDate(firstEnd, secondEnd) <= 0
          ? firstEnd
          : secondEnd;

  return {
    firstVersionId: first.rateVersionId,
    secondVersionId: second.rateVersionId,
    // Der spätere Start — `second` per Konstruktion, ausser bei gleichem Start.
    overlapFrom: second.validFrom,
    overlapEndExclusive: earlierEnd,
  };
}

/**
 * Die für `on` gültige Satzversion — oder ein blockierendes Ergebnis.
 *
 * Bewusst **kein** `versions.find(...)`: das liefert bei zwei deckenden
 * Versionen klaglos die erste und erzeugt einen Betrag, den hinterher niemand
 * belegen kann. Es werden deshalb alle Treffer gezählt, und mehr als einer ist
 * ein Grund zu blockieren, keine Gelegenheit zu wählen.
 */
export function selectRateVersion(
  versions: readonly HourlyRateVersion[],
  on: LocalBusinessDate,
): RateSelectionResult {
  const covering = versions.filter((version) => coversDay(version, on));

  const [only] = covering;
  if (only === undefined) return { ok: false, error: "RATE_MISSING" };
  if (covering.length > 1) return { ok: false, error: "RATE_AMBIGUOUS" };

  return { ok: true, version: only };
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
  const found: RateVersionOverlap[] = [];

  // Alle Paare, nicht nur sortierte Nachbarn. `hasAnyOverlap` in
  // `time-interval.ts` darf das, weil es nur die Existenz einer Überschneidung
  // meldet; hier werden die Beteiligten benannt, und eine lange Version, die
  // zwei kurze überspannt, wäre bei einem reinen Nachbarvergleich unsichtbar.
  //
  // `j > i` ist zugleich die Deduplizierung aus V5.5: jedes ungeordnete Paar
  // wird genau einmal besucht, unabhängig von der Eingabereihenfolge.
  for (let i = 0; i < versions.length; i += 1) {
    for (let j = i + 1; j < versions.length; j += 1) {
      const a = versions[i];
      const b = versions[j];
      if (a === undefined || b === undefined) continue;
      if (overlaps(a, b)) found.push(canonicalOverlap(a, b));
    }
  }

  return found;
}
