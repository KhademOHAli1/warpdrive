import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import { inventoryProductionOutputs, type ProductionBuildRow } from "../production/buildSchema";
import type { ExistingProductionCommand, SubcontractCommand } from "../production/contracts";
import { failProduction } from "../production/failure";
import { requireCompletedProductionTasks } from "../production/projects";
import { readPurchaseSiteAccess } from "../purchasing/scope";
import type { WarehouseAccess } from "../warehouse/access";
import { linkSubcontract, type lockSubcontractPurchase } from "./configure";
import { dispatchSubcontract, returnSubcontractMaterial } from "./custody";
import { companySubcontractMaterials, readSubcontract, readSubcontractPurchase } from "./reads";
import { inventorySubcontractDispatches, type Subcontract } from "./schema";
import { releaseSubcontractOutput } from "./settle";

type Order = Awaited<ReturnType<typeof lockSubcontractPurchase>>;

export function isSubcontractCommand(command: { type: string }): command is SubcontractCommand {
  switch (command.type) {
    case "linkSubcontract":
    case "dispatchSubcontract":
    case "returnSubcontractMaterial":
    case "releaseSubcontractOutput":
      return true;
    default:
      return false;
  }
}

export async function requireSubcontractBuyer(
  tx: Db,
  actor: HydratedActor,
  build: ProductionBuildRow,
  order: Order,
) {
  if (order.siteId !== build.siteId) failProduction("unavailable");
  const sites = await readPurchaseSiteAccess(tx, actor);
  if (!sites.some(({ site }) => site.id === order.siteId && site.canBuy))
    failProduction("unavailable");
}

export async function applySubcontractCommand(
  tx: Db,
  actor: HydratedActor,
  access: WarehouseAccess,
  build: ProductionBuildRow,
  command: SubcontractCommand,
  order: Order | null,
  signal: AbortSignal,
) {
  const subcontract = await readSubcontract(tx, build.id);
  if (command.type === "linkSubcontract") {
    if (order === null || subcontract !== null) failProduction("subcontract");
    await requireSubcontractBuyer(tx, actor, build, order);
    return linkSubcontract(tx, actor, access, build, order, command, signal);
  }
  if (subcontract === null) failProduction("subcontract");
  // Purchasing updates this committed state only while holding the same build lock.
  const purchase = await readSubcontractPurchase(tx, subcontract.orderId);
  if (purchase === null) failProduction("subcontract");
  if (command.type === "returnSubcontractMaterial") {
    return returnSubcontractMaterial(tx, actor.id, build, subcontract, command);
  }
  if (build.status !== "issued") failProduction("state");
  if (purchase.status === "cancelled" || purchase.status === "draft") failProduction("subcontract");
  if (command.type === "releaseSubcontractOutput") {
    await requireCompletedProductionTasks(tx, actor, build, signal);
    return releaseSubcontractOutput(tx, actor.id, build, subcontract, command);
  }
  return dispatchSubcontract(tx, actor.id, build, subcontract, command);
}

async function requireResolvedSubcontract(tx: Db, link: Subcontract) {
  const order = await readSubcontractPurchase(tx, link.orderId);
  if (order?.status !== "cancelled") failProduction("subcontract");
  const deliveries = inventoryProductionOutputs;
  const [held] = await tx
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(eq(deliveries.buildId, link.buildId), eq(deliveries.status, "wip")))
    .limit(1);
  const dispatches = inventorySubcontractDispatches;
  const [custody] = await tx
    .select({ id: dispatches.id })
    .from(dispatches)
    .where(
      and(
        eq(dispatches.buildId, link.buildId),
        sql`${dispatches.quantity} > ${dispatches.consumed} + ${dispatches.returned}`,
      ),
    )
    .limit(1);
  if (held !== undefined || custody !== undefined) failProduction("subcontract");
}

export async function requireInternalBuildOperation(
  tx: Db,
  build: ProductionBuildRow,
  command: ExistingProductionCommand,
) {
  const link = await readSubcontract(tx, build.id);
  if (link === null) return;
  switch (command.type) {
    case "cancelBuild":
      return requireResolvedSubcontract(tx, link);
    case "allocate":
    case "autoAllocate":
      if (
        (await readSubcontractPurchase(tx, link.orderId))?.status === "cancelled" ||
        (command.type === "allocate" &&
          !(await companySubcontractMaterials(tx, build.id)).includes(command.materialId))
      )
        failProduction("subcontract");
      return;
    case "schedule":
    case "deallocate":
      return;
    case "cancelBatch":
    case "finalizeBatch":
    case "hold":
    case "issue":
    case "resume":
    case "reverseOutput":
    case "startBatch":
      failProduction("subcontract");
  }
}
