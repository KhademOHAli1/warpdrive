"use client";

import { useRef } from "react";
import type { InventoryCommand, InventoryWorkspace } from "./contracts";
import { applyInventoryFixture } from "./fixtures";
import type { EngineeringFixtureActor } from "./releases/changes/fixture";
import {
  ManufacturingReleaseFixtureProvider,
  ManufacturingReleasesFixture,
} from "./releases/ui/ManufacturingReleasesFixture";
import { InventoryCatalogLinks } from "./ui/InventoryCatalogLinks";
import { InventoryClient } from "./ui/InventoryClient";

export function InventoryFixture({
  initial,
  openReleases,
  initialItemId,
  canEditIntake,
  engineeringActor,
}: {
  initial: InventoryWorkspace;
  openReleases: boolean;
  initialItemId?: string;
  canEditIntake?: boolean;
  engineeringActor?: EngineeringFixtureActor;
}) {
  const workspace = useRef(initial);
  function submit(command: InventoryCommand) {
    const result = applyInventoryFixture(workspace.current, command);
    if (result.ok) workspace.current = result.value;
    return Promise.resolve(result);
  }

  return (
    <ManufacturingReleaseFixtureProvider {...{ canEditIntake, engineeringActor }}>
      <InventoryClient
        initial={initial}
        submit={submit}
        ProductReleases={ManufacturingReleasesFixture}
        openReleases={openReleases}
        initialItemId={initialItemId}
        catalogLinks={initial.deal === null && <InventoryCatalogLinks fixture />}
      />
    </ManufacturingReleaseFixtureProvider>
  );
}
