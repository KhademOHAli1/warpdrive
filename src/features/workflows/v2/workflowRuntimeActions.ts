"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./workflowRuntimeActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./workflowRuntimeActions.backend";

export async function saveWorkflowRuntimeAction(
  ...args: Parameters<Implementation["saveWorkflowRuntimeAction"]>
): ReturnType<Implementation["saveWorkflowRuntimeAction"]> {
  return invokeAction(
    "features/workflows/v2/workflowRuntimeActions.saveWorkflowRuntimeAction",
    args,
  );
}

export async function saveWorkflowLogicFunctionAction(
  ...args: Parameters<Implementation["saveWorkflowLogicFunctionAction"]>
): ReturnType<Implementation["saveWorkflowLogicFunctionAction"]> {
  return invokeAction(
    "features/workflows/v2/workflowRuntimeActions.saveWorkflowLogicFunctionAction",
    args,
  );
}
