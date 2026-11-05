import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import type { WorkflowDefinition } from "./schemas";
import { readWorkflowRunLaunch, type WorkflowRunLaunchPayload } from "./workflowRunLaunchContract";
import { workflowScheduleRequestKey } from "./workflowScheduleAdmission";
import { workflowWebhookRequestKey } from "./workflowWebhookAuth";

interface LaunchIdentity {
  readonly actorId: string;
  readonly workflowId: string;
  readonly mode: "simulation" | "live";
  readonly requestKey: string;
  readonly trigger: unknown;
}

// The caller has selected this run's exact version and current workflow owner.
// A schedule has no interactive session. Every continuation rechecks owner
// identity; a human form response separately requires the owner's real session.
export function verifyWorkflowRunLaunch(
  definition: Pick<WorkflowDefinition, "nodes">,
  run: LaunchIdentity,
  ownerId: string,
  publishedAt: Date,
): Result<WorkflowRunLaunchPayload, string> {
  const launch = readWorkflowRunLaunch(definition, run.trigger);
  if (launch === null) return err(ERROR_IDS.WORKFLOW_INVALID);
  if (!("scope" in launch) || launch.scope === "global") return ok(launch);
  if (run.actorId !== ownerId) return err(ERROR_IDS.WORKFLOW_DENIED);
  if (launch.scope === "webhook")
    return run.mode === "live" &&
      run.requestKey === workflowWebhookRequestKey(run.workflowId, launch.eventId)
      ? ok(launch)
      : err(ERROR_IDS.WORKFLOW_INVALID);
  const publishedMs = publishedAt.getTime();
  if (
    run.mode !== "live" ||
    !Number.isFinite(publishedMs) ||
    publishedMs > Date.parse(launch.scheduledAt) ||
    run.requestKey !==
      workflowScheduleRequestKey({ workflowId: run.workflowId, scheduledAt: launch.scheduledAt })
  )
    return err(ERROR_IDS.WORKFLOW_INVALID);
  return ok(launch);
}
