import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import type { HydratedActor } from "@/server/hydrateActor";
import { currentInventoryActor, lockInventoryOrderDeal, readInventoryDeal } from "./access";
import { canHoldInventory } from "./catalog/eligibility";
import { catalogItemPolicy, createLegacyPartProfile, lockInventoryCatalog } from "./catalog/policy";
import { type InventoryCommand, type InventoryResult, inventoryCommand } from "./contracts";
import { InventoryDomainError, inventoryUnavailable } from "./errors";
import {
  checkInventoryProductionTemplate,
  createInventoryProjectTasks,
  verifyInventoryTasksComplete,
} from "./projectBridge";
import { readInventoryWorkspace } from "./reads";
import { inventoryBuildReleases } from "./releases/schema";
import { findActiveRelease } from "./releases/service";
import {
  inventoryBomLines,
  inventoryCommandReceipts,
  inventoryItems,
  inventoryOrderMaterials,
  inventoryOrders,
  inventoryOrderTasks,
  inventoryStockLimit,
  inventoryTemplates,
} from "./schema";
import { InventoryStockError, lockInventoryStock, postInventoryMovement } from "./stock";

type Item = typeof inventoryItems.$inferSelect;
type Order = typeof inventoryOrders.$inferSelect;
type Move = Parameters<typeof postInventoryMovement>[2];
type Movement = Pick<Move, "kind" | "onHandDelta" | "reservedDelta">;
type CatalogCommand = Extract<
  InventoryCommand,
  { type: "createItem" | "receive" | "saveTemplate" }
>;
type Place = Extract<InventoryCommand, { type: "place" }>;
type OrderCommand = Extract<InventoryCommand, { orderId: string }>;

function fail(message: string): never {
  throw new InventoryDomainError(message);
}

async function claimInventoryReceipt(tx: Db, actorId: string, command: InventoryCommand) {
  // The command is rebuilt by the typed schema, which normalizes values and property order.
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const [receipt] = await tx
    .insert(inventoryCommandReceipts)
    .values({ actorId, requestId: command.requestId, fingerprint })
    .onConflictDoNothing()
    .returning({ requestId: inventoryCommandReceipts.requestId });
  if (receipt) return true;
  const [existing] = await tx
    .select({ fingerprint: inventoryCommandReceipts.fingerprint })
    .from(inventoryCommandReceipts)
    .where(
      and(
        eq(inventoryCommandReceipts.actorId, actorId),
        eq(inventoryCommandReceipts.requestId, command.requestId),
      ),
    );
  if (existing?.fingerprint !== fingerprint) fail("This request ID belongs to another change.");
  return false;
}

async function createItem(tx: Db, command: Extract<CatalogCommand, { type: "createItem" }>) {
  const { sku, name, revision, kind, bom } = command;
  const componentIds = new Set(bom.map(({ itemId }) => itemId));
  if (componentIds.size !== bom.length || (kind === "component" && bom.length > 0)) {
    fail("Use distinct component SKUs in a finished product BOM.");
  }
  if (bom.length > 0) {
    const components = await tx
      .select({ kind: inventoryItems.kind })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [...componentIds]));
    if (components.length !== bom.length || components.some((row) => row.kind !== "component")) {
      fail("Each BOM line must reference a stock component.");
    }
    for (const componentId of componentIds) {
      const policy = await catalogItemPolicy(tx, componentId);
      if (!canHoldInventory(policy) || policy?.flags.component !== true) {
        fail("Each BOM line must reference an active stock component.");
      }
    }
  }
  const id = randomUUID();
  const [created] = await tx
    .insert(inventoryItems)
    .values({ id, sku, name, revision, kind })
    .onConflictDoNothing({ target: inventoryItems.sku })
    .returning({ id: inventoryItems.id });
  if (!created) fail("This SKU already exists.");
  if (!(await createLegacyPartProfile(tx, { id, sku, revision, kind }))) {
    fail("This part code already exists. Open the part master to add a revision.");
  }
  if (bom.length > 0) {
    await tx
      .insert(inventoryBomLines)
      .values(
        bom.map(({ itemId: componentId, quantity }) => ({ itemId: id, componentId, quantity })),
      );
  }
}

function stockItem(stock: Map<string, Item>, id: string) {
  const item = stock.get(id);
  if (item === undefined) fail("The stock item is unavailable.");
  return item;
}

async function changeCatalog(
  tx: Db,
  actor: HydratedActor,
  command: CatalogCommand,
  signal: AbortSignal,
) {
  if (command.type === "createItem") return createItem(tx, command);
  const { requestId, itemId } = command;
  const item = stockItem(await lockInventoryStock(tx, [itemId]), itemId);
  if (command.type === "receive") {
    if (!canHoldInventory(await catalogItemPolicy(tx, itemId))) {
      fail("Stock can only be received for an active, stocked part revision.");
    }
    return postInventoryMovement(tx, item, {
      actorId: actor.id,
      requestId,
      kind: "receipt",
      onHandDelta: command.quantity,
      reservedDelta: 0,
    });
  }
  if (item.kind !== "product") fail("A production template needs a finished product.");
  const { projectId, steps } = command;
  await checkInventoryProductionTemplate(tx, actor, { projectId, steps }, signal);
  const values = { projectId, steps, configuredBy: actor.id };
  await tx
    .insert(inventoryTemplates)
    .values({ itemId, ...values })
    .onConflictDoUpdate({
      target: inventoryTemplates.itemId,
      set: { ...values, revision: sql`${inventoryTemplates.revision} + 1` },
    });
}

async function productionMaterials(tx: Db, item: Item) {
  const release = await findActiveRelease(tx, item.id);
  if (release !== null) {
    return {
      releaseId: release.id,
      bom: release.bom.map(({ itemId, quantity }) => ({ componentId: itemId, quantity })),
    };
  }
  if (item.releaseRequired)
    fail("Approve a manufacturing release before accepting a shortage for this product.");
  const bom = await tx
    .select()
    .from(inventoryBomLines)
    .where(eq(inventoryBomLines.itemId, item.id));
  return { releaseId: null, bom };
}

async function placeOrder(tx: Db, actor: HydratedActor, command: Place, signal: AbortSignal) {
  const actorId = actor.id;
  const { dealId, itemId, quantity, requestId } = command;
  const item = stockItem(await lockInventoryStock(tx, [itemId]), itemId);
  const policy = await catalogItemPolicy(tx, itemId);
  if (
    item.kind !== "product" ||
    !canHoldInventory(policy) ||
    policy?.flags.salable !== true ||
    (actor.type !== "admin" && policy.visibility === "admin")
  ) {
    fail("Select a sellable finished product.");
  }
  const reserved = Math.min(quantity, item.onHand - item.reserved);
  const buildQuantity = quantity - reserved;
  const orderId = randomUUID();
  const order = {
    id: orderId,
    dealId,
    itemId,
    quantity,
    reserved,
    buildQuantity,
    createdBy: actorId,
  };
  if (buildQuantity === 0) {
    await tx.insert(inventoryOrders).values({ ...order, status: "ready" });
  } else {
    const [template] = await tx
      .select()
      .from(inventoryTemplates)
      .where(eq(inventoryTemplates.itemId, itemId));
    const { releaseId, bom } = await productionMaterials(tx, item);
    if (template === undefined || bom.length === 0) {
      fail("Configure a BOM and production template before accepting a shortage.");
    }
    const materials = bom.map(({ componentId, quantity }) => ({
      orderId,
      componentId,
      quantity: quantity * buildQuantity,
    }));
    if (materials.some(({ quantity }) => quantity > inventoryStockLimit)) {
      fail("A material requirement exceeds the warehouse quantity limit.");
    }
    const { projectId, revision: templateRevision } = template;
    await tx
      .insert(inventoryOrders)
      .values({ ...order, projectId, templateRevision, status: "awaiting_materials" });
    await tx.insert(inventoryOrderMaterials).values(materials);
    if (releaseId !== null) {
      await tx.insert(inventoryBuildReleases).values({
        orderId,
        itemId,
        releaseId,
        templateSteps: template.steps,
      });
    }
    const tasks = await createInventoryProjectTasks(tx, actorId, template, signal, orderId);
    await tx
      .insert(inventoryOrderTasks)
      .values(tasks.map((itemId, position) => ({ orderId, projectId, itemId, position })));
  }
  if (reserved > 0) {
    await postInventoryMovement(tx, item, {
      actorId,
      orderId,
      requestId,
      kind: "order-reserve",
      onHandDelta: 0,
      reservedDelta: reserved,
    });
  }
}

const transitionStates = {
  reserveMaterials: ["awaiting_materials"],
  completeBuild: ["in_production"],
  ship: ["ready"],
  cancel: ["awaiting_materials", "in_production", "ready"],
} as const satisfies Record<OrderCommand["type"], readonly Order["status"][]>;

async function changeOrder(
  tx: Db,
  actor: HydratedActor,
  command: OrderCommand,
  signal: AbortSignal,
) {
  const { orderId, requestId, type } = command;
  const [order] = await tx
    .select()
    .from(inventoryOrders)
    .where(eq(inventoryOrders.id, orderId))
    .for("update");
  if (order === undefined) fail("The order is unavailable.");
  const expectedStates: readonly Order["status"][] = transitionStates[type];
  if (order.revision !== command.revision || !expectedStates.includes(order.status)) {
    fail("This order changed. Refresh it and try again.");
  }

  const usesMaterials =
    type === "reserveMaterials" ||
    type === "completeBuild" ||
    (type === "cancel" && order.status === "in_production");
  const materials = usesMaterials
    ? await tx
        .select()
        .from(inventoryOrderMaterials)
        .where(eq(inventoryOrderMaterials.orderId, orderId))
    : [];
  const stock = await lockInventoryStock(tx, [
    order.itemId,
    ...materials.map(({ componentId }) => componentId),
  ]);
  const finished = stockItem(stock, order.itemId);
  const post = (item: Item, movement: Movement) =>
    postInventoryMovement(tx, item, { actorId: actor.id, requestId, orderId, ...movement });
  const postMaterials = async (
    kind: Move["kind"],
    onHandFactor: number,
    reservedFactor: number,
  ) => {
    for (const { componentId, quantity } of materials) {
      await post(stockItem(stock, componentId), {
        kind,
        onHandDelta: onHandFactor * quantity,
        reservedDelta: reservedFactor * quantity,
      });
    }
  };

  let status: Order["status"] = order.status;
  let reserved = order.reserved;
  switch (type) {
    case "reserveMaterials":
      if (
        materials.some(({ componentId, quantity }) => {
          const row = stockItem(stock, componentId);
          return row.onHand - row.reserved < quantity;
        })
      ) {
        fail("There is insufficient available stock to reserve all materials.");
      }
      await postMaterials("materials-reserve", 0, 1);
      status = "in_production";
      break;
    case "completeBuild":
      if (order.projectId === null) fail("The production project is unavailable.");
      await verifyInventoryTasksComplete(tx, actor, orderId, order.projectId, signal);
      await postMaterials("build-consume", -1, -1);
      await post(finished, {
        kind: "build-output",
        onHandDelta: order.buildQuantity,
        reservedDelta: order.buildQuantity,
      });
      reserved = order.quantity;
      status = "ready";
      break;
    case "ship":
      await post(finished, {
        kind: "shipment",
        onHandDelta: -order.reserved,
        reservedDelta: -order.reserved,
      });
      reserved = 0;
      status = "shipped";
      break;
    case "cancel":
      if (order.reserved > 0) {
        await post(finished, {
          kind: "cancel-release",
          onHandDelta: 0,
          reservedDelta: -order.reserved,
        });
      }
      await postMaterials("cancel-release", 0, -1);
      reserved = 0;
      status = "cancelled";
      break;
  }
  await tx
    .update(inventoryOrders)
    .set({ revision: order.revision + 1, status, reserved })
    .where(eq(inventoryOrders.id, orderId));
}

/** Stock changes, native project tasks and the replay receipt share a transaction. */
export async function runInventoryCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  dealContext: string | null,
  signal: AbortSignal,
): Promise<InventoryResult> {
  const parsed = inventoryCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Check the quantity and required fields." };
  const command = parsed.data;
  try {
    await withCurrentAuthority(db, "read", signal, async (tx) => {
      const actor = await currentInventoryActor(tx, who, signal);
      if (actor === null) fail(inventoryUnavailable);
      await lockInventoryCatalog(tx, signal, command.type === "createItem" ? "write" : "read");
      if (dealContext !== null && !(await readInventoryDeal(tx, actor, dealContext))) {
        fail("The deal is unavailable.");
      }
      if (command.type === "place") {
        if (!(await lockInventoryOrderDeal(tx, actor, command.dealId))) {
          fail("This account cannot place an order for that deal.");
        }
      } else if (actor.type !== "admin") {
        fail("Inventory management requires an administrator.");
      }
      if (!(await claimInventoryReceipt(tx, actor.id, command))) return;
      if (command.type === "place") await placeOrder(tx, actor, command, signal);
      else if ("orderId" in command) await changeOrder(tx, actor, command, signal);
      else await changeCatalog(tx, actor, command, signal);

      // Do not commit side effects if the authenticated credential expires during a stock wait.
      if (!(await currentInventoryActor(tx, who, signal))) fail(inventoryUnavailable);
    });
  } catch (error) {
    if (error instanceof InventoryDomainError || error instanceof InventoryStockError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
  // End the write transaction before projecting other orders and acquiring read locks.
  const snapshot = await readInventoryWorkspace(db, who, dealContext, signal);
  // The command may have committed just before the view scope changed. A thrown response
  // leaves the caller's request ID in place for any retry.
  if (!snapshot.ok)
    throw new InventoryDomainError("Inventory changed before its updated view could be loaded.");
  return snapshot;
}
