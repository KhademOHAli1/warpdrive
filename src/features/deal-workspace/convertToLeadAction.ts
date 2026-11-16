"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./convertToLeadAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./convertToLeadAction.backend";

export async function convertToLeadAction(
  ...args: Parameters<Implementation["convertToLeadAction"]>
): ReturnType<Implementation["convertToLeadAction"]> {
  return invokeAction("features/deal-workspace/convertToLeadAction.convertToLeadAction", args);
}
