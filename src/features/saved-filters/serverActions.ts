"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./serverActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./serverActions.backend";

export async function createSavedFilterAction(
  ...args: Parameters<Implementation["createSavedFilterAction"]>
): ReturnType<Implementation["createSavedFilterAction"]> {
  return invokeAction("features/saved-filters/serverActions.createSavedFilterAction", args);
}

export async function updateSavedFilterAction(
  ...args: Parameters<Implementation["updateSavedFilterAction"]>
): ReturnType<Implementation["updateSavedFilterAction"]> {
  return invokeAction("features/saved-filters/serverActions.updateSavedFilterAction", args);
}

export async function removeSavedFilterAction(
  ...args: Parameters<Implementation["removeSavedFilterAction"]>
): ReturnType<Implementation["removeSavedFilterAction"]> {
  return invokeAction("features/saved-filters/serverActions.removeSavedFilterAction", args);
}

export async function toggleFavoriteAction(
  ...args: Parameters<Implementation["toggleFavoriteAction"]>
): ReturnType<Implementation["toggleFavoriteAction"]> {
  return invokeAction("features/saved-filters/serverActions.toggleFavoriteAction", args);
}
