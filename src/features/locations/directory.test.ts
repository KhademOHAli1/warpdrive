import { describe, expect, it, vi } from "vitest";
import {
  applyLocationChange,
  type LocationChange,
  type LocationDirectory,
  locationPath,
} from "./directory";

const directory: LocationDirectory = {
  sites: [
    { id: "site-berlin", name: "Berlin", code: "BER", archived: false },
    { id: "site-weimar", name: "Weimar", code: "WEI", archived: false },
  ],
  locations: [
    {
      id: "room",
      name: "Storage",
      code: "STORAGE",
      siteId: "site-berlin",
      parentId: null,
      archived: false,
    },
    {
      id: "bin",
      name: "Storage bin",
      code: "BIN-1",
      siteId: "site-berlin",
      parentId: "room",
      archived: false,
    },
    {
      id: "staging",
      name: "Staging",
      code: "STAGING",
      siteId: "site-berlin",
      parentId: null,
      archived: false,
    },
    {
      id: "weimar-room",
      name: "Storage",
      code: "STORAGE",
      siteId: "site-weimar",
      parentId: null,
      archived: false,
    },
  ],
};

function apply(current: LocationDirectory, change: LocationChange) {
  const result = applyLocationChange(current, change, () => "new-id");
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("location directory", () => {
  it("normalizes valid names and codes and allocates IDs on creation", () => {
    const site = apply(directory, {
      type: "saveSite",
      id: null,
      name: "  Erfurt  ",
      code: " erf_01 ",
    });
    expect(site).toMatchObject({ siteId: "new-id", locationId: null });
    expect(site.directory.sites.at(-1)).toEqual({
      id: "new-id",
      name: "Erfurt",
      code: "ERF_01",
      archived: false,
    });
  });

  it("rejects invalid or duplicate site codes including archived entries", () => {
    const archiveRoom = apply(directory, {
      type: "setLocationArchived",
      id: "weimar-room",
      archived: true,
    }).directory;
    const archiveSite = apply(archiveRoom, {
      type: "setSiteArchived",
      id: "site-weimar",
      archived: true,
    }).directory;
    const createId = vi.fn(() => "unused");
    const addSite = (name: string, code: string) =>
      applyLocationChange(archiveSite, { type: "saveSite", id: null, name, code }, createId);

    expect(addSite(" ", "NEW")).toEqual({ ok: false, error: "invalidName" });
    expect(addSite("x".repeat(101), "NEW")).toEqual({
      ok: false,
      error: "invalidName",
    });
    expect(addSite("Warehouse", "inv code")).toEqual({
      ok: false,
      error: "invalidCode",
    });
    expect(addSite("Warehouse", "x".repeat(25))).toEqual({
      ok: false,
      error: "invalidCode",
    });
    expect(addSite("Second Weimar", " wei ")).toEqual({
      ok: false,
      error: "duplicateCode",
    });
    expect(createId).not.toHaveBeenCalled();
  });

  it("allows the same location code in another site and reserves archived codes", () => {
    const current = apply(directory, {
      type: "setLocationArchived",
      id: "bin",
      archived: true,
    }).directory;
    const addBin = {
      type: "saveLocation",
      id: null,
      siteId: "site-berlin",
      parentId: "room",
      name: "New bin",
      code: " bin-1 ",
    } as const;

    expect(applyLocationChange(current, addBin, () => "unused")).toEqual({
      ok: false,
      error: "duplicateCode",
    });
    const inWeimar = apply(current, {
      ...addBin,
      siteId: "site-weimar",
      parentId: "weimar-room",
    });
    expect(inWeimar).toMatchObject({ siteId: "site-weimar", locationId: "new-id" });
    expect(inWeimar.directory.locations.at(-1)?.code).toBe("BIN-1");
  });

  it("keeps Inventory and Assets references stable through renaming and reparenting", () => {
    const inventoryReference = { siteId: "site-berlin", locationId: "bin" };
    const assetReference = { ...inventoryReference };
    const renamedSite = apply(directory, {
      type: "saveSite",
      id: inventoryReference.siteId,
      code: " BER-2 ",
      name: "Berlin works",
    });
    const movedBin = apply(renamedSite.directory, {
      type: "saveLocation",
      id: inventoryReference.locationId,
      siteId: inventoryReference.siteId,
      parentId: "staging",
      name: "Staging bin",
      code: "BIN-S",
    });

    expect(movedBin).toMatchObject(inventoryReference);
    expect(movedBin).toMatchObject(assetReference);
    expect(movedBin.directory.sites[0]).toMatchObject({
      id: inventoryReference.siteId,
      name: "Berlin works",
    });
    const bin = movedBin.directory.locations.find(({ id }) => id === inventoryReference.locationId);
    if (!bin) throw new Error("Expected a bin");
    expect(locationPath(movedBin.directory.locations, bin).map(({ name }) => name)).toEqual([
      "Staging",
      "Staging bin",
    ]);
    expect(directory.locations.find(({ id }) => id === bin.id)?.parentId).toBe("room");
  });

  it("rejects self-parenting, descendant cycles and cross-site moves", () => {
    const saveRoom = {
      type: "saveLocation",
      id: "room",
      siteId: "site-berlin",
      parentId: "bin",
      name: "Storage",
      code: "STORAGE",
    } as const;
    const save = (change: LocationChange) => applyLocationChange(directory, change, () => "unused");

    expect(save(saveRoom)).toEqual({ ok: false, error: "circularParent" });
    expect(save({ ...saveRoom, parentId: "room" })).toEqual({
      ok: false,
      error: "circularParent",
    });
    expect(save({ ...saveRoom, parentId: "weimar-room" })).toEqual({
      ok: false,
      error: "invalidParent",
    });
    expect(save({ ...saveRoom, siteId: "site-weimar", parentId: null })).toEqual({
      ok: false,
      error: "missingRecord",
    });
  });

  it("archives from the leaves and restores from the site down", () => {
    const archiveRoom = {
      type: "setLocationArchived",
      id: "weimar-room",
      archived: true,
    } as const;
    const archiveSite = {
      type: "setSiteArchived",
      id: "site-weimar",
      archived: true,
    } as const;

    expect(applyLocationChange(directory, archiveSite, () => "unused")).toEqual({
      ok: false,
      error: "activeChildren",
    });
    expect(applyLocationChange(directory, { ...archiveRoom, id: "room" }, () => "unused")).toEqual({
      ok: false,
      error: "activeChildren",
    });
    const archivedRoom = apply(directory, archiveRoom).directory;
    const archivedSite = apply(archivedRoom, archiveSite).directory;
    const restoreRoom = { ...archiveRoom, archived: false };

    expect(applyLocationChange(archivedSite, restoreRoom, () => "unused")).toEqual({
      ok: false,
      error: "inactiveSite",
    });
    const reopenedSite = apply(archivedSite, { ...archiveSite, archived: false }).directory;
    expect(apply(reopenedSite, restoreRoom).directory).toEqual(directory);
  });

  it("requires an active parent for placement and restoration and preserves archival during edit", () => {
    const archivedBin = apply(directory, {
      type: "setLocationArchived",
      id: "bin",
      archived: true,
    }).directory;
    const archivedRoom = apply(archivedBin, {
      type: "setLocationArchived",
      id: "room",
      archived: true,
    }).directory;
    const moveBin = {
      type: "saveLocation",
      id: "bin",
      siteId: "site-berlin",
      parentId: "room",
      name: "Moved bin",
      code: "BIN-1",
    } as const;

    expect(applyLocationChange(archivedRoom, moveBin, () => "unused")).toEqual({
      ok: false,
      error: "invalidParent",
    });
    expect(
      applyLocationChange(
        archivedRoom,
        { type: "setLocationArchived", id: "bin", archived: false },
        () => "unused",
      ),
    ).toEqual({ ok: false, error: "invalidParent" });
    const movedBin = apply(archivedRoom, { ...moveBin, parentId: "staging" }).directory;
    expect(movedBin.locations.find(({ id }) => id === "bin")).toMatchObject({
      archived: true,
      name: "Moved bin",
      parentId: "staging",
    });
  });
});
