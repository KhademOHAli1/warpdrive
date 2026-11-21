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
  inventoryCommandReceipts,
  inventoryItems,
  inventoryMovements,
  inventoryOrderMaterials,
  inventoryOrders,
  inventoryOrderTasks,
  inventoryTemplates,
} from "@/features/inventory/schema";
import { createInternalProject, createInternalProjectItem } from "@/features/projects/service";
import { makeTestDb, type TestDb } from "@/test/db";
import type { Result } from "@/types/result";
import type { LocationsCommand, LocationsResult } from "./contracts";
import { directoryCommandReceipts, directoryLocations } from "./schema";
import { executeLocationsCommand, readLocationsDirectory } from "./service";

const signal = () => AbortSignal.timeout(15_000);
const unavailable = { ok: false, error: "unavailable" };

function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`Expected a successful operation, got ${String(result.error)}`);
  return result.value;
}

async function staff(
  h: TestDb,
  name: string,
  options: { admin?: boolean; disabled?: boolean; invited?: boolean; guest?: boolean } = {},
): Promise<NativeSessionRef> {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await h.db.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    name,
    isAdmin: options.admin ?? false,
    isActive: options.disabled !== true,
    invitedAt: options.invited === true ? new Date() : null,
    projectsGuestOnly: options.guest ?? false,
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

const read = (h: TestDb, who: NativeSessionRef): Promise<LocationsResult> =>
  readLocationsDirectory(h.db, who, signal());
const change = (
  h: TestDb,
  who: NativeSessionRef,
  command: LocationsCommand,
): Promise<LocationsResult> => executeLocationsCommand(h.db, who, command, signal());

const newSite = (code: string, name = code): Extract<LocationsCommand, { type: "saveSite" }> => ({
  type: "saveSite",
  requestId: randomUUID(),
  id: null,
  name,
  code,
});

const newLocation = (
  siteId: string,
  code: string,
  parentId: string | null = null,
): Extract<LocationsCommand, { type: "saveLocation" }> => ({
  type: "saveLocation",
  requestId: randomUUID(),
  id: null,
  name: code,
  code,
  siteId,
  parentId,
});

const grant = (
  siteId: string,
  who: NativeSessionRef,
  role: "viewer" | "manager" | null,
): LocationsCommand => ({
  type: "setGrant",
  requestId: randomUUID(),
  siteId,
  userId: who.userId,
  role,
});

const archiveLocation = (id: string, archived = true): LocationsCommand => ({
  type: "setLocationArchived",
  requestId: randomUUID(),
  id,
  archived,
});

async function createSite(h: TestDb, admin: NativeSessionRef, code: string) {
  const { directory } = value(await change(h, admin, newSite(code)));
  const site = directory.sites.find((row) => row.code === code);
  if (!site) throw new Error("The created site is missing");
  return site.id;
}

async function createLocation(
  h: TestDb,
  actor: NativeSessionRef,
  siteId: string,
  code: string,
  parentId: string | null = null,
) {
  const { directory } = value(await change(h, actor, newLocation(siteId, code, parentId)));
  const location = directory.locations.find((row) => row.siteId === siteId && row.code === code);
  if (!location) throw new Error("The created location is missing");
  return location.id;
}

describe("shared directory on a migrated PostgreSQL database", () => {
  let h: TestDb;
  let admin: NativeSessionRef;

  beforeEach(async () => {
    h = await makeTestDb();
    admin = await staff(h, "Directory administrator", { admin: true });
  });

  afterEach(async () => {
    await h?.close();
  });

  it("admits accepted staff and excludes invited, inactive, project guest, expired and mismatched sessions", async () => {
    const member = await staff(h, "Accepted member");
    const invited = await staff(h, "Pending invitation", { invited: true });
    const inactive = await staff(h, "Inactive user", { disabled: true });
    const guest = await staff(h, "Projects guest", { guest: true });
    const expired = await staff(h, "Expired session");
    await h.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.id, expired.sessionId));

    const siteId = await createSite(h, admin, "STAFF");
    const ownerView = value(await read(h, admin));
    expect(ownerView.canManageSites).toBe(true);
    expect(ownerView.eligibleUsers).toContainEqual({
      id: member.userId,
      name: "Accepted member",
      email: `${member.userId}@example.test`,
    });
    expect(value(await read(h, member))).toEqual({
      directory: { sites: [], locations: [] },
      canManageSites: false,
      managedSiteIds: [],
      grants: [],
      eligibleUsers: [],
    });
    expect(await change(h, member, newLocation(siteId, "OUTSIDE-SCOPE"))).toEqual(unavailable);
    for (const denied of [
      invited,
      inactive,
      guest,
      expired,
      { ...member, sessionId: admin.sessionId },
    ]) {
      expect(await read(h, denied)).toEqual(unavailable);
      expect(await change(h, denied, newSite("DENIED"))).toEqual(unavailable);
    }
    for (const denied of [invited, inactive, guest]) {
      expect(ownerView.eligibleUsers.some(({ id }) => id === denied.userId)).toBe(false);
      expect(await change(h, admin, grant(siteId, denied, "viewer"))).toEqual({
        ok: false,
        error: "invalidGrant",
      });
    }
  });

  it("filters both sites and locations and gives managers location writes only within their site", async () => {
    const manager = await staff(h, "Assembly manager");
    const viewer = await staff(h, "Assembly viewer");
    const assembly = await createSite(h, admin, "ASSEMBLY");
    const dispatch = await createSite(h, admin, "DISPATCH");
    const assemblyBin = await createLocation(h, admin, assembly, "BIN");
    const dispatchBin = await createLocation(h, admin, dispatch, "BIN");

    value(await change(h, admin, grant(assembly, manager, "manager")));
    value(await change(h, admin, grant(assembly, viewer, "viewer")));
    const managing = value(await read(h, manager));
    expect(managing).toMatchObject({
      directory: { sites: [{ id: assembly }], locations: [{ id: assemblyBin }] },
      canManageSites: false,
      managedSiteIds: [assembly],
      grants: [],
      eligibleUsers: [],
    });
    expect(value(await read(h, viewer))).toMatchObject({
      directory: { sites: [{ id: assembly }], locations: [{ id: assemblyBin }] },
      managedSiteIds: [],
    });
    const adminView = value(await read(h, admin));
    expect(adminView.directory.sites.map(({ id }) => id)).toEqual(
      expect.arrayContaining([assembly, dispatch]),
    );
    expect(adminView.grants).toEqual(
      expect.arrayContaining([
        { siteId: assembly, userId: manager.userId, role: "manager" },
        { siteId: assembly, userId: viewer.userId, role: "viewer" },
      ]),
    );

    const denied: [NativeSessionRef, LocationsCommand][] = [
      [viewer, newLocation(assembly, "RESTRICTED")],
      [viewer, archiveLocation(assemblyBin)],
      [manager, newLocation(dispatch, "RESTRICTED")],
      [manager, archiveLocation(dispatchBin)],
      [manager, archiveLocation(randomUUID())],
      [manager, grant(assembly, viewer, "manager")],
      [manager, newSite("RESTRICTED")],
      [manager, { ...newSite("RESTRICTED"), id: assembly }],
      [manager, { type: "setSiteArchived", id: assembly, archived: true, requestId: randomUUID() }],
    ];
    for (const [actor, command] of denied) {
      expect(await change(h, actor, command)).toEqual(unavailable);
    }
    const spoofedEdit = await change(h, manager, {
      ...newLocation(assembly, "RESTRICTED"),
      id: dispatchBin,
    });
    expect(spoofedEdit).toMatchObject({ ok: false });
    expect(spoofedEdit).toEqual(
      await change(h, manager, { ...newLocation(assembly, "RESTRICTED"), id: randomUUID() }),
    );

    const nested = await createLocation(h, manager, assembly, "NESTED", assemblyBin);
    value(await change(h, manager, archiveLocation(nested)));
    expect(value(await read(h, viewer)).directory.locations).toContainEqual(
      expect.objectContaining({ id: nested, siteId: assembly, archived: true }),
    );
    expect(value(await read(h, admin)).directory.locations).toContainEqual(
      expect.objectContaining({ id: dispatchBin, siteId: dispatch, archived: false }),
    );
    await h.db.update(users).set({ isActive: false }).where(eq(users.id, manager.userId));
    expect(await read(h, manager)).toEqual(unavailable);
    expect(await change(h, manager, archiveLocation(nested, false))).toEqual(unavailable);
    const revoked = value(await change(h, admin, grant(assembly, manager, null)));
    expect(revoked.grants).toEqual([{ siteId: assembly, userId: viewer.userId, role: "viewer" }]);
  });

  it("guards hierarchy and code invariants through archive and restore with stable IDs", async () => {
    const siteId = await createSite(h, admin, "PLANT");
    const other = await createSite(h, admin, "SERVICE");
    const root = await createLocation(h, admin, siteId, "WAREHOUSE");
    const child = await createLocation(h, admin, siteId, "BIN", root);
    const foreign = await createLocation(h, admin, other, "WAREHOUSE");

    expect(await change(h, admin, newLocation(siteId, "FOREIGN", foreign))).toMatchObject({
      ok: false,
      error: "invalidParent",
    });
    await expect(
      h.db
        .update(directoryLocations)
        .set({ parentId: foreign })
        .where(eq(directoryLocations.id, child)),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    expect(
      await change(h, admin, { ...newLocation(siteId, "WAREHOUSE", child), id: root }),
    ).toMatchObject({ ok: false, error: "circularParent" });
    expect(await change(h, admin, archiveLocation(root))).toMatchObject({
      ok: false,
      error: "activeChildren",
    });

    value(await change(h, admin, archiveLocation(child)));
    value(await change(h, admin, archiveLocation(root)));
    expect(await change(h, admin, archiveLocation(child, false))).toMatchObject({
      ok: false,
      error: "invalidParent",
    });
    expect(await change(h, admin, newLocation(siteId, " warehouse "))).toMatchObject({
      ok: false,
      error: "duplicateCode",
    });
    const siteArchive = { type: "setSiteArchived", id: siteId } as const;
    value(await change(h, admin, { ...siteArchive, requestId: randomUUID(), archived: true }));
    expect(await change(h, admin, archiveLocation(root, false))).toMatchObject({
      ok: false,
      error: "inactiveSite",
    });
    value(await change(h, admin, { ...siteArchive, requestId: randomUUID(), archived: false }));
    value(await change(h, admin, archiveLocation(root, false)));
    const restored = value(await change(h, admin, archiveLocation(child, false)));
    expect(restored.directory.locations).toContainEqual(
      expect.objectContaining({ id: child, siteId, parentId: root, code: "BIN", archived: false }),
    );
  });

  it("serializes concurrent parent archive and active child creation", async () => {
    const manager = await staff(h, "Location manager");
    const siteId = await createSite(h, admin, "RACE");
    const parentId = await createLocation(h, admin, siteId, "PARENT");
    value(await change(h, admin, grant(siteId, manager, "manager")));
    const [archive, create] = await Promise.all([
      change(h, admin, archiveLocation(parentId)),
      change(h, manager, newLocation(siteId, "CHILD", parentId)),
    ]);
    expect([archive.ok, create.ok].filter(Boolean)).toHaveLength(1);
    if (!archive.ok) expect(archive.error).toBe("activeChildren");
    if (!create.ok) expect(create.error).toBe("invalidParent");

    const { directory } = value(await read(h, admin));
    expect(directory.locations.find(({ id }) => id === parentId)?.archived).toBe(archive.ok);
    expect(directory.locations.some(({ code }) => code === "CHILD")).toBe(create.ok);
  });

  it("replays a command once with a fresh projection and current site authorization", async () => {
    const manager = await staff(h, "Site manager");
    const siteId = await createSite(h, admin, "REPLAY");
    const other = await createSite(h, admin, "REVOKE");
    value(await change(h, admin, grant(siteId, manager, "manager")));
    value(await change(h, admin, grant(other, manager, "viewer")));

    const command = newLocation(siteId, "RACK");
    const results = await Promise.all([change(h, manager, command), change(h, manager, command)]);
    expect(value(results[0]).directory.sites).toHaveLength(2);
    expect(value(results[1]).directory.locations).toEqual(value(results[0]).directory.locations);
    expect(value(results[0]).directory.locations).toHaveLength(1);
    const [location] = value(results[0]).directory.locations;
    expect(results[1]).toMatchObject({ siteId, locationId: location?.id });
    expect(await change(h, manager, { ...command, name: "Different intent" })).toMatchObject({
      ok: false,
      error: "requestConflict",
    });
    expect(
      await executeLocationsCommand(h.db, manager, { ...command, extra: true }, signal()),
    ).toMatchObject({ ok: false, error: "invalidCommand" });
    expect(await change(h, manager, { ...command, name: "Invalid\0name" })).toMatchObject({
      ok: false,
      error: "invalidCommand",
    });

    value(await change(h, admin, grant(other, manager, null)));
    const replayed = value(await change(h, manager, command));
    expect(replayed.directory.sites).toMatchObject([{ id: siteId }]);
    expect(replayed.directory.locations).toEqual(value(results[0]).directory.locations);

    value(await change(h, admin, grant(siteId, manager, "viewer")));
    expect(await change(h, manager, command)).toEqual(unavailable);
    expect(value(await read(h, manager)).directory.sites).toMatchObject([{ id: siteId }]);
    value(await change(h, admin, grant(siteId, manager, null)));
    expect(value(await read(h, manager)).directory).toEqual({ sites: [], locations: [] });
    expect(await change(h, manager, command)).toEqual(unavailable);
    expect(
      await h.db
        .select()
        .from(directoryCommandReceipts)
        .where(eq(directoryCommandReceipts.requestId, command.requestId)),
    ).toHaveLength(1);
  });
});

async function inventorySnapshot(h: TestDb) {
  const [items, orders, movements, receipts, materials, tasks, pins, releases, artifacts] =
    await Promise.all([
      h.db.select().from(inventoryItems).orderBy(inventoryItems.id),
      h.db.select().from(inventoryOrders).orderBy(inventoryOrders.id),
      h.db.select().from(inventoryMovements).orderBy(inventoryMovements.id),
      h.db.select().from(inventoryCommandReceipts).orderBy(inventoryCommandReceipts.requestId),
      h.db.select().from(inventoryOrderMaterials).orderBy(inventoryOrderMaterials.orderId),
      h.db.select().from(inventoryOrderTasks).orderBy(inventoryOrderTasks.position),
      h.db.select().from(inventoryBuildReleases).orderBy(inventoryBuildReleases.orderId),
      readHistoricalProductReleases(h.db),
      h.db.select().from(inventoryReleaseArtifacts).orderBy(inventoryReleaseArtifacts.id),
    ]);
  return { items, orders, movements, receipts, materials, tasks, pins, releases, artifacts };
}

async function priorProductionProject(h: TestDb, admin: NativeSessionRef) {
  await h.db
    .insert(agencyProjectSettings)
    .values({ id: true, enabled: true })
    .onConflictDoUpdate({ target: agencyProjectSettings.id, set: { enabled: true } });
  return value(
    await createInternalProject(
      h.db,
      admin,
      { id: randomUUID(), title: "Production before PLAT-01" },
      signal(),
    ),
  ).id;
}

async function priorDeal(h: TestDb, actor: NativeSessionRef) {
  const pipelineId = randomUUID();
  const stageId = randomUUID();
  const dealId = randomUUID();
  await h.db.insert(pipelines).values({ id: pipelineId, name: "Pre-upgrade sales pipeline" });
  await h.db.insert(stages).values({ id: stageId, pipelineId, name: "Preparing" });
  await h.db.insert(deals).values({
    id: dealId,
    title: "Customer order before PLAT-01",
    pipelineId,
    stageId,
    ownerId: actor.userId,
    visibilityLevel: "all",
  });
  return dealId;
}

async function priorRelease(h: TestDb, admin: NativeSessionRef, productId: string) {
  const component = { id: randomUUID(), sku: "PCB-0128", name: "PCB before PLAT-01" };
  const releaseId = randomUUID();
  const actor = { createdBy: admin.userId };
  const file = {
    releaseId,
    ...actor,
    sizeBytes: 32,
    state: "ready",
    sha256: "a".repeat(64),
  } as const;
  const bom = [{ sku: component.sku, quantity: 2 }];
  await h.db.insert(inventoryItems).values({ ...component, kind: "component", revision: "A" });
  await seedHistoricalDraftRelease(h.db, {
    id: releaseId,
    itemId: productId,
    revision: "A",
    ...actor,
  });
  // Seed approved file metadata under the incumbent triggers. The upgrade concerns database retention.
  await h.db.insert(inventoryReleaseArtifacts).values([
    {
      ...file,
      kind: "pcbFabrication",
      name: "gerbers.zip",
      objectKey: "prior-gerber",
      contentType: "application/zip",
      etag: "prior-gerber",
    },
    {
      ...file,
      kind: "manufacturingBom",
      name: "bom.csv",
      objectKey: "prior-bom",
      contentType: "text/csv",
      etag: "prior-bom",
      bomEntries: bom,
    },
  ]);
  await h.db
    .update(inventoryProductReleases)
    .set({
      status: "released",
      approvedBy: admin.userId,
      approvedAt: new Date(),
      bom: [{ ...bom[0]!, itemId: component.id, name: component.name }],
    })
    .where(eq(inventoryProductReleases.id, releaseId));
  return { releaseId, componentId: component.id };
}

async function priorStock(h: TestDb, admin: NativeSessionRef) {
  // Seed the 0128 records directly. Current Inventory workflows expect the current schema.
  const productId = randomUUID();
  await h.db.insert(inventoryItems).values({
    id: productId,
    sku: "DIN-0128",
    kind: "product",
    name: "DIN controller before PLAT-01",
    revision: "A",
    releaseRequired: true,
    onHand: 4,
    reserved: 4,
  });
  const { releaseId, componentId } = await priorRelease(h, admin, productId);
  const dealId = await priorDeal(h, admin);
  const projectId = await priorProductionProject(h, admin);
  const orderId = randomUUID();
  const step = { title: "Build retained release", assigneeId: admin.userId };
  const steps = [step];
  await h.db
    .update(inventoryItems)
    .set({ onHand: 10, reserved: 2 })
    .where(eq(inventoryItems.id, componentId));
  await h.db.insert(inventoryTemplates).values({
    itemId: productId,
    projectId,
    configuredBy: admin.userId,
    steps,
  });
  await h.db.insert(inventoryOrders).values({
    id: orderId,
    dealId,
    itemId: productId,
    quantity: 5,
    reserved: 4,
    buildQuantity: 1,
    status: "in_production",
    revision: 2,
    projectId,
    templateRevision: 1,
    createdBy: admin.userId,
  });
  await h.db.insert(inventoryOrderMaterials).values({ orderId, componentId, quantity: 2 });
  await h.db
    .insert(inventoryBuildReleases)
    .values({ orderId, itemId: productId, releaseId, templateSteps: steps });
  const project = value(
    await createInternalProjectItem(
      h.db,
      admin,
      { id: randomUUID(), projectId, ...step, status: "todo" },
      signal(),
    ),
  );
  const task = project.items.find(({ title }) => title === step.title);
  if (!task) throw new Error("The incumbent build task is missing");
  await h.db
    .insert(inventoryOrderTasks)
    .values({ orderId, projectId, itemId: task.id, position: 0 });
  const movements = [
    { itemId: productId, kind: "receipt", onHandDelta: 4, reservedDelta: 0, orderId: null },
    { itemId: componentId, kind: "receipt", onHandDelta: 10, reservedDelta: 0, orderId: null },
    { itemId: productId, kind: "order-reserve", onHandDelta: 0, reservedDelta: 4, orderId },
    { itemId: componentId, kind: "materials-reserve", onHandDelta: 0, reservedDelta: 2, orderId },
  ] as const;
  for (const movement of movements) {
    const actorId = admin.userId;
    const requestId = randomUUID();
    await h.db
      .insert(inventoryCommandReceipts)
      .values({ actorId, requestId, fingerprint: "a".repeat(64) });
    await h.db.insert(inventoryMovements).values({ ...movement, actorId, requestId });
  }
  return { productId, componentId, orderId, releaseId };
}

it("upgrades populated migration 0128 to 0129 and retains reservations, movements, and a pinned build", async () => {
  const h = await freshMigrationDb();
  const target = await migrationFolder(130);
  try {
    await installPrefix(h, 129);
    const admin = await staff(h, "Stock owner", { admin: true });
    const { productId, componentId, orderId, releaseId } = await priorStock(h, admin);
    const before = await inventorySnapshot(h);
    const previousLedger = await ledger(h);
    expect(previousLedger).toHaveLength(129);
    expect(before.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: productId, onHand: 4, reserved: 4 }),
        expect.objectContaining({ id: componentId, onHand: 10, reserved: 2 }),
      ]),
    );
    expect(before.orders).toMatchObject([{ id: orderId, status: "in_production", reserved: 4 }]);
    expect(before.movements.map(({ kind }) => kind).sort()).toEqual([
      "materials-reserve",
      "order-reserve",
      "receipt",
      "receipt",
    ]);
    expect(before.pins).toMatchObject([{ orderId, itemId: productId, releaseId }]);
    const priorBuild = value(await readBuildRelease(h.db, admin, orderId, signal()));

    const success = { ok: true, value: { applied: true } };
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), target.folder)).toEqual(
      success,
    );
    const upgradedLedger = await ledger(h);
    expect(upgradedLedger).toHaveLength(130);
    expect(upgradedLedger.slice(0, 129)).toEqual(previousLedger);
    expect(await inventorySnapshot(h)).toEqual(before);
    expect(value(await readBuildRelease(h.db, admin, orderId, signal()))).toEqual(priorBuild);
    expect(value(await read(h, admin)).directory).toEqual({ sites: [], locations: [] });

    const newSiteId = await createSite(h, admin, "NEW");
    const newBinId = await createLocation(h, admin, newSiteId, "NEW-BIN");
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), target.folder)).toEqual(
      success,
    );
    expect(await ledger(h)).toEqual(upgradedLedger);
    expect(await inventorySnapshot(h)).toEqual(before);
    expect(value(await read(h, admin)).directory).toMatchObject({
      sites: [{ id: newSiteId, code: "NEW" }],
      locations: [{ id: newBinId, siteId: newSiteId, code: "NEW-BIN" }],
    });
  } finally {
    await target.dispose();
    await h.close();
  }
});
