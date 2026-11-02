import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, pipelines, stages } from "@/db/schema";
import { dealVisibilityPredicate } from "@/features/permissions/sql";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import { canManagePipelines } from "./canManagePipelines";
import type { PipelineDirectoryData } from "./lifecycleTypes";

export async function listLifecyclePipelines(
  db: Db,
  actorId: string,
  signal: AbortSignal,
): Promise<Result<PipelineDirectoryData[], "denied">> {
  const actor = await hydrateActor(db, actorId, signal);
  if (actor === null || !canManagePipelines(actor)) return err("denied");
  const restriction =
    actor.type === "admin"
      ? sql`true`
      : or(
          isNull(pipelines.visibilityGroupId),
          actor.groupIds.size > 0
            ? inArray(pipelines.visibilityGroupId, [...actor.groupIds])
            : sql`false`,
        );
  const visibleDeals = dealVisibilityPredicate(
    {
      userId: actor.id,
      isAdmin: actor.type === "admin",
      isActive: actor.isActive,
      sessionLive: true,
      groupIds: [...actor.groupIds],
      managedUserIds: [...(actor.managedUserIds ?? [])],
    },
    {
      ownerId: sql`${deals.ownerId}`,
      visibilityLevel: sql`${deals.visibilityLevel}`,
      visibilityGroupId: sql`${deals.visibilityGroupId}`,
      visibleToUserIds: sql`${deals.visibleToUserIds}`,
      pipelineVisibilityGroupId: sql`${pipelines.visibilityGroupId}`,
    },
  );
  const rows = await db
    .select({
      id: pipelines.id,
      name: pipelines.name,
      isArchived: pipelines.isArchived,
      updatedAt: pipelines.updatedAt,
      groupId: pipelines.visibilityGroupId,
    })
    .from(pipelines)
    .where(restriction)
    .orderBy(asc(pipelines.order), asc(pipelines.name), asc(pipelines.id));
  signal.throwIfAborted();
  if (rows.length === 0) return ok([]);
  const ids = rows.map((row) => row.id);
  // Separate grouped reads keep Drizzle from rebinding outer columns inside scalar subqueries.
  const stageCounts = await db
    .select({ pipelineId: stages.pipelineId, value: count() })
    .from(stages)
    .where(inArray(stages.pipelineId, ids))
    .groupBy(stages.pipelineId);
  signal.throwIfAborted();
  const dealCounts = await db
    .select({ pipelineId: deals.pipelineId, value: count() })
    .from(deals)
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .where(and(inArray(deals.pipelineId, ids), isNull(deals.deletedAt), visibleDeals))
    .groupBy(deals.pipelineId);
  signal.throwIfAborted();
  const byStage = new Map(stageCounts.map((row) => [row.pipelineId, row.value]));
  const byDeal = new Map(dealCounts.map((row) => [row.pipelineId, row.value]));
  return ok(
    rows.map(({ groupId, updatedAt, ...row }) => ({
      ...row,
      stageCount: byStage.get(row.id) ?? 0,
      dealCount: byDeal.get(row.id) ?? 0,
      updatedAt: updatedAt.toISOString(),
      visibility: groupId === null ? "workspace" : "restricted",
    })),
  );
}
