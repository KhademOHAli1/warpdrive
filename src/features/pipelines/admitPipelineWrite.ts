import { eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { pipelines } from "@/db/schema";
import type { EntityCreateSession } from "@/features/permissions/entityCreate";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";

// The transactional share lock linearizes insertion before or after archive. A preflight
// alone can pass, wait on an FK lock, then insert after the archive has committed.
export async function admitPipelineWrite(
  db: DbOrTx,
  session: EntityCreateSession,
  pipelineId: string,
  signal: AbortSignal,
  lock: boolean,
): Promise<Result<true, AppError>> {
  signal.throwIfAborted();
  const query = db
    .select({ visibilityGroupId: pipelines.visibilityGroupId, isArchived: pipelines.isArchived })
    .from(pipelines)
    .where(eq(pipelines.id, pipelineId));
  const [pipeline] = await (lock ? query.for("share") : query);
  signal.throwIfAborted();
  if (pipeline === undefined || pipeline.isArchived)
    return err(
      new AppError(ERROR_IDS.DEAL_STAGE_MISMATCH, "Pipeline is unavailable", { pipelineId }),
    );
  if (
    session.isAdmin !== true &&
    pipeline.visibilityGroupId !== null &&
    !session.visibilityGroupIds.includes(pipeline.visibilityGroupId)
  )
    return err(
      new AppError(ERROR_IDS.PERM_DENIED, "Restricted pipeline is not visible", { pipelineId }),
    );
  return ok(true);
}
