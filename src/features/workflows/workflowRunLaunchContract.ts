import type { WorkflowDefinition } from "./schemas";
import {
  readWorkflowManualLaunch,
  type WorkflowManualLaunchPayload,
} from "./workflowManualLaunchContract";
import {
  readWorkflowScheduleLaunch,
  type WorkflowSchedulePayload,
} from "./workflowScheduleContract";

import {
  readWorkflowWebhookLaunch,
  type WorkflowWebhookLaunchPayload,
} from "./workflowWebhookContract";

export type WorkflowRunLaunchPayload =
  | WorkflowManualLaunchPayload
  | WorkflowSchedulePayload
  | WorkflowWebhookLaunchPayload;

export function readWorkflowRunLaunch(
  definition: Pick<WorkflowDefinition, "nodes">,
  raw: unknown,
): WorkflowRunLaunchPayload | null {
  return (
    readWorkflowManualLaunch(definition, raw) ??
    readWorkflowScheduleLaunch(definition, raw) ??
    readWorkflowWebhookLaunch(definition, raw)
  );
}
