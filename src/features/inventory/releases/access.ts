import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lockInternalProject } from "@/features/projects/access";
import type { HydratedActor } from "@/server/hydrateActor";
import { InventoryDomainError } from "../errors";
import { inventoryProjectsEnabled } from "../projectBridge";
import { inventoryItems, inventoryOrders } from "../schema";
import { inventoryBuildReleases, inventoryProductReleases, inventoryReleaseGrants } from "./schema";

export const releaseUnavailable = "This manufacturing release is unavailable for this account.";

type ItemMode = "view" | "edit" | "approve" | "manage";
const releaseIdentity = {
  id: inventoryProductReleases.id,
  itemId: inventoryProductReleases.itemId,
  status: inventoryProductReleases.status,
};

function unavailable(): never {
  throw new InventoryDomainError(releaseUnavailable);
}

async function releasePermissions(tx: Db, actor: HydratedActor, itemId: string) {
  if (actor.projectsGuestOnly) unavailable();
  if (actor.type === "admin") return { view: true, edit: true, approve: true, manage: true };
  const [grant] = await tx
    .select({ role: inventoryReleaseGrants.role })
    .from(inventoryReleaseGrants)
    .where(
      and(eq(inventoryReleaseGrants.itemId, itemId), eq(inventoryReleaseGrants.userId, actor.id)),
    );
  return {
    view: grant !== undefined,
    edit: grant?.role === "editor",
    approve: grant?.role === "approver",
    manage: false,
  };
}

export async function requireItemReleaseAccess(
  tx: Db,
  actor: HydratedActor,
  itemId: string,
  mode: ItemMode,
) {
  const permissions = await releasePermissions(tx, actor, itemId);
  if (!permissions[mode]) unavailable();
  const [item] = await tx
    .select({
      id: inventoryItems.id,
      sku: inventoryItems.sku,
      name: inventoryItems.name,
      releaseRequired: inventoryItems.releaseRequired,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.kind, "product")));
  if (item === undefined) unavailable();
  return { item, permissions };
}

export async function authorizeBuildRelease(
  tx: Db,
  actor: HydratedActor,
  orderId: string,
  signal: AbortSignal,
) {
  if (actor.projectsGuestOnly || !(await inventoryProjectsEnabled(tx))) unavailable();
  const [row] = await tx
    .select({
      release: releaseIdentity,
      itemId: inventoryItems.id,
      sku: inventoryItems.sku,
      name: inventoryItems.name,
      orderId: inventoryOrders.id,
      projectId: inventoryOrders.projectId,
      templateRevision: inventoryOrders.templateRevision,
    })
    .from(inventoryBuildReleases)
    .innerJoin(inventoryOrders, eq(inventoryBuildReleases.orderId, inventoryOrders.id))
    .innerJoin(inventoryItems, eq(inventoryBuildReleases.itemId, inventoryItems.id))
    .innerJoin(
      inventoryProductReleases,
      eq(inventoryBuildReleases.releaseId, inventoryProductReleases.id),
    )
    .where(
      and(
        eq(inventoryBuildReleases.orderId, orderId),
        eq(inventoryProductReleases.status, "released"),
      ),
    );
  if (row?.projectId == null || row.templateRevision === null) unavailable();
  const access = await lockInternalProject(tx, actor, row.projectId, "read", "work-items");
  signal.throwIfAborted();
  if (!access.ok || access.value.guestAccess !== null) unavailable();
  return { ...row, projectId: row.projectId, templateRevision: row.templateRevision };
}

export async function authorizeArtifactRelease(
  tx: Db,
  actor: HydratedActor,
  releaseId: string,
  mode: "view" | "edit",
  signal: AbortSignal,
  orderId?: string,
) {
  if (orderId !== undefined) {
    if (mode !== "view") unavailable();
    const { release } = await authorizeBuildRelease(tx, actor, orderId, signal);
    if (release.id !== releaseId) unavailable();
    return release;
  }
  const [release] = await tx
    .select(releaseIdentity)
    .from(inventoryProductReleases)
    .where(eq(inventoryProductReleases.id, releaseId));
  if (release === undefined) unavailable();
  await requireItemReleaseAccess(tx, actor, release.itemId, mode);
  signal.throwIfAborted();
  if (mode === "edit" && release.status !== "draft") {
    throw new InventoryDomainError("The approved manufacturing package is read-only.");
  }
  return release;
}
