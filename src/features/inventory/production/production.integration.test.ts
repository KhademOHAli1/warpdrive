import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { agencyProjectSettings } from "@/features/agency-projects/schema/agencyProjectSettings";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySiteGrants } from "@/features/locations/schema";
import {
  createInternalProject,
  readInternalProject,
  setInternalProjectMember,
  updateInternalProjectItem,
} from "@/features/projects/service";
import { makeTestDb, type TestDb } from "@/test/db";
import { blankCatalogProfile } from "../catalog/contracts";
import { inventoryPartProfiles } from "../catalog/schema";
import {
  type ApprovedBomLine,
  inventoryProductReleases,
  inventoryReleaseArtifacts,
} from "../releases/schema";
import { executeReleaseMetadata } from "../releases/service";
import { runInventoryCommand } from "../service";
import {
  actor,
  incumbentRows,
  position,
  seedStructures,
  signal,
  value,
} from "../warehouse/operations/structures.test-helpers";
import { inventoryStockPositions } from "../warehouse/schema";
import { runWarehouseCommand } from "../warehouse/service";
import { inventoryProductionBuilds, inventoryProductionOutputs } from "./buildSchema";
import type { ProductionIntent } from "./contracts";
import { inventoryProductionInputs, inventoryProductionReceipts } from "./materialSchema";
import { readProductionWorkspace, runProductionCommand } from "./service";

async function released(
  h: TestDb,
  admin: NativeSessionRef,
  itemId: string,
  revision: string,
  bom: ApprovedBomLine[],
) {
  const id = randomUUID();
  const createdBy = admin.userId;
  await h.db.insert(inventoryProductReleases).values({ id, revision, itemId, createdBy });
  const artifact = {
    releaseId: id,
    createdBy,
    sizeBytes: 32,
    sha256: "a".repeat(64),
    etag: "qa",
    state: "ready",
  } as const;
  await h.db.insert(inventoryReleaseArtifacts).values([
    {
      ...artifact,
      kind: "pcbFabrication",
      name: "pcb.zip",
      objectKey: `${id}/pcb`,
      contentType: "application/zip",
    },
    {
      ...artifact,
      kind: "manufacturingBom",
      name: "bom.csv",
      objectKey: `${id}/bom`,
      contentType: "text/csv",
      bomEntries: bom.map(({ sku, quantity }) => ({ sku, quantity })),
    },
  ]);
  await h.db
    .update(inventoryProductReleases)
    .set({ bom, status: "released", approvedAt: new Date(), approvedBy: createdBy })
    .where(eq(inventoryProductReleases.id, id));
  return id;
}

const send = (
  h: TestDb,
  who: NativeSessionRef,
  intent: ProductionIntent,
  requestId = randomUUID(),
) => runProductionCommand(h.db, who, { ...intent, requestId }, signal());

async function detail(h: TestDb, who: NativeSessionRef, buildId: string) {
  const result = value(await readProductionWorkspace(h.db, who, { buildId }, signal())).detail;
  assert(result !== null);
  return result;
}

async function pendingBatch(h: TestDb, who: NativeSessionRef, buildId: string) {
  const output = (await detail(h, who, buildId)).outputs.find(({ status }) => status === "wip");
  assert(output !== undefined);
  return output;
}

it("upgrades populated 0137 lots, serials, movement evidence and reservations before shipping the incumbent order", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 138);
    const fixture = await seedStructures(h);
    const before = await incumbentRows(h);
    const previous = await ledger(h);
    expect(previous).toHaveLength(138);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const upgraded = await ledger(h);
    const manifest = await readCanonicalMigrations(canonicalFolder, signal());
    assert(manifest.ok);
    expect(upgraded).toHaveLength(manifest.value.length);
    expect(manifest.value[138]?.tag).toBe("0138_inventory_production_builds");
    expect(upgraded[138]?.hash).toBe(manifest.value[138]?.hash);
    expect(upgraded.slice(0, 138)).toEqual(previous);
    expect(await incumbentRows(h)).toEqual(before);
    expect(await position(h, fixture.lot.positionId)).toMatchObject({
      onHand: 10,
      reserved: 4,
      buildOutputId: null,
    });
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(upgraded);
    expect(
      await runInventoryCommand(
        h.db,
        fixture.admin,
        {
          type: "ship",
          requestId: randomUUID(),
          orderId: fixture.orderId,
          revision: 1,
        },
        null,
        signal(),
      ),
    ).toMatchObject({ ok: true });
    expect(await position(h, fixture.lot.positionId)).toMatchObject({
      onHand: 6,
      reserved: 0,
      buildOutputId: null,
    });
  } finally {
    await h.close();
  }
});

it("executes exact-release child demand, scoped allocations, partial serialized output, scrap and safe reversal", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const manager = await actor(h, "Scoped production lead");
    const viewer = await actor(h, "Production observer");
    const outsider = await actor(h, "Remote production lead");
    await h.db.insert(directorySiteGrants).values([
      { siteId: f.source.siteId, userId: manager.userId, role: "manager" },
      { siteId: f.source.siteId, userId: viewer.userId, role: "viewer" },
      { siteId: f.remote.siteId, userId: outsider.userId, role: "manager" },
    ]);
    for (const itemId of [f.parent.itemId, f.lot.itemId]) {
      for (const { userId } of [manager, viewer, outsider]) {
        value(
          await executeReleaseMetadata(
            h.db,
            f.admin,
            { type: "setGrant", itemId, userId, role: "editor" },
            signal(),
          ),
        );
      }
    }
    await h.db
      .update(inventoryPartProfiles)
      .set({ flags: { ...blankCatalogProfile("product").flags, trackable: true } })
      .where(eq(inventoryPartProfiles.itemId, f.parent.itemId));
    for (const serial of ["Q-CHILD-2", "Q-CHILD-3", "Q-CHILD-4"]) {
      value(
        await runWarehouseCommand(
          h.db,
          f.admin,
          {
            type: "receive",
            requestId: randomUUID(),
            itemId: f.child.itemId,
            locationId: f.source.locationId,
            quantity: 1,
            lot: "TRACKED-COMPONENTS",
            serial,
            expiryDate: null,
            ownerOrganizationId: null,
            state: "available",
            incomingId: null,
          },
          signal(),
        ),
      );
    }
    const component = { itemId: f.child.itemId, sku: "CONTROL-0132", name: "Control", quantity: 1 };
    const childRelease = await released(h, f.admin, f.lot.itemId, "A", [component]);
    await released(h, f.admin, f.lot.itemId, "B", [component]);
    const rootRelease = await released(h, f.admin, f.parent.itemId, "A", [
      {
        itemId: f.lot.itemId,
        sku: "MODULE-0132",
        name: "Module",
        quantity: 1,
        spec: {
          enteredQuantity: "1",
          enteredUnit: "each",
          stockUnit: "each",
          childReleaseId: childRelease,
          alternatives: [],
          optional: false,
          consumable: false,
          inherited: false,
          pieces: null,
        },
      },
    ]);
    const creation = (releaseId: string, quantity: number) =>
      ({
        type: "createBuild",
        releaseId,
        quantity,
        ...f.source,
        dueDate: "2027-04-12",
        priority: "high",
        useTemplate: false,
        choices: [],
      }) as const satisfies ProductionIntent;
    const plan = (releaseId: string, quantity: number) =>
      send(h, manager, { ...creation(releaseId, quantity), choices: [] });
    const incumbentChild = value(await plan(childRelease, 1)).buildId;
    async function action(
      buildId: string,
      intent:
        | Omit<Extract<ProductionIntent, { type: "finalizeBatch" }>, "buildId" | "version">
        | Omit<Extract<ProductionIntent, { type: "reverseOutput" }>, "buildId" | "version">
        | { type: "startBatch"; quantity: number }
        | { type: "issue" | "autoAllocate" }
        | { type: "hold" | "resume" | "cancelBuild"; reason: string }
        | { type: "deallocate"; materialId: string; positionId: string; quantity: number },
    ) {
      const { version } = await detail(h, manager, buildId);
      return send(h, manager, { ...intent, buildId, version });
    }
    async function output(buildId: string, lot: string) {
      value(await action(buildId, { type: "autoAllocate" }));
      value(await action(buildId, { type: "issue" }));
      value(await action(buildId, { type: "startBatch", quantity: 1 }));
      const { id } = await pendingBatch(h, manager, buildId);
      value(
        await action(buildId, {
          type: "finalizeBatch",
          outputId: id,
          lot,
          serials: [],
          reason: "Built module",
          disposition: "completed",
        }),
      );
      return id;
    }
    const onHandOutput = await output(incumbentChild, "MODULE-APPROVED-A");
    const requestId = randomUUID();
    const rootIntent = { ...creation(rootRelease, 2), choices: [] } satisfies ProductionIntent;
    const [first, repeated] = await Promise.all([
      send(h, manager, rootIntent, requestId),
      send(h, manager, rootIntent, requestId),
    ]);
    const { buildId } = value(first);
    expect(repeated).toEqual(first);
    const root = await detail(h, viewer, buildId);
    expect(root).toMatchObject({
      quantity: 2,
      status: "planned",
      canManage: false,
      trackable: true,
    });
    expect(root.children).toMatchObject([
      { release: { id: childRelease }, quantity: 1, parentId: buildId },
    ]);
    expect(root.materials).toMatchObject([
      {
        demand: 2,
        allocated: 1,
        releaseId: childRelease,
        allocations: [{ position: { buildOutputId: onHandOutput } }],
      },
    ]);
    expect(await send(h, viewer, { type: "issue", buildId, version: 1 })).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(await plan(childRelease, 1)).toMatchObject({ ok: true });
    expect(await readProductionWorkspace(h.db, outsider, { buildId }, signal())).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(await send(h, outsider, { type: "issue", buildId, version: 1 })).toEqual({
      ok: false,
      error: "unavailable",
    });
    const [child] = root.children;
    assert(child !== undefined);
    const freshOutput = await output(child.id, "MODULE-SECOND-A");
    value(await action(buildId, { type: "autoAllocate" }));
    value(await action(buildId, { type: "issue" }));
    const during = await detail(h, manager, buildId);
    const [material] = during.materials;
    const [reservation] = material?.allocations ?? [];
    assert(material !== undefined && reservation !== undefined);
    value(await action(buildId, { type: "hold", reason: "Stop for inspection" }));
    value(
      await action(buildId, {
        type: "deallocate",
        materialId: material.id,
        positionId: reservation.position.id,
        quantity: 1,
      }),
    );
    expect(await action(buildId, { type: "autoAllocate" })).toEqual({ ok: false, error: "state" });
    value(await action(buildId, { type: "resume", reason: "Resume after inspection" }));
    value(await action(buildId, { type: "autoAllocate" }));

    value(await action(buildId, { type: "startBatch", quantity: 1 }));
    value(await action(buildId, { type: "startBatch", quantity: 1 }));
    const splits = (await detail(h, manager, buildId)).outputs.filter(
      ({ status }) => status === "wip",
    );
    expect(splits).toHaveLength(2);
    const [completed, scrap] = splits;
    assert(completed !== undefined && scrap !== undefined);
    const finalize = (serial: string) =>
      action(buildId, {
        type: "finalizeBatch",
        outputId: completed.id,
        disposition: "completed",
        reason: "Final assembly accepted",
        lot: "ASSEMBLY-LOT",
        serials: [serial],
      });
    expect(await finalize("PARENT-001")).toEqual({ ok: false, error: "serial" });
    expect((await detail(h, manager, buildId)).materials[0]?.allocated).toBe(2);
    value(await finalize("PARENT-NEW-001"));
    value(
      await action(buildId, {
        type: "finalizeBatch",
        outputId: scrap.id,
        disposition: "scrapped",
        reason: "Rework disposition",
        lot: null,
        serials: [],
      }),
    );
    const closed = await detail(h, manager, buildId);
    expect(closed).toMatchObject({ status: "closed", completed: 1, scrapped: 1 });
    const sourceOutputs = closed.outputs.flatMap(({ inputs }) =>
      inputs.flatMap(({ position: input }) =>
        input.buildOutputId === null ? [] : [input.buildOutputId],
      ),
    );
    expect(sourceOutputs.sort()).toEqual([onHandOutput, freshOutput].sort());
    expect(await position(h, f.lot.positionId)).toMatchObject({
      onHand: 10,
      reserved: 4,
      buildOutputId: null,
    });
    value(
      await action(buildId, {
        type: "reverseOutput",
        outputId: scrap.id,
        reason: "Return intact module to stock",
      }),
    );
    const open = await detail(h, manager, buildId);
    expect(open).toMatchObject({ status: "issued", completed: 1, scrapped: 0 });
    expect(open.outputs.find(({ id }) => id === scrap.id)).toMatchObject({ status: "reversed" });
    value(
      await action(buildId, {
        type: "reverseOutput",
        outputId: completed.id,
        reason: "Reverse pristine output",
      }),
    );
    const [result] = await h.db
      .select()
      .from(inventoryStockPositions)
      .where(eq(inventoryStockPositions.buildOutputId, completed.id));
    expect(result).toMatchObject({ onHand: 0, serial: "PARENT-NEW-001" });
    expect(
      await h.db
        .select()
        .from(inventoryProductionInputs)
        .where(eq(inventoryProductionInputs.outputId, completed.id)),
    ).toHaveLength(1);
    value(await action(buildId, { type: "cancelBuild", reason: "Build superseded" }));
    expect(
      await action(incumbentChild, {
        type: "reverseOutput",
        outputId: onHandOutput,
        reason: "Already used and returned",
      }),
    ).toEqual({ ok: false, error: "reversal" });
    const cascade = value(await plan(rootRelease, 3)).buildId;
    const pending = await detail(h, manager, cascade);
    expect(pending.children).toMatchObject([{ status: "planned", quantity: 1 }]);
    value(await action(cascade, { type: "cancelBuild", reason: "Series withdrawn" }));
    const stopped = await detail(h, manager, cascade);
    expect(stopped.children).toMatchObject([{ status: "cancelled", quantity: 1 }]);
    expect(stopped.materials[0]?.allocated).toBe(0);
    await expect(
      h.db
        .update(inventoryProductionOutputs)
        .set({ lot: "REWRITTEN" })
        .where(eq(inventoryProductionOutputs.id, completed.id)),
    ).rejects.toThrow();
    await expect(
      h.db
        .update(inventoryProductionBuilds)
        .set({ releaseId: childRelease })
        .where(eq(inventoryProductionBuilds.id, buildId)),
    ).rejects.toThrow();
    await h.db.delete(directorySiteGrants).where(eq(directorySiteGrants.userId, manager.userId));
    expect(await send(h, manager, rootIntent, requestId)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(
      await h.db
        .select()
        .from(inventoryProductionReceipts)
        .where(eq(inventoryProductionReceipts.requestId, requestId)),
    ).toHaveLength(1);
  } finally {
    await h.close();
  }
});

it("links native assigned tasks and gates finished stock on production project completion", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    await h.db
      .insert(agencyProjectSettings)
      .values({ id: true, enabled: true })
      .onConflictDoUpdate({ target: agencyProjectSettings.id, set: { enabled: true } });
    const observer = await actor(h, "Project participant without engineering scope");
    const project = value(
      await createInternalProject(
        h.db,
        f.admin,
        { id: randomUUID(), title: "Production tasks" },
        signal(),
      ),
    );
    value(
      await setInternalProjectMember(
        h.db,
        f.admin,
        {
          projectId: project.id,
          userId: observer.userId,
          membership: { role: "viewer", canAssign: false },
        },
        signal(),
      ),
    );
    value(
      await runInventoryCommand(
        h.db,
        f.admin,
        {
          type: "saveTemplate",
          requestId: randomUUID(),
          itemId: f.parent.itemId,
          projectId: project.id,
          steps: [{ title: "Confirm connector torque", assigneeId: f.admin.userId }],
        },
        null,
        signal(),
      ),
    );
    const releaseId = await released(h, f.admin, f.parent.itemId, "A", [
      { itemId: f.child.itemId, sku: "CONTROL-0132", name: "Control", quantity: 1 },
    ]);
    const { buildId } = value(
      await send(h, f.admin, {
        type: "createBuild",
        releaseId,
        ...f.source,
        quantity: 1,
        priority: "normal",
        dueDate: null,
        useTemplate: true,
        choices: [],
      }),
    );
    const workspace = value(await readInternalProject(h.db, f.admin, project.id, signal()));
    const task = workspace.items.find((item) => item.productionBuildId === buildId);
    assert(task !== undefined);
    expect(task).toMatchObject({
      title: "Confirm connector torque",
      assigneeId: f.admin.userId,
    });
    const restricted = value(await readInternalProject(h.db, observer, project.id, signal()));
    expect(restricted.items.find(({ id }) => id === task.id)?.productionBuildId).toBeUndefined();
    const build = () => detail(h, f.admin, buildId);
    value(
      await send(h, f.admin, { type: "autoAllocate", buildId, version: (await build()).version }),
    );
    value(await send(h, f.admin, { type: "issue", buildId, version: (await build()).version }));
    value(
      await send(h, f.admin, {
        type: "startBatch",
        buildId,
        version: (await build()).version,
        quantity: 1,
      }),
    );
    const finish = {
      type: "finalizeBatch",
      buildId,
      version: (await build()).version,
      outputId: (await pendingBatch(h, f.admin, buildId)).id,
      disposition: "completed",
      lot: "TORQUE-OK",
      serials: [],
      reason: "Torque accepted",
    } satisfies ProductionIntent;
    expect(await send(h, f.admin, finish)).toEqual({ ok: false, error: "project" });
    value(
      await updateInternalProjectItem(
        h.db,
        f.admin,
        { projectId: project.id, itemId: task.id, revision: task.revision, status: "done" },
        signal(),
      ),
    );
    value(await send(h, f.admin, finish));
    expect(await build()).toMatchObject({
      status: "closed",
      completed: 1,
      project: { tasks: [{ id: task.id, completed: true }] },
    });
  } finally {
    await h.close();
  }
});
