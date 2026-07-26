import type { WorksiteId } from "@easytree/domain";

import type { Worksite } from "../domain/worksite";

/** Öffentlicher Anwendungs-Port des Worksites-Moduls (EYT-46, ADR-001 Z. 76). */
export interface WorksiteQueries {
  findPublishable(id: WorksiteId): Promise<Worksite | null>;
}
