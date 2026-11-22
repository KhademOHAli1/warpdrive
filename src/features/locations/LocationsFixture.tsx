"use client";

import { useRef, useState } from "react";
import type { LocationsCommand, LocationsResult, LocationsWorkspace } from "./contracts";
import { applyLocationChange, type LocationDirectory } from "./directory";
import { LocationsDirectory } from "./LocationsDirectory";

export function LocationsFixture({
  initial,
  canManage,
  initialLocationId,
}: {
  initial: LocationDirectory;
  canManage: boolean;
  initialLocationId?: string;
}) {
  const [initialWorkspace] = useState<LocationsWorkspace>(() => ({
    directory: initial,
    canManageSites: canManage,
    managedSiteIds: [],
    eligibleUsers: [],
    grants: [],
  }));
  const workspace = useRef(initialWorkspace);

  function submit(command: LocationsCommand): Promise<LocationsResult> {
    if (!canManage || command.type === "setGrant")
      return Promise.resolve({ ok: false, error: "unavailable" });
    const result = applyLocationChange(workspace.current.directory, command, () =>
      crypto.randomUUID(),
    );
    if (!result.ok) return Promise.resolve(result);
    workspace.current = { ...workspace.current, directory: result.directory };
    return Promise.resolve({
      ok: true,
      value: workspace.current,
      siteId: result.siteId,
      locationId: result.locationId,
    });
  }

  return (
    <LocationsDirectory
      initial={initialWorkspace}
      initialLocationId={initialLocationId}
      submit={submit}
      fixture
    />
  );
}
