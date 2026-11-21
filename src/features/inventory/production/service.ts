import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { currentInventoryActor } from "../access";
import { BomPlanningFailure } from "../bom/failure";
import { readBomGraph } from "../bom/graph";
import { lockBomReleaseGrants } from "../bom/reads";
import { lockInventoryCatalog } from "../catalog/policy";
import { InventoryDomainError } from "../errors";
import { requireItemReleaseAccess } from "../releases/access";
import { inventoryProductReleases } from "../releases/schema";
import { InventoryStockError, lockInventoryStock } from "../stock";
import { readWarehouseAccess, type WarehouseAccess } from "../warehouse/access";
import { inventoryProductionBuilds, type ProductionBuildRow } from "./buildSchema";
import {
  type ProductionCommand,
  type ProductionEffect,
  type ProductionError,
  type ProductionQuery,
  type ProductionResult,
  productionCommand,
} from "./contracts";
import { createProductionTree } from "./create";
import { executeBuildOperation } from "./execution";
import { failProduction, ProductionFailure } from "./failure";
import { inventoryProductionReceipts } from "./materialSchema";
import { requireCompletedProductionTasks } from "./projects";
import { projectProductionWorkspace } from "./reads";

function productionError(error: unknown): ProductionError {
  if (error instanceof ProductionFailure || error instanceof BomPlanningFailure) return error.code;
  if (error instanceof InventoryStockError) return "stock";
  if (error instanceof InventoryDomainError) return "project";
  throw error;
}

async function currentProductionActor(tx: Db, who: NativeSessionRef, signal: AbortSignal) {
  const actor = await currentInventoryActor(tx, who, signal);
  if (actor === null || actor.projectsGuestOnly) failProduction("unavailable");
  return actor;
}

export async function readProductionWorkspace(
  db: Db,
  who: NativeSessionRef,
  query: ProductionQuery,
  signal: AbortSignal,
): Promise<ProductionResult> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const actor = await currentProductionActor(tx, who, signal);
      const access = await readWarehouseAccess(tx, actor, signal);
      const scope = await lockBomReleaseGrants(tx, actor);
      const value = await projectProductionWorkspace(tx, actor, access, scope, query, signal);
      await currentProductionActor(tx, who, signal);
      return ok(value);
    });
  } catch (error) {
    return err(productionError(error));
  }
}

function requireManagedBuildBin(access: WarehouseAccess, siteId: string, locationId: string) {
  const site = access.sites.find(({ id }) => id === siteId);
  const bin = access.locations.find(({ id }) => id === locationId);
  if (
    site?.canManage !== true ||
    site.archived ||
    bin?.siteId !== siteId ||
    bin.archived ||
    bin.kind !== "storage"
  ) {
    failProduction("unavailable");
  }
}

async function lockProductionBuild(tx: Db, access: WarehouseAccess, buildId: string) {
  const [build] = await tx
    .select()
    .from(inventoryProductionBuilds)
    .where(eq(inventoryProductionBuilds.id, buildId))
    .for("update");
  if (build === undefined) failProduction("unavailable");
  requireManagedBuildBin(access, build.siteId, build.locationId);
  return build;
}

async function lockProductionDescendants(
  tx: Db,
  access: WarehouseAccess,
  build: ProductionBuildRow,
) {
  const children = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE branch (id, path) AS (
      SELECT id, ARRAY[id] FROM inventory_production_builds WHERE parent_id = ${build.id}
      UNION ALL
      SELECT child.id, branch.path || child.id FROM branch
        JOIN inventory_production_builds child ON child.parent_id = branch.id
    )
    SELECT id FROM branch ORDER BY path
  `);
  const descendants = [];
  // Keep ancestor locks ahead of descendant locks and ahead of all stock locks.
  for (const { id } of children.rows) descendants.push(await lockProductionBuild(tx, access, id));
  return descendants;
}

async function authorizedGraph(
  tx: Db,
  actor: HydratedActor,
  releaseId: string,
  signal: AbortSignal,
) {
  const [release] = await tx
    .select({ itemId: inventoryProductReleases.itemId })
    .from(inventoryProductReleases)
    .where(
      and(
        eq(inventoryProductReleases.id, releaseId),
        eq(inventoryProductReleases.status, "released"),
      ),
    );
  if (release === undefined) failProduction("unavailable");
  try {
    await requireItemReleaseAccess(tx, actor, release.itemId, "view");
  } catch (error) {
    if (error instanceof InventoryDomainError) failProduction("unavailable");
    throw error;
  }
  // Release grant changes lock the part before touching the grant. Discover IDs while
  // the catalog is stable, then take the stock locks before taking grant locks.
  const discovery = await readBomGraph(tx, null, releaseId, signal);
  await lockInventoryStock(tx, [...discovery.parts.keys()]);
  const scope = await lockBomReleaseGrants(tx, actor);
  return readBomGraph(tx, scope, releaseId, signal);
}

async function applyProductionCommand(
  tx: Db,
  actor: HydratedActor,
  access: WarehouseAccess,
  command: ProductionCommand,
  signal: AbortSignal,
) {
  if (command.type === "createBuild") {
    requireManagedBuildBin(access, command.siteId, command.locationId);
    const graph = await authorizedGraph(tx, actor, command.releaseId, signal);
    return createProductionTree(tx, actor, command, graph, signal);
  }
  const build = await lockProductionBuild(tx, access, command.buildId);
  const descendants =
    command.type === "cancelBuild" ? await lockProductionDescendants(tx, access, build) : [];
  await authorizedGraph(tx, actor, build.releaseId, signal);
  if (build.version !== command.version) failProduction("stale");
  if (command.type === "finalizeBatch" && command.disposition === "completed") {
    await requireCompletedProductionTasks(tx, actor, build, signal);
  }
  await executeBuildOperation(tx, actor.id, build, command, signal);
  if (command.type === "cancelBuild") {
    for (const child of descendants) {
      if (child.status === "closed" || child.status === "cancelled") continue;
      await executeBuildOperation(
        tx,
        actor.id,
        child,
        { ...command, buildId: child.id, version: child.version },
        signal,
      );
      await tx
        .update(inventoryProductionBuilds)
        .set({ version: child.version + 1 })
        .where(eq(inventoryProductionBuilds.id, child.id));
    }
  }
  await tx
    .update(inventoryProductionBuilds)
    .set({ version: build.version + 1 })
    .where(eq(inventoryProductionBuilds.id, build.id));
  return build.id;
}

async function changeOrReplay(
  tx: Db,
  actor: HydratedActor,
  access: WarehouseAccess,
  command: ProductionCommand,
  signal: AbortSignal,
) {
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`production:${actor.id}`}), hashtext(${command.requestId}))`,
  );
  const [receipt] = await tx
    .select()
    .from(inventoryProductionReceipts)
    .where(
      and(
        eq(inventoryProductionReceipts.actorId, actor.id),
        eq(inventoryProductionReceipts.requestId, command.requestId),
      ),
    );
  if (receipt !== undefined) {
    const build = await lockProductionBuild(tx, access, receipt.buildId);
    await authorizedGraph(tx, actor, build.releaseId, signal);
    if (receipt.fingerprint !== fingerprint) failProduction("stale");
    return build.id;
  }
  const buildId = await applyProductionCommand(tx, actor, access, command, signal);
  await tx.insert(inventoryProductionReceipts).values({
    actorId: actor.id,
    requestId: command.requestId,
    buildId,
    fingerprint,
    command: command.type,
    reason: "reason" in command ? command.reason : null,
  });
  return buildId;
}

export async function runProductionCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<ProductionEffect> {
  const parsed = productionCommand.safeParse(raw);
  if (!parsed.success) return err("invalid");
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const actor = await currentProductionActor(tx, who, signal);
      const access = await readWarehouseAccess(tx, actor, signal);
      const buildId = await changeOrReplay(tx, actor, access, parsed.data, signal);
      await currentProductionActor(tx, who, signal);
      return ok({ buildId });
    });
  } catch (error) {
    return err(productionError(error));
  }
}
