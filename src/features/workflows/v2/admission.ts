import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { workflowV2Runs } from "@/db/schema/workflowV2";
import type {
  BlockOutput,
  WorkflowV2Adapters,
  WorkflowV2Definition,
  WorkflowV2RunState,
} from "@/features/blocks/contracts";
import { blockOutputSchema } from "@/features/blocks/schemas";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import { publishedWorkflowV2 } from "./persistence";
import { workflowV2Readiness } from "./readiness";
import { authorizedWorkflow, runDto, V2_ERROR } from "./shared";

export function initialV2State(definition: WorkflowV2Definition): WorkflowV2RunState {
  return {
    queue: definition.entryNodeIds.map((nodeId) => ({
      nodeId,
      framePath: [],
      visitKey: `|${nodeId}`,
    })),
    outputs: {},
    frames: [],
    stepCount: 0,
  };
}
async function projectLaunch(
  db: Db,
  actor: PermSetUser,
  launch: BlockOutput,
  trigger: BlockOutput,
  effectKey: string,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
) {
  if (launch.availability !== "single" && launch.availability !== "bulk") return ok(trigger);
  const rawIds = launch.availability === "single" ? [trigger.recordId] : trigger.recordIds;
  const parsed = z.array(z.uuid()).min(1).max(100).safeParse(rawIds);
  if (!parsed.success || typeof launch.objectName !== "string") return err(V2_ERROR.invalid);
  const ids = parsed.data;
  const config = {
    objectName: launch.objectName,
    filters: [{ field: "id", operator: "in", value: ids }],
    limit: 100,
  };
  const found = await adapters.native(db, {
    actor,
    node: { id: "launch", type: "FIND_RECORDS", version: 1, name: "Launch records", config },
    resolvedConfig: config,
    effectKey,
    signal,
    nextPickIndex: () => Promise.resolve(0),
  });
  if (
    !found.ok ||
    !Array.isArray(found.value.records) ||
    found.value.records.length !== new Set(ids).size
  )
    return err(V2_ERROR.denied);
  const projected: BlockOutput =
    launch.availability === "single"
      ? { recordId: ids[0] ?? null, record: found.value.records[0] ?? null }
      : { recordIds: ids, records: found.value.records };
  return ok(projected);
}
export async function startWorkflowV2(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
) {
  const input = z
    .strictObject({
      id: z.uuid(),
      requestKey: z.uuid(),
      mode: z.enum(["test", "live"]).default("live"),
      expectedPublishedNumber: z.number().int().positive().optional(),
      trigger: blockOutputSchema.default({}),
    })
    .safeParse(raw);
  if (!input.success) return err(V2_ERROR.invalid);
  return db.transaction(async (tx) => {
    const access = await authorizedWorkflow(tx, actor, input.data.id, "run", signal, true);
    if (!access.ok) return access;
    const { workflow } = access.value;
    const [existing] = await tx
      .select()
      .from(workflowV2Runs)
      .where(
        and(
          eq(workflowV2Runs.workflowId, workflow.id),
          eq(workflowV2Runs.actorId, access.value.actor.id),
          eq(workflowV2Runs.requestKey, input.data.requestKey),
        ),
      );
    if (existing !== undefined)
      return existing.mode === input.data.mode ? ok(runDto(existing)) : err(V2_ERROR.conflict);
    if (!workflow.active || workflow.archivedAt !== null || workflow.publishedNumber === null)
      return err(V2_ERROR.inactive);
    if (
      input.data.expectedPublishedNumber !== undefined &&
      input.data.expectedPublishedNumber !== workflow.publishedNumber
    )
      return err(V2_ERROR.conflict);
    const version = await publishedWorkflowV2(tx, workflow.id, workflow.publishedNumber);
    if (version === null || version.definition.trigger.type !== "manual")
      return err(V2_ERROR.invalid);
    const readiness = await workflowV2Readiness(
      tx,
      access.value.actor,
      version.definition,
      adapters,
      signal,
    );
    if (Object.values(readiness).some((row) => row.state !== "ready"))
      return err(V2_ERROR.notReady);
    const projected = await projectLaunch(
      tx,
      access.value.actor,
      version.definition.trigger.config,
      input.data.trigger,
      input.data.requestKey,
      adapters,
      signal,
    );
    if (!projected.ok) return projected;
    const trigger: BlockOutput = {
      ...projected.value,
      $workflowV2: { depth: 0, workflowIds: [workflow.id] },
    };
    const [row] = await tx
      .insert(workflowV2Runs)
      .values({
        workflowId: workflow.id,
        versionId: version.id,
        actorId: access.value.actor.id,
        requestKey: input.data.requestKey,
        mode: input.data.mode,
        trigger,
        state: initialV2State(version.definition),
      })
      .returning();
    return row === undefined ? err(V2_ERROR.write) : ok(runDto(row));
  });
}
