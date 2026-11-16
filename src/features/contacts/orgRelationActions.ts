"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./orgRelationActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./orgRelationActions.backend";

export async function addOrgRelationAction(
  ...args: Parameters<Implementation["addOrgRelationAction"]>
): ReturnType<Implementation["addOrgRelationAction"]> {
  return invokeAction("features/contacts/orgRelationActions.addOrgRelationAction", args);
}

export async function removeOrgRelationAction(
  ...args: Parameters<Implementation["removeOrgRelationAction"]>
): ReturnType<Implementation["removeOrgRelationAction"]> {
  return invokeAction("features/contacts/orgRelationActions.removeOrgRelationAction", args);
}
