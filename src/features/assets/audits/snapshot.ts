import type { AssetLocation, AssetRecord, AssetsWorkspace } from "../contracts";
import type {
  EquipmentAuditPlacement,
  EquipmentAuditScope,
  EquipmentAuditTarget,
} from "./contracts";
import type { AuditFinding } from "./state";

export function siteAuditLocations(assets: AssetsWorkspace, siteId: string) {
  return assets.locations.filter((bin) => bin.siteId === siteId && !bin.archived);
}

function tagKey(tag: string) {
  return tag.trim().normalize("NFKC").toLowerCase();
}

function activeRecords(assets: AssetsWorkspace, siteId: string) {
  return assets.records.filter(
    ({ siteId: site, archivedAt }) => site === siteId && archivedAt === null,
  );
}

export function siteAuditTargets(assets: AssetsWorkspace, siteId: string): EquipmentAuditTarget[] {
  const equipment = activeRecords(assets, siteId).map(({ id, name, code }) => ({
    id,
    name,
    code,
    kind: "asset" as const,
  }));
  const kits = (assets.kits?.records ?? []).flatMap(({ id, name, code, siteId: site }) =>
    site === siteId ? [{ id, name, code, kind: "kit" as const }] : [],
  );
  return [...equipment, ...kits];
}

export function siteAuditTags(assets: AssetsWorkspace, siteId: string) {
  const tags = new Map<string, string>();
  for (const row of activeRecords(assets, siteId)) {
    for (const tag of row.tags) tags.set(tagKey(tag), tag);
  }
  return [...tags.values()].sort((left, right) => left.localeCompare(right));
}

export function validAuditScope(
  assets: AssetsWorkspace,
  siteId: string,
  scope: EquipmentAuditScope,
) {
  const locationIds = new Set(siteAuditLocations(assets, siteId).map(({ id }) => id));
  const targets = new Map(siteAuditTargets(assets, siteId).map(({ id, kind }) => [id, kind]));
  const categories = new Set(
    assets.categories.filter((category) => category.siteId === siteId).map(({ id }) => id),
  );
  const { tag } = scope;
  return (
    scope.locationIds.every((id) => locationIds.has(id)) &&
    scope.assetIds.every((id) => targets.get(id) === "asset") &&
    scope.kitIds.every((id) => targets.get(id) === "kit") &&
    scope.categoryIds.every((id) => categories.has(id)) &&
    (tag === null || siteAuditTags(assets, siteId).some((value) => tagKey(value) === tagKey(tag)))
  );
}

function auditBins(locations: AssetLocation[], scope: EquipmentAuditScope) {
  const selected = new Set(scope.locationIds);
  if (!scope.includeChildren || selected.size === 0) return selected;
  const parentIds = new Map(locations.map(({ id, parentId }) => [id, parentId]));
  for (const { id } of locations) {
    let current: string | null | undefined = id;
    const visited = new Set<string>();
    while (current !== null && current !== undefined && !visited.has(current)) {
      if (selected.has(current)) {
        selected.add(id);
        break;
      }
      visited.add(current);
      current = parentIds.get(current);
    }
  }
  return selected;
}

type Slice = { asset: AssetRecord; quantity: number; placement: EquipmentAuditPlacement };
type BinLabels = ReadonlyMap<string, string>;

function packedKitSlices(
  assets: AssetsWorkspace,
  siteId: string,
  records: ReadonlyMap<string, AssetRecord>,
  bins: BinLabels,
) {
  const packed: Slice[] = [];
  for (const kit of assets.kits?.records ?? []) {
    const bin = bins.get(kit.locationId);
    if (kit.siteId !== siteId || bin === undefined) continue;
    for (const line of kit.lines) {
      const asset = records.get(line.assetId);
      if (asset === undefined || line.packedQuantity === 0) continue;
      packed.push({
        asset,
        quantity: line.packedQuantity,
        placement: {
          kind: "kit",
          locationId: kit.locationId,
          kitId: kit.id,
          sourceId: line.id,
          label: `${bin} · ${kit.name}`,
        },
      });
    }
  }
  return packed;
}

function heldKitSlices(
  assets: AssetsWorkspace,
  siteId: string,
  records: ReadonlyMap<string, AssetRecord>,
) {
  const held: Slice[] = [];
  for (const checkout of assets.kits?.checkouts ?? []) {
    if (checkout.siteId !== siteId || checkout.closedAt !== null) continue;
    for (const line of checkout.lines) {
      const asset = records.get(line.assetId);
      const quantity = line.quantity - line.returned - line.consumed;
      if (asset === undefined || quantity <= 0) continue;
      held.push({
        asset,
        quantity,
        placement: {
          kind: "custody",
          locationId: null,
          kitId: checkout.kitId,
          sourceId: line.id,
          label: `${checkout.kitName} · ${checkout.custodianName}`,
        },
      });
    }
  }
  return held;
}

function custodySlices(
  assets: AssetsWorkspace,
  siteId: string,
  records: ReadonlyMap<string, AssetRecord>,
) {
  return (assets.custody?.holdings ?? []).flatMap((row): Slice[] => {
    const asset = records.get(row.assetId);
    return row.siteId === siteId && asset !== undefined
      ? [
          {
            asset,
            quantity: row.quantity,
            placement: {
              kind: "custody",
              locationId: null,
              kitId: null,
              sourceId: row.id,
              label: row.custodianName,
            },
          },
        ]
      : [];
  });
}

function storedSlices(asset: AssetRecord, bins: BinLabels, bound: ReadonlySet<string>): Slice[] {
  const storage = (locationId: string | null, quantity: number): Slice => ({
    asset,
    quantity,
    placement: {
      kind: locationId === null ? "unlocated" : "storage",
      locationId,
      kitId: null,
      sourceId: null,
      label: locationId === null ? null : (bins.get(locationId) ?? null),
    },
  });
  if (asset.tracking === "individual") {
    return bound.has(asset.id) || (asset.locationId !== null && !bins.has(asset.locationId))
      ? []
      : [storage(asset.locationId, 1)];
  }
  return asset.balances.flatMap(({ locationId, quantity }) =>
    quantity > 0 && bins.has(locationId) ? [storage(locationId, quantity)] : [],
  );
}

export function snapshotAuditRows(
  assets: AssetsWorkspace,
  siteId: string,
  scope: EquipmentAuditScope,
  makeId: () => string,
): AuditFinding[] {
  const locations = siteAuditLocations(assets, siteId);
  const bins = new Map(locations.map(({ id, name }) => [id, name]));
  const records = new Map(activeRecords(assets, siteId).map((row) => [row.id, row]));
  const packed = packedKitSlices(assets, siteId, records, bins);
  const held = [
    ...custodySlices(assets, siteId, records),
    ...heldKitSlices(assets, siteId, records),
  ];
  const bound = new Set([...packed, ...held].map(({ asset }) => asset.id));
  const loose = [...records.values()].flatMap((row) => storedSlices(row, bins, bound));
  const selections = auditBins(locations, scope);
  const noPlacementSelector = selections.size + scope.assetIds.length + scope.kitIds.length === 0;
  const tag = scope.tag === null ? null : tagKey(scope.tag);
  return [...loose, ...packed, ...(scope.includeCustody ? held : [])]
    .filter(({ asset, placement }) => {
      const withinPlacement =
        noPlacementSelector ||
        scope.assetIds.includes(asset.id) ||
        (placement.kitId !== null && scope.kitIds.includes(placement.kitId)) ||
        (placement.locationId !== null && selections.has(placement.locationId));
      return (
        withinPlacement &&
        (scope.categoryIds.length === 0 ||
          (asset.categoryId !== null && scope.categoryIds.includes(asset.categoryId))) &&
        (tag === null || asset.tags.some((value) => tagKey(value) === tag))
      );
    })
    .map(({ asset, quantity, placement }) => ({
      id: makeId(),
      target: { id: asset.id, name: asset.name, code: asset.code, kind: "asset" },
      serial: asset.tracking === "individual" ? asset.serial : null,
      sourceVersion: asset.version,
      placement,
      quantityType: asset.tracking === "individual" ? "single" : "pool",
      expected: quantity,
      counted: null,
      opaqueKey: null,
    }));
}
