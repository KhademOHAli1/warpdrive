"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./invite.backend";

type Implementation = typeof ImplementationModule;

export type * from "./invite.backend";

export async function inviteUserAction(
  ...args: Parameters<Implementation["inviteUserAction"]>
): ReturnType<Implementation["inviteUserAction"]> {
  return invokeAction("features/identity/actions/invite.inviteUserAction", args);
}
