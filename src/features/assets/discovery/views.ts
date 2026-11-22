import { z } from "zod";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import type { AssetSite } from "../contracts";
import { assetKey } from "../registerRules";
import {
  type AssetRegisterView,
  type AssetRegisterViewRemove,
  type AssetRegisterViewSave,
  type AssetRegisterViewsResult,
  maxAssetRegisterViewName,
  maxAssetRegisterViews,
} from "./contracts";
import {
  assetDiscoveryFingerprint,
  deleteAssetRegisterView,
  insertAssetRegisterView,
  persistAssetDiscoveryReceipt,
  readAssetDiscoveryReceipt,
  readAssetRegisterViewScope,
  readOwnedAssetRegisterViews,
  updateAssetRegisterView,
} from "./repository";
import type { AssetRegisterDiscoveryReceipt } from "./schema";
import {
  assetDiscoveryUnavailable,
  lockAssetDiscoveryRequests,
  withAssetDiscoveryAuthority,
} from "./scope";
import {
  assetRegisterSettingsAvailable,
  assetRegisterSettingsSchema,
  assetRegisterViewRemoveSchema,
  assetRegisterViewSaveSchema,
} from "./settings";

const invalid = { ok: false, error: "invalid" } as const;
const conflict = { ok: false, error: "conflict" } as const;
const limit = { ok: false, error: "limit" } as const;
const definitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.number().int().positive(),
  settings: assetRegisterSettingsSchema,
});

function canReadSite(sites: AssetSite[], siteId: string) {
  return sites.some(({ id }) => id === siteId);
}

async function ownerViews(tx: Db, ownerId: string) {
  const rows = await readOwnedAssetRegisterViews(tx, ownerId);
  const views: AssetRegisterView[] = [];
  for (const { id, name, definition } of rows) {
    const parsed = definitionSchema.safeParse(definition);
    if (!parsed.success || name.length === 0 || name.length > maxAssetRegisterViewName) continue;
    const { version, settings } = parsed.data;
    views.push({ id, name, version, settings });
  }
  return { total: rows.length, views };
}

async function projectViews(
  tx: Db,
  ownerId: string,
  sites: AssetSite[],
): Promise<AssetRegisterViewsResult> {
  const { views } = await ownerViews(tx, ownerId);
  const scope = await readAssetRegisterViewScope(
    tx,
    sites,
    views.map(({ settings }) => settings),
  );
  return {
    ok: true,
    views: views.filter(({ settings }) => assetRegisterSettingsAvailable(scope, settings)),
  };
}

async function replayView(
  tx: Db,
  sites: AssetSite[],
  receipt: AssetRegisterDiscoveryReceipt,
  kind: "save_view" | "remove_view",
  fingerprint: string,
  siteId: string = receipt.siteId,
): Promise<AssetRegisterViewsResult> {
  if (!canReadSite(sites, receipt.siteId)) return assetDiscoveryUnavailable;
  if (receipt.kind !== kind || receipt.siteId !== siteId || receipt.fingerprint !== fingerprint)
    return conflict;
  return projectViews(tx, receipt.actorId, sites);
}

function checkViewWrite(
  sites: AssetSite[],
  { total, views }: Awaited<ReturnType<typeof ownerViews>>,
  input: AssetRegisterViewSave,
) {
  if (input.id === null) {
    if (total >= maxAssetRegisterViews) return limit;
  } else {
    const existing = views.find(({ id }) => id === input.id);
    if (existing === undefined || !canReadSite(sites, existing.settings.filters.site))
      return assetDiscoveryUnavailable;
    if (existing.settings.filters.site !== input.settings.filters.site) return invalid;
    if (existing.version !== input.version) return conflict;
  }
  const name = assetKey(input.name);
  const duplicate = views.some(
    (view) =>
      view.id !== input.id &&
      view.settings.filters.site === input.settings.filters.site &&
      assetKey(view.name) === name,
  );
  return duplicate ? conflict : undefined;
}

async function writeView(
  tx: Db,
  actorId: string,
  sites: AssetSite[],
  input: AssetRegisterViewSave,
  signal: AbortSignal,
): Promise<AssetRegisterViewsResult> {
  const { id, version, name, settings, requestId } = input;
  const siteId = settings.filters.site;
  if (!canReadSite(sites, siteId)) return assetDiscoveryUnavailable;
  await lockAssetDiscoveryRequests(tx, actorId, signal);
  const scope = await readAssetRegisterViewScope(tx, sites, [settings]);
  if (!assetRegisterSettingsAvailable(scope, settings)) return assetDiscoveryUnavailable;
  const fingerprint = assetDiscoveryFingerprint(input);
  const prior = await readAssetDiscoveryReceipt(tx, actorId, requestId);
  if (prior !== undefined) return replayView(tx, sites, prior, "save_view", fingerprint, siteId);

  const failure = checkViewWrite(sites, await ownerViews(tx, actorId), input);
  if (failure !== undefined) return failure;
  signal.throwIfAborted();
  if (id === null || version === null) {
    await insertAssetRegisterView(tx, actorId, name, { schemaVersion: 1, version: 1, settings });
  } else {
    if (
      !(await updateAssetRegisterView(tx, actorId, id, version, name, {
        schemaVersion: 1,
        version: version + 1,
        settings,
      }))
    )
      return conflict;
  }
  await persistAssetDiscoveryReceipt(tx, {
    actorId,
    requestId,
    siteId,
    kind: "save_view",
    fingerprint,
    outcomes: null,
  });
  return projectViews(tx, actorId, sites);
}

async function removeView(
  tx: Db,
  actorId: string,
  sites: AssetSite[],
  input: AssetRegisterViewRemove,
  signal: AbortSignal,
): Promise<AssetRegisterViewsResult> {
  const { id, version, requestId } = input;
  await lockAssetDiscoveryRequests(tx, actorId, signal);
  const fingerprint = assetDiscoveryFingerprint(input);
  const prior = await readAssetDiscoveryReceipt(tx, actorId, requestId);
  if (prior !== undefined) return replayView(tx, sites, prior, "remove_view", fingerprint);

  const { views } = await ownerViews(tx, actorId);
  const existing = views.find((view) => view.id === id);
  if (existing === undefined || !canReadSite(sites, existing.settings.filters.site))
    return assetDiscoveryUnavailable;
  signal.throwIfAborted();
  if (!(await deleteAssetRegisterView(tx, actorId, id, version))) return conflict;
  await persistAssetDiscoveryReceipt(tx, {
    actorId,
    requestId,
    siteId: existing.settings.filters.site,
    kind: "remove_view",
    fingerprint,
    outcomes: null,
  });
  return projectViews(tx, actorId, sites);
}

export function readAssetRegisterViews(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
): Promise<AssetRegisterViewsResult> {
  return withAssetDiscoveryAuthority(db, who, signal, "read", (tx, actor, sites) =>
    projectViews(tx, actor.id, sites),
  );
}

export async function saveAssetRegisterView(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<AssetRegisterViewsResult> {
  const parsed = assetRegisterViewSaveSchema.safeParse(raw);
  if (!parsed.success) return invalid;
  return withAssetDiscoveryAuthority(db, who, signal, "read", (tx, actor, sites) =>
    writeView(tx, actor.id, sites, parsed.data, signal),
  );
}

export async function removeAssetRegisterView(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<AssetRegisterViewsResult> {
  const parsed = assetRegisterViewRemoveSchema.safeParse(raw);
  if (!parsed.success) return invalid;
  return withAssetDiscoveryAuthority(db, who, signal, "read", (tx, actor, sites) =>
    removeView(tx, actor.id, sites, parsed.data, signal),
  );
}
