"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./readActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./readActions.backend";

export async function markThreadReadAction(
  ...args: Parameters<Implementation["markThreadReadAction"]>
): ReturnType<Implementation["markThreadReadAction"]> {
  return invokeAction("features/email/readActions.markThreadReadAction", args);
}

export async function markThreadUnreadAction(
  ...args: Parameters<Implementation["markThreadUnreadAction"]>
): ReturnType<Implementation["markThreadUnreadAction"]> {
  return invokeAction("features/email/readActions.markThreadUnreadAction", args);
}
