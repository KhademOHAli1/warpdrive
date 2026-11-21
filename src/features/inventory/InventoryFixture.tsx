"use client";

import { MapPin } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { locationsMessages } from "@/features/locations/locationsMessages";
import type { InventoryCommand, InventoryWorkspace } from "./contracts";
import { applyInventoryFixture } from "./fixtures";
import {
  ManufacturingReleaseFixtureProvider,
  ManufacturingReleasesFixture,
} from "./releases/ui/ManufacturingReleasesFixture";
import { InventoryClient } from "./ui/InventoryClient";

export function InventoryFixture({
  initial,
  openReleases,
}: {
  initial: InventoryWorkspace;
  openReleases: boolean;
}) {
  const locale = useLocale();
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
        locationsLink={
          initial.deal === null && (
            <Link
              href="/locations"
              prefetch={false}
              className="inline-flex items-center gap-2 border-b-2 border-transparent px-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <MapPin aria-hidden="true" className="size-4" /> {locationsMessages[locale].title}
            </Link>
          )
        }
      />
    </ManufacturingReleaseFixtureProvider>
  );
}
