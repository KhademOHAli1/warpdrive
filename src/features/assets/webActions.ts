"use server";

import { invokeAction } from "@/frontend/actions";
import type { AssetCommand, AssetResult } from "./contracts";

export async function executeAssetAction(
  actorId: string,
  command: AssetCommand,
  csrf: string | null,
): Promise<AssetResult> {
  return invokeAction("features/assets/webActions.executeAssetAction", [actorId, command, csrf]);
}
