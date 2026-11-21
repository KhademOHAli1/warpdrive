import { assert, describe, expect, it } from "vitest";
import type { AssetsWorkspace } from "../contracts";
import { emptyCustodyWorkspace } from "../custody/contracts";
import { assetsFixture } from "../fixtures";
import { emptyKitWorkspace, type KitIntent, type KitResult } from "./contracts";
import { applyKitCommand } from "./transitions";

function accepted(effect: KitResult) {
  if (!effect.ok) throw new Error(`Expected a kit result, received ${effect.error}`);
  const kit = effect.value.kits.records.find(({ id }) => id === effect.kitId);
  assert(kit !== undefined);
  return { kit, value: effect.value };
}

function submit(workspace: AssetsWorkspace, intent: KitIntent) {
  return applyKitCommand(workspace, { ...intent, requestId: crypto.randomUUID() }, "Kit operator");
}

function equipment(workspace: AssetsWorkspace, code: string) {
  const row = workspace.records.find((asset) => asset.code === code);
  assert(row !== undefined);
  return row;
}

function seed() {
  const initial = assetsFixture(true);
  const bin = initial.locations.find(({ code }) => code === "A-01");
  const recovery = initial.locations.find(({ code }) => code === "RECEIVING");
  const remoteBin = initial.locations.find(({ code }) => code === "TOOL-CRIB");
  assert(bin !== undefined && recovery !== undefined && remoteBin !== undefined);
  const { siteId } = bin;
  const requested = equipment(initial, "METER-101");
  const alternate = equipment(initial, "METER-102");
  const pool = equipment(initial, "LEAD-SET");
  const supplies = equipment(initial, "FERRULE-1");
  const remote = equipment(initial, "LOOP-01");
  assert(requested.tracking === "individual" && requested.modelId !== null);
  assert(alternate.tracking === "individual");
  const custodianId = crypto.randomUUID();
  const workspace = {
    ...initial,
    records: initial.records.map((item) =>
      item.id === alternate.id ? { ...alternate, locationId: recovery.id } : item,
    ),
    kits: emptyKitWorkspace(),
    custody: {
      ...emptyCustodyWorkspace(),
      custodians: [
        {
          id: custodianId,
          siteId,
          name: "Field technician",
          kind: "non_login" as const,
          staffId: null,
          active: true,
          version: 1,
        },
      ],
    },
  };
  const definition = {
    type: "saveKit",
    siteId,
    kitId: null,
    version: null,
    code: "SERVICE-KIT",
    name: "Service measurement kit",
    locationId: bin.id,
    note: null,
    lines: [],
  } satisfies KitIntent;
  const modelLine = {
    mode: "model",
    assetId: requested.id,
    modelId: requested.modelId,
    quantity: 1,
    sourceLocationId: null,
  } as const;
  return {
    workspace,
    definition,
    modelLine,
    custodianId,
    siteId,
    bin,
    recovery,
    remoteBin,
    requested,
    alternate,
    pool,
    supplies,
    remote,
  };
}

function kitTarget(kit: { id: string; siteId: string; version: number }) {
  return { kitId: kit.id, siteId: kit.siteId, version: kit.version };
}

describe("shared kit transitions", () => {
  it("packs exact slices once per asset and moves only the contents of the kit", () => {
    const { workspace, definition, modelLine, pool, bin, recovery, requested } = seed();
    const firstSlice = {
      mode: "returnable_pool",
      assetId: pool.id,
      modelId: null,
      quantity: 4,
      sourceLocationId: bin.id,
    } as const;
    const packed = accepted(
      submit(workspace, {
        ...definition,
        lines: [
          modelLine,
          firstSlice,
          { ...firstSlice, quantity: 2, sourceLocationId: recovery.id },
        ],
      }),
    );
    const free = expect.arrayContaining([
      { locationId: bin.id, quantity: 8 },
      { locationId: recovery.id, quantity: 6 },
    ]);
    expect(equipment(packed.value, pool.code)).toMatchObject({
      version: pool.version + 1,
      balances: free,
    });
    expect(packed.kit.lines.map(({ packedQuantity }) => packedQuantity)).toEqual([1, 4, 2]);

    const moved = accepted(
      submit(packed.value, {
        ...kitTarget(packed.kit),
        type: "moveKit",
        locationId: recovery.id,
        note: "Move the packed kit to receiving",
      }),
    );
    expect(moved.kit).toMatchObject({ locationId: recovery.id, version: 2, definitionVersion: 1 });
    expect(equipment(moved.value, requested.code)).toMatchObject({ locationId: recovery.id });
    const poolAfter = equipment(moved.value, pool.code);
    expect(poolAfter).toMatchObject({ version: pool.version + 2, balances: free });
    expect(poolAfter.events[0]).toMatchObject({
      kind: "moved",
      quantity: 6,
      fromLocationId: bin.id,
      locationId: recovery.id,
    });
    expect(submit(moved.value, { ...definition, code: "OTHER-KIT", lines: [modelLine] })).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(equipment(workspace, pool.code)).toEqual(pool);
  });

  it("pins alternate identity and partially returns supplies or explicitly consumes them", () => {
    const { workspace, definition, modelLine, bin, alternate, requested, supplies, custodianId } =
      seed();
    const ready = accepted(
      submit(workspace, {
        ...definition,
        lines: [
          modelLine,
          {
            mode: "consumable_pool",
            assetId: supplies.id,
            modelId: null,
            quantity: 3,
            sourceLocationId: bin.id,
          },
        ],
      }),
    );
    const [model, consumables] = ready.kit.lines;
    assert(model !== undefined && consumables !== undefined);
    const issued = accepted(
      submit(ready.value, {
        ...kitTarget(ready.kit),
        type: "checkoutKit",
        custodianId,
        replacements: [{ lineId: model.id, assetId: alternate.id }],
        note: "Use the spare meter",
      }),
    );
    const [checkout] = issued.value.kits.checkouts;
    assert(checkout !== undefined);
    expect(checkout.lines[0]).toMatchObject({
      id: model.id,
      requestedAssetId: requested.id,
      assetId: alternate.id,
      serial: alternate.serial,
    });
    expect(checkout).toMatchObject({ definitionVersion: 1, closedAt: null });
    expect(issued.kit.lines).toMatchObject([
      { assetId: alternate.id, packedQuantity: 0 },
      { packedQuantity: 0 },
    ]);
    expect(equipment(issued.value, alternate.code)).toMatchObject({ locationId: bin.id });
    expect(
      submit(issued.value, {
        ...definition,
        ...kitTarget(issued.kit),
        name: "Changed while out",
      }),
    ).toEqual({ ok: false, error: "held" });

    const settle = {
      type: "returnKit",
      checkoutId: checkout.id,
      condition: "worn",
      note: null,
    } as const;
    const partial = accepted(
      submit(issued.value, {
        ...kitTarget(issued.kit),
        ...settle,
        lines: [{ lineId: consumables.id, returned: 1, consumed: 1 }],
      }),
    );
    expect(partial.value.kits.checkouts[0]).toMatchObject({ closedAt: null });
    expect(partial.kit.lines[1]).toMatchObject({ packedQuantity: 1 });
    expect(
      submit(partial.value, {
        ...kitTarget(partial.kit),
        ...settle,
        lines: [{ lineId: model.id, returned: 0, consumed: 1 }],
      }),
    ).toEqual({ ok: false, error: "invalid" });
    const settled = accepted(
      submit(partial.value, {
        ...kitTarget(partial.kit),
        ...settle,
        lines: [
          { lineId: model.id, returned: 1, consumed: 0 },
          { lineId: consumables.id, returned: 0, consumed: 1 },
        ],
      }),
    );
    expect(settled.value.kits.checkouts[0]).toMatchObject({
      closedAt: expect.any(String),
      lines: [
        { id: model.id, assetId: alternate.id, returned: 1, consumed: 0 },
        { id: consumables.id, returned: 1, consumed: 2 },
      ],
    });
    expect(
      submit(settled.value, {
        ...kitTarget(settled.kit),
        type: "checkoutKit",
        custodianId,
        replacements: [],
        note: null,
      }),
    ).toEqual({ ok: false, error: "quantity" });
    expect(equipment(settled.value, supplies.code)).toMatchObject({
      balances: [{ locationId: bin.id, quantity: 97 }],
    });

    const edited = accepted(
      submit(settled.value, { ...definition, ...kitTarget(settled.kit), name: "Empty kit" }),
    );
    expect(edited.kit).toMatchObject({ definitionVersion: 2, lines: [] });
    expect(edited.value.kits.checkouts).toEqual(settled.value.kits.checkouts);
    expect(edited.value.kits.returns).toEqual(settled.value.kits.returns);
    expect(equipment(edited.value, supplies.code)).toMatchObject({
      balances: [{ locationId: bin.id, quantity: 98 }],
    });
  });

  it("rejects a foreign member or overdrawn loose slice without affecting the original pack", () => {
    const { workspace, definition, modelLine, remote, remoteBin, pool, bin } = seed();
    const foreign = {
      mode: "individual",
      assetId: remote.id,
      modelId: null,
      quantity: 1,
      sourceLocationId: remoteBin.id,
    } as const;
    expect(submit(workspace, { ...definition, lines: [modelLine, foreign] })).toEqual({
      ok: false,
      error: "unavailable",
    });
    const overdrawn = {
      mode: "returnable_pool",
      assetId: pool.id,
      modelId: null,
      quantity: 13,
      sourceLocationId: bin.id,
    } as const;
    expect(submit(workspace, { ...definition, lines: [modelLine, overdrawn] })).toEqual({
      ok: false,
      error: "quantity",
    });
    const valid = accepted(submit(workspace, { ...definition, lines: [modelLine] }));
    expect(valid.kit).toMatchObject({ version: 1, definitionVersion: 1 });
    expect(equipment(valid.value, pool.code)).toBe(pool);
  });
});
