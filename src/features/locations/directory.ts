export interface Site {
  id: string;
  name: string;
  code: string;
  archived: boolean;
}

export interface Location extends Site {
  siteId: string;
  parentId: string | null;
}

export interface LocationDirectory {
  sites: readonly Site[];
  locations: readonly Location[];
}

export type LocationChange =
  | { type: "saveSite"; id: string | null; name: string; code: string }
  | {
      type: "saveLocation";
      id: string | null;
      siteId: string;
      parentId: string | null;
      name: string;
      code: string;
    }
  | { type: "setSiteArchived"; id: string; archived: boolean }
  | { type: "setLocationArchived"; id: string; archived: boolean };

export type LocationError =
  | "invalidName"
  | "invalidCode"
  | "duplicateCode"
  | "missingRecord"
  | "inactiveSite"
  | "invalidParent"
  | "circularParent"
  | "activeChildren";

type LocationChangeResult =
  | {
      ok: true;
      directory: LocationDirectory;
      siteId: string;
      locationId: string | null;
    }
  | { ok: false; error: LocationError };

function storeSite(directory: LocationDirectory, site: Site): LocationChangeResult {
  const exists = directory.sites.some(({ id }) => id === site.id);
  const sites = exists
    ? directory.sites.map((current) => (current.id === site.id ? site : current))
    : [...directory.sites, site];
  return {
    ok: true,
    directory: { ...directory, sites },
    siteId: site.id,
    locationId: null,
  };
}

function storeLocation(directory: LocationDirectory, location: Location): LocationChangeResult {
  const exists = directory.locations.some(({ id }) => id === location.id);
  const locations = exists
    ? directory.locations.map((current) => (current.id === location.id ? location : current))
    : [...directory.locations, location];
  return {
    ok: true,
    directory: { ...directory, locations },
    siteId: location.siteId,
    locationId: location.id,
  };
}

function validatePlacement(
  directory: LocationDirectory,
  siteId: string,
  parentId: string | null,
  locationId: string | null,
): LocationError | null {
  const site = directory.sites.find(({ id }) => id === siteId);
  if (!site || site.archived) return "inactiveSite";
  if (parentId === null) return null;

  const locations = new Map(directory.locations.map((location) => [location.id, location]));
  const visited = new Set<string>();
  let ancestorId: string | null = parentId;
  while (ancestorId !== null) {
    if (ancestorId === locationId || visited.has(ancestorId)) return "circularParent";
    visited.add(ancestorId);

    const ancestor = locations.get(ancestorId);
    if (!ancestor || ancestor.archived || ancestor.siteId !== siteId) {
      return "invalidParent";
    }
    ancestorId = ancestor.parentId;
  }
  return null;
}

function setSiteArchived(
  directory: LocationDirectory,
  change: Extract<LocationChange, { type: "setSiteArchived" }>,
): LocationChangeResult {
  const site = directory.sites.find(({ id }) => id === change.id);
  if (!site) return { ok: false, error: "missingRecord" };
  if (site.archived === change.archived) {
    return { ok: true, directory, siteId: site.id, locationId: null };
  }
  if (
    change.archived &&
    directory.locations.some((location) => location.siteId === site.id && !location.archived)
  ) {
    return { ok: false, error: "activeChildren" };
  }
  return storeSite(directory, { ...site, archived: change.archived });
}

function setLocationArchived(
  directory: LocationDirectory,
  change: Extract<LocationChange, { type: "setLocationArchived" }>,
): LocationChangeResult {
  const location = directory.locations.find(({ id }) => id === change.id);
  if (!location) return { ok: false, error: "missingRecord" };
  if (location.archived === change.archived) {
    return {
      ok: true,
      directory,
      siteId: location.siteId,
      locationId: location.id,
    };
  }
  if (change.archived) {
    if (directory.locations.some((child) => child.parentId === location.id && !child.archived)) {
      return { ok: false, error: "activeChildren" };
    }
  } else {
    const error = validatePlacement(directory, location.siteId, location.parentId, location.id);
    if (error) return { ok: false, error };
  }
  return storeLocation(directory, { ...location, archived: change.archived });
}

function saveSite(
  directory: LocationDirectory,
  { id, name, code }: Extract<LocationChange, { type: "saveSite" }>,
  createId: () => string,
): LocationChangeResult {
  const existing = directory.sites.find((site) => site.id === id);
  if (id !== null && !existing) return { ok: false, error: "missingRecord" };
  if (directory.sites.some((site) => site.code === code && site.id !== id)) {
    return { ok: false, error: "duplicateCode" };
  }
  return storeSite(directory, {
    id: id ?? createId(),
    archived: existing?.archived ?? false,
    name,
    code,
  });
}

function saveLocation(
  directory: LocationDirectory,
  { id, siteId, parentId, name, code }: Extract<LocationChange, { type: "saveLocation" }>,
  createId: () => string,
): LocationChangeResult {
  const existing = directory.locations.find((location) => location.id === id);
  if (id !== null && existing?.siteId !== siteId) {
    return { ok: false, error: "missingRecord" };
  }
  const error = validatePlacement(directory, siteId, parentId, id);
  if (error) return { ok: false, error };
  if (
    directory.locations.some(
      (location) => location.siteId === siteId && location.code === code && location.id !== id,
    )
  ) {
    return { ok: false, error: "duplicateCode" };
  }
  return storeLocation(directory, {
    id: id ?? createId(),
    archived: existing?.archived ?? false,
    siteId,
    parentId,
    name,
    code,
  });
}

export function applyLocationChange(
  directory: LocationDirectory,
  change: LocationChange,
  createId: () => string,
): LocationChangeResult {
  if (change.type === "setSiteArchived") {
    return setSiteArchived(directory, change);
  }
  if (change.type === "setLocationArchived") {
    return setLocationArchived(directory, change);
  }

  const name = change.name.trim();
  const code = change.code.trim().toUpperCase();
  if (!name || name.length > 100) return { ok: false, error: "invalidName" };
  if (!/^[A-Z0-9][A-Z0-9_-]{0,23}$/.test(code)) {
    return { ok: false, error: "invalidCode" };
  }
  return change.type === "saveSite"
    ? saveSite(directory, { ...change, name, code }, createId)
    : saveLocation(directory, { ...change, name, code }, createId);
}

export function locationPath(locations: readonly Location[], location: Location): Location[] {
  const byId = new Map(locations.map((item) => [item.id, item]));
  const path: Location[] = [];
  const visited = new Set<string>();
  let item: Location | undefined = location;
  while (item && item.siteId === location.siteId && !visited.has(item.id)) {
    path.push(item);
    visited.add(item.id);
    item = item.parentId === null ? undefined : byId.get(item.parentId);
  }
  return path.reverse();
}
