"use server";

import { invokeAction } from "@/frontend/actions";
import type { ReleaseCommand, ReleaseCommandResult } from "./liveContracts";
import { readBuildRelease, readManufacturingReleases } from "./webReads";

export async function readManufacturingReleasesAction(itemId: string) {
  return readManufacturingReleases(itemId);
}

export async function readBuildReleaseAction(orderId: string) {
  return readBuildRelease(orderId);
}

export async function executeManufacturingReleaseAction(
  command: ReleaseCommand,
  csrfToken: string | null,
): Promise<ReleaseCommandResult> {
  return invokeAction("features/inventory/releases.executeManufacturingReleaseAction", [
    command,
    csrfToken,
  ]);
}
