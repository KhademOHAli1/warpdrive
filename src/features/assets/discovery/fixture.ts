import type { AssetsWorkspace } from "../contracts";
import { assetKey } from "../registerRules";
import { applyAssetRegisterBatch, assetRegisterBatchInput } from "./batch";
import {
  type AssetRegisterBatchInput,
  type AssetRegisterBatchOutcome,
  type AssetRegisterBatchResult,
  type AssetRegisterDiscoveryAccess,
  type AssetRegisterView,
  type AssetRegisterViewRemove,
  type AssetRegisterViewSave,
  type AssetRegisterViewsResult,
  maxAssetRegisterViews,
} from "./contracts";
import {
  assetRegisterSettingsAvailable,
  assetRegisterViewRemoveSchema,
  assetRegisterViewSaveSchema,
} from "./settings";

type Receipt = { siteId: string; signature: string };
type BatchReceipt = Receipt & { outcomes: AssetRegisterBatchOutcome[] };

const conflict = { ok: false, error: "conflict" } as const;
const invalid = { ok: false, error: "invalid" } as const;
const unavailable = { ok: false, error: "unavailable" } as const;

export function createAssetDiscoveryFixture(
  initial: AssetsWorkspace,
  onBatch: (workspace: AssetsWorkspace) => void,
  actorName = "Demo operator",
) {
  let register = initial;
  const views = new Map<string, AssetRegisterView>();
  const viewReceipts = new Map<string, Receipt>();
  const batchReceipts = new Map<string, BatchReceipt>();

  function projectViews(): AssetRegisterViewsResult {
    return {
      ok: true,
      views: structuredClone(
        [...views.values()].filter(({ settings }) =>
          assetRegisterSettingsAvailable(register, settings),
        ),
      ),
    };
  }

  function canReadSite(siteId: string) {
    return register.sites.some(({ id }) => id === siteId);
  }

  function canManageSite(siteId: string) {
    return register.sites.some(({ id, canManage }) => id === siteId && canManage);
  }

  function replayView(receipt: Receipt, signature: string): AssetRegisterViewsResult {
    if (!canReadSite(receipt.siteId)) return unavailable;
    return receipt.signature === signature ? projectViews() : conflict;
  }

  function replayBatch(
    receipt: BatchReceipt,
    siteId: string,
    signature: string,
  ): AssetRegisterBatchResult {
    if (!canManageSite(receipt.siteId)) return unavailable;
    return receipt.siteId === siteId && receipt.signature === signature
      ? { ok: true, workspace: register, outcomes: structuredClone(receipt.outcomes) }
      : conflict;
  }

  async function batch(raw: AssetRegisterBatchInput): Promise<AssetRegisterBatchResult> {
    const parsed = assetRegisterBatchInput.safeParse(raw);
    if (!parsed.success) return invalid;
    const input = parsed.data;
    const signature = JSON.stringify([input.siteId, input.selection, input.intent]);
    for (;;) {
      const before = register;
      if (!canManageSite(input.siteId)) return unavailable;
      const receipt = batchReceipts.get(input.requestId);
      if (receipt !== undefined) return replayBatch(receipt, input.siteId, signature);

      const result = await applyAssetRegisterBatch(before, input, actorName);
      // Qualify the caller's original row versions again if a register or batch write won.
      if (register !== before || batchReceipts.has(input.requestId)) continue;
      if (result.ok) {
        batchReceipts.set(input.requestId, {
          siteId: input.siteId,
          signature,
          outcomes: structuredClone(result.outcomes),
        });
        register = result.workspace;
        onBatch(result.workspace);
      }
      return result;
    }
  }

  function saveView(raw: AssetRegisterViewSave): AssetRegisterViewsResult {
    const parsed = assetRegisterViewSaveSchema.safeParse(raw);
    if (!parsed.success) return invalid;
    const input = parsed.data;
    const { id, version, name, settings, requestId } = input;
    const siteId = settings.filters.site;
    if (!assetRegisterSettingsAvailable(register, settings)) return unavailable;

    const signature = JSON.stringify(["save", input]);
    const saved = viewReceipts.get(requestId);
    if (saved !== undefined) return replayView(saved, signature);

    const current = id === null ? undefined : views.get(id);
    if (id !== null) {
      if (current === undefined || !canReadSite(current.settings.filters.site)) return unavailable;
      if (current.settings.filters.site !== siteId) return invalid;
      if (current.version !== version) return conflict;
    } else if (views.size >= maxAssetRegisterViews) {
      return { ok: false, error: "limit" };
    }
    if (
      [...views.values()].some(
        (view) =>
          view.id !== id &&
          view.settings.filters.site === siteId &&
          assetKey(view.name) === assetKey(name),
      )
    )
      return conflict;

    const viewId = id ?? crypto.randomUUID();
    views.set(viewId, { id: viewId, version: (version ?? 0) + 1, name, settings });
    viewReceipts.set(requestId, { signature, siteId });
    return projectViews();
  }

  function removeView(raw: AssetRegisterViewRemove): AssetRegisterViewsResult {
    const parsed = assetRegisterViewRemoveSchema.safeParse(raw);
    if (!parsed.success) return invalid;
    const input = parsed.data;
    const { id, version, requestId } = input;
    const signature = JSON.stringify(["remove", input]);
    const saved = viewReceipts.get(requestId);
    if (saved !== undefined) return replayView(saved, signature);

    const current = views.get(id);
    if (current === undefined || !canReadSite(current.settings.filters.site)) return unavailable;
    if (current.version !== version) return conflict;
    views.delete(id);
    viewReceipts.set(requestId, { signature, siteId: current.settings.filters.site });
    return projectViews();
  }

  const access: AssetRegisterDiscoveryAccess = {
    readViews: () => Promise.resolve(projectViews()),
    saveView: (input) => Promise.resolve(saveView(input)),
    removeView: (input) => Promise.resolve(removeView(input)),
    batch,
  };

  return {
    access,
    updateRegister: (next: AssetsWorkspace) => {
      register = next;
    },
  };
}
