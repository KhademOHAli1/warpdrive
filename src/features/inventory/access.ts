import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, pipelines, users } from "@/db/schema";
import { currentNativeActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import { toVisibleDeal } from "@/features/deals/dealAuth";
import { lockStageDeal } from "@/features/deals/nativeStageAccess";
import { can } from "@/features/permissions/can";
import { canSee } from "@/features/permissions/canSee";
import { dealVisibilityPredicate } from "@/features/permissions/sql";
import type { HydratedActor } from "@/server/hydrateActor";

export async function currentInventoryActor(tx: Db, who: NativeSessionRef, signal: AbortSignal) {
  const current = await currentNativeActor(tx, who, signal);
  if (current === null) return null;
  const [staff] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, current.actor.id), isNull(users.invitedAt)));
  signal.throwIfAborted();
  return staff === undefined ? null : current.actor;
}

/** For bulk order reads, evaluate CRM visibility at the query before projecting order details. */
export function inventoryDealVisibility(actor: HydratedActor) {
  return and(
    isNull(deals.deletedAt),
    eq(pipelines.isArchived, false),
    dealVisibilityPredicate(
      {
        userId: actor.id,
        isActive: actor.isActive,
        isAdmin: actor.type === "admin",
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
    ),
  );
}

export async function readInventoryDeal(tx: Db, actor: HydratedActor, dealId: string) {
  const [row] = await tx
    .select({
      deal: {
        id: deals.id,
        title: deals.title,
        ownerId: deals.ownerId,
        visibilityLevel: deals.visibilityLevel,
        visibilityGroupId: deals.visibilityGroupId,
        visibleToUserIds: deals.visibleToUserIds,
        archivedAt: deals.archivedAt,
      },
      pipelineVisibilityGroupId: pipelines.visibilityGroupId,
    })
    .from(deals)
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .where(and(eq(deals.id, dealId), isNull(deals.deletedAt), eq(pipelines.isArchived, false)));
  if (row === undefined) return null;
  const { deal, pipelineVisibilityGroupId } = row;
  const visible = toVisibleDeal(deal, pipelineVisibilityGroupId);
  if (!canSee(actor, visible)) return null;
  return {
    id: deal.id,
    name: deal.title,
    canOrder: deal.archivedAt === null && can(actor, "deal.edit", visible),
  };
}

export async function lockInventoryOrderDeal(tx: Db, actor: HydratedActor, dealId: string) {
  const [hint] = await tx
    .select({ pipelineId: deals.pipelineId })
    .from(deals)
    .where(eq(deals.id, dealId));
  if (hint === undefined) return false;
  // Inventory reads CRM identity and holds it stable through the stock write.
  const { pipeline, deal } = await lockStageDeal(tx, dealId, hint.pipelineId, false);
  if (
    pipeline === undefined ||
    deal === undefined ||
    pipeline.isArchived ||
    deal.pipelineId !== pipeline.id ||
    deal.deletedAt !== null ||
    deal.archivedAt !== null
  ) {
    return false;
  }
  const visible = toVisibleDeal(deal, pipeline.visibilityGroupId);
  return canSee(actor, visible) && can(actor, "deal.edit", visible);
}
