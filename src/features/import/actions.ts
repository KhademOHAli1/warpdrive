"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function setMappingAction(
  ...args: Parameters<Implementation["setMappingAction"]>
): ReturnType<Implementation["setMappingAction"]> {
  return invokeAction("features/import/actions.setMappingAction", args);
}

export async function commitBatchAction(
  ...args: Parameters<Implementation["commitBatchAction"]>
): ReturnType<Implementation["commitBatchAction"]> {
  return invokeAction("features/import/actions.commitBatchAction", args);
}

export async function requestImportUploadAction(
  ...args: Parameters<Implementation["requestImportUploadAction"]>
): ReturnType<Implementation["requestImportUploadAction"]> {
  return invokeAction("features/import/actions.requestImportUploadAction", args);
}

export async function confirmImportUploadAction(
  ...args: Parameters<Implementation["confirmImportUploadAction"]>
): ReturnType<Implementation["confirmImportUploadAction"]> {
  return invokeAction("features/import/actions.confirmImportUploadAction", args);
}

export async function undoImportAction(
  ...args: Parameters<Implementation["undoImportAction"]>
): ReturnType<Implementation["undoImportAction"]> {
  return invokeAction("features/import/actions.undoImportAction", args);
}
