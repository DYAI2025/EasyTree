import type { OrgId, WorksiteId } from "@easytree/domain";

/** Baustelle einer Organisation (EYT-46). Framework-frei, siehe ADR-001 Z. 74. */
export interface Worksite {
  readonly id: WorksiteId;
  readonly orgId: OrgId;
  readonly name: string;
  /**
   * Mindestens eine Tätigkeit ist Pflicht, bevor eine Baustelle veröffentlicht
   * werden darf (PRD v1.3, EYT-16). Hier nur als Invariante abgebildet; die
   * Tätigkeiten selbst kommen mit dem Fachschema aus EYT-86.
   */
  readonly activityCount: number;
}

/** Veröffentlichbar nur mit mindestens einer Tätigkeit. */
export function isPublishable(worksite: Worksite): boolean {
  return worksite.activityCount > 0;
}
