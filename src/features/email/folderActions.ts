"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./folderActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./folderActions.backend";

export async function archiveThreadAction(
  ...args: Parameters<Implementation["archiveThreadAction"]>
): ReturnType<Implementation["archiveThreadAction"]> {
  return invokeAction("features/email/folderActions.archiveThreadAction", args);
}

export async function unarchiveThreadAction(
  ...args: Parameters<Implementation["unarchiveThreadAction"]>
): ReturnType<Implementation["unarchiveThreadAction"]> {
  return invokeAction("features/email/folderActions.unarchiveThreadAction", args);
}

export async function saveDraftAction(
  ...args: Parameters<Implementation["saveDraftAction"]>
): ReturnType<Implementation["saveDraftAction"]> {
  return invokeAction("features/email/folderActions.saveDraftAction", args);
}

export async function deleteDraftAction(
  ...args: Parameters<Implementation["deleteDraftAction"]>
): ReturnType<Implementation["deleteDraftAction"]> {
  return invokeAction("features/email/folderActions.deleteDraftAction", args);
}

export async function cancelOutboxAction(
  ...args: Parameters<Implementation["cancelOutboxAction"]>
): ReturnType<Implementation["cancelOutboxAction"]> {
  return invokeAction("features/email/folderActions.cancelOutboxAction", args);
}
