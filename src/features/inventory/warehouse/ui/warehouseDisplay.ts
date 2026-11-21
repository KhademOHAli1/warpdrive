import type {
  WarehouseIncoming,
  WarehouseIntent,
  WarehouseLocation,
  WarehousePart,
  WarehousePosition,
  WarehouseResult,
  WarehouseSite,
  WarehouseWorkspace,
} from "../contracts";

export const stockStates = ["available", "hold", "quarantine"] as const;
export const locationKinds = ["storage", "structure", "external"] as const;

export type WarehouseEditor =
  | { type: "receive"; incoming: WarehouseIncoming | null }
  | { type: "reconcile" | "createIncoming" | "saveLocationPolicy" }
  | { type: "setPositionState"; position: WarehousePosition };

export type SaveWarehouse = (
  intent: WarehouseIntent,
) => Promise<WarehouseResult | { ok: false; error: "transport" }>;
export type WarehouseDialogProps = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: SaveWarehouse;
};

export type WarehouseFilters = {
  part: string;
  site: string;
  location: string;
  search: string;
  includeEmpty: boolean;
};

export const warehouseFilters: WarehouseFilters = {
  part: "",
  site: "",
  location: "",
  search: "",
  includeEmpty: false,
};

export const unlocatedFilter = "unlocated";

export function warehousePartLabel({ code, name, revision }: WarehousePart) {
  return `${code} · ${revision} — ${name}`;
}

function locationTrail(location: WarehouseLocation, locations: readonly WarehouseLocation[]) {
  const trail = [location];
  let id = location.parentId;
  while (id !== null && !trail.some((entry) => entry.id === id)) {
    const parent = locations.find((entry) => entry.id === id);
    if (parent === undefined) break;
    trail.unshift(parent);
    id = parent.parentId;
  }
  return trail.map(({ name }) => name).join(" / ");
}

export function warehouseLocationLabel(location: WarehouseLocation, workspace: WarehouseWorkspace) {
  const site = workspace.sites.find(({ id }) => id === location.siteId);
  const trail = locationTrail(location, workspace.locations);
  return site === undefined
    ? `${trail} · ${location.code}`
    : `${site.name} / ${trail} · ${location.code}`;
}

export function locationOptions(locations: WarehouseLocation[], workspace: WarehouseWorkspace) {
  return locations.map((location) => ({
    value: location.id,
    label: warehouseLocationLabel(location, workspace),
  }));
}

export function managedLocations(workspace: WarehouseWorkspace) {
  return workspace.locations.filter((location) => {
    if (location.archived) return false;
    const site = workspace.sites.find(({ id }) => id === location.siteId);
    return site?.canManage === true && !site.archived;
  });
}

export function receivableLocations(workspace: WarehouseWorkspace) {
  return managedLocations(workspace).filter(({ kind }) => kind !== "structure");
}

export function warehouseSiteLabel(site: WarehouseSite) {
  return `${site.name} · ${site.code}`;
}

export function inWarehouseScope(
  entry: { itemId: string; siteId: string | null; locationId: string | null },
  filters: WarehouseFilters,
) {
  if (filters.part !== "" && filters.part !== entry.itemId) return false;
  if (filters.site === unlocatedFilter) return entry.siteId === null;
  if (filters.site !== "" && filters.site !== entry.siteId) return false;
  return filters.location === "" || filters.location === entry.locationId;
}
