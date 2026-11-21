"use client";

import { useRef } from "react";
import type { InventoryCommand, InventoryWorkspace } from "./contracts";
import { applyInventoryFixture } from "./fixtures";
import {
  ManufacturingReleaseFixtureProvider,
  ManufacturingReleasesFixture,
} from "./releases/ui/ManufacturingReleasesFixture";
import { InventoryCatalogLinks } from "./ui/InventoryCatalogLinks";
import { InventoryClient } from "./ui/InventoryClient";

export function InventoryFixture({
  initial,
  openReleases,
}: {
  initial: InventoryWorkspace;
  openReleases: boolean;
}) {
  const workspace = useRef(initial);
  function submit(command: InventoryCommand) {
    const result = applyInventoryFixture(workspace.current, command);
    if (result.ok) workspace.current = result.value;
    return Promise.resolve(result);
  }

  return (
    <ManufacturingReleaseFixtureProvider>
      <InventoryClient
        initial={initial}
        submit={submit}
        ProductReleases={ManufacturingReleasesFixture}
        openReleases={openReleases}
        catalogLinks={initial.deal === null && <InventoryCatalogLinks fixture />}
      />
    </ManufacturingReleaseFixtureProvider>
  );
}
