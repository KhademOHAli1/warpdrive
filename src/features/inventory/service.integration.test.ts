import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { deals, permissionSets, pipelines, sessions, stages, users } from "@/db/schema";
import { agencyProjectSettings } from "@/features/agency-projects/schema/agencyProjectSettings";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { internalProjectItemEvents } from "@/features/projects/profile/schema";
import { internalProjectItems } from "@/features/projects/schema";
import {
  createInternalProject,
  readInternalProject,
  setInternalProjectMember,
  updateInternalProjectItem,
} from "@/features/projects/service";
import { makeTestDb, type TestDb } from "@/test/db";
import type { Result } from "@/types/result";
import type { InventoryCommand, InventoryResult, InventoryWorkspace } from "./contracts";
import { readInventoryWorkspace } from "./reads";
import { inventoryCommandReceipts, inventoryMovements, inventoryOrders } from "./schema";
import { runInventoryCommand } from "./service";

let fixture: TestDb;
const signal = () => AbortSignal.timeout(15_000);

beforeAll(async () => {
  fixture = await makeTestDb();
  await fixture.db
    .insert(agencyProjectSettings)
    .values({ id: true, enabled: true })
    .onConflictDoUpdate({ target: agencyProjectSettings.id, set: { enabled: true } });
});

afterAll(async () => {
  await fixture.close();
});

function value<T, E>(result: Result<T, E> | InventoryResult): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected a successful fixture operation");
  return result.value as T;
}

function inventory(result: InventoryResult) {
  return value<InventoryWorkspace, string>(result);
}

async function staff(name: string, role: "admin" | "seller" | "staff" = "staff") {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const permissionSetId = role === "seller" ? randomUUID() : null;
  if (permissionSetId !== null) {
    await fixture.db
      .insert(permissionSets)
      .values({ id: permissionSetId, name: permissionSetId, flags: { "deal.edit_own": true } });
  }
  await fixture.db.insert(users).values({
    id: userId,
    name,
    email: `${userId}@example.test`,
    isAdmin: role === "admin",
    permissionSetId,
  });
  await fixture.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 600_000),
    authMethod: "legacy",
    assurance: "legacy",
  });
  return { userId, sessionId };
}

async function realDeal(owner: NativeSessionRef, visibilityLevel: "all" | "owner" = "all") {
  const [pipeline] = await fixture.db
    .insert(pipelines)
    .values({ name: "Stock inquiries" })
    .returning();
  const [stage] = await fixture.db
    .insert(stages)
    .values({ pipelineId: pipeline!.id, name: "Proposal" })
    .returning();
  const [deal] = await fixture.db
    .insert(deals)
    .values({
      title: "Industrial automation inquiry",
      pipelineId: pipeline!.id,
      stageId: stage!.id,
      ownerId: owner.userId,
      visibilityLevel,
    })
    .returning();
  if (deal === undefined) throw new Error("No deal fixture was stored");
  return deal;
}

const command = (who: NativeSessionRef, input: InventoryCommand, dealId: string | null = null) =>
  runInventoryCommand(fixture.db, who, input, dealId, signal());
const read = (who: NativeSessionRef, dealId: string | null = null) =>
  readInventoryWorkspace(fixture.db, who, dealId, signal());

async function catalogueItem(
  admin: NativeSessionRef,
  kind: "component" | "product",
  bom: { itemId: string; quantity: number }[] = [],
) {
  const sku = `QA-${randomUUID().slice(0, 16).toUpperCase()}`;
  const catalogue = inventory(
    await command(admin, {
      type: "createItem",
      requestId: randomUUID(),
      sku,
      name: kind === "product" ? "I/O unit" : "I/O part",
      revision: "A",
      kind,
      bom,
    }),
  );
  const item = catalogue.items.find((row) => row.sku === sku);
  if (item === undefined) throw new Error("No catalogue fixture was stored");
  return item;
}

async function receive(admin: NativeSessionRef, itemId: string, quantity: number) {
  return inventory(
    await command(admin, { type: "receive", requestId: randomUUID(), itemId, quantity }),
  );
}

function balance(workspace: InventoryWorkspace, itemId: string) {
  const item = workspace.items.find(({ id }) => id === itemId);
  if (item === undefined) throw new Error("No catalogue balance was returned");
  return { onHand: item.onHand, reserved: item.reserved, available: item.onHand - item.reserved };
}

function soleOrder(workspace: InventoryWorkspace) {
  expect(workspace.orders).toHaveLength(1);
  const [order] = workspace.orders;
  if (order === undefined) throw new Error("No order fixture was stored");
  return order;
}

async function productionProject(admin: NativeSessionRef, assignees: NativeSessionRef[]) {
  const created = await createInternalProject(
    fixture.db,
    admin,
    { id: randomUUID(), title: "Private production" },
    signal(),
  );
  if (!created.ok) throw new Error("No production project fixture was created");
  const projectId = created.value.id;
  for (const assignee of assignees) {
    const grant = await setInternalProjectMember(
      fixture.db,
      admin,
      {
        projectId,
        userId: assignee.userId,
        membership: { role: "editor", canAssign: false },
      },
      signal(),
    );
    expect(grant.ok).toBe(true);
  }
  return projectId;
}

const movements = (orderId: string) =>
  fixture.db
    .select({
      itemId: inventoryMovements.itemId,
      kind: inventoryMovements.kind,
      onHandDelta: inventoryMovements.onHandDelta,
      reservedDelta: inventoryMovements.reservedDelta,
    })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.orderId, orderId));

const transition = (
  type: "reserveMaterials" | "completeBuild" | "ship" | "cancel",
  order: { id: string; revision: number },
) => ({ type, orderId: order.id, revision: order.revision, requestId: randomUUID() });

test("concurrent confirmation and replay reserve in-stock units once, leaving the CRM deal unchanged", async () => {
  const admin = await staff("Stock administrator", "admin");
  const seller = await staff("Deal seller", "seller");
  const observer = await staff("Read-only observer");
  const deal = await realDeal(seller);
  const hiddenDeal = await realDeal(admin, "owner");
  const product = await catalogueItem(admin, "product");
  await receive(admin, product.id, 5);
  const place = {
    type: "place",
    requestId: randomUUID(),
    dealId: deal.id,
    itemId: product.id,
    quantity: 2,
  } as const;

  expect(await read(observer, hiddenDeal.id)).toMatchObject({ ok: false });
  expect(inventory(await read(observer, deal.id))).toMatchObject({
    canManage: false,
    canOrder: false,
  });
  expect(await command(observer, place, deal.id)).toMatchObject({ ok: false });
  expect(
    await command(observer, {
      type: "receive",
      requestId: randomUUID(),
      itemId: product.id,
      quantity: 1,
    }),
  ).toMatchObject({ ok: false });
  expect(await command(seller, { ...place, dealId: hiddenDeal.id }, deal.id)).toMatchObject({
    ok: false,
  });
  expect(inventory(await read(seller, deal.id))).toMatchObject({
    canManage: false,
    canOrder: true,
  });

  const [first, duplicate] = await Promise.all([
    command(seller, place, deal.id),
    command(seller, place, deal.id),
  ]);
  const order = soleOrder(inventory(first));
  expect(soleOrder(inventory(duplicate))).toEqual(order);
  expect(order).toMatchObject({
    quantity: 2,
    reserved: 2,
    buildQuantity: 0,
    status: "ready",
    projectId: null,
    tasks: [],
  });
  expect(await command(seller, { ...place, quantity: 3 }, deal.id)).toMatchObject({ ok: false });
  expect(soleOrder(inventory(await command(seller, place, deal.id)))).toEqual(order);
  expect(balance(inventory(await read(admin, deal.id)), product.id)).toEqual({
    onHand: 5,
    reserved: 2,
    available: 3,
  });
  expect(await movements(order.id)).toEqual([
    { itemId: product.id, kind: "order-reserve", onHandDelta: 0, reservedDelta: 2 },
  ]);
  const [retained] = await fixture.db
    .select({ writeVersion: deals.writeVersion })
    .from(deals)
    .where(eq(deals.id, deal.id));
  expect(retained?.writeVersion).toBe(deal.writeVersion);
});

test("shortage and invalid assignee roll back stock, tasks, order, and replay receipt", async () => {
  const admin = await staff("Template owner", "admin");
  const seller = await staff("Seller requiring a build", "seller");
  const member = await staff("Active production assignee");
  const removed = await staff("Removed production assignee");
  const deal = await realDeal(seller);
  const component = await catalogueItem(admin, "component");
  const product = await catalogueItem(admin, "product", [{ itemId: component.id, quantity: 1 }]);
  const projectId = await productionProject(admin, [member, removed]);
  await receive(admin, product.id, 2);
  const place = {
    type: "place",
    requestId: randomUUID(),
    dealId: deal.id,
    itemId: product.id,
    quantity: 3,
  } as const;

  async function expectNoEffects() {
    const workspace = inventory(await read(admin, deal.id));
    expect(workspace.orders).toEqual([]);
    expect(balance(workspace, product.id)).toEqual({ onHand: 2, reserved: 0, available: 2 });
    expect(
      await fixture.db
        .select()
        .from(inventoryCommandReceipts)
        .where(
          and(
            eq(inventoryCommandReceipts.actorId, seller.userId),
            eq(inventoryCommandReceipts.requestId, place.requestId),
          ),
        ),
    ).toEqual([]);
    expect(
      await fixture.db
        .select()
        .from(internalProjectItems)
        .where(eq(internalProjectItems.projectId, projectId)),
    ).toEqual([]);
  }

  expect(await command(seller, place, deal.id)).toMatchObject({ ok: false });
  await expectNoEffects();
  const template = {
    type: "saveTemplate",
    requestId: randomUUID(),
    itemId: product.id,
    projectId,
    steps: [
      { title: "Stage stock", assigneeId: member.userId },
      { title: "Fault-inject removed member", assigneeId: removed.userId },
    ],
  } as const;
  inventory(await command(admin, { ...template, steps: [...template.steps] }));
  expect(
    (
      await setInternalProjectMember(
        fixture.db,
        admin,
        {
          projectId,
          userId: removed.userId,
          membership: null,
        },
        signal(),
      )
    ).ok,
  ).toBe(true);
  expect(await command(seller, place, deal.id)).toMatchObject({ ok: false });
  await expectNoEffects();

  inventory(
    await command(admin, { ...template, requestId: randomUUID(), steps: [template.steps[0]] }),
  );
  expect(soleOrder(inventory(await command(seller, place, deal.id)))).toMatchObject({
    status: "awaiting_materials",
    quantity: 3,
    reserved: 2,
    buildQuantity: 1,
  });
});

test("shortage creates assigned native to-dos and only a completed build can post output and ship", async () => {
  const admin = await staff("Production project owner", "admin");
  const seller = await staff("Order author", "seller");
  const planner = await staff("Production planner");
  const assembler = await staff("Production assembler");
  const deal = await realDeal(seller);
  const projectId = await productionProject(admin, [planner, assembler]);
  const pcb = await catalogueItem(admin, "component");
  const enclosure = await catalogueItem(admin, "component");
  const product = await catalogueItem(admin, "product", [
    { itemId: pcb.id, quantity: 2 },
    { itemId: enclosure.id, quantity: 1 },
  ]);
  await receive(admin, pcb.id, 10);
  await receive(admin, enclosure.id, 2);
  await receive(admin, product.id, 2);
  inventory(
    await command(admin, {
      type: "saveTemplate",
      requestId: randomUUID(),
      itemId: product.id,
      projectId,
      steps: [
        { title: "Pick components", assigneeId: planner.userId },
        { title: "Assemble product", assigneeId: assembler.userId },
      ],
    }),
  );
  const place = {
    type: "place",
    requestId: randomUUID(),
    dealId: deal.id,
    itemId: product.id,
    quantity: 5,
  } as const;
  const sellerOrder = soleOrder(inventory(await command(seller, place, deal.id)));
  expect(sellerOrder).toMatchObject({
    quantity: 5,
    reserved: 2,
    buildQuantity: 3,
    status: "awaiting_materials",
    projectId: null,
    tasks: [],
  });

  const waiting = soleOrder(inventory(await read(admin, deal.id)));
  expect(waiting).toMatchObject({
    projectId,
    materials: expect.arrayContaining([
      { itemId: pcb.id, quantity: 6 },
      { itemId: enclosure.id, quantity: 3 },
    ]),
  });
  expect(waiting.tasks.map(({ title, done }) => ({ title, done }))).toEqual([
    { title: "Pick components", done: false },
    { title: "Assemble product", done: false },
  ]);
  const native = await readInternalProject(fixture.db, admin, projectId, signal());
  if (!native.ok) throw new Error("Production project is missing");
  expect(native.value.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: waiting.tasks[0]?.id,
        createdBy: seller.userId,
        assigneeId: planner.userId,
        status: "todo",
      }),
      expect.objectContaining({
        id: waiting.tasks[1]?.id,
        createdBy: seller.userId,
        assigneeId: assembler.userId,
        status: "todo",
      }),
    ]),
  );
  for (const task of waiting.tasks) {
    expect(
      await fixture.db
        .select({
          actorId: internalProjectItemEvents.actorId,
          kind: internalProjectItemEvents.kind,
        })
        .from(internalProjectItemEvents)
        .where(eq(internalProjectItemEvents.itemId, task.id)),
    ).toEqual([{ actorId: seller.userId, kind: "created" }]);
  }

  const reserve = transition("reserveMaterials", waiting);
  expect(await command(admin, reserve, deal.id)).toMatchObject({ ok: false });
  const afterShortage = inventory(await read(admin, deal.id));
  expect(balance(afterShortage, pcb.id)).toEqual({ onHand: 10, reserved: 0, available: 10 });
  expect(balance(afterShortage, enclosure.id)).toEqual({ onHand: 2, reserved: 0, available: 2 });
  await receive(admin, enclosure.id, 4);
  const producing = soleOrder(inventory(await command(admin, reserve, deal.id)));
  expect(producing).toMatchObject({ status: "in_production", revision: waiting.revision + 1 });
  expect(await command(admin, transition("ship", producing), deal.id)).toMatchObject({ ok: false });
  expect(await command(admin, transition("completeBuild", waiting), deal.id)).toMatchObject({
    ok: false,
  });
  const complete = transition("completeBuild", producing);
  expect(await command(admin, complete, deal.id)).toMatchObject({ ok: false });

  for (const [index, item] of native.value.items.entries()) {
    const actor = item.assigneeId === planner.userId ? planner : assembler;
    const updated = await updateInternalProjectItem(
      fixture.db,
      actor,
      {
        projectId,
        itemId: item.id,
        revision: item.revision,
        status: "done",
      },
      signal(),
    );
    expect(updated.ok).toBe(true);
    if (index === 0) expect(await command(admin, complete, deal.id)).toMatchObject({ ok: false });
  }

  const completed = inventory(await command(admin, complete, deal.id));
  const ready = soleOrder(completed);
  expect(ready).toMatchObject({
    status: "ready",
    reserved: 5,
    tasks: expect.arrayContaining([
      expect.objectContaining({ done: true }),
      expect.objectContaining({ done: true }),
    ]),
  });
  expect(ready.tasks.every(({ done }) => done)).toBe(true);
  expect(balance(completed, product.id)).toEqual({ onHand: 5, reserved: 5, available: 0 });
  expect(balance(completed, pcb.id)).toEqual({ onHand: 4, reserved: 0, available: 4 });
  expect(balance(completed, enclosure.id)).toEqual({ onHand: 3, reserved: 0, available: 3 });

  const shipment = transition("ship", ready);
  const shipped = inventory(await command(admin, shipment, deal.id));
  const shippedOrder = soleOrder(shipped);
  expect(shippedOrder).toMatchObject({
    status: "shipped",
    reserved: 0,
    revision: ready.revision + 1,
  });
  expect(soleOrder(inventory(await command(admin, shipment, deal.id)))).toEqual(shippedOrder);
  expect(await command(admin, transition("ship", shippedOrder), deal.id)).toMatchObject({
    ok: false,
  });
  expect(balance(shipped, product.id)).toEqual({ onHand: 0, reserved: 0, available: 0 });
  expect(await movements(waiting.id)).toEqual(
    expect.arrayContaining([
      { itemId: product.id, kind: "order-reserve", onHandDelta: 0, reservedDelta: 2 },
      { itemId: pcb.id, kind: "materials-reserve", onHandDelta: 0, reservedDelta: 6 },
      { itemId: enclosure.id, kind: "materials-reserve", onHandDelta: 0, reservedDelta: 3 },
      { itemId: pcb.id, kind: "build-consume", onHandDelta: -6, reservedDelta: -6 },
      { itemId: enclosure.id, kind: "build-consume", onHandDelta: -3, reservedDelta: -3 },
      { itemId: product.id, kind: "build-output", onHandDelta: 3, reservedDelta: 3 },
      { itemId: product.id, kind: "shipment", onHandDelta: -5, reservedDelta: -5 },
    ]),
  );
  expect(await movements(waiting.id)).toHaveLength(7);
});

test("cancelling a production order releases finished and component reservations exactly once", async () => {
  const admin = await staff("Cancellation owner", "admin");
  const seller = await staff("Cancellation customer owner", "seller");
  const deal = await realDeal(seller);
  const projectId = await productionProject(admin, []);
  const component = await catalogueItem(admin, "component");
  const product = await catalogueItem(admin, "product", [{ itemId: component.id, quantity: 2 }]);
  await receive(admin, product.id, 2);
  await receive(admin, component.id, 10);
  inventory(
    await command(admin, {
      type: "saveTemplate",
      requestId: randomUUID(),
      itemId: product.id,
      projectId,
      steps: [{ title: "Assemble part", assigneeId: admin.userId }],
    }),
  );
  const place = {
    type: "place",
    requestId: randomUUID(),
    dealId: deal.id,
    itemId: product.id,
    quantity: 4,
  } as const;
  const waiting = soleOrder(inventory(await command(seller, place, deal.id)));
  const producing = soleOrder(
    inventory(await command(admin, transition("reserveMaterials", waiting), deal.id)),
  );
  const cancel = transition("cancel", producing);
  const released = inventory(await command(admin, cancel, deal.id));
  const result = soleOrder(released);
  expect(result).toMatchObject({ status: "cancelled", reserved: 0 });
  expect(soleOrder(inventory(await command(admin, cancel, deal.id)))).toEqual(result);
  expect(balance(released, product.id)).toEqual({ onHand: 2, reserved: 0, available: 2 });
  expect(balance(released, component.id)).toEqual({ onHand: 10, reserved: 0, available: 10 });
  expect((await movements(waiting.id)).filter(({ kind }) => kind === "cancel-release")).toEqual(
    expect.arrayContaining([
      { itemId: product.id, kind: "cancel-release", onHandDelta: 0, reservedDelta: -2 },
      { itemId: component.id, kind: "cancel-release", onHandDelta: 0, reservedDelta: -4 },
    ]),
  );
  expect(await movements(waiting.id)).toHaveLength(4);
  expect(
    await fixture.db
      .select({ status: inventoryOrders.status })
      .from(inventoryOrders)
      .where(eq(inventoryOrders.id, result.id)),
  ).toEqual([{ status: "cancelled" }]);
});
