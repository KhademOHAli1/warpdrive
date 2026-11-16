"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./groups.backend";

type Implementation = typeof ImplementationModule;

export type * from "./groups.backend";

export async function createGroupAction(
  ...args: Parameters<Implementation["createGroupAction"]>
): ReturnType<Implementation["createGroupAction"]> {
  return invokeAction("features/identity/actions/groups.createGroupAction", args);
}

export async function addGroupMemberAction(
  ...args: Parameters<Implementation["addGroupMemberAction"]>
): ReturnType<Implementation["addGroupMemberAction"]> {
  return invokeAction("features/identity/actions/groups.addGroupMemberAction", args);
}

export async function removeGroupMemberAction(
  ...args: Parameters<Implementation["removeGroupMemberAction"]>
): ReturnType<Implementation["removeGroupMemberAction"]> {
  return invokeAction("features/identity/actions/groups.removeGroupMemberAction", args);
}
