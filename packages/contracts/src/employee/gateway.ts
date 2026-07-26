/** Mitarbeiter-Port (EYT-79). Ausschliesslich Transporttypen. */
import type { GatewayResult } from "../gateway.js";
import type {
  ActiveTimeEntry,
  ConfirmPlanCommand,
  Confirmation,
  EmployeeSchedule,
  MyScheduleQuery,
  RejectAssignmentCommand,
  Rejection,
  StartTimeCommand,
  StopTimeCommand,
  SubmittedTimeEntry,
} from "./schemas.js";

export interface EmployeeGateway {
  getMySchedule(input: MyScheduleQuery): Promise<GatewayResult<EmployeeSchedule>>;
  confirmPlan(input: ConfirmPlanCommand): Promise<GatewayResult<Confirmation>>;
  rejectAssignment(input: RejectAssignmentCommand): Promise<GatewayResult<Rejection>>;
  startTime(input: StartTimeCommand): Promise<GatewayResult<ActiveTimeEntry>>;
  stopTime(input: StopTimeCommand): Promise<GatewayResult<SubmittedTimeEntry>>;
}
