/**
 * Montage der Snapshotpositionen (EYT-109).
 *
 * Die EINZIGE Stelle, an der Tagesallokation (EYT-109), Satzauswahl (EYT-108)
 * und Geldregel (EYT-95) zusammentreffen. Rein: kein NestJS, kein `pg`, keine
 * Uhr — der Erstellungszeitpunkt gehoert in den Snapshotkopf und entsteht im
 * Use-Case.
 *
 * ## Warum `effectiveRateVersion` und nicht direkt `selectRateVersion`
 *
 * Seit EYT-109 D1 sind das dieselbe Regel: `effectiveRateVersion` waehlt nicht
 * mehr selbst, sondern uebersetzt `RateVersionRecord`s in gepruefte
 * `HourlyRateVersion`s und delegiert an `@easytree/domain::selectRateVersion`.
 * Der Aufruf steht hier, damit Controller und Montage durch DIESELBE Funktion
 * gehen; ein direkter Aufruf von `selectRateVersion` braeuchte hier eine
 * zweite Record-Konvertierung — und eine zweite Konvertierung ist eine zweite
 * Gelegenheit, sich um einen Tag zu irren.
 *
 * Es gibt hier deshalb auch KEIN `dayBefore` mehr: `validTo` ist oberhalb der
 * Persistenzgrenze bereits der letzte wirksame Tag. Die frueher an dieser
 * Stelle stehende Umrechnung waere heute die doppelte (Risiko R1); die eine
 * Naht liegt in `infrastructure/rate-interval-boundary.ts`.
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
  TimeInterval,
  COST_RULE_VERSION,
} from "@easytree/domain";
import { formatLocalDate } from "./local-business-date-format";
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
      // `gewaehlt.problem` ist bereits vom Typ `RateEffectivityProblem`, und
      // alle drei Werte stehen schon in `SNAPSHOT_ASSEMBLY_PROBLEMS` — die
      // Zuweisung typprueft ohne Cast.
      const gewaehlt = effectiveRateVersion(saetze, tag);
      if (!gewaehlt.ok) return scheitern(gewaehlt.problem, tag);

      // `checked` kommt fertig geprueft aus der Bruecke. Hier NICHT noch einmal
      // konvertieren: das war bis EYT-109 D1 die zweite Umrechnungsstelle.
      const betrag = costOfDuration(gewaehlt.checked, anteil.quantity);

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
      vergleiche(a.localDate, b.localDate) ||
      vergleiche(a.worksiteId, b.worksiteId) ||
      vergleiche(a.employeeLabel, b.employeeLabel) ||
      vergleiche(a.assignmentId, b.assignmentId),
  );

  return { ok: true, positions: positionen };
}

/**
 * Codepoint-Ordnung — absichtlich NICHT `localeCompare`.
 *
 * `localeCompare` ohne Locale loest gegen die Umgebung auf (`LANG`), und weder
 * `.github/workflows/ci.yml` noch die Railway-Laufzeit legen die fest. Diese
 * Reihenfolge wird in Task 11 als `ordinal` in der Datenbank eingefroren und
 * muss fuer den Export (EYT-110) byteweise reproduzierbar sein — eine Ordnung,
 * die von einer Umgebungsvariable abhaengt, kann das nicht.
 *
 * Gemessen am 09.08.2026 auf dieser Maschine (`de-DE`):
 *
 * | Paar                    | de  | sv  | da  | Codepoint |
 * | ----------------------- | --- | --- | --- | --------- |
 * | `Zimmermann` / `Ärgel`  | +1  | -1  | -1  | -1        |
 * | `a` / `A`               | -1  | -1  | +1  | +1        |
 * | `aaaaaaaa…` / `ffffff…` | -1  | -1  | +1  | -1        |
 *
 * Schon `a` gegen `A` geht zwischen zwei Locales auseinander; die letzte Zeile
 * ist die gefaehrlichste, weil sie UUIDs betrifft: daenische Sortierung liest
 * `aa` als `å` und stellt eine `aaaa…`-Id HINTER eine `ffff…`-Id.
 *
 * Codepoint-Ordnung stimmt ausserdem mit `ORDER BY … COLLATE "C"` in
 * PostgreSQL ueberein — `localeCompare` stimmt mit keiner Collation ueberein.
 */
function vergleiche(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
