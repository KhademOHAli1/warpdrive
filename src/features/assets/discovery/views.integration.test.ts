import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { savedFilters } from "@/db/schema/savedFilters";
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import { actor, signal } from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { listSavedFilters, removeSavedFilter } from "@/features/saved-filters/savedFilterActions";
import { makeTestDb, type TestDb } from "@/test/db";
import { runAssetCommand } from "../service";
import type { AssetRegisterViewSave } from "./contracts";
import { assetRegisterDiscoveryReceipts } from "./schema";
import { readAssetRegisterViews, removeAssetRegisterView, saveAssetRegisterView } from "./views";

const unavailable = { ok: false, error: "unavailable" } as const;
const conflict = { ok: false, error: "conflict" } as const;

async function setup(h: TestDb) {
  const { db } = h;
  const admin = await actor(h, "Equipment administrator", true);
  const main = { site: randomUUID(), location: randomUUID() };
  const east = { site: randomUUID(), location: randomUUID() };
  await db.insert(directorySites).values([
    { id: main.site, code: "ASSEMBLY", name: "Main assembly" },
    { id: east.site, code: "EAST", name: "East service" },
  ]);
  await db.insert(directoryLocations).values([
    { id: main.location, siteId: main.site, code: "BENCH", name: "Assembly bench" },
    { id: east.location, siteId: east.site, code: "BENCH", name: "Service bench" },
  ]);
  const owner = await createSourcingActor(
    h,
    admin,
    "Equipment view owner",
    main.site,
    "asset_viewer",
  );
  await setRole(h, admin, owner, east.site, "asset_viewer");
  const peer = await createSourcingActor(
    h,
    admin,
    "Equipment view peer",
    main.site,
    "asset_manager",
  );
  const warehouse = await createSourcingActor(
    h,
    admin,
    "Warehouse operator",
    main.site,
    "warehouse_manager",
  );
  const saved = await runAssetCommand(
    db,
    admin,
    {
      type: "saveCategory",
      siteId: main.site,
      categoryId: null,
      version: null,
      name: "Instrumentation",
      fields: [],
      requestId: randomUUID(),
    },
    signal(),
  );
  assert(saved.ok);
  const category = saved.value.categories.find(({ siteId }) => siteId === main.site);
  assert(category !== undefined);
  return { admin, owner, peer, warehouse, main, east, category };
}

function viewInput(
  { site, location }: { site: string; location: string },
  category: string,
): AssetRegisterViewSave {
  return {
    id: null,
    version: null,
    requestId: randomUUID(),
    name: "  Calibration benches  ",
    settings: {
      filters: {
        site,
        location,
        category,
        search: "Bench",
        tracking: "individual",
        status: "active",
        includeSublocations: true,
      },
      columns: ["name", "serial", "model", "location"],
      sort: [{ column: "serial", direction: "asc" }],
    },
  };
}

it("stores personal versioned views, fences their site references and rechecks each replay", async () => {
  const h = await makeTestDb();
  try {
    const { db } = h;
    const { admin, owner, peer, warehouse, main, east, category } = await setup(h);
    const create = viewInput(main, category.id);
    const wrongBin = {
      ...create,
      settings: {
        ...create.settings,
        filters: { ...create.settings.filters, location: east.location },
      },
    };
    expect(await saveAssetRegisterView(db, owner, wrongBin, signal())).toEqual(unavailable);
    expect(await saveAssetRegisterView(db, warehouse, create, signal())).toEqual(unavailable);
    expect(await readAssetRegisterViews(db, warehouse, signal())).toEqual(unavailable);

    const existing = await saveAssetRegisterView(db, owner, create, signal());
    assert(existing.ok, JSON.stringify(existing));
    const [view] = existing.views;
    assert(view !== undefined);
    expect(view).toMatchObject({
      name: "Calibration benches",
      version: 1,
      settings: create.settings,
    });
    expect(await saveAssetRegisterView(db, owner, create, signal())).toEqual(existing);
    expect(await readAssetRegisterViews(db, owner, signal())).toEqual(existing);
    expect(await readAssetRegisterViews(db, peer, signal())).toEqual({ ok: true, views: [] });
    expect(
      await saveAssetRegisterView(db, owner, { ...create, name: "Changed request" }, signal()),
    ).toEqual(conflict);
    expect(
      await saveAssetRegisterView(
        db,
        owner,
        { ...create, requestId: randomUUID(), name: "CALIBRATION BENCHES" },
        signal(),
      ),
    ).toEqual(conflict);

    const peerCopy = await saveAssetRegisterView(db, peer, create, signal());
    assert(peerCopy.ok);
    const [peerView] = peerCopy.views;
    assert(peerView !== undefined);
    expect(peerView.id).not.toBe(view.id);
    expect({ ...peerView, id: view.id }).toEqual(view);
    const update = {
      ...create,
      id: view.id,
      version: view.version,
      requestId: randomUUID(),
      name: "Calibrate instruments",
    };
    expect(await saveAssetRegisterView(db, peer, update, signal())).toEqual(unavailable);
    expect(
      await removeAssetRegisterView(
        db,
        peer,
        { id: view.id, version: view.version, requestId: randomUUID() },
        signal(),
      ),
    ).toEqual(unavailable);
    const changed = await saveAssetRegisterView(db, owner, update, signal());
    expect(changed).toEqual({ ok: true, views: [{ ...view, name: update.name, version: 2 }] });
    expect(await saveAssetRegisterView(db, owner, update, signal())).toEqual(changed);
    expect(
      await saveAssetRegisterView(db, owner, { ...update, requestId: randomUUID() }, signal()),
    ).toEqual(conflict);

    const otherSite = { ...viewInput(east, ""), name: update.name };
    expect(await saveAssetRegisterView(db, owner, otherSite, signal())).toMatchObject({
      ok: true,
      views: expect.arrayContaining([{ ...view, name: update.name, version: 2 }]),
    });
    await setRole(h, admin, owner, main.site, "asset_viewer", false);
    const visible = await readAssetRegisterViews(db, owner, signal());
    assert(visible.ok);
    expect(visible.views).toHaveLength(1);
    expect(visible.views[0]).toMatchObject({ settings: otherSite.settings });
    expect(await saveAssetRegisterView(db, owner, update, signal())).toEqual(unavailable);

    await setRole(h, admin, owner, main.site, "asset_viewer");
    const deletion = { id: view.id, version: 2, requestId: randomUUID() };
    expect(await removeAssetRegisterView(db, owner, { ...deletion, version: 1 }, signal())).toEqual(
      conflict,
    );
    expect(await removeAssetRegisterView(db, owner, deletion, signal())).toEqual(visible);
    expect(await removeAssetRegisterView(db, owner, deletion, signal())).toEqual(visible);
    await setRole(h, admin, owner, main.site, "asset_viewer", false);
    expect(await removeAssetRegisterView(db, owner, deletion, signal())).toEqual(unavailable);
  } finally {
    await h.close();
  }
});

it("preserves legacy CRM filters and guards private view definitions and receipts in Postgres", async () => {
  const h = await makeTestDb();
  try {
    const { db } = h;
    const { owner, main, east, category } = await setup(h);
    const create = viewInput(main, category.id);
    const result = await saveAssetRegisterView(db, owner, create, signal());
    assert(result.ok);
    const [view] = result.views;
    assert(view !== undefined);

    const [legacy] = await db
      .insert(savedFilters)
      .values({
        ownerId: owner.userId,
        targetEntity: "deal",
        name: "Legacy deals",
        definition: { clauses: [] },
        isShared: false,
      })
      .returning();
    assert(legacy !== undefined);
    const legacySession = { userId: owner.userId, isAdmin: false, flags: {} };
    expect(await listSavedFilters(db, legacySession, "deal", signal())).toEqual([legacy]);
    expect((await removeSavedFilter(db, legacySession, view.id, signal())).ok).toBe(false);
    expect(await readAssetRegisterViews(db, owner, signal())).toEqual(result);

    await expect(
      db.update(savedFilters).set({ isShared: true }).where(eq(savedFilters.id, view.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    const crossBin = {
      ...view.settings,
      filters: { ...view.settings.filters, location: east.location },
    };
    await expect(
      db
        .update(savedFilters)
        .set({ definition: { schemaVersion: 1, version: 2, settings: crossBin } })
        .where(eq(savedFilters.id, view.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db
        .delete(assetRegisterDiscoveryReceipts)
        .where(eq(assetRegisterDiscoveryReceipts.requestId, create.requestId)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    expect(await listSavedFilters(db, legacySession, "deal", signal())).toEqual([legacy]);
    expect(await readAssetRegisterViews(db, owner, signal())).toEqual(result);
  } finally {
    await h.close();
  }
});
