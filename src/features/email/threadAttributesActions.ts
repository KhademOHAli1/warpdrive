"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./threadAttributesActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./threadAttributesActions.backend";

export async function setFollowUpStatusAction(
  ...args: Parameters<Implementation["setFollowUpStatusAction"]>
): ReturnType<Implementation["setFollowUpStatusAction"]> {
  return invokeAction("features/email/threadAttributesActions.setFollowUpStatusAction", args);
}

export async function setThreadLabelsAction(
  ...args: Parameters<Implementation["setThreadLabelsAction"]>
): ReturnType<Implementation["setThreadLabelsAction"]> {
  return invokeAction("features/email/threadAttributesActions.setThreadLabelsAction", args);
}
