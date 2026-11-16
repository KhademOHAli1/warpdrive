"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./followerActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./followerActions.backend";

export async function followContactAction(
  ...args: Parameters<Implementation["followContactAction"]>
): ReturnType<Implementation["followContactAction"]> {
  return invokeAction("features/contacts/followerActions.followContactAction", args);
}

export async function unfollowContactAction(
  ...args: Parameters<Implementation["unfollowContactAction"]>
): ReturnType<Implementation["unfollowContactAction"]> {
  return invokeAction("features/contacts/followerActions.unfollowContactAction", args);
}
