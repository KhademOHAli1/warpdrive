import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { pipelines, settings } from "@/db/schema";
import { recordAudit } from "@/features/identity/audit";
import { err, ok } from "@/types/result";
import type { PipelineLifecycleResult } from "./lifecycleTypes";
import { canManagePipelineScope, lockLifecycleActor } from "./pipelineLifecycleAccess";

export { listLifecyclePipelines } from "./pipelineLifecycleQuery";
export const pipelineLifecycleInput = z.strictObject({
  pipelineId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
});
const LIFECYCLE_LOCK = "warpdrive:pipeline-lifecycle";

export async function setPipelineArchived(
  db: Db,
  requestHeaders: Headers,
  raw: unknown,
  archived: boolean,
  signal: AbortSignal,
): Promise<PipelineLifecycleResult> {
  const parsed = pipelineLifecycleInput.safeParse(raw);
  if (!parsed.success) return err("failed");
  signal.throwIfAborted();
  try {
    return await db.transaction(async (tx) => {
      // Serializes independent archive commands so two callers cannot archive the last two.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LIFECYCLE_LOCK}))`);
      signal.throwIfAborted();
      const actor = await lockLifecycleActor(tx, requestHeaders, signal);
      if (actor === null) return err("fresh-auth-required");
      const [pipeline] = await tx
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, parsed.data.pipelineId))
        .for("update");
      signal.throwIfAborted();
      if (pipeline === undefined || !canManagePipelineScope(actor, pipeline.visibilityGroupId))
        return err("denied");
      // A retry that already achieved this state never writes another audit or revision.
      if (pipeline.isArchived === archived)
        return ok({ updatedAt: pipeline.updatedAt.toISOString() });
      if (
        pipeline.updatedAt.toISOString() !== new Date(parsed.data.expectedUpdatedAt).toISOString()
      )
        return err("conflict");
      if (archived) {
        const [cfg] = await tx
          .select({ defaultPipelineId: settings.defaultPipelineId })
          .from(settings)
          .where(eq(settings.id, true))
          .for("share");
        if (cfg?.defaultPipelineId === pipeline.id) return err("default-pipeline");
        const [count] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(pipelines)
          .where(eq(pipelines.isArchived, false));
        if ((count?.value ?? 0) <= 1) return err("last-active");
      }
      const [updated] = await tx
        .update(pipelines)
        .set({
          isArchived: archived,
          updatedAt: sql`greatest(clock_timestamp(), date_trunc('milliseconds', ${pipelines.updatedAt}) + interval '1 millisecond')`,
        })
        .where(eq(pipelines.id, pipeline.id))
        .returning({ updatedAt: pipelines.updatedAt });
      if (updated === undefined) return err("failed");
      await recordAudit(
        tx,
        {
          actorId: actor.id,
          targetType: "pipeline",
          targetId: pipeline.id,
          action: archived ? "pipeline.archive" : "pipeline.restore",
          before: { isArchived: pipeline.isArchived, updatedAt: pipeline.updatedAt.toISOString() },
          after: { isArchived: archived, updatedAt: updated.updatedAt.toISOString() },
        },
        signal,
      );
      signal.throwIfAborted();
      return ok({ updatedAt: updated.updatedAt.toISOString() });
    });
  } catch {
    signal.throwIfAborted();
    return err("failed");
  }
}
