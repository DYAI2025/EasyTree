/**
 * Die eine Uebersetzung gespeicherter Stand -> Transportform (EYT-139).
 *
 * ## Warum diese Funktion existiert und der Controller sie nicht selbst macht
 *
 * Weil sie die einzige Stelle ist, an der `days` entsteht, und weil ein Test sie
 * ohne Nest, ohne Datenbank und ohne Anfrage messen koennen muss. Baute der
 * Controller die Antwort inline, waere die Ableitung nur ueber einen HTTP-Test
 * erreichbar — und der misst dann zwei Dinge gleichzeitig.
 *
 * ## `days` ist eine Ableitung, keine zweite Datenquelle
 *
 * Gespeichert ist ausschliesslich `total_minor_units` im Kopf (Migration 0018).
 * Die Tagessummen werden HIER aus den gespeicherten Positionen gruppiert —
 * deterministisch, aufsteigend nach lokalem Tag. Aufsteigend und nicht in
 * Einfuegereihenfolge: `positions` traegt die eingefrorene `ordinal`-Ordnung,
 * die fachlich etwas anderes bedeutet als eine Tagesliste. Waere `days` bloss
 * die Reihenfolge des ersten Vorkommens, haetten zwei Snapshots mit denselben
 * Zahlen je nach Einsatzreihenfolge verschiedene Tageslisten.
 *
 * `YYYY-MM-DD` sortiert lexikographisch in Kalenderreihenfolge — deshalb genuegt
 * ein Stringvergleich, und deshalb steht hier KEIN `localeCompare`: das haenge
 * ohne explizites Locale an der Umgebung.
 *
 * ## Kein `number`, nirgends
 *
 * Betraege und Dauern sind in Prozess `bigint` und im Vertrag Ziffernfolgen.
 * `.toString()` ist der einzige erlaubte Weg dazwischen. Ein `Number(...)` waere
 * die Stelle, an der oberhalb von 2^53 still Genauigkeit verloren geht — der
 * Test haelt das an einem Wert von 2^53+1 fest.
 *
 * ## Was hier NICHT passiert
 *
 * Keine Neuberechnung, keine Satzermittlung, keine Planungsauswertung. Diese
 * Funktion sieht ausschliesslich einen bereits gespeicherten Snapshot.
 */
import type { CostDayTotalDto, CostPositionDto, CostSnapshot } from "@easytree/contracts";

import type {
  StoredCostSnapshot,
  StoredCostSnapshotPosition,
} from "../../application/cost-snapshot-repository.port";

function toPositionDto(position: StoredCostSnapshotPosition): CostPositionDto {
  return {
    id: position.id,
    assignmentId: position.assignmentId,
    worksiteId: position.worksiteId,
    worksiteLabel: position.worksiteLabel,
    employeeId: position.employeeId,
    employeeLabel: position.employeeLabel,
    localDate: position.localDate,
    durationMilliseconds: position.durationMilliseconds.toString(),
    rateVersionId: position.rateVersionId,
    amountMinorUnits: position.amountMinorUnits.toString(),
  };
}

function tagessummen(positions: readonly StoredCostSnapshotPosition[]): CostDayTotalDto[] {
  const summen = new Map<string, bigint>();
  for (const position of positions) {
    summen.set(
      position.localDate,
      (summen.get(position.localDate) ?? 0n) + position.amountMinorUnits,
    );
  }
  return [...summen.entries()]
    .sort(([links], [rechts]) => (links < rechts ? -1 : links > rechts ? 1 : 0))
    .map(([localDate, betrag]) => ({ localDate, amountMinorUnits: betrag.toString() }));
}

export function toCostSnapshotDto(stored: StoredCostSnapshot): CostSnapshot {
  return {
    id: stored.id,
    planVersionId: stored.planVersionId,
    worksiteId: stored.worksiteId,
    weekKey: stored.weekKey,
    timeZone: stored.timeZone,
    currency: stored.currency,
    // Der Vertrag tippt `ruleVersion` heute auf das Literal `personnel-plan-cost-v1`,
    // der gespeicherte Stand auf `string` — Absicht (ein unter v1 entstandener
    // Snapshot bleibt v1). Der Cast ist die dokumentierte Naht dazwischen; kommt
    // v2, wird das Vertragsliteral zu einem `z.enum` und dieser Cast faellt weg.
    ruleVersion: stored.ruleVersion as CostSnapshot["ruleVersion"],
    createdAt: stored.createdAt.toISOString(),
    createdBy: stored.createdBy,
    correlationId: stored.correlationId,
    totalMinorUnits: stored.totalMinorUnits.toString(),
    days: tagessummen(stored.positions),
    positions: stored.positions.map(toPositionDto),
  };
}
