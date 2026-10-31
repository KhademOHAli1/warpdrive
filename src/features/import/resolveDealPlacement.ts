import { and, asc, eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { pipelines, stages } from "@/db/schema";
import { settings } from "@/db/schema/system";
import { canManagePipelines } from "@/features/pipelines/canManagePipelines";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import type { ImportActor, RowError } from "./commitHelpers";
import type { ImportContext } from "./externalIds";

function mayCreatePlacement(actor: ImportActor, ctx: ImportContext): boolean {
  return ctx.source === "pipedrive" && ctx.createMissingStages && canManagePipelines(actor);
}

async function createPipeline(tx: DbOrTx, name: string): Promise<string> {
  const [last] = await tx
    .select({ order: sql<number>`coalesce(max(${pipelines.order}), -1)` })
    .from(pipelines);
  const [created] = await tx
    .insert(pipelines)
    .values({ name, order: (last?.order ?? -1) + 1 })
    .returning({ id: pipelines.id });
  if (created === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "pipeline insert returned no rows", {});
  return created.id;
}

async function createStage(tx: DbOrTx, pipelineId: string, name: string): Promise<string> {
  const [last] = await tx
    .select({ order: sql<number>`coalesce(max(${stages.order}), -1)` })
    .from(stages)
    .where(eq(stages.pipelineId, pipelineId));
  const [created] = await tx
    .insert(stages)
    .values({ pipelineId, name, order: (last?.order ?? -1) + 1 })
    .returning({ id: stages.id });
  if (created === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "stage insert returned no rows", {});
  return created.id;
}

export async function resolvePipelineId(
  tx: DbOrTx,
  actor: ImportActor,
  ctx: ImportContext,
  pipelineName: string | null,
  signal: AbortSignal,
): Promise<Result<string, RowError[]>> {
  signal.throwIfAborted();
  if (pipelineName !== null) {
    const [pipe] = await tx
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(
        sql`lower(${pipelines.name}) = lower(${pipelineName}) and ${pipelines.isArchived} = false`,
      );
    if (pipe !== undefined) return ok(pipe.id);
    if (mayCreatePlacement(actor, ctx)) return ok(await createPipeline(tx, pipelineName));
    return err([{ field: "pipeline", message: `unknown pipeline: ${pipelineName}` }]);
  }

  const [cfg] = await tx
    .select({ defaultPipelineId: settings.defaultPipelineId })
    .from(settings)
    .where(eq(settings.id, true));
  if (cfg?.defaultPipelineId != null) return ok(cfg.defaultPipelineId);

  const [first] = await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(eq(pipelines.isArchived, false))
    .orderBy(asc(pipelines.order))
    .limit(1);
  if (first === undefined) {
    return err([{ field: "pipeline", message: "no pipeline available to import into" }]);
  }
  return ok(first.id);
}

export async function resolveStageId(
  tx: DbOrTx,
  actor: ImportActor,
  ctx: ImportContext,
  pipelineId: string,
  stageName: string | null,
  signal: AbortSignal,
): Promise<Result<string, RowError[]>> {
  signal.throwIfAborted();
  if (stageName !== null) {
    const [stage] = await tx
      .select({ id: stages.id })
      .from(stages)
      .where(
        and(eq(stages.pipelineId, pipelineId), sql`lower(${stages.name}) = lower(${stageName})`),
      );
    if (stage !== undefined) return ok(stage.id);
    if (mayCreatePlacement(actor, ctx)) return ok(await createStage(tx, pipelineId, stageName));
    return err([{ field: "stage", message: `unknown stage: ${stageName}` }]);
  }

  const [first] = await tx
    .select({ id: stages.id })
    .from(stages)
    .where(eq(stages.pipelineId, pipelineId))
    .orderBy(asc(stages.order))
    .limit(1);
  if (first === undefined) {
    return err([{ field: "stage", message: "pipeline has no stages" }]);
  }
  return ok(first.id);
}
