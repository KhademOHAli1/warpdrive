"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function createActivityAction(
  ...args: Parameters<Implementation["createActivityAction"]>
): ReturnType<Implementation["createActivityAction"]> {
  return invokeAction("features/activities/actions.createActivityAction", args);
}

export async function completeActivityAction(
  ...args: Parameters<Implementation["completeActivityAction"]>
): ReturnType<Implementation["completeActivityAction"]> {
  return invokeAction("features/activities/actions.completeActivityAction", args);
}

export async function editActivityAction(
  ...args: Parameters<Implementation["editActivityAction"]>
): ReturnType<Implementation["editActivityAction"]> {
  return invokeAction("features/activities/actions.editActivityAction", args);
}

export async function deleteActivityAction(
  ...args: Parameters<Implementation["deleteActivityAction"]>
): ReturnType<Implementation["deleteActivityAction"]> {
  return invokeAction("features/activities/actions.deleteActivityAction", args);
}
