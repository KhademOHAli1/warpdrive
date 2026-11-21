import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { deals, permissionSets, pipelines, sessions, stages, users } from "@/db/schema";
import { agencyProjectSettings } from "@/features/agency-projects/schema/agencyProjectSettings";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { FakeStorageClient } from "@/features/files/storageFake";
import {
  directoryLocations,
  directorySiteGrants,
  directorySites,
} from "@/features/locations/schema";
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
import { readBomPlanningWorkspace } from "./bom/service";
import { blankCatalogProfile } from "./catalog/contracts";
import { inventoryPartProfiles } from "./catalog/schema";
import { runCatalogCommand } from "./catalog/service";
import type { InventoryCommand, InventoryResult, InventoryWorkspace } from "./contracts";
import { readInventoryWorkspace } from "./reads";
import {
  confirmReleaseArtifactUpload,
  readReleaseArtifactDownload,
  requestReleaseArtifactUpload,
} from "./releases/artifacts";
import { createReleaseFixture } from "./releases/fixtures";
import {
  inventoryBuildReleases,
  inventoryProductReleases,
  inventoryReleaseArtifacts,
} from "./releases/schema";
import { executeReleaseMetadata, readBuildRelease, readReleaseWorkspace } from "./releases/service";
import { inventoryCommandReceipts, inventoryMovements, inventoryOrders } from "./schema";
import { runInventoryCommand } from "./service";
import { runWarehouseCommand } from "./warehouse/service";

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

test("approves versioned Gerber packages and pins builds, materials and authorization to the selected revision", async () => {
  const admin = await staff("Release administrator", "admin");
  const editor = await staff("Release engineer");
  const approver = await staff("Release approver");
  const operator = await staff("Production operator");
  const seller = await staff("Release sales", "seller");
  const outsider = await staff("Other staff");
  const component = await catalogueItem(admin, "component");
  const product = await catalogueItem(admin, "product", [{ itemId: component.id, quantity: 9 }]);
  const deal = await realDeal(seller);
  const projectId = await productionProject(admin, [operator]);
  await command(admin, {
    type: "saveTemplate",
    requestId: randomUUID(),
    itemId: product.id,
    projectId,
    steps: [{ title: "Build release", assigneeId: operator.userId }],
  });
  const storage = new FakeStorageClient();
  const metadata = (who: NativeSessionRef, change: Parameters<typeof executeReleaseMetadata>[2]) =>
    executeReleaseMetadata(fixture.db, who, change, signal(), storage);
  const workspace = (who: NativeSessionRef) =>
    readReleaseWorkspace(fixture.db, who, product.id, signal());
  const build = (who: NativeSessionRef, orderId: string) =>
    readBuildRelease(fixture.db, who, orderId, signal());
  value(await metadata(admin, { type: "setRequirement", itemId: product.id, required: true }));
  expect(
    await command(
      seller,
      {
        type: "place",
        requestId: randomUUID(),
        dealId: deal.id,
        itemId: product.id,
        quantity: 2,
      },
      deal.id,
    ),
  ).toMatchObject({ ok: false, error: expect.stringContaining("manufacturing release") });
  expect(inventory(await read(seller, deal.id)).orders).toEqual([]);

  for (const [userId, role] of [
    [editor.userId, "editor"],
    [approver.userId, "approver"],
  ] as const) {
    value(await metadata(admin, { type: "setGrant", itemId: product.id, userId, role }));
  }
  expect(await workspace(outsider)).toMatchObject({ ok: false });
  expect(
    await metadata(approver, { type: "createDraft", itemId: product.id, revision: "DENIED" }),
  ).toMatchObject({ ok: false });
  const archive = createReleaseFixture({
    ...product,
    sku: "IO-24-DIN",
  }).releases[0]?.artifacts.find(({ kind }) => kind === "pcbFabrication");
  if (!archive) throw new Error("The release fixture needs its synthetic PCB archive");
  const gerber = Buffer.from(await archive.bytes.arrayBuffer());

  async function upload(
    releaseId: string,
    kind: "pcbFabrication" | "manufacturingBom",
    name: string,
    bytes: Buffer,
  ) {
    const { artifactId, post } = value(
      await requestReleaseArtifactUpload(
        fixture.db,
        editor,
        { releaseId, kind, name, sizeBytes: bytes.length },
        signal(),
        storage,
      ),
    );
    const key = post.fields.key;
    const contentType = post.fields["Content-Type"];
    if (key === undefined || contentType === undefined)
      throw new Error("The release upload needs signed object fields");
    storage.objectsByKey.set(key, { size: bytes.length, contentType });
    storage.objectBytes.set(key, bytes);
    value(
      await confirmReleaseArtifactUpload(
        fixture.db,
        editor,
        { releaseId, artifactId },
        signal(),
        storage,
      ),
    );
    return artifactId;
  }

  async function approve(revision: string, quantity: number) {
    const { releaseId } = value(
      await metadata(editor, { type: "createDraft", itemId: product.id, revision }),
    );
    if (releaseId === undefined) throw new Error("Expected a new draft ID");
    expect(await metadata(approver, { type: "approve", releaseId })).toMatchObject({ ok: false });
    expect(await metadata(editor, { type: "approve", releaseId })).toMatchObject({ ok: false });
    const id = await upload(releaseId, "pcbFabrication", `gerber-${revision}.zip`, gerber);
    await upload(
      releaseId,
      "manufacturingBom",
      `bom-${revision}.csv`,
      Buffer.from(`sku,quantity\n${component.sku},${quantity}\n`),
    );
    if (revision === "A") {
      const [file] = await fixture.db
        .select()
        .from(inventoryReleaseArtifacts)
        .where(eq(inventoryReleaseArtifacts.id, id));
      if (!file) throw new Error("The approved integrity test needs a sealed object key");
      storage.objectBytes.set(file.objectKey, Buffer.alloc(gerber.length, 0));
      expect(await metadata(approver, { type: "approve", releaseId })).toMatchObject({ ok: false });
      storage.objectBytes.set(file.objectKey, gerber);
    }
    value(await metadata(approver, { type: "approve", releaseId }));
    expect(
      await requestReleaseArtifactUpload(
        fixture.db,
        editor,
        { releaseId, kind: "pcbFabrication", name: "replacement.zip", sizeBytes: gerber.length },
        signal(),
        storage,
      ),
    ).toMatchObject({ ok: false });
    return { releaseId, artifactId: id };
  }

  async function place(quantity: number) {
    const snapshot = inventory(
      await command(
        seller,
        {
          type: "place",
          requestId: randomUUID(),
          dealId: deal.id,
          itemId: product.id,
          quantity,
        },
        deal.id,
      ),
    );
    const order = snapshot.orders.find((entry) => entry.quantity === quantity);
    if (!order) throw new Error("Expected a new production order");
    return order;
  }

  const manifestA = await approve("A", 2);
  const a = await place(2);
  const manifestB = await approve("B", 4);
  const b = await place(3);
  expect(a.materials).toEqual([{ itemId: component.id, quantity: 4 }]);
  expect(b.materials).toEqual([{ itemId: component.id, quantity: 12 }]);
  expect(a.release).toBeNull();
  expect(value(await build(operator, a.id)).release).toMatchObject({
    id: manifestA.releaseId,
    revision: "A",
    approvedBy: { id: approver.userId },
    bom: [{ itemId: component.id, sku: component.sku, quantity: 2 }],
  });
  expect(value(await build(operator, b.id)).release).toMatchObject({
    id: manifestB.releaseId,
    revision: "B",
    status: "released",
    bom: [{ itemId: component.id, sku: component.sku, quantity: 4 }],
  });
  expect(await workspace(operator)).toMatchObject({ ok: false });
  expect(await build(seller, a.id)).toMatchObject({ ok: false });
  const linkedProject = value(await readInternalProject(fixture.db, operator, projectId, signal()));
  expect(
    linkedProject.items.map(({ productionReleaseOrderId }) => productionReleaseOrderId),
  ).toEqual(expect.arrayContaining([a.id, b.id]));
  const pins = await fixture.db
    .select()
    .from(inventoryBuildReleases)
    .where(eq(inventoryBuildReleases.orderId, a.id));
  expect(pins).toMatchObject([
    { releaseId: manifestA.releaseId, templateSteps: [{ assigneeId: operator.userId }] },
  ]);

  const access = (who: NativeSessionRef, target: typeof manifestA, orderId?: string) =>
    readReleaseArtifactDownload(fixture.db, who, { ...target, orderId }, signal(), storage);
  expect(await access(operator, manifestA, b.id)).toMatchObject({ ok: false });
  expect(await access(outsider, manifestA, a.id)).toMatchObject({ ok: false });
  expect(value(await access(operator, manifestA, a.id)).bytes).toEqual(gerber);

  const artifact = value(await workspace(approver))
    .releases.find(({ id }) => id === manifestA.releaseId)
    ?.artifacts.find(({ id }) => id === manifestA.artifactId);
  expect(artifact?.sha256).toBe(createHash("sha256").update(gerber).digest("hex"));
  const [stored] = await fixture.db
    .select({ key: inventoryReleaseArtifacts.objectKey })
    .from(inventoryReleaseArtifacts)
    .where(eq(inventoryReleaseArtifacts.id, manifestA.artifactId));
  if (!stored) throw new Error("Expected stored release file");
  storage.objectBytes.set(stored.key, Buffer.alloc(gerber.length, 0));
  expect(await access(operator, manifestA, a.id)).toMatchObject({ ok: false });
  expect(value(await access(operator, manifestB, b.id)).bytes).toEqual(gerber);
});

test("plans a released diamond BOM by exact child revision and preserves incumbent CRM build materials", async () => {
  const admin = await staff("BOM administrator", "admin");
  const planner = await staff("Material planner");
  const seller = await staff("BOM sales", "seller");
  const outsider = await staff("Unassigned engineer");
  const [parent, pcba, enclosure, template] = await Promise.all([
    catalogueItem(admin, "product"),
    catalogueItem(admin, "product"),
    catalogueItem(admin, "product"),
    catalogueItem(admin, "product"),
  ]);
  const [common, cable, alternateCable, paste] = await Promise.all([
    catalogueItem(admin, "component"),
    catalogueItem(admin, "component"),
    catalogueItem(admin, "component"),
    catalogueItem(admin, "component"),
  ]);
  await fixture.db
    .update(inventoryPartProfiles)
    .set({ unit: "mm" })
    .where(eq(inventoryPartProfiles.itemId, cable.id));
  await fixture.db
    .update(inventoryPartProfiles)
    .set({ unit: "cm" })
    .where(eq(inventoryPartProfiles.itemId, alternateCable.id));

  async function storageBin(name: string) {
    const siteId = randomUUID();
    const id = randomUUID();
    await fixture.db
      .insert(directorySites)
      .values({ id: siteId, code: siteId.slice(0, 8).toUpperCase(), name });
    await fixture.db.insert(directoryLocations).values({ id, siteId, code: "BIN", name });
    return { id, siteId };
  }

  const local = await storageBin("Main assembly stockroom");
  const remote = await storageBin("Remote stockroom");
  await fixture.db.insert(directorySiteGrants).values({
    siteId: local.siteId,
    userId: planner.userId,
    role: "viewer",
  });
  async function receiveInBin(itemId: string, quantity: number, lot: string, overrides = {}) {
    const result = await runWarehouseCommand(
      fixture.db,
      admin,
      {
        type: "receive",
        requestId: randomUUID(),
        itemId,
        locationId: local.id,
        quantity,
        lot,
        state: "available",
        serial: null,
        expiryDate: null,
        ownerOrganizationId: null,
        incomingId: null,
        ...overrides,
      },
      signal(),
    );
    expect(result).toMatchObject({ ok: true });
  }

  const storage = new FakeStorageClient();
  const metadata = (who: NativeSessionRef, input: Parameters<typeof executeReleaseMetadata>[2]) =>
    executeReleaseMetadata(fixture.db, who, input, signal(), storage);
  const archive = createReleaseFixture({ ...parent, sku: "IO-24-DIN" }).releases[0]?.artifacts.find(
    ({ kind }) => kind === "pcbFabrication",
  );
  if (archive === undefined) throw new Error("Missing fixture Gerber archive");
  const gerber = Buffer.from(await archive.bytes.arrayBuffer());

  async function prepareRelease(itemId: string, revision: string, csv: string) {
    const { releaseId } = value(await metadata(admin, { type: "createDraft", itemId, revision }));
    if (releaseId === undefined) throw new Error("Expected a draft release ID");
    for (const [kind, name, bytes] of [
      ["pcbFabrication", "fabrication.zip", gerber],
      ["manufacturingBom", "bom.csv", Buffer.from(csv)],
    ] as const) {
      const { artifactId, post } = value(
        await requestReleaseArtifactUpload(
          fixture.db,
          admin,
          {
            releaseId,
            kind,
            name,
            sizeBytes: bytes.length,
          },
          signal(),
          storage,
        ),
      );
      const key = post.fields.key;
      const contentType = post.fields["Content-Type"];
      if (key === undefined || contentType === undefined) {
        throw new Error("Expected signed BOM upload fields");
      }
      storage.objectsByKey.set(key, { size: bytes.length, contentType });
      storage.objectBytes.set(key, bytes);
      value(
        await confirmReleaseArtifactUpload(
          fixture.db,
          admin,
          { releaseId, artifactId },
          signal(),
          storage,
        ),
      );
    }
    return releaseId;
  }

  async function approve(itemId: string, revision: string, csv: string) {
    const releaseId = await prepareRelease(itemId, revision, csv);
    value(await metadata(admin, { type: "approve", releaseId }));
    return releaseId;
  }

  const old = await approve(parent.id, "LEGACY", `sku,quantity\n${common.sku},2\n`);
  const crm = await realDeal(seller);
  const projectId = await productionProject(admin, []);
  inventory(
    await command(admin, {
      type: "saveTemplate",
      requestId: randomUUID(),
      itemId: parent.id,
      projectId,
      steps: [{ title: "Wire and test", assigneeId: admin.userId }],
    }),
  );
  const place = () =>
    command(
      seller,
      { type: "place", requestId: randomUUID(), dealId: crm.id, itemId: parent.id, quantity: 1 },
      crm.id,
    );
  const incumbent = soleOrder(inventory(await place()));
  await receiveInBin(common.id, 6, "UNRESERVED-AND-COMMITTED");
  const active = soleOrder(
    inventory(
      await command(
        admin,
        {
          type: "reserveMaterials",
          requestId: randomUUID(),
          orderId: incumbent.id,
          revision: incumbent.revision,
        },
        crm.id,
      ),
    ),
  );
  expect(active.status).toBe("in_production");

  await receiveInBin(common.id, 7, "HELD", { state: "hold" });
  await receiveInBin(common.id, 2, "EXPIRED", { expiryDate: "2000-01-01" });
  await receiveInBin(common.id, 11, "OTHER-SITE", { locationId: remote.id });
  await receive(admin, common.id, 12);
  await receiveInBin(pcba.id, 5, "RELEASE-UNATTRIBUTED");
  await receiveInBin(cable.id, 800, "CABLE");
  await receiveInBin(alternateCable.id, 50, "SWAP");

  const pcbaA = await approve(pcba.id, "A", `sku,quantity\n${common.sku},2\n`);
  await approve(enclosure.id, "A", `sku,quantity\n${common.sku},3\n`);
  await approve(template.id, "A", `sku,quantity,consumable\n${paste.sku},1,true\n`);
  const csv = (length: string, pieces: number) =>
    [
      "sku,quantity,unit,child_release,alternates,optional,consumable,inherited,pieces",
      `${pcba.sku},1,,A,,,,,`,
      `${enclosure.sku},1,,A,,,,,`,
      `${template.sku},1,,A,,,,true,`,
      `${cable.sku}@A,${length},m,,${alternateCable.sku},true,,,${pieces}`,
    ].join("\n");
  const parentA = await approve(parent.id, "A", csv("0.75", 3));
  const pcbaB = await approve(pcba.id, "B", `sku,quantity\n${common.sku},20\n`);
  const parentB = await approve(parent.id, "B", csv("0.5", 2));
  const cyclic = await prepareRelease(
    pcba.id,
    "CYCLIC",
    `sku,quantity,child_release\n${parent.sku},1,A\n`,
  );
  const badUnit = await prepareRelease(
    parent.id,
    "BAD-UNIT",
    `sku,quantity,unit\n${common.sku},1,m\n`,
  );
  for (const releaseId of [cyclic, badUnit]) {
    expect(await metadata(admin, { type: "approve", releaseId })).toMatchObject({ ok: false });
  }

  for (const itemId of [parent.id, pcba.id, enclosure.id, template.id]) {
    value(
      await metadata(admin, { type: "setGrant", itemId, userId: planner.userId, role: "editor" }),
    );
  }
  const scope = { releaseId: parentA, siteId: local.siteId, partId: common.id, quantity: 2 };
  const plan = (who: NativeSessionRef, query = scope) =>
    readBomPlanningWorkspace(fixture.db, who, query, signal());
  const baseline = value(await plan(planner));
  expect(baseline.plan?.subassemblies.map(({ id }) => id)).toContain(pcbaA);
  expect(baseline.plan?.subassemblies.map(({ id }) => id)).not.toContain(pcbaB);
  expect(baseline.plan?.requirements.find(({ part }) => part.id === common.id)).toMatchObject({
    required: 10,
    available: 4,
    shortage: 6,
    releaseId: null,
  });
  expect(baseline.plan?.requirements.find(({ part }) => part.id === pcba.id)).toMatchObject({
    required: 2,
    available: 0,
    shortage: 2,
    releaseId: pcbaA,
    genericAssemblyAvailable: 5,
  });
  expect(baseline.plan?.requirements.find(({ part }) => part.id === paste.id)).toMatchObject({
    required: 2,
    consumable: true,
  });
  expect(baseline.plan?.requirements.some(({ part }) => part.id === template.id)).toBe(false);
  expect(baseline.plan?.requirements.some(({ part }) => part.id === cable.id)).toBe(false);
  expect(baseline.whereUsed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ release: expect.objectContaining({ id: pcbaA }), direct: true }),
      expect.objectContaining({ release: expect.objectContaining({ id: parentA }), direct: false }),
    ]),
  );

  const substitute = {
    releaseId: parentA,
    itemId: cable.id,
    substituteItemId: alternateCable.id,
    include: true,
  };
  const planned = value(
    await readBomPlanningWorkspace(
      fixture.db,
      planner,
      {
        ...scope,
        choices: [substitute],
        compareReleaseId: parentB,
      },
      signal(),
    ),
  );
  expect(
    planned.plan?.requirements.find(({ part }) => part.id === alternateCable.id),
  ).toMatchObject({
    part: { unit: "cm" },
    required: 150,
    available: 50,
    shortage: 100,
  });
  expect(planned.plan?.edges.find(({ primary }) => primary.id === cable.id)).toMatchObject({
    chosenItemId: alternateCable.id,
    enteredQuantity: "0.75",
    enteredUnit: "m",
    requiredPieces: 6,
  });
  expect(planned.comparison?.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        item: expect.objectContaining({ id: cable.id }),
        before: expect.objectContaining({ piecesPerParent: expect.any(Number) }),
        after: expect.objectContaining({ piecesPerParent: expect.any(Number) }),
      }),
    ]),
  );
  const successor = await runCatalogCommand(
    fixture.db,
    admin,
    {
      type: "savePart",
      requestId: randomUUID(),
      id: null,
      code: parent.sku,
      name: parent.name,
      revision: "B",
      kind: "product",
      profile: blankCatalogProfile("product"),
    },
    signal(),
  );
  if (!successor.ok || successor.focusId === undefined)
    throw new Error("Expected a new part revision");
  const successorRelease = await approve(successor.focusId, "A", csv("0.5", 2));
  const compared = value(
    await readBomPlanningWorkspace(
      fixture.db,
      admin,
      {
        ...scope,
        compareReleaseId: successorRelease,
      },
      signal(),
    ),
  );
  expect(compared.comparison?.release.part).toMatchObject({ id: successor.focusId, revision: "B" });
  expect(
    await readBomPlanningWorkspace(
      fixture.db,
      admin,
      { ...scope, compareReleaseId: pcbaB },
      signal(),
    ),
  ).toEqual({
    ok: false,
    error: "invalid",
  });

  expect(await plan(outsider)).toEqual({ ok: false, error: "unavailable" });
  expect(await plan(planner, { ...scope, siteId: remote.siteId })).toEqual({
    ok: false,
    error: "unavailable",
  });
  expect(
    await readBomPlanningWorkspace(
      fixture.db,
      planner,
      {
        ...scope,
        choices: [
          {
            ...substitute,
            substituteItemId: outsider.userId,
          },
        ],
      },
      signal(),
    ),
  ).toEqual({ ok: false, error: "invalid" });

  expect(await place()).toMatchObject({
    ok: false,
    error: expect.stringContaining("release-aware"),
  });
  expect(soleOrder(inventory(await read(seller, crm.id)))).toMatchObject({
    id: incumbent.id,
    materials: [{ itemId: common.id, quantity: 2 }],
  });
  expect(value(await readBuildRelease(fixture.db, admin, incumbent.id, signal())).release.id).toBe(
    old,
  );
  const sealed = value(await readReleaseWorkspace(fixture.db, planner, parent.id, signal()));
  expect(sealed.releases.find(({ id }) => id === parentA)?.bom[0]).toEqual({
    itemId: pcba.id,
    sku: pcba.sku,
    name: pcba.name,
    quantity: 1,
  });
  await expect(
    fixture.db
      .update(inventoryProductReleases)
      .set({ bom: [] })
      .where(eq(inventoryProductReleases.id, parentA)),
  ).rejects.toThrow();
  value(
    await metadata(admin, {
      type: "setGrant",
      itemId: pcba.id,
      userId: planner.userId,
      role: null,
    }),
  );
  expect(await plan(planner)).toEqual({ ok: false, error: "unavailable" });
  const scoped = value(
    await readBomPlanningWorkspace(fixture.db, planner, { partId: common.id }, signal()),
  );
  expect(scoped.whereUsed.map(({ release }) => release.id)).not.toContain(parentA);

  await fixture.db
    .update(inventoryPartProfiles)
    .set({ unit: "mm" })
    .where(eq(inventoryPartProfiles.itemId, common.id));
  expect(await plan(admin)).toEqual({ ok: false, error: "unitChanged" });
});
