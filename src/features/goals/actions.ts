"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function createGoalAction(
  ...args: Parameters<Implementation["createGoalAction"]>
): ReturnType<Implementation["createGoalAction"]> {
  return invokeAction("features/goals/actions.createGoalAction", args);
}

export async function updateGoalAction(
  ...args: Parameters<Implementation["updateGoalAction"]>
): ReturnType<Implementation["updateGoalAction"]> {
  return invokeAction("features/goals/actions.updateGoalAction", args);
}

export async function deleteGoalAction(
  ...args: Parameters<Implementation["deleteGoalAction"]>
): ReturnType<Implementation["deleteGoalAction"]> {
  return invokeAction("features/goals/actions.deleteGoalAction", args);
}
