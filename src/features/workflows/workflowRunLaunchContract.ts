import type { WorkflowDefinition } from "./schemas";
import {
  readWorkflowManualLaunch,
  type WorkflowManualLaunchPayload,
} from "./workflowManualLaunchContract";
import {
  readWorkflowScheduleLaunch,
  type WorkflowSchedulePayload,
} from "./workflowScheduleContract";

export type WorkflowRunLaunchPayload = WorkflowManualLaunchPayload | WorkflowSchedulePayload;

export function readWorkflowRunLaunch(
  definition: Pick<WorkflowDefinition, "nodes">,
  raw: unknown,
): WorkflowRunLaunchPayload | null {
  return readWorkflowManualLaunch(definition, raw) ?? readWorkflowScheduleLaunch(definition, raw);
}
