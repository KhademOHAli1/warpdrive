"use server";

import { invokeAction } from "@/frontend/actions";
import type { LocationsCommand, LocationsResult } from "./contracts";

export async function executeLocationsAction(
  actorId: string,
  command: LocationsCommand,
  csrf: string | null,
): Promise<LocationsResult> {
  return invokeAction("features/locations/actions.executeLocationsAction", [
    actorId,
    command,
    csrf,
  ]);
}
