"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./serverActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./serverActions.backend";

export async function requestUploadAction(
  ...args: Parameters<Implementation["requestUploadAction"]>
): ReturnType<Implementation["requestUploadAction"]> {
  return invokeAction("features/files/serverActions.requestUploadAction", args);
}

export async function confirmUploadAction(
  ...args: Parameters<Implementation["confirmUploadAction"]>
): ReturnType<Implementation["confirmUploadAction"]> {
  return invokeAction("features/files/serverActions.confirmUploadAction", args);
}

export async function requestDownloadAction(
  ...args: Parameters<Implementation["requestDownloadAction"]>
): ReturnType<Implementation["requestDownloadAction"]> {
  return invokeAction("features/files/serverActions.requestDownloadAction", args);
}
