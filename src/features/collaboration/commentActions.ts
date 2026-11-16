"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./commentActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./commentActions.backend";

export async function createCommentAction(
  ...args: Parameters<Implementation["createCommentAction"]>
): ReturnType<Implementation["createCommentAction"]> {
  return invokeAction("features/collaboration/commentActions.createCommentAction", args);
}

export async function updateCommentAction(
  ...args: Parameters<Implementation["updateCommentAction"]>
): ReturnType<Implementation["updateCommentAction"]> {
  return invokeAction("features/collaboration/commentActions.updateCommentAction", args);
}

export async function deleteCommentAction(
  ...args: Parameters<Implementation["deleteCommentAction"]>
): ReturnType<Implementation["deleteCommentAction"]> {
  return invokeAction("features/collaboration/commentActions.deleteCommentAction", args);
}
