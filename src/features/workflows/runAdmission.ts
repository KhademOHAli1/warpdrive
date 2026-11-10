import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflows, workflowVersions } from "@/db/schema";
import { prepareCurrentCustomFieldValidation } from "@/features/custom-fields/currentValidation";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { validateDefinition } from "./definition";
import { executableDefinition, requiresExternalHttp, requiresHumanForm } from "./readiness";
import { definitionSchema } from "./schemas";
import {
  prepareWorkflowManualLaunch,
  readWorkflowManualLaunch,
} from "./workflowManualLaunchContract";

const inputSchema = z.strictObject({
  workflowId: z.string().uuid(),
  requestKey: z.string().uuid(),
  recordId: z.uuid().optional(),
  mode: z.enum(["simulation", "live"]).default("simulation"),
  reviewedVersionId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase())
    .optional(),
});
type ManualRunInput = z.infer<typeof inputSchema>;
type Publication = typeof workflowVersions.$inferSelect;

function matchesReviewedVersion(reviewedVersionId: string | undefined, versionId: string) {
  return reviewedVersionId === undefined || reviewedVersionId === versionId;
}

async function sameManualCommand(
  db: Db,
  existing: typeof workflowRuns.$inferSelect,
  input: ManualRunInput,
  published: Publication,
) {
  if (
    existing.mode !== input.mode ||
    !matchesReviewedVersion(input.reviewedVersionId, existing.versionId)
  )
    return false;
  const pinned =
    existing.versionId === published.id
      ? published
      : (
          await db
            .select()
            .from(workflowVersions)
            .where(
              and(
                eq(workflowVersions.id, existing.versionId),
                eq(workflowVersions.workflowId, existing.workflowId),
              ),
            )
        )[0];
  const definition = definitionSchema.safeParse(pinned?.definition);
  if (!definition.success) return false;
  const launch = readWorkflowManualLaunch(definition.data, existing.trigger);
  if (launch === null) return false;
  return "recordId" in launch ? launch.recordId === input.recordId : input.recordId === undefined;
}

function prepareNewLaunch(input: ManualRunInput, version: Publication, triggerConfig: unknown) {
  if (input.mode === "simulation" && requiresHumanForm(version.definition))
    return err(ERROR_IDS.WORKFLOW_FORM_REQUIRES_LIVE);
  if (input.mode === "simulation" && requiresExternalHttp(version.definition))
    return err(ERROR_IDS.WORKFLOW_NOT_READY);
  if (!matchesReviewedVersion(input.reviewedVersionId, version.id))
    return err(ERROR_IDS.WORKFLOW_CONFLICT);
  const launch = prepareWorkflowManualLaunch(triggerConfig, input.recordId);
  return launch === null ? err(ERROR_IDS.WORKFLOW_INVALID) : ok(launch);
}

export async function admitManualRun(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  const input = inputSchema.safeParse(raw);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return db.transaction(async (tx) => {
    const currentActor = await hydrateActor(tx, actor.id, signal);
    if (currentActor === null) return err(ERROR_IDS.WORKFLOW_DENIED);
    const [workflow] = await tx
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, input.data.workflowId), isNull(workflows.archivedAt)))
      .for("update");
    if (
      workflow === undefined ||
      !workflow.active ||
      workflow.publishedNumber === null ||
      !canWorkflow(currentActor, "run", workflow.ownerId)
    )
      return err(ERROR_IDS.WORKFLOW_DENIED);
    const [version] = await tx
      .select()
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.workflowId, workflow.id),
          eq(workflowVersions.number, workflow.publishedNumber),
        ),
      );
    const trigger = version?.definition.nodes.find((node) => node.type.startsWith("trigger."));
    if (version === undefined || trigger?.type !== "trigger.manual")
      return err(ERROR_IDS.WORKFLOW_NOT_READY);
    if (!executableDefinition(version.definition)) return err(ERROR_IDS.WORKFLOW_NOT_READY);
    const key = and(
      eq(workflowRuns.workflowId, workflow.id),
      eq(workflowRuns.actorId, actor.id),
      eq(workflowRuns.requestKey, input.data.requestKey),
    );
    const [existing] = await tx.select().from(workflowRuns).where(key);
    if (existing !== undefined) {
      if (!(await sameManualCommand(tx, existing, input.data, version)))
        return err(ERROR_IDS.WORKFLOW_CONFLICT);
      return ok(existing);
    }
    const launch = prepareNewLaunch(input.data, version, trigger.config);
    if (!launch.ok) return launch;
    const metadata = version.definition.nodes.some((node) => node.type === "activity.create")
      ? {
          status: "complete" as const,
          defs: (await prepareCurrentCustomFieldValidation(tx, "activity", signal)).defs,
        }
      : { status: "complete" as const, defs: [] };
    if (!validateDefinition(version.definition, metadata).ok)
      return err(ERROR_IDS.WORKFLOW_INVALID);
    const [run] = await tx
      .insert(workflowRuns)
      .values({
        workflowId: workflow.id,
        versionId: version.id,
        actorId: actor.id,
        requestKey: input.data.requestKey,
        mode: input.data.mode,
        trigger: launch.value,
        nextNodeId: trigger.id,
      })
      .returning();
    signal.throwIfAborted();
    return run === undefined ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED) : ok(run);
  });
}
