"use server";

import { invokeAction } from "@/frontend/actions";
import type {
  AssetTagCommand,
  AssetTagContactInput,
  AssetTagContactResult,
  AssetTagResult,
  AssetTagScanInput,
  AssetTagScanResult,
} from "./contracts";

export async function executeAssetTagAction(
  actorId: string,
  input: AssetTagCommand,
  csrf: string | null,
): Promise<AssetTagResult> {
  return invokeAction("features/assets/tags/webActions.executeAssetTagAction", [
    actorId,
    input,
    csrf,
  ]);
}

export async function resolveAssetTagAction(
  actorId: string,
  input: AssetTagScanInput,
  csrf: string | null,
): Promise<AssetTagScanResult> {
  return invokeAction("features/assets/tags/webActions.resolveAssetTagAction", [
    actorId,
    input,
    csrf,
  ]);
}

export async function sendAssetTagContactAction(
  input: AssetTagContactInput,
  proof: string,
): Promise<AssetTagContactResult> {
  return invokeAction("features/assets/tags/webActions.sendAssetTagContactAction", [input, proof]);
}
