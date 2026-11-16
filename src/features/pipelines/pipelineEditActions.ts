"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./pipelineEditActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./pipelineEditActions.backend";

export async function createPipelineAction(
  ...args: Parameters<Implementation["createPipelineAction"]>
): ReturnType<Implementation["createPipelineAction"]> {
  return invokeAction("features/pipelines/pipelineEditActions.createPipelineAction", args);
}

export async function renamePipelineAction(
  ...args: Parameters<Implementation["renamePipelineAction"]>
): ReturnType<Implementation["renamePipelineAction"]> {
  return invokeAction("features/pipelines/pipelineEditActions.renamePipelineAction", args);
}

export async function createStageAction(
  ...args: Parameters<Implementation["createStageAction"]>
): ReturnType<Implementation["createStageAction"]> {
  return invokeAction("features/pipelines/pipelineEditActions.createStageAction", args);
}

export async function updateStageAction(
  ...args: Parameters<Implementation["updateStageAction"]>
): ReturnType<Implementation["updateStageAction"]> {
  return invokeAction("features/pipelines/pipelineEditActions.updateStageAction", args);
}

export async function deleteStageAction(
  ...args: Parameters<Implementation["deleteStageAction"]>
): ReturnType<Implementation["deleteStageAction"]> {
  return invokeAction("features/pipelines/pipelineEditActions.deleteStageAction", args);
}

export async function reorderStagesAction(
  ...args: Parameters<Implementation["reorderStagesAction"]>
): ReturnType<Implementation["reorderStagesAction"]> {
  return invokeAction("features/pipelines/pipelineEditActions.reorderStagesAction", args);
}
