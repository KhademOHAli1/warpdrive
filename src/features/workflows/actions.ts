"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function archiveWorkflowAction(
  ...args: Parameters<Implementation["archiveWorkflowAction"]>
): ReturnType<Implementation["archiveWorkflowAction"]> {
  return invokeAction("features/workflows/actions.archiveWorkflowAction", args);
}

export async function unarchiveWorkflowAction(
  ...args: Parameters<Implementation["unarchiveWorkflowAction"]>
): ReturnType<Implementation["unarchiveWorkflowAction"]> {
  return invokeAction("features/workflows/actions.unarchiveWorkflowAction", args);
}

export async function duplicateWorkflowAction(
  ...args: Parameters<Implementation["duplicateWorkflowAction"]>
): ReturnType<Implementation["duplicateWorkflowAction"]> {
  return invokeAction("features/workflows/actions.duplicateWorkflowAction", args);
}

export async function restoreWorkflowDraftAction(
  ...args: Parameters<Implementation["restoreWorkflowDraftAction"]>
): ReturnType<Implementation["restoreWorkflowDraftAction"]> {
  return invokeAction("features/workflows/actions.restoreWorkflowDraftAction", args);
}

export async function createWorkflowAction(
  ...args: Parameters<Implementation["createWorkflowAction"]>
): ReturnType<Implementation["createWorkflowAction"]> {
  return invokeAction("features/workflows/actions.createWorkflowAction", args);
}

export async function saveWorkflowAction(
  ...args: Parameters<Implementation["saveWorkflowAction"]>
): ReturnType<Implementation["saveWorkflowAction"]> {
  return invokeAction("features/workflows/actions.saveWorkflowAction", args);
}

export async function publishWorkflowAction(
  ...args: Parameters<Implementation["publishWorkflowAction"]>
): ReturnType<Implementation["publishWorkflowAction"]> {
  return invokeAction("features/workflows/actions.publishWorkflowAction", args);
}

export async function pauseWorkflowAction(
  ...args: Parameters<Implementation["pauseWorkflowAction"]>
): ReturnType<Implementation["pauseWorkflowAction"]> {
  return invokeAction("features/workflows/actions.pauseWorkflowAction", args);
}

export async function runWorkflowAction(
  ...args: Parameters<Implementation["runWorkflowAction"]>
): ReturnType<Implementation["runWorkflowAction"]> {
  return invokeAction("features/workflows/actions.runWorkflowAction", args);
}

export async function simulateWorkflowDraftAction(
  ...args: Parameters<Implementation["simulateWorkflowDraftAction"]>
): ReturnType<Implementation["simulateWorkflowDraftAction"]> {
  return invokeAction("features/workflows/actions.simulateWorkflowDraftAction", args);
}

export async function cancelWorkflowAction(
  ...args: Parameters<Implementation["cancelWorkflowAction"]>
): ReturnType<Implementation["cancelWorkflowAction"]> {
  return invokeAction("features/workflows/actions.cancelWorkflowAction", args);
}

export async function retryWorkflowAction(
  ...args: Parameters<Implementation["retryWorkflowAction"]>
): ReturnType<Implementation["retryWorkflowAction"]> {
  return invokeAction("features/workflows/actions.retryWorkflowAction", args);
}

export async function submitWorkflowHumanFormAction(
  ...args: Parameters<Implementation["submitWorkflowHumanFormAction"]>
): ReturnType<Implementation["submitWorkflowHumanFormAction"]> {
  return invokeAction("features/workflows/actions.submitWorkflowHumanFormAction", args);
}
