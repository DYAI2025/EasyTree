/**
 * Planer-Port (EYT-79).
 *
 * Ausschliesslich Transporttypen — siehe Kopf von `schemas.ts` und `gateway.ts`.
 */
import type { GatewayResult } from "../gateway.js";
import type {
  AssignmentDto,
  CreateAssignmentCommand,
  PlanValidationResult,
  PlanningWindow,
  PlanningWindowQuery,
  PublishPlanCommand,
  PublishedPlanVersion,
  ValidatePlanCommand,
} from "./schemas.js";

export interface PlanningGateway {
  getPlanningWindow(input: PlanningWindowQuery): Promise<GatewayResult<PlanningWindow>>;
  validateDraft(input: ValidatePlanCommand): Promise<GatewayResult<PlanValidationResult>>;
  createAssignment(input: CreateAssignmentCommand): Promise<GatewayResult<AssignmentDto>>;
  publishPlan(input: PublishPlanCommand): Promise<GatewayResult<PublishedPlanVersion>>;
}
