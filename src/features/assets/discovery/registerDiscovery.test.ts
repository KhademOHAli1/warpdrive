import { describe, expect, it } from "vitest";
import { assetsFixture } from "../fixtures";
import { applyAssetRegisterBatch } from "./batch";
import type { AssetRegisterBatchInput } from "./contracts";
import { sortAssetRegisterRecords } from "./sort";

const destinationId = "8174452d-abb6-4ed2-b226-86c6dd07a623";
const thirdId = "80d728a2-6cfa-4269-b088-346ec9be4946";

function demo() {
  const workspace = assetsFixture(true);
  const original = workspace.models[0];
  const first = workspace.records.find(({ code }) => code === "METER-101");
  const second = workspace.records.find(({ code }) => code === "METER-102");
  const pool = workspace.records.find(({ code }) => code === "LEAD-SET");
  const remote = workspace.records.find(({ code }) => code === "LOOP-01");
  if (
    first?.tracking !== "individual" ||
    second?.tracking !== "individual" ||
    original === undefined ||
    pool === undefined ||
    remote === undefined
  )
    throw new Error("Expected both sites and the demonstration meter fleet");
  const destination = { ...original, id: destinationId, code: "CAL-BENCH" };
  const third = { ...second, id: thirdId, code: "METER-103", serial: "MT-10", version: 2 };
  return {
    workspace: {
      ...workspace,
      models: [...workspace.models, destination],
      records: [...workspace.records, third],
    },
    first,
    second,
    third,
    pool,
    remote,
    original,
    destination,
  };
}

describe("equipment register discovery", () => {
  it("applies only eligible selected records and retains exact before and after models", async () => {
    const { workspace, first, second, third, pool, remote, original, destination } = demo();
    const input = {
      siteId: first.siteId,
      requestId: crypto.randomUUID(),
      intent: { type: "setModel", modelId: destination.id },
      selection: [first, pool, third, second, remote].map(({ id, version }) => ({
        assetId: id,
        version: id === third.id ? version - 1 : version,
      })),
    } satisfies AssetRegisterBatchInput;
    const result = await applyAssetRegisterBatch(workspace, input, "Workshop operator", {
      checkUpdate: ({ record }) => record.id !== second.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcomes).toEqual([
      { assetId: first.id, state: "applied", reason: "changed" },
      { assetId: pool.id, state: "skipped", reason: "incompatible" },
      { assetId: third.id, state: "conflict", reason: "stale" },
      { assetId: second.id, state: "conflict", reason: "protected" },
      { assetId: remote.id, state: "unavailable", reason: "unavailable" },
    ]);
    const changed = result.workspace.records.find(({ id }) => id === first.id);
    expect(changed).toMatchObject({
      code: first.code,
      serial: first.serial,
      locationId: first.locationId,
      fieldValues: first.fieldValues,
      modelId: destination.id,
      version: first.version + 1,
    });
    expect(changed?.events[0]).toMatchObject({
      kind: "updated",
      actor: "Workshop operator",
      reason: `${original.code} → ${destination.code}`,
    });
    expect(changed?.events.slice(1)).toEqual(first.events);
    expect(result.workspace.records.filter(({ id }) => id !== first.id)).toEqual(
      workspace.records.filter(({ id }) => id !== first.id),
    );
  });

  it("preserves incompatible category fields and treats tag case changes as unchanged", async () => {
    const { workspace, first, second } = demo();
    const base = {
      siteId: first.siteId,
      requestId: crypto.randomUUID(),
      selection: [{ assetId: first.id, version: first.version }],
    };
    const category = await applyAssetRegisterBatch(
      workspace,
      { ...base, intent: { type: "setCategory", categoryId: null } },
      "Operator",
    );
    expect(category).toEqual({
      ok: true,
      workspace,
      outcomes: [{ assetId: first.id, state: "skipped", reason: "incompatible" }],
    });
    const tag = await applyAssetRegisterBatch(
      workspace,
      { ...base, intent: { type: "addTags", tags: ["test BENCH"] } },
      "Operator",
    );
    expect(tag).toEqual({
      ok: true,
      workspace,
      outcomes: [{ assetId: first.id, state: "skipped", reason: "unchanged" }],
    });
    const added = await applyAssetRegisterBatch(
      workspace,
      {
        ...base,
        selection: [...base.selection, { assetId: second.id, version: second.version }],
        intent: { type: "addTags", tags: ["Calibration due"] },
      },
      "Operator",
    );
    expect(added).toMatchObject({
      ok: true,
      outcomes: [first, second].map(({ id }) => ({
        assetId: id,
        state: "applied",
        reason: "changed",
      })),
    });
  });

  it("refuses duplicate picks and unauthorized sites before making any change", async () => {
    const { workspace, first } = demo();
    const selection = { assetId: first.id, version: first.version };
    const input = {
      siteId: first.siteId,
      requestId: crypto.randomUUID(),
      selection: [selection],
      intent: { type: "addTags", tags: ["Inspection"] },
    } satisfies AssetRegisterBatchInput;
    expect(
      await applyAssetRegisterBatch(
        workspace,
        { ...input, selection: [selection, selection] },
        "Operator",
      ),
    ).toEqual({ ok: false, error: "invalid" });
    expect(
      await applyAssetRegisterBatch(
        { ...workspace, sites: workspace.sites.map((site) => ({ ...site, canManage: false })) },
        input,
        "Reader",
      ),
    ).toEqual({ ok: false, error: "unavailable" });
  });

  it("orders serials naturally within a ranked sort and puts missing serials last", () => {
    const { workspace, first, second, third, pool } = demo();
    const slow = { ...first, serial: "MT-10", name: "Scope 2" };
    const fast = { ...second, serial: "MT-2", name: "Scope 2" };
    const earlier = { ...third, serial: "MT-25", name: "Scope 1" };
    const rows = sortAssetRegisterRecords(
      [slow, pool, earlier, fast],
      workspace,
      new Map(),
      [
        { column: "name", direction: "asc" },
        { column: "serial", direction: "asc" },
      ],
      "en",
    );
    expect(rows.map(({ id }) => id)).toEqual([pool.id, third.id, second.id, first.id]);
    const descending = sortAssetRegisterRecords(
      [slow, fast, pool],
      workspace,
      new Map(),
      [{ column: "serial", direction: "desc" }],
      "en",
    );
    expect(descending.map(({ id }) => id)).toEqual([first.id, second.id, pool.id]);
  });
});
