"use server";

import { invokeAction } from "@/frontend/actions";
import type { AssetMediaResult, AssetMediaSelectCover, AssetMediaTarget } from "./contracts";

export async function readAssetMediaAction(
  actorId: string,
  target: AssetMediaTarget,
  csrf: string | null,
): Promise<AssetMediaResult> {
  return invokeAction("features/assets/media/webActions.readAssetMediaAction", [
    actorId,
    target,
    csrf,
  ]);
}

export async function selectAssetMediaCoverAction(
  actorId: string,
  command: AssetMediaSelectCover,
  csrf: string | null,
): Promise<AssetMediaResult> {
  return invokeAction("features/assets/media/webActions.selectAssetMediaCoverAction", [
    actorId,
    command,
    csrf,
  ]);
}
