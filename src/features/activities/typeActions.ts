"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./typeActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./typeActions.backend";

export async function createActivityTypeAction(
  ...args: Parameters<Implementation["createActivityTypeAction"]>
): ReturnType<Implementation["createActivityTypeAction"]> {
  return invokeAction("features/activities/typeActions.createActivityTypeAction", args);
}

export async function renameActivityTypeAction(
  ...args: Parameters<Implementation["renameActivityTypeAction"]>
): ReturnType<Implementation["renameActivityTypeAction"]> {
  return invokeAction("features/activities/typeActions.renameActivityTypeAction", args);
}

export async function reorderActivityTypesAction(
  ...args: Parameters<Implementation["reorderActivityTypesAction"]>
): ReturnType<Implementation["reorderActivityTypesAction"]> {
  return invokeAction("features/activities/typeActions.reorderActivityTypesAction", args);
}

export async function setActivityTypeActiveAction(
  ...args: Parameters<Implementation["setActivityTypeActiveAction"]>
): ReturnType<Implementation["setActivityTypeActiveAction"]> {
  return invokeAction("features/activities/typeActions.setActivityTypeActiveAction", args);
}

export async function deleteActivityTypeAction(
  ...args: Parameters<Implementation["deleteActivityTypeAction"]>
): ReturnType<Implementation["deleteActivityTypeAction"]> {
  return invokeAction("features/activities/typeActions.deleteActivityTypeAction", args);
}
