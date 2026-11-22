import { randomUUID } from "node:crypto";
import { assert, expect, it } from "vitest";
import { runKitCommand } from "@/features/assets/kits/service";
import { runAssetCommand } from "@/features/assets/service";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import { actor, signal } from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { searchEquipment } from "./equipmentQuery";

async function site(h: TestDb, code: string) {
  const siteId = randomUUID();
  const locationId = randomUUID();
  await h.db.insert(directorySites).values({ id: siteId, name: code, code });
  await h.db.insert(directoryLocations).values({ id: locationId, siteId, name: code, code });
  return { siteId, locationId };
}

async function asset(
  h: TestDb,
  who: NativeSessionRef,
  placement: Awaited<ReturnType<typeof site>>,
  code: string,
  name: string,
  serial: string,
) {
  const result = await runAssetCommand(
    h.db,
    who,
    {
      type: "create",
      requestId: randomUUID(),
      ...placement,
      code,
      name,
      serial,
      tracking: "individual",
      modelId: null,
      categoryId: null,
      description: null,
      tags: [],
      fieldValues: {},
      openingQuantity: 0,
    },
    signal(),
  );
  assert(result.ok && result.focusId !== null);
  return result.focusId;
}

it("searches current active equipment and kits in scoped sites with stable ranked identities", async () => {
  const h = await makeTestDb();
  try {
    const admin = await actor(h, "Equipment admin", true);
    const viewer = await actor(h, "Equipment reader");
    const warehouse = await actor(h, "Warehouse staff");
    const west = await site(h, "WEST");
    const east = await site(h, "EAST");
    await setRole(h, admin, viewer, west.siteId, "asset_viewer");
    await setRole(h, admin, warehouse, west.siteId, "warehouse_viewer");
    const active = await asset(h, admin, west, "BENCH-02", "Bench meter", "QA-%2");
    const eastAsset = await asset(h, admin, east, "BENCH-03", "Bench meter east", "QA-EAST");
    const archiveId = await asset(h, admin, west, "BENCH-OLD", "Bench meter expired", "QA-OLD");
    const archived = await runAssetCommand(
      h.db,
      admin,
      {
        type: "setArchive",
        assetId: archiveId,
        version: 1,
        archived: true,
        reason: "Retired in test register",
        requestId: randomUUID(),
      },
      signal(),
    );
    assert(archived.ok);
    const kit = await runKitCommand(
      h.db,
      admin,
      {
        type: "saveKit",
        requestId: randomUUID(),
        ...west,
        code: "BENCH-KIT",
        name: "Bench kit",
        kitId: null,
        version: null,
        lines: [],
        note: null,
      },
      signal(),
    );
    assert(kit.ok);

    const read = (who: NativeSessionRef, q: string) => searchEquipment(h.db, who, q, signal());
    expect(await read(viewer, "bench")).toEqual([
      { id: kit.kitId, kind: "kit", primary: "Bench kit", secondary: "BENCH-KIT" },
      { id: active, kind: "asset", primary: "Bench meter", secondary: "BENCH-02 · QA-%2" },
    ]);
    expect(await read(viewer, "meter %2")).toMatchObject([{ id: active }]);
    expect(await read(viewer, "_")).toEqual([]);
    expect(await read(admin, "QA-EAST")).toMatchObject([{ id: eastAsset, kind: "asset" }]);
    expect(await read(admin, "QA-OLD")).toEqual([]);
    expect(await read(warehouse, "bench")).toEqual([]);
    expect(await read(viewer, "QA-EAST")).toEqual([]);
    await setRole(h, admin, viewer, west.siteId, "asset_viewer", false);
    expect(await read(viewer, "bench")).toEqual([]);
  } finally {
    await h.close();
  }
});
