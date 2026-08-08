/**
 * Montage der Snapshotpositionen (EYT-109).
 *
 * Die EINZIGE Stelle, an der Tagesallokation (EYT-109), Satzauswahl (EYT-108)
 * und Geldregel (EYT-95) zusammentreffen. Rein: kein NestJS, kein `pg`, keine
 * Uhr — der Erstellungszeitpunkt gehoert in den Snapshotkopf und entsteht im
 * Use-Case.
 *
 * ## Warum `effectiveRateVersion` und nicht `selectRateVersion`
 *
 * Die Datenbank liest `[validFrom, validTo)` halboffen (Migration 0013,
 * EXCLUDE-Constraint). `@easytree/domain::selectRateVersion` liest `validTo`
 * EINSCHLIESSEND. An jedem Nahtstellentag — Satz A endet, Satz B beginnt am
 * selben Tag — lieferte die Domaenenlesart RATE_AMBIGUOUS fuer eine
 * Konstellation, die die Datenbank ausdruecklich zulaesst. Deshalb waehlt die
 * Modulregel, und `costOfDuration` bekommt die einmal uebersetzte Version.
 * Siehe D1 im Plan; ein Test friert den Fall ein.
 *
 * ## Warum die Blockade total ist
 *
 * Jira EYT-109: "Fehlende oder mehrdeutige Saetze blockieren die
 * Snapshot-Erzeugung." Ein Teilergebnis waere eine Summe, die vollstaendig
 * aussieht und es nicht ist — und der Export (EYT-110) bekaeme kein Feld, an
 * dem er die Luecke bemerken koennte.
 */
import {
  allocateAcrossLocalDays,
  costOfDuration,
  createTimeZone,
  dayBefore,
  hourlyRateAmount,
  hourlyRateVersion,
  moneyOfMinorUnits,
  TimeInterval,
  unsafeIdentifier,
  COST_RULE_VERSION,
} from "@easytree/domain";
import type { LocalBusinessDate, RateVersionId } from "@easytree/domain";
import { effectiveRateVersion } from "./rate-effectivity";
import type { RateVersionRecord } from "./rate-version";
import type { PublishedPlanFacts } from "./planned-work-fact";

export interface AssembledPosition {
  readonly assignmentId: string;
  readonly worksiteId: string;
  readonly worksiteLabel: string;
  readonly employeeId: string;
  readonly employeeLabel: string;
  /** Ortstag in der Zone der Organisation, `JJJJ-MM-TT`. */
  readonly localDate: string;
  readonly durationMilliseconds: bigint;
  readonly rateVersionId: string;
  readonly amountMinorUnits: bigint;
  readonly ruleVersion: typeof COST_RULE_VERSION;
}

export interface SnapshotAssemblyInput {
  readonly facts: PublishedPlanFacts;
  /** `null` = alle Baustellen der Planversion. */
  readonly worksiteFilter: string | null;
  readonly employeeLabels: ReadonlyMap<string, string>;
  readonly worksiteLabels: ReadonlyMap<string, string>;
  readonly ratesByEmployee: ReadonlyMap<string, readonly RateVersionRecord[]>;
}

export const SNAPSHOT_ASSEMBLY_PROBLEMS = [
  "RATE_NOT_FOUND",
  "RATE_AMBIGUOUS",
  /**
   * Die gespeicherte Satzzeile passiert die Domaenenfactory nicht — negativer
   * Betrag oder `validTo` vor `validFrom`. Mit den Checks aus Migration 0013
   * unerreichbar; der Zweig steht trotzdem, weil ein `!` an dieser Stelle eine
   * Pruefung BEHAUPTEN wuerde, die niemand ausfuehrt.
   */
  "RATE_INVALID",
  "LABEL_MISSING",
  "DAY_BOUNDARY_NONEXISTENT",
  "DAY_BOUNDARY_AMBIGUOUS",
  "TIME_ZONE_UNKNOWN",
  "INTERVAL_INVALID",
] as const;
export type SnapshotAssemblyProblem = (typeof SNAPSHOT_ASSEMBLY_PROBLEMS)[number];

export type SnapshotAssemblyResult =
  | { readonly ok: true; readonly positions: readonly AssembledPosition[] }
  | {
      readonly ok: false;
      readonly problem: SnapshotAssemblyProblem;
      /** Genug fuer eine handlungsorientierte Meldung — und nicht mehr. */
      readonly assignmentId: string | null;
      readonly employeeId: string | null;
      readonly localDate: string | null;
    };

export function assembleCostSnapshotPositions(
  input: SnapshotAssemblyInput,
): SnapshotAssemblyResult {
  // Die Zonenpruefung passiert HIER, wo die Zone angewendet wird — so steht es
  // im Kopfkommentar von `planned-work-fact.ts`.
  const zone = createTimeZone(input.facts.timeZone);
  if (!zone.ok) {
    return {
      ok: false,
      problem: "TIME_ZONE_UNKNOWN",
      assignmentId: null,
      employeeId: null,
      localDate: null,
    };
  }

  const positionen: AssembledPosition[] = [];

  for (const einsatz of input.facts.work) {
    if (input.worksiteFilter !== null && einsatz.worksiteId !== input.worksiteFilter) continue;

    const scheitern = (
      problem: SnapshotAssemblyProblem,
      localDate: string | null,
    ): SnapshotAssemblyResult => ({
      ok: false,
      problem,
      assignmentId: einsatz.assignmentId,
      employeeId: einsatz.employeeId,
      localDate,
    });

    const intervall = TimeInterval.create(einsatz.startsAtUtc, einsatz.endsAtUtc);
    if (!intervall.ok) return scheitern("INTERVAL_INVALID", null);

    const anteile = allocateAcrossLocalDays(intervall.interval, zone.timeZone);
    if (!anteile.ok) return scheitern(anteile.error, null);

    const worksiteLabel = input.worksiteLabels.get(einsatz.worksiteId);
    const employeeLabel = input.employeeLabels.get(einsatz.employeeId);
    if (worksiteLabel === undefined || employeeLabel === undefined) {
      return scheitern("LABEL_MISSING", null);
    }

    const saetze = input.ratesByEmployee.get(einsatz.employeeId) ?? [];

    for (const anteil of anteile.parts) {
      const tag = formatLocalDate(anteil.date);
      const gewaehlt = effectiveRateVersion(saetze, tag);
      if (!gewaehlt.ok) return scheitern(gewaehlt.problem, tag);

      // `hourlyRateAmount` und `hourlyRateVersion` sind BEIDE Result-Factories,
      // nicht direkte Konstruktoren. Das Ergebnis auszupacken statt `!` zu
      // schreiben ist der Unterschied zwischen einer Pruefung und ihrer
      // Behauptung (`money.ts:266`, `rate-version.ts:138`).
      const satzBetrag = hourlyRateAmount(
        moneyOfMinorUnits(BigInt(gewaehlt.version.amountMinorUnits), gewaehlt.version.currency),
      );
      if (!satzBetrag.ok) return scheitern("RATE_INVALID", tag);

      // Halboffen (DB) -> einschliessend (Domaene). `null` bleibt `null`.
      // Der DB-Check `valid_to > valid_from` schliesst das leere Intervall aus.
      const version = hourlyRateVersion({
        rateVersionId: unsafeIdentifier<RateVersionId>(gewaehlt.version.id),
        amountPerHour: satzBetrag.rate,
        validFrom: parseLocalDate(gewaehlt.version.validFrom),
        validTo:
          gewaehlt.version.validTo === null
            ? null
            : dayBefore(parseLocalDate(gewaehlt.version.validTo)),
      });
      if (!version.ok) return scheitern("RATE_INVALID", tag);

      const betrag = costOfDuration(version.version, anteil.quantity);

      positionen.push({
        assignmentId: einsatz.assignmentId,
        worksiteId: einsatz.worksiteId,
        worksiteLabel,
        employeeId: einsatz.employeeId,
        employeeLabel,
        localDate: tag,
        // Schon `bigint` — `DurationMilliseconds.milliseconds` ist als `bigint`
        // deklariert (`duration-milliseconds.ts`). Ein `BigInt(...)` darum
        // waere eine Konvertierung, die nichts konvertiert, und liesse offen,
        // ob hier je ein `number` unterwegs war.
        durationMilliseconds: anteil.quantity.milliseconds,
        rateVersionId: gewaehlt.version.id,
        amountMinorUnits: betrag.minorUnits,
        ruleVersion: COST_RULE_VERSION,
      });
    }
  }

  // Feste Ordnung: ohne sie waeren zwei Laeufe nicht vergleichbar und der
  // Export (EYT-110) nicht reproduzierbar. Die Reihenfolge wird in Task 11 als
  // `ordinal` eingefroren.
  positionen.sort(
    (a, b) =>
      a.localDate.localeCompare(b.localDate) ||
      a.worksiteId.localeCompare(b.worksiteId) ||
      a.employeeLabel.localeCompare(b.employeeLabel) ||
      a.assignmentId.localeCompare(b.assignmentId),
  );

  return { ok: true, positions: positionen };
}

/**
 * `JJJJ-MM-TT` aus einem geprueften Ortstag — mit String-Padding, nie ueber
 * `Date`. Ein `new Date(...)` machte aus einem Kalendertag wieder einen
 * Zeitpunkt in irgendeiner Zone; genau das verbietet
 * `no-local-time-construction.test.ts`.
 */
function formatLocalDate(date: LocalBusinessDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${String(date.year).padStart(4, "0")}-${mm}-${dd}`;
}

/**
 * `JJJJ-MM-TT` -> {@link LocalBusinessDate}, ohne `Date`.
 *
 * `@easytree/domain` exportiert bewusst KEINE solche Funktion:
 * `LocalBusinessDate` ist ein offenes Interface ohne Laufzeitvalidierung, und
 * das Paket sagt dazu ausdruecklich „wer diese Eingabe ausschliessen will, tut
 * das an der Grenze, an der das Datum entsteht" (`local-business-date.ts`).
 * Diese Grenze ist hier: die Zeichenkette kommt aus `date`-Spalten, die
 * PostgreSQL bereits als Kalendertag geprueft hat.
 */
function parseLocalDate(iso: string): LocalBusinessDate {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}
