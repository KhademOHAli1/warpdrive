import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect, test } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import {
  agencyProjectMembers,
  deals,
  persons,
  pipelines,
  sessions,
  stages,
  users,
} from "@/db/schema";
import { agencyProjectSettings } from "@/features/agency-projects/schema/agencyProjectSettings";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { FakeStorageClient } from "@/features/files/storageFake";
import { readInventoryWorkspace } from "@/features/inventory/reads";
import { readReleaseArtifactDownload } from "@/features/inventory/releases/artifacts";
import {
  inventoryProductReleases,
  inventoryReleaseArtifacts,
} from "@/features/inventory/releases/schema";
import { executeReleaseMetadata } from "@/features/inventory/releases/service";
import { runInventoryCommand } from "@/features/inventory/service";
import type { WarehouseCommand } from "@/features/inventory/warehouse/contracts";
import {
  incumbentRows,
  seedStructures,
} from "@/features/inventory/warehouse/operations/structures.test-helpers";
import {
  readWarehouseWorkspace,
  runWarehouseCommand,
} from "@/features/inventory/warehouse/service";
import { directorySiteGrants, directorySites } from "@/features/locations/schema";
import { createInternalProject, readInternalProject } from "@/features/projects/service";
import { makeTestDb, type TestDb } from "@/test/db";
import type { OperationsAccessCommand, OperationsRole } from "./contracts";
import { operationsAccessReceipts } from "./schema";
import { readOperationsScope } from "./scope";
import { executeOperationsAccessCommand, readOperationsAccessWorkspace } from "./service";

const signal = () => AbortSignal.timeout(20_000);
const unavailable = { ok: false, error: "unavailable" };

async function staff(
  h: TestDb,
  name: string,
  options: { disabled?: boolean; invited?: boolean; guest?: boolean } = {},
): Promise<NativeSessionRef> {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await h.db.insert(users).values({
    id: userId,
    name,
    email: `${userId}@example.test`,
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

function grant(
  siteId: string,
  userId: string,
  role: OperationsRole,
  enabled = true,
): OperationsAccessCommand {
  return { siteId, userId, role, enabled, requestId: randomUUID() };
}

const change = (h: TestDb, who: NativeSessionRef, input: OperationsAccessCommand) =>
  executeOperationsAccessCommand(h.db, who, input, signal());

const scope = (h: TestDb, who: NativeSessionRef) => readOperationsScope(h.db, who, signal());
const warehouse = (h: TestDb, who: NativeSessionRef) =>
  readWarehouseWorkspace(h.db, who, {}, signal());

test("separates site combinations and only grants warehouse actions to the warehouse manager", async () => {
  const h = await makeTestDb();
  try {
    const { admin, source, remote, lot } = await seedStructures(h);
    const viewer = await staff(h, "Warehouse viewer and remote asset manager");
    const manager = await staff(h, "Warehouse manager");
    const buyer = await staff(h, "Buyer and remote cost reviewer");
    const receiving: WarehouseCommand = {
      type: "receive",
      requestId: randomUUID(),
      itemId: lot.itemId,
      locationId: source.locationId,
      quantity: 3,
      lot: "MODULE-LOT-02",
      serial: null,
      expiryDate: null,
      state: "available",
      ownerOrganizationId: null,
      incomingId: null,
    };
    for (const input of [
      grant(source.siteId, viewer.userId, "warehouse_viewer"),
      grant(remote.siteId, viewer.userId, "asset_manager"),
      grant(source.siteId, manager.userId, "warehouse_manager"),
      grant(source.siteId, buyer.userId, "buyer"),
      grant(remote.siteId, buyer.userId, "cost_viewer"),
    ]) {
      expect(await change(h, admin, input)).toMatchObject({ ok: true });
    }

    expect(await scope(h, buyer)).toMatchObject({
      ok: true,
      value: {
        sites: expect.arrayContaining([
          {
            siteId: source.siteId,
            canReadWarehouse: false,
            canManageWarehouse: false,
            canReadAssets: false,
            canManageAssets: false,
            canBuy: true,
            canViewCosts: false,
            canInspectQuality: false,
          },
          {
            siteId: remote.siteId,
            canReadWarehouse: false,
            canManageWarehouse: false,
            canReadAssets: false,
            canManageAssets: false,
            canBuy: false,
            canViewCosts: true,
            canInspectQuality: false,
          },
        ]),
      },
    });
    expect(await scope(h, viewer)).toMatchObject({
      ok: true,
      value: {
        sites: expect.arrayContaining([
          {
            siteId: source.siteId,
            canReadWarehouse: true,
            canManageWarehouse: false,
            canReadAssets: false,
            canManageAssets: false,
            canBuy: false,
            canViewCosts: false,
            canInspectQuality: false,
          },
          {
            siteId: remote.siteId,
            canReadWarehouse: false,
            canManageWarehouse: false,
            canReadAssets: true,
            canManageAssets: true,
            canBuy: false,
            canViewCosts: false,
            canInspectQuality: false,
          },
        ]),
      },
    });
    expect(await warehouse(h, buyer)).toMatchObject({
      ok: true,
      value: { sites: [], locations: [], positions: [] },
    });
    expect(await warehouse(h, viewer)).toMatchObject({
      ok: true,
      value: { sites: [{ id: source.siteId, canManage: false }] },
    });
    expect(await warehouse(h, manager)).toMatchObject({
      ok: true,
      value: {
        sites: [{ id: source.siteId, canManage: true }],
        positions: expect.arrayContaining([
          expect.objectContaining({ id: lot.positionId, onHand: 10, reserved: 4 }),
        ]),
      },
    });
    expect(await readInventoryWorkspace(h.db, manager, null, signal())).toMatchObject({
      ok: true,
      value: {
        items: expect.arrayContaining([
          expect.objectContaining({ id: lot.itemId, onHand: 10, reserved: 4, available: 6 }),
        ]),
      },
    });
    for (const who of [viewer, buyer]) {
      expect(await runWarehouseCommand(h.db, who, receiving, signal())).toEqual(unavailable);
    }
    expect(
      await runWarehouseCommand(
        h.db,
        manager,
        { ...receiving, locationId: remote.locationId },
        signal(),
      ),
    ).toEqual(unavailable);
    expect(await runWarehouseCommand(h.db, manager, receiving, signal())).toMatchObject({
      ok: true,
      value: {
        positions: expect.arrayContaining([
          expect.objectContaining({ lot: "MODULE-LOT-02", onHand: 3 }),
        ]),
      },
    });
  } finally {
    await h.close();
  }
});

test("rechecks grants on the same session and returns current state when a previous grant is replayed", async () => {
  const h = await makeTestDb();
  try {
    const { admin, source, lot } = await seedStructures(h);
    const viewer = await staff(h, "Stock member");
    const initial = grant(source.siteId, viewer.userId, "warehouse_manager");
    const receipt = {
      siteId: initial.siteId,
      userId: initial.userId,
      role: initial.role,
    };
    const reverse = grant(initial.siteId, initial.userId, initial.role, false);
    const receiving: WarehouseCommand = {
      type: "receive",
      requestId: randomUUID(),
      locationId: source.locationId,
      itemId: lot.itemId,
      quantity: 1,
      lot: "RECEIPT-01",
      serial: null,
      expiryDate: null,
      state: "available",
      ownerOrganizationId: null,
      incomingId: null,
    };
    expect(await change(h, admin, initial)).toMatchObject({
      ok: true,
      value: { grants: [receipt] },
    });
    expect(await change(h, admin, initial)).toMatchObject({
      ok: true,
      value: { grants: [receipt] },
    });
    expect(await runWarehouseCommand(h.db, viewer, receiving, signal())).toMatchObject({
      ok: true,
    });
    expect(await change(h, admin, { ...initial, role: "cost_viewer" })).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(await change(h, admin, reverse)).toMatchObject({ ok: true, value: { grants: [] } });
    expect(await scope(h, viewer)).toMatchObject({ ok: true, value: { sites: [] } });
    expect(await warehouse(h, viewer)).toMatchObject({
      ok: true,
      value: { sites: [], positions: [] },
    });
    expect(await runWarehouseCommand(h.db, viewer, receiving, signal())).toEqual(unavailable);
    expect(await change(h, admin, initial)).toMatchObject({ ok: true, value: { grants: [] } });
    expect(await scope(h, viewer)).toMatchObject({ ok: true, value: { sites: [] } });

    const history = await h.db
      .select()
      .from(operationsAccessReceipts)
      .where(eq(operationsAccessReceipts.userId, viewer.userId));
    expect(history).toHaveLength(2);
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...receipt,
          requestId: initial.requestId,
          enabled: true,
          changed: true,
        }),
        expect.objectContaining({
          ...receipt,
          requestId: reverse.requestId,
          enabled: false,
          changed: true,
        }),
      ]),
    );
  } finally {
    await h.close();
  }
});

test("rejects ineligible recipients and keeps native Projects, CRM, and release permissions independent", async () => {
  const h = await makeTestDb();
  try {
    const { admin, source, parent } = await seedStructures(h);
    const operator = await staff(h, "Operations staff");
    const pending = await staff(h, "Pending staff invitation", { invited: true });
    const disabled = await staff(h, "Disabled staff", { disabled: true });
    const guest = await staff(h, "Projects guest", { guest: true });
    const contactId = randomUUID();
    await h.db.insert(persons).values({
      id: contactId,
      name: "Equipment delivery recipient",
      primaryEmail: "recipient@example.test",
      ownerId: admin.userId,
      visibilityLevel: "owner",
    });
    const [archived] = await h.db
      .insert(directorySites)
      .values({ name: "Archived operations site", code: "ARCHIVED-OPS", archived: true })
      .returning({ id: directorySites.id });
    assert(archived !== undefined);
    const attempted = grant(source.siteId, operator.userId, "warehouse_manager");
    for (const who of [operator, pending, disabled, guest]) {
      expect(await readOperationsAccessWorkspace(h.db, who, signal())).toEqual(unavailable);
      expect(await change(h, who, attempted)).toEqual(unavailable);
    }
    for (const who of [pending, disabled, guest]) {
      expect(await scope(h, who)).toEqual(unavailable);
    }
    for (const invalid of [
      pending.userId,
      disabled.userId,
      guest.userId,
      contactId,
      admin.userId,
    ]) {
      expect(await change(h, admin, grant(source.siteId, invalid, "warehouse_viewer"))).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    expect(await change(h, admin, grant(archived.id, operator.userId, "asset_manager"))).toEqual({
      ok: false,
      error: "invalid",
    });
    const workspace = await readOperationsAccessWorkspace(h.db, admin, signal());
    assert(workspace.ok);
    expect(workspace.value.staff).toContainEqual(
      expect.objectContaining({ id: operator.userId, eligible: true }),
    );
    expect(
      workspace.value.staff.filter(({ eligible }) => eligible).map(({ id }) => id),
    ).not.toContain(contactId);

    await h.db
      .insert(agencyProjectSettings)
      .values({ id: true, enabled: true })
      .onConflictDoUpdate({ target: agencyProjectSettings.id, set: { enabled: true } });
    const project = await createInternalProject(
      h.db,
      admin,
      { id: randomUUID(), title: "Private design project" },
      signal(),
    );
    assert(project.ok);
    await h.db.insert(agencyProjectMembers).values({
      projectId: project.value.id,
      userId: guest.userId,
      projectGuest: true,
    });
    const [pipeline] = await h.db.insert(pipelines).values({ name: "Inquiries" }).returning();
    assert(pipeline !== undefined);
    const [stage] = await h.db
      .insert(stages)
      .values({ pipelineId: pipeline.id, name: "Received" })
      .returning();
    assert(stage !== undefined);
    const [deal] = await h.db
      .insert(deals)
      .values({
        title: "Private stock inquiry",
        ownerId: admin.userId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        visibilityLevel: "owner",
      })
      .returning({ id: deals.id });
    assert(deal !== undefined);

    const target = { releaseId: randomUUID(), artifactId: randomUUID() };
    const bytes = Buffer.from("Synthetic drawing bytes");
    const objectKey = `confirmed/inventory-release-artifacts/${target.releaseId}/${target.artifactId}/${randomUUID()}`;
    const contentType = "application/octet-stream";
    await h.db.insert(inventoryProductReleases).values({
      id: target.releaseId,
      itemId: parent.itemId,
      revision: "A",
      createdBy: admin.userId,
    });
    await h.db.insert(inventoryReleaseArtifacts).values({
      id: target.artifactId,
      releaseId: target.releaseId,
      kind: "enclosure",
      name: "panel.step",
      sizeBytes: bytes.length,
      contentType,
      objectKey,
      etag: "fake-etag",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      createdBy: admin.userId,
      state: "ready",
    });
    const storage = new FakeStorageClient();
    storage.objectsByKey.set(objectKey, { size: bytes.length, contentType });
    storage.objectBytes.set(objectKey, bytes);
    expect(await change(h, admin, attempted)).toMatchObject({ ok: true });
    expect(
      await change(h, admin, grant(source.siteId, operator.userId, "asset_manager")),
    ).toMatchObject({
      ok: true,
    });
    expect(
      await change(h, admin, grant(source.siteId, operator.userId, "cost_viewer")),
    ).toMatchObject({
      ok: true,
    });

    for (const who of [operator, guest]) {
      expect(await readInventoryWorkspace(h.db, who, deal.id, signal())).toMatchObject({
        ok: false,
      });
      expect(await readReleaseArtifactDownload(h.db, who, target, signal(), storage)).toMatchObject(
        {
          ok: false,
        },
      );
    }
    expect(storage.calls).toEqual([]);
    expect(await readInternalProject(h.db, operator, project.value.id, signal())).toEqual({
      ok: false,
      error: "project_unavailable",
    });
    expect(await readInternalProject(h.db, guest, project.value.id, signal())).toMatchObject({
      ok: true,
      value: { guestAccess: "restricted", canEdit: false },
    });

    expect(
      await executeReleaseMetadata(
        h.db,
        admin,
        { type: "setGrant", itemId: parent.itemId, userId: operator.userId, role: "editor" },
        signal(),
        storage,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await readReleaseArtifactDownload(h.db, operator, target, signal(), storage),
    ).toMatchObject({
      ok: true,
      value: { bytes },
    });
  } finally {
    await h.close();
  }
});

test("upgrades populated 0133 stock and preserves legacy site management and a sales reservation", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 134);
    const { admin, source, lot, orderId } = await seedStructures(h);
    const manager = await staff(h, "Existing site manager");
    await h.db
      .insert(directorySiteGrants)
      .values({ siteId: source.siteId, userId: manager.userId, role: "manager" });
    const before = await incumbentRows(h);
    const previous = await ledger(h);
    expect(previous).toHaveLength(134);

    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const canonical = await readCanonicalMigrations(canonicalFolder, signal());
    assert(canonical.ok);
    const after = await ledger(h);
    expect(after).toHaveLength(canonical.value.length);
    expect(canonical.value[134]?.tag).toMatch(/^0134_/);
    expect(after[134]?.hash).toBe(canonical.value[134]?.hash);
    expect(after.slice(0, 134)).toEqual(previous);
    expect(await incumbentRows(h)).toEqual(before);
    expect(await readOperationsAccessWorkspace(h.db, admin, signal())).toMatchObject({
      ok: true,
      value: { grants: [] },
    });
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(after);

    expect(await warehouse(h, manager)).toMatchObject({
      ok: true,
      value: { sites: [{ id: source.siteId, canManage: true }] },
    });
    expect(
      await runInventoryCommand(
        h.db,
        admin,
        { type: "ship", requestId: randomUUID(), orderId, revision: 1 },
        null,
        signal(),
      ),
    ).toMatchObject({ ok: true });
    expect(await warehouse(h, manager)).toMatchObject({
      ok: true,
      value: {
        positions: expect.arrayContaining([
          expect.objectContaining({
            id: lot.positionId,
            onHand: 6,
            reserved: 0,
            lot: "MODULE-LOT-01",
          }),
        ]),
      },
    });
  } finally {
    await h.close();
  }
});
