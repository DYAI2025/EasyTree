import { findCapacityIssues, overlaps, planningWeekKey, planningWeekOf } from "@easytree/domain";
import type { CapacityEntry, CapacityLimit, IanaTimeZone } from "@easytree/domain";

import type { AssignmentDraft, PlanningConflict } from "./assignment-draft";

/**
 * Prueft einen Entwurf gegen den Bestand (EYT-73, EYT-74).
 *
 * Fasst die beiden Regeln zusammen, die heute belegbar sind — Intervall-
 * ueberschneidung und Wochenkapazitaet — und liefert sie als stabile
 * Konfliktcodes. Das ist die Stelle, an der die Unterscheidung zwischen Warnung
 * und Publish-Blocker sichtbar wird: `blocking` kommt aus dem Kapazitaetsurteil,
 * nicht aus der Formulierung der Meldung.
 *
 * Bewusst hier und nicht in `@easytree/domain`: die Zusammensetzung der Regeln
 * ist eine Anwendungsentscheidung des Planungsmoduls, die einzelnen Regeln sind
 * es nicht.
 *
 * **Keine Absicherung unter Nebenlaeufigkeit.** Zwei parallele Requests koennen
 * beide „frei" sehen. Der Schutz gehoert in die Datenbank (EYT-49) und existiert
 * dort noch nicht.
 */
export function validateDraft(input: {
  readonly draft: AssignmentDraft;
  readonly existing: readonly AssignmentDraft[];
  readonly excludeId: AssignmentDraft["id"] | null;
  readonly timeZone: IanaTimeZone;
  readonly capacityLimit: CapacityLimit;
}): PlanningConflict[] {
  const { draft, existing, excludeId, timeZone, capacityLimit } = input;
  const conflicts: PlanningConflict[] = [];

  const sameTenantSameEmployee = existing.filter(
    (other) =>
      (excludeId === null || other.id !== excludeId) &&
      other.orgId === draft.orgId &&
      other.employeeId === draft.employeeId,
  );

  if (sameTenantSameEmployee.some((other) => overlaps(draft.interval, other.interval))) {
    conflicts.push({ code: "EMPLOYEE_INTERVAL_OVERLAP", blocking: true });
  }

  // Der Entwurf zaehlt zur Kapazitaet dazu — sonst meldete die Pruefung erst
  // nach dem Speichern, dass die Woche voll ist.
  const entries: CapacityEntry[] = [draft, ...sameTenantSameEmployee].map((assignment) => ({
    employeeId: assignment.employeeId,
    interval: assignment.interval,
  }));

  // Nur die Woche des Entwurfs. Eine bereits ueberbuchte ANDERE Woche ist nicht
  // das Problem dieses Entwurfs; wuerde sie mitgemeldet, saehe jeder Entwurf in
  // einer vollen Vier-Wochen-Planung konfliktbehaftet aus — dieselbe
  // Fehlwirkung wie FIND-003, nur eine Ebene hoeher.
  const draftWeekKey = planningWeekKey(planningWeekOf(draft.interval, timeZone));

  for (const issue of findCapacityIssues(entries, timeZone, capacityLimit)) {
    if (issue.weekKey !== draftWeekKey) continue;
    conflicts.push({
      code: "EMPLOYEE_WEEKLY_CAPACITY",
      blocking: issue.verdict === "BLOCKING",
    });
  }

  return conflicts;
}
