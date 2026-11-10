import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { activityTypes, workflows } from "@/db/schema";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import {
  type PaletteEntryState,
  type PaletteExecutionReason,
  paletteCatalog,
  type WorkflowPaletteSnapshot,
} from "./paletteCatalog";
import { hasWorkflowHttpOperatorGrant } from "./workflowHttpOperatorPolicy";
import { hasWorkflowWebhookKey } from "./workflowWebhookOperator";

function authoringState(
  actor: PermSetUser,
  workflow: { ownerId: string; archivedAt: Date | null },
): WorkflowPaletteSnapshot["authoring"] {
  if (workflow.archivedAt !== null) return { allowed: false, reason: "workflow-archived" };
  if (!canWorkflow(actor, "edit", workflow.ownerId))
    return { allowed: false, reason: "workflow-edit-required" };
  return { allowed: true, reason: null };
}

function entryStates(
  reasons: PaletteExecutionReason[],
  httpGranted: boolean,
  webhookGranted: boolean,
): PaletteEntryState[] {
  return paletteCatalog.map((entry) => {
    const missingWebhookKey = entry.type === "trigger.webhook" && !webhookGranted;
    const missingHttpGrant = entry.type === "http.request" && !httpGranted;
    return {
      type: entry.type,
      version: entry.version,
      support: missingHttpGrant || missingWebhookKey ? "unavailable" : entry.support,
      supportReason: missingHttpGrant
        ? "http-grant-required"
        : missingWebhookKey
          ? "webhook-key-required"
          : entry.supportReason,
      provider: entry.provider,
      executionReasons: entry.type === "activity.create" ? [...reasons] : [],
    };
  });
}

// Editing/prerequisite metadata only. Publication, target-record access and actual
// execution still perform their own current authorization and configuration checks.
export async function readWorkflowPalette(
  db: Db,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
): Promise<Result<WorkflowPaletteSnapshot, string>> {
  signal.throwIfAborted();
  if (!z.string().uuid().safeParse(id).success) return err(ERROR_IDS.WORKFLOW_INVALID);
  try {
    const currentActor = await hydrateActor(db, actor.id, signal);
    if (currentActor === null || !canWorkflow(currentActor, "view"))
      return err(ERROR_IDS.WORKFLOW_DENIED);
    const [workflow] = await db
      .select({
        id: workflows.id,
        ownerId: workflows.ownerId,
        revision: workflows.revision,
        archivedAt: workflows.archivedAt,
      })
      .from(workflows)
      .where(eq(workflows.id, id))
      .limit(1);
    signal.throwIfAborted();
    if (workflow === undefined || !canWorkflow(currentActor, "view", workflow.ownerId))
      return err(ERROR_IDS.WORKFLOW_DENIED);
    const [taskType] = await db
      .select({ id: activityTypes.id })
      .from(activityTypes)
      .where(and(eq(activityTypes.key, "task"), isNull(activityTypes.archivedAt)))
      .limit(1);
    signal.throwIfAborted();
    const reasons: PaletteExecutionReason[] = [];
    if (!can(currentActor, "activity.create")) reasons.push("activity-create-required");
    if (taskType === undefined) reasons.push("task-type-unavailable");
    return ok({
      workflowId: workflow.id,
      revision: workflow.revision,
      authoring: authoringState(currentActor, workflow),
      entries: entryStates(
        reasons,
        currentActor.type === "admin" && hasWorkflowHttpOperatorGrant(workflow.id),
        hasWorkflowWebhookKey(workflow.id, workflow.ownerId),
      ),
    });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return err(ERROR_IDS.DB_READ_FAILED);
  }
}
