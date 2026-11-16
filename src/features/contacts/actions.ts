"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function patchContactCustomFieldAction(
  ...args: Parameters<Implementation["patchContactCustomFieldAction"]>
): ReturnType<Implementation["patchContactCustomFieldAction"]> {
  return invokeAction("features/contacts/actions.patchContactCustomFieldAction", args);
}

export async function createPersonAction(
  ...args: Parameters<Implementation["createPersonAction"]>
): ReturnType<Implementation["createPersonAction"]> {
  return invokeAction("features/contacts/actions.createPersonAction", args);
}

export async function updatePersonAction(
  ...args: Parameters<Implementation["updatePersonAction"]>
): ReturnType<Implementation["updatePersonAction"]> {
  return invokeAction("features/contacts/actions.updatePersonAction", args);
}

export async function deletePersonAction(
  ...args: Parameters<Implementation["deletePersonAction"]>
): ReturnType<Implementation["deletePersonAction"]> {
  return invokeAction("features/contacts/actions.deletePersonAction", args);
}

export async function createOrgAction(
  ...args: Parameters<Implementation["createOrgAction"]>
): ReturnType<Implementation["createOrgAction"]> {
  return invokeAction("features/contacts/actions.createOrgAction", args);
}

export async function updateOrgAction(
  ...args: Parameters<Implementation["updateOrgAction"]>
): ReturnType<Implementation["updateOrgAction"]> {
  return invokeAction("features/contacts/actions.updateOrgAction", args);
}

export async function deleteOrgAction(
  ...args: Parameters<Implementation["deleteOrgAction"]>
): ReturnType<Implementation["deleteOrgAction"]> {
  return invokeAction("features/contacts/actions.deleteOrgAction", args);
}

export async function mergePersonsAction(
  ...args: Parameters<Implementation["mergePersonsAction"]>
): ReturnType<Implementation["mergePersonsAction"]> {
  return invokeAction("features/contacts/actions.mergePersonsAction", args);
}

export async function mergeOrgsAction(
  ...args: Parameters<Implementation["mergeOrgsAction"]>
): ReturnType<Implementation["mergeOrgsAction"]> {
  return invokeAction("features/contacts/actions.mergeOrgsAction", args);
}
