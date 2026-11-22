"use server";

import { invokeAction } from "@/frontend/actions";
import type {
  AssetRegisterBatchInput,
  AssetRegisterBatchResult,
  AssetRegisterViewRemove,
  AssetRegisterViewSave,
  AssetRegisterViewsResult,
} from "./contracts";

export async function readAssetRegisterViewsAction(
  actorId: string,
  csrf: string | null,
): Promise<AssetRegisterViewsResult> {
  return invokeAction("features/assets/discovery/webActions.readAssetRegisterViewsAction", [
    actorId,
    csrf,
  ]);
}

export async function saveAssetRegisterViewAction(
  actorId: string,
  input: AssetRegisterViewSave,
  csrf: string | null,
): Promise<AssetRegisterViewsResult> {
  return invokeAction("features/assets/discovery/webActions.saveAssetRegisterViewAction", [
    actorId,
    input,
    csrf,
  ]);
}

export async function removeAssetRegisterViewAction(
  actorId: string,
  input: AssetRegisterViewRemove,
  csrf: string | null,
): Promise<AssetRegisterViewsResult> {
  return invokeAction("features/assets/discovery/webActions.removeAssetRegisterViewAction", [
    actorId,
    input,
    csrf,
  ]);
}

export async function runAssetRegisterBatchAction(
  actorId: string,
  input: AssetRegisterBatchInput,
  csrf: string | null,
): Promise<AssetRegisterBatchResult> {
  return invokeAction("features/assets/discovery/webActions.runAssetRegisterBatchAction", [
    actorId,
    input,
    csrf,
  ]);
}
