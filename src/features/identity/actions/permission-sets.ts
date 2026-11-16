"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./permission-sets.backend";

type Implementation = typeof ImplementationModule;

export type * from "./permission-sets.backend";

export async function createPermissionSetAction(
  ...args: Parameters<Implementation["createPermissionSetAction"]>
): ReturnType<Implementation["createPermissionSetAction"]> {
  return invokeAction("features/identity/actions/permission-sets.createPermissionSetAction", args);
}

export async function updateFlagsAction(
  ...args: Parameters<Implementation["updateFlagsAction"]>
): ReturnType<Implementation["updateFlagsAction"]> {
  return invokeAction("features/identity/actions/permission-sets.updateFlagsAction", args);
}
