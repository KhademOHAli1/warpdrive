"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function createDefAction(
  ...args: Parameters<Implementation["createDefAction"]>
): ReturnType<Implementation["createDefAction"]> {
  return invokeAction("features/custom-fields/actions.createDefAction", args);
}

export async function archiveDefAction(
  ...args: Parameters<Implementation["archiveDefAction"]>
): ReturnType<Implementation["archiveDefAction"]> {
  return invokeAction("features/custom-fields/actions.archiveDefAction", args);
}

export async function renameDefAction(
  ...args: Parameters<Implementation["renameDefAction"]>
): ReturnType<Implementation["renameDefAction"]> {
  return invokeAction("features/custom-fields/actions.renameDefAction", args);
}

export async function setDefFlagsAction(
  ...args: Parameters<Implementation["setDefFlagsAction"]>
): ReturnType<Implementation["setDefFlagsAction"]> {
  return invokeAction("features/custom-fields/actions.setDefFlagsAction", args);
}

export async function reorderDefsAction(
  ...args: Parameters<Implementation["reorderDefsAction"]>
): ReturnType<Implementation["reorderDefsAction"]> {
  return invokeAction("features/custom-fields/actions.reorderDefsAction", args);
}

export async function addOptionAction(
  ...args: Parameters<Implementation["addOptionAction"]>
): ReturnType<Implementation["addOptionAction"]> {
  return invokeAction("features/custom-fields/actions.addOptionAction", args);
}

export async function renameOptionAction(
  ...args: Parameters<Implementation["renameOptionAction"]>
): ReturnType<Implementation["renameOptionAction"]> {
  return invokeAction("features/custom-fields/actions.renameOptionAction", args);
}

export async function archiveOptionAction(
  ...args: Parameters<Implementation["archiveOptionAction"]>
): ReturnType<Implementation["archiveOptionAction"]> {
  return invokeAction("features/custom-fields/actions.archiveOptionAction", args);
}

export async function setBuiltinFieldHiddenAction(
  ...args: Parameters<Implementation["setBuiltinFieldHiddenAction"]>
): ReturnType<Implementation["setBuiltinFieldHiddenAction"]> {
  return invokeAction("features/custom-fields/actions.setBuiltinFieldHiddenAction", args);
}
