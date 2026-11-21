import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, pipelines, users } from "@/db/schema";
import {
  agencyProjectMembers,
  agencyProjects,
} from "@/features/agency-projects/schema/agencyProjects";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import {
  type InternalProjectAccess,
  listInternalProjectScope,
  lockInternalProject,
} from "@/features/projects/access";
import type { HydratedActor } from "@/server/hydrateActor";
import { currentInventoryActor, inventoryDealVisibility, readInventoryDeal } from "./access";
import { canHoldInventory } from "./catalog/eligibility";
import { catalogItemPolicies, lockInventoryCatalog } from "./catalog/policy";
import type {
  InventoryOrder,
  InventoryProject,
  InventoryResult,
  InventoryTemplate,
} from "./contracts";
import { inventoryUnavailable } from "./errors";
import { inventoryProjectsEnabled, readInventoryProjectTaskRows } from "./projectBridge";
import {
  inventoryBuildReleases,
  inventoryProductReleases,
  inventoryReleaseGrants,
} from "./releases/schema";
import {
  inventoryBomLines,
  inventoryItems,
  inventoryOrderMaterials,
  inventoryOrders,
  inventoryTemplates,
} from "./schema";
import { summarizeStockAvailability } from "./warehouse/balances";
import { readOrderWarehouseSites } from "./warehouse/legacyScope";
import { readStockSnapshot } from "./warehouse/snapshot";

async function readOrders(tx: Db, actor: HydratedActor, dealId: string | null) {
  const visibleDeals = tx
    .select({ id: deals.id })
    .from(deals)
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .where(inventoryDealVisibility(actor))
    .as("visible_inventory_deals");
  return tx
    .select({
      id: inventoryOrders.id,
      dealId: visibleDeals.id,
      itemId: inventoryOrders.itemId,
      quantity: inventoryOrders.quantity,
      reserved: inventoryOrders.reserved,
      buildQuantity: inventoryOrders.buildQuantity,
      status: inventoryOrders.status,
      revision: inventoryOrders.revision,
      projectId: inventoryOrders.projectId,
      releaseRevision: inventoryProductReleases.revision,
    })
    .from(inventoryOrders)
    .leftJoin(visibleDeals, eq(visibleDeals.id, inventoryOrders.dealId))
    .leftJoin(inventoryBuildReleases, eq(inventoryBuildReleases.orderId, inventoryOrders.id))
    .leftJoin(
      inventoryProductReleases,
      eq(inventoryBuildReleases.releaseId, inventoryProductReleases.id),
    )
    .where(
      and(
        dealId === null ? undefined : eq(inventoryOrders.dealId, dealId),
        dealId === null && actor.type === "admin" ? undefined : isNotNull(visibleDeals.id),
      ),
    )
    .orderBy(desc(inventoryOrders.createdAt), asc(inventoryOrders.id));
}

async function projectAccessForOrders(
  tx: Db,
  actor: HydratedActor,
  orders: Awaited<ReturnType<typeof readOrders>>,
  signal: AbortSignal,
) {
  const access = new Map<string, InternalProjectAccess>();
  const configureCandidates =
    actor.type === "admin"
      ? await tx
          .select({ id: agencyProjects.id })
          .from(agencyProjects)
          .where(and(listInternalProjectScope(tx, actor.id), ne(agencyProjects.state, "archived")))
          .orderBy(asc(agencyProjects.title), asc(agencyProjects.id))
      : [];
  const ids = new Set(configureCandidates.map(({ id }) => id));
  for (const { projectId } of orders) {
    if (projectId !== null) ids.add(projectId);
  }
  for (const id of [...ids].sort()) {
    signal.throwIfAborted();
    const project = await lockInternalProject(tx, actor, id, "read", "work-items");
    if (project.ok) access.set(id, project.value);
  }
  return {
    access,
    configurable: configureCandidates.flatMap(({ id }) => {
      const project = access.get(id);
      return project?.canAssign === true && !project.summary.archived ? [project] : [];
    }),
  };
}

async function readProjectChoices(
  tx: Db,
  projects: InternalProjectAccess[],
): Promise<InventoryProject[]> {
  if (projects.length === 0) return [];
  const byProject = new Map<string, InventoryProject>(
    projects.map(({ summary, ownerEligible }) => [
      summary.id,
      { id: summary.id, title: summary.title, members: ownerEligible ? [summary.owner] : [] },
    ]),
  );
  const memberships = await tx
    .select({ projectId: agencyProjectMembers.projectId, id: users.id, name: users.name })
    .from(agencyProjectMembers)
    .innerJoin(users, eq(users.id, agencyProjectMembers.userId))
    .where(
      and(
        inArray(agencyProjectMembers.projectId, [...byProject.keys()]),
        eq(agencyProjectMembers.projectGuest, false),
        eq(users.isActive, true),
        eq(users.projectsGuestOnly, false),
        isNull(users.invitedAt),
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
  for (const { projectId, id, name } of memberships) {
    const members = byProject.get(projectId)?.members;
    if (members && !members.some((member) => member.id === id)) members.push({ id, name });
  }
  return [...byProject.values()];
}

async function readCatalog(tx: Db, projects: InventoryProject[], actor: HydratedActor) {
  const grants =
    actor.type === "admin"
      ? []
      : await tx
          .select({ itemId: inventoryReleaseGrants.itemId })
          .from(inventoryReleaseGrants)
          .where(eq(inventoryReleaseGrants.userId, actor.id));
  const releaseItems = new Set(grants.map(({ itemId }) => itemId));
  const policies = await catalogItemPolicies(tx);
  const items = (await tx.select().from(inventoryItems).orderBy(asc(inventoryItems.sku))).filter(
    ({ id }) => actor.type === "admin" || policies.get(id)?.visibility !== "admin",
  );
  const warehouseSites = await readOrderWarehouseSites(tx, actor);
  const snapshot = await readStockSnapshot(
    tx,
    items.map(({ id }) => id),
  );
  const visibleIds = new Set(items.map(({ id }) => id));
  const bom = await tx
    .select({
      itemId: inventoryBomLines.itemId,
      componentId: inventoryBomLines.componentId,
      quantity: inventoryBomLines.quantity,
    })
    .from(inventoryBomLines)
    .orderBy(asc(inventoryBomLines.componentId));
  const bomByItem = new Map<string, { itemId: string; quantity: number }[]>();
  for (const { itemId, componentId, quantity } of bom) {
    if (!visibleIds.has(componentId)) continue;
    const lines = bomByItem.get(itemId) ?? [];
    lines.push({ itemId: componentId, quantity });
    bomByItem.set(itemId, lines);
  }
  const templates = new Map<string, InventoryTemplate>();
  if (projects.length > 0) {
    const rows = await tx
      .select({
        itemId: inventoryTemplates.itemId,
        projectId: inventoryTemplates.projectId,
        steps: inventoryTemplates.steps,
      })
      .from(inventoryTemplates)
      .where(
        inArray(
          inventoryTemplates.projectId,
          projects.map(({ id }) => id),
        ),
      );
    for (const { itemId, projectId, steps } of rows) templates.set(itemId, { projectId, steps });
  }
  return items.map((item) => {
    const policy = policies.get(item.id) ?? null;
    const stockable = canHoldInventory(policy);
    const balance = summarizeStockAvailability(
      snapshot.balances.get(item.id) ?? item,
      snapshot.positions.get(item.id) ?? [],
      warehouseSites,
    );
    return {
      ...item,
      onHand: balance.onHand,
      reserved: balance.reserved,
      available: stockable ? balance.available : 0,
      partCode: policy?.code ?? item.sku,
      canReceive: stockable && policy?.flags.trackable !== true,
      canSell: stockable && policy?.flags.salable === true,
      canUseAsComponent: stockable && policy?.flags.component === true,
      bom: bomByItem.get(item.id) ?? [],
      template: templates.get(item.id) ?? null,
      releaseAccess: actor.type === "admin" || releaseItems.has(item.id),
    };
  });
}

async function addOrderDetails(
  tx: Db,
  orders: Awaited<ReturnType<typeof readOrders>>,
  access: Map<string, InternalProjectAccess>,
): Promise<InventoryOrder[]> {
  if (orders.length === 0) return [];
  const materialRows = await tx
    .select({
      orderId: inventoryOrderMaterials.orderId,
      itemId: inventoryOrderMaterials.componentId,
      quantity: inventoryOrderMaterials.quantity,
    })
    .from(inventoryOrderMaterials)
    .where(
      inArray(
        inventoryOrderMaterials.orderId,
        orders.map(({ id }) => id),
      ),
    )
    .orderBy(asc(inventoryOrderMaterials.componentId));
  const materials = new Map<string, InventoryOrder["materials"]>();
  for (const { orderId, ...material } of materialRows) {
    const lines = materials.get(orderId) ?? [];
    lines.push(material);
    materials.set(orderId, lines);
  }
  const projectOrderIds = orders.flatMap(({ id, projectId }) =>
    projectId !== null && access.has(projectId) ? [id] : [],
  );
  const tasks = new Map<string, InventoryOrder["tasks"]>();
  for (const task of await readInventoryProjectTaskRows(tx, projectOrderIds)) {
    const project = access.get(task.projectId);
    if (
      !project ||
      (project.workItemCreatorId !== null && project.workItemCreatorId !== task.createdBy)
    )
      continue;
    const steps = tasks.get(task.orderId) ?? [];
    steps.push({ id: task.id, title: task.title, done: task.category === "completed" });
    tasks.set(task.orderId, steps);
  }
  return orders.map(({ releaseRevision, ...order }) => ({
    ...order,
    projectId: order.projectId !== null && access.has(order.projectId) ? order.projectId : null,
    materials: materials.get(order.id) ?? [],
    tasks: tasks.get(order.id) ?? [],
    release:
      releaseRevision !== null &&
      order.projectId !== null &&
      access.get(order.projectId)?.guestAccess === null
        ? { revision: releaseRevision }
        : null,
  }));
}

export async function readInventoryWorkspace(
  db: Db,
  who: NativeSessionRef,
  dealId: string | null,
  signal: AbortSignal,
): Promise<InventoryResult> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    const actor = await currentInventoryActor(tx, who, signal);
    if (actor === null) return { ok: false, error: inventoryUnavailable };
    await lockInventoryCatalog(tx, signal, "read");
    await lockDirectory(tx, "read", signal);
    if (dealId !== null && !(await readInventoryDeal(tx, actor, dealId))) {
      return { ok: false, error: "The deal is unavailable." };
    }
    const orders = await readOrders(tx, actor, dealId);
    const { access, configurable } = (await inventoryProjectsEnabled(tx))
      ? await projectAccessForOrders(tx, actor, orders, signal)
      : { access: new Map<string, InternalProjectAccess>(), configurable: [] };
    const projects = await readProjectChoices(tx, configurable);
    const items = await readCatalog(tx, projects, actor);
    const orderDetails = await addOrderDetails(tx, orders, access);
    // A lock or query can outlast the credential used to admit this read.
    if ((await currentInventoryActor(tx, who, signal)) === null) {
      return { ok: false, error: inventoryUnavailable };
    }
    // Legacy CRM writers can also change the deal/pipeline rows independently of this fence.
    const deal = dealId === null ? null : await readInventoryDeal(tx, actor, dealId);
    if (dealId !== null && deal === null) return { ok: false, error: "The deal is unavailable." };
    return {
      ok: true,
      value: {
        items,
        orders: orderDetails,
        projects,
        deal: deal === null ? null : { id: deal.id, name: deal.name },
        canManage: actor.type === "admin",
        canOrder: deal?.canOrder ?? false,
        fixture: false,
      },
    };
  });
}
