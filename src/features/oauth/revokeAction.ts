"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./revokeAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./revokeAction.backend";

export async function revokeConnectionAction(
  ...args: Parameters<Implementation["revokeConnectionAction"]>
): ReturnType<Implementation["revokeConnectionAction"]> {
  return invokeAction("features/oauth/revokeAction.revokeConnectionAction", args);
}
