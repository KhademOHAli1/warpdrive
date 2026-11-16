"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./pipelineLifecycleActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./pipelineLifecycleActions.backend";

export async function archivePipelineAction(
  ...args: Parameters<Implementation["archivePipelineAction"]>
): ReturnType<Implementation["archivePipelineAction"]> {
  return invokeAction("features/pipelines/pipelineLifecycleActions.archivePipelineAction", args);
}

export async function restorePipelineAction(
  ...args: Parameters<Implementation["restorePipelineAction"]>
): ReturnType<Implementation["restorePipelineAction"]> {
  return invokeAction("features/pipelines/pipelineLifecycleActions.restorePipelineAction", args);
}
