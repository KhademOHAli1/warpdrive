import type { AssetRecord, AssetsWorkspace } from "../contracts";
import { kitUsesAsset } from "../kits/usage";
import type { BookingCapacityInventory } from "./availability";
import type { BookingLocation, BookingResource, PullListItem } from "./contracts";

type Sources = {
  resources: BookingResource[];
  locations: BookingLocation[];
  inventory: BookingCapacityInventory;
};

function locationName(location: BookingLocation, locations: Map<string, BookingLocation>) {
  const names = [location.name];
  const seen = new Set([location.id]);
  let parent = location.parentId;
  while (parent !== null && !seen.has(parent)) {
    const next = locations.get(parent);
    if (next === undefined) break;
    names.unshift(next.name);
    seen.add(next.id);
    parent = next.parentId;
  }
  return names.join(" / ");
}

function projectLocations(workspace: AssetsWorkspace) {
  return workspace.locations
    .filter(({ archived }) => !archived)
    .map(({ id, siteId, name, parentId }) => ({ id, siteId, name, parentId }));
}

type Free = Array<BookingCapacityInventory["assets"][number]>;
type KitReady = Array<BookingCapacityInventory["kits"][number]>;
type Pools = Array<BookingCapacityInventory["pools"][number]>;
type Labels = Map<string, string>;

function binLabel(bins: Labels, locationId: string | null) {
  return locationId === null ? null : (bins.get(locationId) ?? null);
}

function serialEligible(
  workspace: AssetsWorkspace,
  asset: Extract<AssetRecord, { tracking: "individual" }>,
  assigned: ReadonlySet<string>,
  bins: Labels,
) {
  const { id, locationId } = asset;
  return (
    !kitUsesAsset(workspace.kits, id) &&
    !assigned.has(id) &&
    (locationId === null || bins.has(locationId))
  );
}

function poolSources(asset: Exclude<AssetRecord, { tracking: "individual" }>, bins: Labels): Pools {
  return asset.balances
    .filter(({ locationId, quantity }) => bins.has(locationId) && quantity > 0)
    .map(({ locationId, quantity }) => ({
      id: asset.id,
      siteId: asset.siteId,
      locationId,
      kind: asset.tracking,
      quantity,
    }));
}

function assetSources(workspace: AssetsWorkspace, bins: Labels) {
  const resources: BookingResource[] = [];
  const assets: Free = [];
  const pools: Pools = [];
  const assigned = new Set(workspace.custody?.holdings.map(({ assetId }) => assetId));
  for (const asset of workspace.records) {
    const { id, siteId, code, name, tracking } = asset;
    if (asset.archivedAt !== null) continue;
    const shared = { siteId, resourceId: id, name, code, contents: [], kitDefinitionVersion: null };
    if (tracking === "individual") {
      const { locationId, modelId, serial } = asset;
      const available = serialEligible(workspace, asset, assigned, bins);
      if (available) assets.push({ id, siteId, modelId, locationId });
      resources.push({
        ...shared,
        kind: "asset",
        serial,
        locationId,
        bin: binLabel(bins, locationId),
        freeNow: available ? 1 : 0,
      });
      continue;
    }
    for (const pool of poolSources(asset, bins)) {
      pools.push(pool);
      resources.push({
        ...shared,
        kind: pool.kind,
        serial: null,
        locationId: pool.locationId,
        bin: binLabel(bins, pool.locationId),
        freeNow: pool.quantity,
      });
    }
  }
  return { resources, assets, pools };
}

function kitContents(
  lines: NonNullable<AssetsWorkspace["kits"]>["records"][number]["lines"],
  assets: Map<string, AssetRecord>,
  bin: string | null,
): PullListItem[] {
  return lines.flatMap(({ assetId, quantity }) => {
    const asset = assets.get(assetId);
    if (asset === undefined) return [];
    return [
      {
        name: asset.name,
        code: asset.tracking === "individual" ? (asset.serial ?? asset.code) : asset.code,
        bin,
        quantity,
      },
    ];
  });
}

function kitSources(workspace: AssetsWorkspace, bins: Labels) {
  const resources: BookingResource[] = [];
  const kits: KitReady = [];
  const out = new Set(
    workspace.kits?.checkouts.filter(({ closedAt }) => closedAt === null).map(({ kitId }) => kitId),
  );
  const assets = new Map(workspace.records.map((record) => [record.id, record]));
  for (const { id, siteId, name, code, locationId, definitionVersion, lines } of workspace.kits
    ?.records ?? []) {
    const bin = binLabel(bins, locationId);
    const contents = kitContents(lines, assets, bin);
    const ready =
      bin !== null &&
      !out.has(id) &&
      contents.length > 0 &&
      contents.length === lines.length &&
      lines.every(({ quantity, packedQuantity }) => packedQuantity === quantity);
    if (ready) kits.push({ id, siteId, locationId, definitionVersion });
    resources.push({
      siteId,
      kind: "kit",
      resourceId: id,
      locationId,
      name,
      code,
      bin,
      serial: null,
      freeNow: ready ? 1 : 0,
      contents,
      kitDefinitionVersion: definitionVersion,
    });
  }
  return { kits, resources };
}

export function assetBookingSources(workspace: AssetsWorkspace): Sources {
  const locations = projectLocations(workspace);
  const byId = new Map(locations.map((location) => [location.id, location]));
  const bins = new Map(locations.map((location) => [location.id, locationName(location, byId)]));
  const { resources, assets, pools } = assetSources(workspace, bins);
  const kit = kitSources(workspace, bins);
  for (const { id, siteId, name, code } of workspace.models) {
    resources.push({
      siteId,
      kind: "model",
      resourceId: id,
      locationId: null,
      name,
      code,
      bin: null,
      serial: null,
      contents: [],
      kitDefinitionVersion: null,
      freeNow: assets.filter(
        ({ siteId: assetSite, modelId }) => siteId === assetSite && id === modelId,
      ).length,
    });
  }
  return {
    resources: [...resources, ...kit.resources],
    locations,
    inventory: { assets, kits: kit.kits, pools },
  };
}
