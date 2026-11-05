import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { workflowsV2, workflowV2Runs, workflowV2TriggerReceipts } from "@/db/schema/workflowV2";
import type { WorkflowV2Adapters } from "@/features/blocks/contracts";
import { hydrateActor } from "@/server/hydrateActor";
import { canWorkflow } from "../access";
import { initialV2State } from "./admission";
import { scheduleMatches } from "./cron";
import { publishedWorkflowV2 } from "./persistence";
import { workflowV2Readiness } from "./readiness";
import { resumeDueWorkflowV2Waits } from "./waits";

export { scheduleMatches } from "./cron";
export async function admitDueWorkflowV2Schedules(
  db: Db,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
  now = new Date(),
) {
  const rows = await db
    .select({ id: workflowsV2.id })
    .from(workflowsV2)
    .where(eq(workflowsV2.active, true));
  const ids: string[] = [];
  for (const candidate of rows) {
    signal.throwIfAborted();
    const id = await db.transaction(async (tx) => {
      const [workflow] = await tx
        .select()
        .from(workflowsV2)
        .where(eq(workflowsV2.id, candidate.id))
        .for("update");
      if (
        workflow === undefined ||
        !workflow.active ||
        workflow.archivedAt !== null ||
        workflow.publishedNumber === null
      )
        return null;
      const version = await publishedWorkflowV2(tx, workflow.id, workflow.publishedNumber);
      if (
        version === null ||
        version.definition.trigger.type !== "schedule" ||
        !scheduleMatches(version.definition.trigger.config, now)
      )
        return null;
      const eventKey = `schedule:${version.id}:${Math.floor(now.getTime() / 60_000)}`;
      const [existing] = await tx
        .select({ runId: workflowV2TriggerReceipts.runId })
        .from(workflowV2TriggerReceipts)
        .where(
          and(
            eq(workflowV2TriggerReceipts.workflowId, workflow.id),
            eq(workflowV2TriggerReceipts.eventKey, eventKey),
          ),
        );
      if (existing !== undefined) return existing.runId;
      const actor = await hydrateActor(tx, workflow.ownerId, signal);
      if (actor === null || !canWorkflow(actor, "run", workflow.ownerId)) return null;
      const readiness = await workflowV2Readiness(tx, actor, version.definition, adapters, signal);
      if (Object.values(readiness).some((row) => row.state !== "ready")) return null;
      const payload = {
        scheduledAt: now.toISOString(),
        $workflowV2: { depth: 0, workflowIds: [workflow.id] },
      };
      const [run] = await tx
        .insert(workflowV2Runs)
        .values({
          workflowId: workflow.id,
          versionId: version.id,
          actorId: actor.id,
          requestKey: crypto.randomUUID(),
          mode: "live",
          trigger: payload,
          state: initialV2State(version.definition),
        })
        .returning({ id: workflowV2Runs.id });
      if (run === undefined) return null;
      await tx.insert(workflowV2TriggerReceipts).values({
        workflowId: workflow.id,
        versionId: version.id,
        eventKey,
        payload,
        runId: run.id,
      });
      return run.id;
    });
    if (id !== null) ids.push(id);
  }
  return ids;
}
export async function reconcileWorkflowV2(
  db: Db,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
) {
  const due = await resumeDueWorkflowV2Waits(db, adapters, signal);
  const scheduled = await admitDueWorkflowV2Schedules(db, adapters, signal);
  const ready = await db
    .select({ id: workflowV2Runs.id })
    .from(workflowV2Runs)
    .where(inArray(workflowV2Runs.status, ["queued", "running"]))
    .orderBy(workflowV2Runs.updatedAt)
    .limit(100);
  return [...new Set([...due, ...scheduled, ...ready.map((row) => row.id)])];
}
