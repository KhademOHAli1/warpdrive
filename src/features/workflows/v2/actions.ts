"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function createWorkflowV2Action(
  ...args: Parameters<Implementation["createWorkflowV2Action"]>
): ReturnType<Implementation["createWorkflowV2Action"]> {
  return invokeAction("features/workflows/v2/actions.createWorkflowV2Action", args);
}

export async function saveWorkflowV2Action(
  ...args: Parameters<Implementation["saveWorkflowV2Action"]>
): ReturnType<Implementation["saveWorkflowV2Action"]> {
  return invokeAction("features/workflows/v2/actions.saveWorkflowV2Action", args);
}

export async function readWorkflowV2Action(
  ...args: Parameters<Implementation["readWorkflowV2Action"]>
): ReturnType<Implementation["readWorkflowV2Action"]> {
  return invokeAction("features/workflows/v2/actions.readWorkflowV2Action", args);
}

export async function listWorkflowV2Action(
  ...args: Parameters<Implementation["listWorkflowV2Action"]>
): ReturnType<Implementation["listWorkflowV2Action"]> {
  return invokeAction("features/workflows/v2/actions.listWorkflowV2Action", args);
}

export async function listWorkflowAllEnginesAction(
  ...args: Parameters<Implementation["listWorkflowAllEnginesAction"]>
): ReturnType<Implementation["listWorkflowAllEnginesAction"]> {
  return invokeAction("features/workflows/v2/actions.listWorkflowAllEnginesAction", args);
}

export async function publishWorkflowV2Action(
  ...args: Parameters<Implementation["publishWorkflowV2Action"]>
): ReturnType<Implementation["publishWorkflowV2Action"]> {
  return invokeAction("features/workflows/v2/actions.publishWorkflowV2Action", args);
}

export async function pauseWorkflowV2Action(
  ...args: Parameters<Implementation["pauseWorkflowV2Action"]>
): ReturnType<Implementation["pauseWorkflowV2Action"]> {
  return invokeAction("features/workflows/v2/actions.pauseWorkflowV2Action", args);
}

export async function archiveWorkflowV2Action(
  ...args: Parameters<Implementation["archiveWorkflowV2Action"]>
): ReturnType<Implementation["archiveWorkflowV2Action"]> {
  return invokeAction("features/workflows/v2/actions.archiveWorkflowV2Action", args);
}

export async function unarchiveWorkflowV2Action(
  ...args: Parameters<Implementation["unarchiveWorkflowV2Action"]>
): ReturnType<Implementation["unarchiveWorkflowV2Action"]> {
  return invokeAction("features/workflows/v2/actions.unarchiveWorkflowV2Action", args);
}

export async function duplicateWorkflowV2Action(
  ...args: Parameters<Implementation["duplicateWorkflowV2Action"]>
): ReturnType<Implementation["duplicateWorkflowV2Action"]> {
  return invokeAction("features/workflows/v2/actions.duplicateWorkflowV2Action", args);
}

export async function startWorkflowV2Action(
  ...args: Parameters<Implementation["startWorkflowV2Action"]>
): ReturnType<Implementation["startWorkflowV2Action"]> {
  return invokeAction("features/workflows/v2/actions.startWorkflowV2Action", args);
}

export async function readWorkflowV2RunAction(
  ...args: Parameters<Implementation["readWorkflowV2RunAction"]>
): ReturnType<Implementation["readWorkflowV2RunAction"]> {
  return invokeAction("features/workflows/v2/actions.readWorkflowV2RunAction", args);
}

export async function listWorkflowV2RunsAction(
  ...args: Parameters<Implementation["listWorkflowV2RunsAction"]>
): ReturnType<Implementation["listWorkflowV2RunsAction"]> {
  return invokeAction("features/workflows/v2/actions.listWorkflowV2RunsAction", args);
}

export async function cancelWorkflowV2RunAction(
  ...args: Parameters<Implementation["cancelWorkflowV2RunAction"]>
): ReturnType<Implementation["cancelWorkflowV2RunAction"]> {
  return invokeAction("features/workflows/v2/actions.cancelWorkflowV2RunAction", args);
}

export async function readWorkflowV2StudioAction(
  ...args: Parameters<Implementation["readWorkflowV2StudioAction"]>
): ReturnType<Implementation["readWorkflowV2StudioAction"]> {
  return invokeAction("features/workflows/v2/actions.readWorkflowV2StudioAction", args);
}

export async function lookupWorkflowV2RecordsAction(
  ...args: Parameters<Implementation["lookupWorkflowV2RecordsAction"]>
): ReturnType<Implementation["lookupWorkflowV2RecordsAction"]> {
  return invokeAction("features/workflows/v2/actions.lookupWorkflowV2RecordsAction", args);
}

export async function testWorkflowV2DraftAction(
  ...args: Parameters<Implementation["testWorkflowV2DraftAction"]>
): ReturnType<Implementation["testWorkflowV2DraftAction"]> {
  return invokeAction("features/workflows/v2/actions.testWorkflowV2DraftAction", args);
}

export async function listPendingWorkflowV2InputsAction(
  ...args: Parameters<Implementation["listPendingWorkflowV2InputsAction"]>
): ReturnType<Implementation["listPendingWorkflowV2InputsAction"]> {
  return invokeAction("features/workflows/v2/actions.listPendingWorkflowV2InputsAction", args);
}

export async function readWorkflowV2FormAction(
  ...args: Parameters<Implementation["readWorkflowV2FormAction"]>
): ReturnType<Implementation["readWorkflowV2FormAction"]> {
  return invokeAction("features/workflows/v2/actions.readWorkflowV2FormAction", args);
}

export async function resumeWorkflowV2FormAction(
  ...args: Parameters<Implementation["resumeWorkflowV2FormAction"]>
): ReturnType<Implementation["resumeWorkflowV2FormAction"]> {
  return invokeAction("features/workflows/v2/actions.resumeWorkflowV2FormAction", args);
}

export async function rotateWorkflowV2WebhookAction(
  ...args: Parameters<Implementation["rotateWorkflowV2WebhookAction"]>
): ReturnType<Implementation["rotateWorkflowV2WebhookAction"]> {
  return invokeAction("features/workflows/v2/actions.rotateWorkflowV2WebhookAction", args);
}
