import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  freshMigrationDb,
  installPrefix,
  ledger,
  migrationFolder,
} from "@/db/migrationAdmission.test-helpers";
import { deals, pipelines, sessions, stages, users } from "@/db/schema";
import { agencyProjectSettings } from "@/features/agency-projects/schema/agencyProjectSettings";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import {
  readHistoricalProductReleases,
  seedHistoricalDraftRelease,
} from "@/features/inventory/releases/releases.test-helpers";
import {
  inventoryBuildReleases,
  inventoryProductReleases,
  inventoryReleaseArtifacts,
} from "@/features/inventory/releases/schema";
import { readBuildRelease } from "@/features/inventory/releases/service";
import {
  inventoryBomLines,
  inventoryCommandReceipts,
  inventoryItems,
  inventoryMovements,
  inventoryOrderMaterials,
  inventoryOrders,
} from "@/features/inventory/schema";
import { createInternalProject } from "@/features/projects/service";
import { makeTestDb, type TestDb } from "@/test/db";
import type { Result } from "@/types/result";
import { blankCatalogProfile, type CatalogCommand, type CatalogPart } from "./contracts";
import { readCatalogWorkspace, runCatalogCommand } from "./service";

const signal = () => AbortSignal.timeout(15_000);

function value<T, E>(result: Result<T, E>): T {
  if (!result.ok)
    throw new Error(`Expected catalog operation to succeed, got ${String(result.error)}`);
  return result.value;
}

function focus<T extends { ok: boolean; focusId?: string }>(result: T): string {
  if (result.ok && result.focusId !== undefined) return result.focusId;
  throw new Error("Catalog write did not return a record ID");
}

function catalogPart(parts: CatalogPart[], partId: string): CatalogPart {
  const part = parts.find(({ id }) => id === partId);
  if (part === undefined) throw new Error("The expected part revision is unavailable");
  return part;
}

async function staff(h: TestDb, admin = false): Promise<NativeSessionRef> {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await h.db.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    name: "Catalog test member",
    isAdmin: admin,
  });
  await h.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 300_000),
    authMethod: "legacy",
    assurance: "legacy",
  });
  return { userId, sessionId };
}

type SavePart = Extract<CatalogCommand, { type: "savePart" }>;
type Profile = SavePart["profile"];
type Category = Extract<CatalogCommand, { type: "saveCategory" }>;

function definition(
  code: string,
  profile: Partial<Profile> = {},
  values: Partial<Omit<SavePart, "profile">> = {},
): SavePart {
  const kind = values.kind ?? "component";
  return {
    type: "savePart",
    requestId: randomUUID(),
    id: null,
    code,
    name: code,
    revision: "A",
    kind,
    ...values,
    profile: {
      ...blankCatalogProfile(kind),
      ...profile,
    },
  };
}

function edit(part: CatalogPart, profile: Partial<Profile> = {}): SavePart {
  return definition(
    part.code,
    { ...part.profile, ...profile },
    { id: part.id, name: part.name, revision: part.revision, kind: part.kind },
  );
}

function category(code: string, props: Partial<Category> = {}): Category {
  return {
    type: "saveCategory",
    requestId: randomUUID(),
    id: null,
    code,
    name: code,
    parentId: null,
    defaultUnit: null,
    parameters: [],
    ...props,
  };
}

describe("catalog integration with native sessions", () => {
  let h: TestDb;
  let admin: NativeSessionRef;
  const read = (
    who: NativeSessionRef = admin,
    filter: Parameters<typeof readCatalogWorkspace>[2] = {},
  ) => readCatalogWorkspace(h.db, who, filter, signal());
  const write = (command: CatalogCommand, who: NativeSessionRef = admin) =>
    runCatalogCommand(h.db, who, command, signal());

  beforeEach(async () => {
    h = await makeTestDb();
    admin = await staff(h, true);
  });

  afterEach(async () => {
    await h?.close();
  });

  it("searches descendant categories, inherits parameter definitions, and normalizes compatible values once", async () => {
    const pitch = { key: "pitch", label: "Connector pitch", kind: "number", unit: "mm" } as const;
    const parent = focus(
      await write(category("ELECTRONICS", { parameters: [pitch], defaultUnit: "mm" })),
    );
    const child = focus(await write(category("CONNECTORS", { parentId: parent })));
    const itemId = focus(
      await write(
        definition("CN-25", {
          categoryId: child,
          unit: null,
          description: "Industrial Micro Pitch Receptacle",
          notes: "Use the keyed housing",
          tags: ["PanelBuild"],
          values: [{ key: "pitch", value: 2500, unit: "um" }],
        }),
      ),
    );
    const result = value(await read(admin, { search: "  RECEPTACLE  ", categoryId: parent }));
    expect(result.parts).toHaveLength(1);
    const part = catalogPart(result.parts, itemId);
    expect(part).toMatchObject({
      id: itemId,
      code: "CN-25",
      profile: {
        categoryId: child,
        unit: "mm",
        notes: "Use the keyed housing",
        values: [{ key: "pitch", value: 2.5, unit: "mm" }],
      },
      parameters: [pitch],
    });
    expect(value(await read(admin, { search: "panelbuild" })).parts.map(({ id }) => id)).toEqual([
      itemId,
    ]);
    expect(
      await write(edit(part, { values: [{ key: "pitch", value: 12, unit: "V" }] })),
    ).toMatchObject({
      ok: false,
      error: "unitMismatch",
    });
    expect(
      await write(category("ELECTRONICS", { id: parent, parentId: child, parameters: [pitch] })),
    ).toMatchObject({
      ok: false,
      error: "cycle",
    });
    expect(value(await read()).parts[0]?.profile.values).toEqual([
      { key: "pitch", value: 2.5, unit: "mm" },
    ]);
  });

  it("keeps templates, variants, and independent revisions attached to the right identities", async () => {
    const templateId = focus(
      await write(definition("SENSOR-TEMPLATE", { isTemplate: true, stockMode: "virtual" })),
    );
    const a = focus(
      await write(
        definition("SENSOR-24", {
          templateItemId: templateId,
          stockMode: "consumable",
          flags: {
            assembly: false,
            component: true,
            purchasable: true,
            salable: false,
            testable: true,
            trackable: true,
          },
        }),
      ),
    );
    const b = focus(
      await write(
        definition(
          "SENSOR-24",
          {
            templateItemId: templateId,
            supersedesItemId: a,
          },
          { revision: "B" },
        ),
      ),
    );
    const catalog = value(await read());
    const revA = catalogPart(catalog.parts, a);
    const revB = catalogPart(catalog.parts, b);
    expect(revA.familyId).toBe(revB.familyId);
    expect(revA.sku).not.toBe(revB.sku);
    expect(revA).toMatchObject({
      revision: "A",
      profile: {
        templateItemId: templateId,
        stockMode: "consumable",
        flags: { testable: true, trackable: true },
      },
    });
    expect(revB).toMatchObject({
      revision: "B",
      profile: { templateItemId: templateId, supersedesItemId: a },
    });
    expect(catalog.parts.find(({ id }) => id === templateId)).toMatchObject({
      profile: { isTemplate: true, stockMode: "virtual" },
    });
    expect(await write(definition("SENSOR-24", {}, { revision: "B" }))).toMatchObject({
      ok: false,
      error: "duplicate",
    });
    expect(await write(edit(revA, { supersedesItemId: b }))).toMatchObject({
      ok: false,
      error: "cycle",
    });
    expect(
      value(await read()).parts.find(({ id }) => id === a)?.profile.supersedesItemId,
    ).toBeNull();
  });

  it("uses current visibility for staff and enforces state locking and replay", async () => {
    const viewer = await staff(h);
    const lockedId = focus(
      await write({
        type: "saveState",
        requestId: randomUUID(),
        id: null,
        code: "HISTORICAL",
        name: "Historical",
        active: false,
        locked: true,
      }),
    );
    const hidden = focus(await write(definition("PALETTE-PRIVATE", { visibility: "admin" })));
    const create = definition("PANEL-COVER", { relatedItemIds: [hidden] });
    const [first, retried] = await Promise.all([
      write(create),
      write({ ...create, code: "panel-cover" }),
    ]);
    const itemId = focus(first);
    expect(focus(retried)).toBe(itemId);
    expect(value(retried).parts.filter(({ code }) => code === "PANEL-COVER")).toHaveLength(1);
    expect(await write({ ...create, name: "Different request" })).toMatchObject({
      ok: false,
      error: "conflict",
    });
    const scoped = value(await read(viewer));
    expect(scoped.canManage).toBe(false);
    expect(scoped.parts).toMatchObject([{ id: itemId, profile: { relatedItemIds: [] } }]);
    expect(value(await read(viewer, { search: "palette-private" })).parts).toEqual([]);
    expect(await write(definition("UNAUTHORIZED"), viewer)).toMatchObject({ ok: false });
    const before = catalogPart(value(await read()).parts, itemId);
    value(
      await write({
        type: "setPartState",
        requestId: randomUUID(),
        id: itemId,
        stateId: lockedId,
        version: before.profile.version,
      }),
    );
    const filtered = value(await read(admin, { stateId: lockedId }));
    expect(filtered.states).toMatchObject([{ id: lockedId, active: false, locked: true }]);
    const after = catalogPart(filtered.parts, itemId);
    expect(after).toMatchObject({ id: itemId, profile: { stateId: lockedId } });
    expect(await write(edit(after, { notes: "Do not write to a locked revision" }))).toMatchObject({
      ok: false,
      error: "locked",
    });
    const replay = await write(create);
    expect(focus(replay)).toBe(itemId);
    expect(value(replay).parts.find(({ id }) => id === itemId)?.profile.stateId).toBe(lockedId);
  });
});

async function legacySnapshot(h: TestDb) {
  const [items, bom, orders, materials, pins, releases, artifacts, movements, receipts] =
    await Promise.all([
      h.db
        .select({
          id: inventoryItems.id,
          sku: inventoryItems.sku,
          name: inventoryItems.name,
          revision: inventoryItems.revision,
          kind: inventoryItems.kind,
          onHand: inventoryItems.onHand,
          reserved: inventoryItems.reserved,
          releaseRequired: inventoryItems.releaseRequired,
        })
        .from(inventoryItems)
        .orderBy(inventoryItems.id),
      h.db
        .select()
        .from(inventoryBomLines)
        .orderBy(inventoryBomLines.itemId, inventoryBomLines.componentId),
      h.db.select().from(inventoryOrders).orderBy(inventoryOrders.id),
      h.db.select().from(inventoryOrderMaterials).orderBy(inventoryOrderMaterials.orderId),
      h.db.select().from(inventoryBuildReleases).orderBy(inventoryBuildReleases.orderId),
      readHistoricalProductReleases(h.db),
      h.db.select().from(inventoryReleaseArtifacts).orderBy(inventoryReleaseArtifacts.id),
      h.db.select().from(inventoryMovements).orderBy(inventoryMovements.id),
      h.db.select().from(inventoryCommandReceipts).orderBy(inventoryCommandReceipts.requestId),
    ]);
  return { items, bom, orders, materials, pins, releases, artifacts, movements, receipts };
}

async function previousProjectAndDeal(h: TestDb, actor: NativeSessionRef) {
  await h.db
    .insert(agencyProjectSettings)
    .values({ id: true, enabled: true })
    .onConflictDoUpdate({
      target: agencyProjectSettings.id,
      set: { enabled: true },
    });
  const project = value(
    await createInternalProject(
      h.db,
      actor,
      { id: randomUUID(), title: "Legacy production" },
      signal(),
    ),
  );
  const pipelineId = randomUUID();
  const stageId = randomUUID();
  const dealId = randomUUID();
  await h.db.insert(pipelines).values({ id: pipelineId, name: "Existing sales pipeline" });
  await h.db.insert(stages).values({ id: stageId, pipelineId, name: "Preparing" });
  await h.db.insert(deals).values({
    id: dealId,
    pipelineId,
    stageId,
    title: "Existing customer order",
    ownerId: actor.userId,
    visibilityLevel: "all",
  });
  return { projectId: project.id, dealId };
}

async function previousBuild(
  h: TestDb,
  actor: NativeSessionRef,
  productId: string,
  componentId: string,
) {
  const releaseId = randomUUID();
  const orderId = randomUUID();
  const createdBy = actor.userId;
  const bomEntry = { sku: "PCB-LEGACY", quantity: 2 };
  await seedHistoricalDraftRelease(h.db, {
    id: releaseId,
    itemId: productId,
    revision: "A",
    createdBy,
  });
  const metadata = {
    releaseId,
    createdBy,
    sizeBytes: 32,
    sha256: "a".repeat(64),
    state: "ready",
  } as const;
  await h.db.insert(inventoryReleaseArtifacts).values([
    {
      ...metadata,
      kind: "pcbFabrication",
      name: "gerbers.zip",
      objectKey: "old-gerber",
      contentType: "application/zip",
      etag: "old-gerber",
    },
    {
      ...metadata,
      kind: "manufacturingBom",
      name: "bom.csv",
      objectKey: "old-bom",
      contentType: "text/csv",
      etag: "old-bom",
      bomEntries: [bomEntry],
    },
  ]);
  await h.db
    .update(inventoryProductReleases)
    .set({
      status: "released",
      approvedAt: new Date(),
      approvedBy: createdBy,
      bom: [{ ...bomEntry, itemId: componentId, name: "Approved board" }],
    })
    .where(eq(inventoryProductReleases.id, releaseId));
  const { projectId, dealId } = await previousProjectAndDeal(h, actor);
  await h.db.insert(inventoryOrders).values({
    id: orderId,
    itemId: productId,
    projectId,
    dealId,
    createdBy,
    templateRevision: 1,
    status: "in_production",
    quantity: 5,
    reserved: 4,
    buildQuantity: 1,
  });
  await h.db.insert(inventoryOrderMaterials).values({ orderId, componentId, quantity: 2 });
  await h.db.insert(inventoryBuildReleases).values({
    orderId,
    itemId: productId,
    releaseId,
    templateSteps: [{ title: "Build approved Rev A", assigneeId: createdBy }],
  });
  return { orderId, releaseId };
}

async function previousInventory(h: TestDb, actor: NativeSessionRef) {
  // Seed precisely the 0129 rows. Future service changes can then depend on newer tables.
  const productId = randomUUID();
  const componentId = randomUUID();
  await h.db.insert(inventoryItems).values([
    {
      id: productId,
      sku: "DIN-LEGACY",
      name: "Legacy DIN controller",
      kind: "product",
      revision: "A",
      onHand: 4,
      reserved: 4,
      releaseRequired: true,
    },
    {
      id: componentId,
      sku: "PCB-LEGACY",
      name: "Approved board",
      kind: "component",
      revision: "A",
      onHand: 10,
      reserved: 2,
    },
  ]);
  await h.db.insert(inventoryBomLines).values({ itemId: productId, componentId, quantity: 2 });
  const { orderId, releaseId } = await previousBuild(h, actor, productId, componentId);
  const requestId = randomUUID();
  const event = { actorId: actor.userId, requestId };
  await h.db.insert(inventoryCommandReceipts).values({ ...event, fingerprint: "b".repeat(64) });
  await h.db.insert(inventoryMovements).values([
    { ...event, itemId: productId, kind: "receipt", onHandDelta: 4, reservedDelta: 0 },
    { ...event, itemId: componentId, kind: "receipt", onHandDelta: 10, reservedDelta: 0 },
    {
      ...event,
      itemId: productId,
      orderId,
      kind: "order-reserve",
      onHandDelta: 0,
      reservedDelta: 4,
    },
    {
      ...event,
      itemId: componentId,
      orderId,
      kind: "materials-reserve",
      onHandDelta: 0,
      reservedDelta: 2,
    },
  ]);
  return { productId, componentId, orderId, releaseId };
}

it("upgrades a populated 0129 database and preserves legacy stock, reservations, and the Rev A build pin", async () => {
  const h = await freshMigrationDb();
  const target = await migrationFolder(131);
  try {
    await installPrefix(h, 130);
    const admin = await staff(h, true);
    const { productId, componentId, orderId, releaseId } = await previousInventory(h, admin);
    const before = await legacySnapshot(h);
    const history = await ledger(h);
    expect(history).toHaveLength(130);
    const priorBuild = value(await readBuildRelease(h.db, admin, orderId, signal()));
    const success = { ok: true, value: { applied: true } };
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), target.folder)).toEqual(
      success,
    );
    const upgraded = await ledger(h);
    expect(upgraded).toHaveLength(131);
    expect(upgraded.slice(0, 130)).toEqual(history);
    expect(await legacySnapshot(h)).toEqual(before);
    expect(value(await readBuildRelease(h.db, admin, orderId, signal()))).toEqual(priorBuild);

    const initial = value(await readCatalogWorkspace(h.db, admin, {}, signal()));
    expect(initial.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: productId,
          code: "DIN-LEGACY",
          revision: "A",
          onHand: 4,
          reserved: 4,
        }),
        expect.objectContaining({
          id: componentId,
          code: "PCB-LEGACY",
          revision: "A",
          onHand: 10,
          reserved: 2,
          whereUsedByIds: [productId],
        }),
      ]),
    );
    const revision = await runCatalogCommand(
      h.db,
      admin,
      definition(
        "DIN-LEGACY",
        {
          supersedesItemId: productId,
        },
        { name: "Legacy DIN controller revision B", revision: "B", kind: "product" },
      ),
      signal(),
    );
    const revisionId = focus(revision);
    expect(revisionId).not.toBe(productId);
    const { parts } = value(revision);
    const revA = catalogPart(parts, productId);
    const revB = catalogPart(parts, revisionId);
    expect(revB).toMatchObject({
      revision: "B",
      familyId: revA.familyId,
      onHand: 0,
      reserved: 0,
      profile: { supersedesItemId: productId },
    });
    const revised = await legacySnapshot(h);
    expect(revised.items).toHaveLength(before.items.length + 1);
    expect(revised).toEqual({
      ...before,
      items: expect.arrayContaining(before.items),
    });
    expect(
      await h.db
        .select()
        .from(inventoryBuildReleases)
        .where(eq(inventoryBuildReleases.orderId, orderId)),
    ).toMatchObject([{ itemId: productId, releaseId }]);
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), target.folder)).toEqual(
      success,
    );
    expect(await ledger(h)).toEqual(upgraded);
    expect(value(await readBuildRelease(h.db, admin, orderId, signal()))).toEqual(priorBuild);
  } finally {
    await target.dispose();
    await h.close();
  }
});
