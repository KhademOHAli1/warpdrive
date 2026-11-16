"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./users.backend";

type Implementation = typeof ImplementationModule;

export type * from "./users.backend";

export async function assignPermissionSetAction(
  ...args: Parameters<Implementation["assignPermissionSetAction"]>
): ReturnType<Implementation["assignPermissionSetAction"]> {
  return invokeAction("features/identity/actions/users.assignPermissionSetAction", args);
}

export async function setUserAdminAction(
  ...args: Parameters<Implementation["setUserAdminAction"]>
): ReturnType<Implementation["setUserAdminAction"]> {
  return invokeAction("features/identity/actions/users.setUserAdminAction", args);
}

export async function setUserActiveAction(
  ...args: Parameters<Implementation["setUserActiveAction"]>
): ReturnType<Implementation["setUserActiveAction"]> {
  return invokeAction("features/identity/actions/users.setUserActiveAction", args);
}
