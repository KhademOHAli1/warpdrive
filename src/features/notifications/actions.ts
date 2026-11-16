"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function markReadAction(
  ...args: Parameters<Implementation["markReadAction"]>
): ReturnType<Implementation["markReadAction"]> {
  return invokeAction("features/notifications/actions.markReadAction", args);
}

export async function markAllReadAction(
  ...args: Parameters<Implementation["markAllReadAction"]>
): ReturnType<Implementation["markAllReadAction"]> {
  return invokeAction("features/notifications/actions.markAllReadAction", args);
}

export async function setPreferenceAction(
  ...args: Parameters<Implementation["setPreferenceAction"]>
): ReturnType<Implementation["setPreferenceAction"]> {
  return invokeAction("features/notifications/actions.setPreferenceAction", args);
}
