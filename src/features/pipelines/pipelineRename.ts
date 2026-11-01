import { eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { pipelines } from "@/db/schema";
import { recordAudit } from "@/features/identity/audit";
import { err, ok, type Result } from "@/types/result";
import { canManagePipelineScope, lockLifecycleActor } from "./pipelineLifecycleAccess";
import { pipelineRenameInput } from "./schemas";

export async function renamePipeline(
  db: Db,
  requestHeaders: Headers,
  raw: unknown,
  signal: AbortSignal,
): Promise<Result<typeof pipelines.$inferSelect, AppError>> {
  const parsed = pipelineRenameInput.safeParse(raw);
  if (!parsed.success)
    return err(new AppError(ERROR_IDS.PIPELINE_RENAME_INPUT_INVALID, "Invalid pipeline rename"));
  signal.throwIfAborted();
  try {
    return await db.transaction(async (tx) => {
      // Queue before locking authority, so changes committed while waiting are rechecked.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('warpdrive:pipeline-lifecycle'))`);
      signal.throwIfAborted();
      const actor = await lockLifecycleActor(tx, requestHeaders, signal);
      if (actor === null)
        return err(
          new AppError(ERROR_IDS.PIPELINE_FRESH_AUTH_REQUIRED, "Fresh native proof required"),
        );
      const [pipeline] = await tx
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, parsed.data.pipelineId))
        .for("update");
      signal.throwIfAborted();
      if (
        pipeline === undefined ||
        pipeline.isArchived ||
        !canManagePipelineScope(actor, pipeline.visibilityGroupId)
      )
        return err(new AppError(ERROR_IDS.PIPELINE_NOT_FOUND, "Pipeline unavailable"));
      if (pipeline.name === parsed.data.name) return ok(pipeline);
      if (
        pipeline.updatedAt.toISOString() !== new Date(parsed.data.expectedUpdatedAt).toISOString()
      )
        return err(new AppError(ERROR_IDS.PIPELINE_REVISION_CONFLICT, "Pipeline revision changed"));
      const [updated] = await tx
        .update(pipelines)
        .set({
          name: parsed.data.name,
          updatedAt: sql`greatest(clock_timestamp(), date_trunc('milliseconds', ${pipelines.updatedAt}) + interval '1 millisecond')`,
        })
        .where(eq(pipelines.id, pipeline.id))
        .returning();
      if (updated === undefined)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Locked pipeline disappeared");
      await recordAudit(
        tx,
        {
          actorId: actor.id,
          targetType: "pipeline",
          targetId: pipeline.id,
          action: "pipeline.rename",
          before: { name: pipeline.name, updatedAt: pipeline.updatedAt.toISOString() },
          after: { name: updated.name, updatedAt: updated.updatedAt.toISOString() },
        },
        signal,
      );
      signal.throwIfAborted();
      return ok(updated);
    });
  } catch {
    signal.throwIfAborted();
    return err(new AppError(ERROR_IDS.DB_WRITE_FAILED, "Pipeline rename could not be confirmed"));
  }
}
