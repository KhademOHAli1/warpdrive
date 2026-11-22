import { describe, expect, it, vi } from "vitest";
import { assetsDiscoveryFixture } from "../fixtures";
import { applyAssetWorkspaceCommand } from "../registerCommands";
import type { AssetRegisterBatchInput, AssetRegisterSettings } from "./contracts";
import { createAssetDiscoveryFixture } from "./fixture";
import { assetRegisterSettingsAvailable } from "./settings";

function seed(canManage = true) {
  const register = assetsDiscoveryFixture(canManage);
  function byCode(code: string) {
    const item = register.records.find((row) => row.code === code);
    if (item === undefined) throw new Error(`Missing fixture ${code}`);
    return item;
  }

  const first = byCode("METER-101");
  const second = byCode("METER-102");
  const pool = byCode("LEAD-SET");
  const foreign = byCode("LOOP-01");
  const model = register.models.find(({ code }) => code === "SIGNAL-300");
  if (model === undefined || first.tracking !== "individual" || foreign.tracking !== "individual")
    throw new Error("Incomplete discovery seed");
  const settings: AssetRegisterSettings = {
    filters: {
      site: first.siteId,
      category: first.categoryId ?? "",
      location: first.locationId ?? "",
      search: "Test bench",
      status: "active",
      tracking: "individual",
      includeSublocations: true,
    },
    columns: ["name", "serial", "model"],
    sort: [{ column: "serial", direction: "asc" }],
  };
  return { register, first, second, pool, model, foreign, settings };
}

describe("asset discovery fixture", () => {
  it("keeps a read-only site's named views private, exact and versioned within the mount", async () => {
    const { register, settings, first } = seed(false);
    const { access } = createAssetDiscoveryFixture(register, vi.fn());
    const separate = createAssetDiscoveryFixture(register, vi.fn());
    const input = {
      id: null,
      version: null,
      name: "  Bench assets  ",
      settings,
      requestId: crypto.randomUUID(),
    };
    const saved = await access.saveView(input);
    if (!saved.ok || saved.views[0] === undefined) throw new Error("Expected named view");
    const { id, version } = saved.views[0];
    expect(saved.views[0]).toMatchObject({ version: 1, name: "Bench assets", settings });
    expect(await access.saveView(input)).toEqual(saved);
    expect(await separate.access.readViews()).toEqual({ ok: true, views: [] });
    expect(
      await access.saveView({ ...input, name: "BENCH ASSETS", requestId: crypto.randomUUID() }),
    ).toEqual({ ok: false, error: "conflict" });
    expect(
      await access.batch({
        siteId: first.siteId,
        requestId: crypto.randomUUID(),
        selection: [{ assetId: first.id, version: first.version }],
        intent: { type: "addTags", tags: ["Unpermitted"] },
      }),
    ).toEqual({ ok: false, error: "unavailable" });

    const updated = await access.saveView({
      ...input,
      id,
      version,
      name: "Calibration benches",
      requestId: crypto.randomUUID(),
    });
    expect(updated).toMatchObject({ ok: true, views: [{ id, version: 2 }] });
    const remove = { id, version, requestId: crypto.randomUUID() };
    expect(await access.removeView(remove)).toEqual({ ok: false, error: "conflict" });
    const removal = { ...remove, version: 2 };
    expect(await access.removeView(removal)).toEqual({ ok: true, views: [] });
    expect(await access.removeView(removal)).toEqual({ ok: true, views: [] });
  });

  it("rejects unscoped and malformed settings and hides saved views after scope changes", async () => {
    const { register, settings, first, foreign } = seed();
    const fixture = createAssetDiscoveryFixture(register, vi.fn());
    expect(assetRegisterSettingsAvailable(register, settings)).toBe(true);
    expect(
      assetRegisterSettingsAvailable(register, {
        ...settings,
        filters: { ...settings.filters, site: "" },
      }),
    ).toBe(false);
    expect(
      assetRegisterSettingsAvailable(register, {
        ...settings,
        filters: { ...settings.filters, location: foreign.locationId ?? "" },
      }),
    ).toBe(false);
    expect(assetRegisterSettingsAvailable(register, { ...settings, columns: ["serial"] })).toBe(
      false,
    );
    expect(
      assetRegisterSettingsAvailable(register, {
        ...settings,
        sort: [...settings.sort, ...settings.sort],
      }),
    ).toBe(false);

    const input = {
      id: null,
      version: null,
      name: "Bench",
      settings,
      requestId: crypto.randomUUID(),
    };
    expect(await fixture.access.saveView(input)).toMatchObject({ ok: true });
    fixture.updateRegister({
      ...register,
      sites: register.sites.filter(({ id }) => id !== first.siteId),
    });
    expect(await fixture.access.readViews()).toEqual({ ok: true, views: [] });
    expect(await fixture.access.saveView(input)).toEqual({ ok: false, error: "unavailable" });
  });

  it("qualifies each originally selected row after an ordinary asset edit races a batch", async () => {
    const { register, first, second, pool, model, foreign } = seed();
    const commit = vi.fn();
    const fixture = createAssetDiscoveryFixture(register, commit);
    const request = {
      siteId: first.siteId,
      requestId: crypto.randomUUID(),
      selection: [first, second, pool, foreign].map(({ id, version }) => ({
        assetId: id,
        version,
      })),
      intent: { type: "setModel", modelId: model.id },
    } satisfies AssetRegisterBatchInput;
    const attempted = fixture.access.batch(request);
    const noted = applyAssetWorkspaceCommand(
      register,
      {
        type: "note",
        assetId: second.id,
        version: second.version,
        requestId: crypto.randomUUID(),
        reason: "Pre-inspection complete",
      },
      "Inspection operator",
    );
    if (!noted.ok) throw new Error("Failed to add fixture note");
    fixture.updateRegister(noted.value);

    const result = await attempted;
    if (!result.ok) throw new Error("Expected per-row batch outcomes");
    expect(result.outcomes).toEqual([
      { assetId: first.id, state: "applied", reason: "changed" },
      { assetId: second.id, state: "conflict", reason: "stale" },
      { assetId: pool.id, state: "skipped", reason: "incompatible" },
      { assetId: foreign.id, state: "unavailable", reason: "unavailable" },
    ]);
    expect(result.workspace.records.find(({ id }) => id === first.id)).toMatchObject({
      version: first.version + 1,
      modelId: model.id,
      events: [
        expect.objectContaining({ kind: "updated", actor: "Demo operator" }),
        ...first.events,
      ],
    });
    expect(result.workspace.records.find(({ id }) => id === second.id)?.events[0]).toMatchObject({
      kind: "note",
      reason: "Pre-inspection complete",
    });
    expect(await fixture.access.batch(request)).toEqual(result);
    expect(
      await fixture.access.batch({ ...request, intent: { type: "setModel", modelId: null } }),
    ).toEqual({ ok: false, error: "conflict" });
    expect(commit).toHaveBeenCalledOnce();
  });
});
