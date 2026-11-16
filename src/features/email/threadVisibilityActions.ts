"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./threadVisibilityActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./threadVisibilityActions.backend";

export async function setThreadVisibilityAction(
  ...args: Parameters<Implementation["setThreadVisibilityAction"]>
): ReturnType<Implementation["setThreadVisibilityAction"]> {
  return invokeAction("features/email/threadVisibilityActions.setThreadVisibilityAction", args);
}
