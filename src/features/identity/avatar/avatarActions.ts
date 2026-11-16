"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./avatarActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./avatarActions.backend";

export async function requestAvatarUploadAction(
  ...args: Parameters<Implementation["requestAvatarUploadAction"]>
): ReturnType<Implementation["requestAvatarUploadAction"]> {
  return invokeAction("features/identity/avatar/avatarActions.requestAvatarUploadAction", args);
}

export async function confirmAvatarUploadAction(
  ...args: Parameters<Implementation["confirmAvatarUploadAction"]>
): ReturnType<Implementation["confirmAvatarUploadAction"]> {
  return invokeAction("features/identity/avatar/avatarActions.confirmAvatarUploadAction", args);
}

export async function removeAvatarAction(
  ...args: Parameters<Implementation["removeAvatarAction"]>
): ReturnType<Implementation["removeAvatarAction"]> {
  return invokeAction("features/identity/avatar/avatarActions.removeAvatarAction", args);
}
