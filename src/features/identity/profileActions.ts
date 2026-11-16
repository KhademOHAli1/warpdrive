"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./profileActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./profileActions.backend";

export async function updateUserProfileAction(
  ...args: Parameters<Implementation["updateUserProfileAction"]>
): ReturnType<Implementation["updateUserProfileAction"]> {
  return invokeAction("features/identity/profileActions.updateUserProfileAction", args);
}
