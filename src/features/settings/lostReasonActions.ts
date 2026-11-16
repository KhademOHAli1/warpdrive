"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./lostReasonActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./lostReasonActions.backend";

export async function createLostReasonAction(
  ...args: Parameters<Implementation["createLostReasonAction"]>
): ReturnType<Implementation["createLostReasonAction"]> {
  return invokeAction("features/settings/lostReasonActions.createLostReasonAction", args);
}

export async function renameLostReasonAction(
  ...args: Parameters<Implementation["renameLostReasonAction"]>
): ReturnType<Implementation["renameLostReasonAction"]> {
  return invokeAction("features/settings/lostReasonActions.renameLostReasonAction", args);
}

export async function reorderLostReasonsAction(
  ...args: Parameters<Implementation["reorderLostReasonsAction"]>
): ReturnType<Implementation["reorderLostReasonsAction"]> {
  return invokeAction("features/settings/lostReasonActions.reorderLostReasonsAction", args);
}

export async function archiveLostReasonAction(
  ...args: Parameters<Implementation["archiveLostReasonAction"]>
): ReturnType<Implementation["archiveLostReasonAction"]> {
  return invokeAction("features/settings/lostReasonActions.archiveLostReasonAction", args);
}
