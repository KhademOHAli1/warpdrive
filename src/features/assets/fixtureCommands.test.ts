import { describe, expect, it } from "vitest";
import type { AssetIntent, AssetsWorkspace } from "./contracts";
import { assetsFixture } from "./fixtures";
import { applyAssetWorkspaceCommand } from "./registerCommands";

function apply(workspace: AssetsWorkspace, intent: AssetIntent) {
  return applyAssetWorkspaceCommand(
    workspace,
    { ...intent, requestId: crypto.randomUUID() },
    "Demo operator",
  );
}

function seed() {
  const workspace = assetsFixture(true);
  const model = workspace.models[0];
  const pool = workspace.records.find(({ tracking }) => tracking === "returnable_pool");
  const worksBin = workspace.locations.find(({ code }) => code === "A-01");
  const receiving = workspace.locations.find(({ code }) => code === "RECEIVING");
  const serviceBin = workspace.locations.find(({ code }) => code === "TOOL-CRIB");
  if (
    model === undefined ||
    pool?.tracking !== "returnable_pool" ||
    worksBin === undefined ||
    receiving === undefined ||
    serviceBin === undefined
  )
    throw new Error("Demo fixtures incomplete");
  return { workspace, model, pool, worksBin, receiving, serviceBin };
}

describe("asset register fixture", () => {
  it("checks category fields and keeps existing records valid when a definition changes", () => {
    const { workspace, model } = seed();
    const category = workspace.categories[0];
    const range = category?.fields.find(({ type }) => type === "choice");
    if (category === undefined || range === undefined) throw new Error("Demo category incomplete");
    const { id: modelId, ...defaults } = model;
    expect(
      apply(workspace, {
        ...defaults,
        type: "saveModel",
        modelId,
        fieldValues: { ...model.fieldValues, [range.id]: "Unsupported measurement" },
      }),
    ).toEqual({ ok: false, error: "invalid" });
    expect(
      apply(workspace, {
        type: "saveCategory",
        siteId: category.siteId,
        categoryId: category.id,
        version: category.version,
        name: category.name,
        fields: category.fields.map((field) =>
          field.id === range.id
            ? { ...field, options: ["4–20 mA"], defaultValue: "4–20 mA" }
            : field,
        ),
      }),
    ).toEqual({ ok: false, error: "state" });
  });

  it("creates separate model units by stable IDs and keeps the model defaults", () => {
    const { workspace, model, worksBin } = seed();
    const input = {
      type: "createFleet",
      modelId: model.id,
      siteId: model.siteId,
      locationId: worksBin.id,
      units: [
        { code: "METER-203", serial: "METER-QA-0203" },
        { code: "METER-204", serial: "METER-QA-0204" },
      ],
    } satisfies AssetIntent;
    const created = apply(workspace, input);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const [first, second] = created.value.records.slice(-2);
    expect(first).toMatchObject({
      tracking: "individual",
      modelId: model.id,
      fieldValues: model.fieldValues,
      categoryId: model.categoryId,
      locationId: worksBin.id,
    });
    expect(first?.id).not.toBe(second?.id);
    expect(workspace.records).toHaveLength(created.value.records.length - 2);
    expect(apply(created.value, input)).toEqual({ ok: false, error: "conflict" });
  });

  it("moves part of a pool in scope and protects the quantity and version", () => {
    const { workspace, pool, worksBin, receiving, serviceBin } = seed();
    const input = {
      type: "changePool",
      assetId: pool.id,
      version: pool.version,
      operation: "move",
      locationId: worksBin.id,
      toLocationId: receiving.id,
      quantity: 5,
      reason: "Bench replenishment",
    } satisfies AssetIntent;
    expect(apply(workspace, { ...input, quantity: 13 })).toEqual({ ok: false, error: "stock" });
    expect(apply(workspace, { ...input, toLocationId: serviceBin.id })).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(apply(assetsFixture(false), input)).toEqual({ ok: false, error: "unavailable" });
    const moved = apply(workspace, input);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const position = moved.value.records.find(({ id }) => id === pool.id);
    expect(position).toMatchObject({
      balances: expect.arrayContaining([
        { locationId: worksBin.id, quantity: 7 },
        { locationId: receiving.id, quantity: 13 },
      ]),
      events: [expect.objectContaining({ kind: "moved", quantity: 5, reason: input.reason })],
    });
    expect(apply(moved.value, input)).toEqual({ ok: false, error: "stale" });
  });

  it("keeps recorded history on reinstatement and rejects consumption of reusable pools", () => {
    const { workspace, pool, worksBin } = seed();
    expect(
      apply(workspace, {
        type: "changePool",
        assetId: pool.id,
        version: pool.version,
        operation: "consume",
        locationId: worksBin.id,
        toLocationId: null,
        quantity: 1,
        reason: "Test",
      }),
    ).toEqual({ ok: false, error: "invalid" });
    const archived = apply(workspace, {
      type: "setArchive",
      assetId: pool.id,
      version: pool.version,
      archived: true,
      reason: "Temporarily out of service",
    });
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    const restored = apply(archived.value, {
      type: "setArchive",
      assetId: pool.id,
      version: pool.version + 1,
      archived: false,
      reason: "Reinstated",
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.records.find(({ id }) => id === pool.id)).toMatchObject({
      id: pool.id,
      archivedAt: null,
      balances: pool.balances,
      events: [
        expect.objectContaining({ kind: "reinstated" }),
        expect.objectContaining({ kind: "archived" }),
      ],
    });
  });
});
