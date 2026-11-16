"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./prospectApplyActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./prospectApplyActions.backend";

export async function applyProspectsAction(
  ...args: Parameters<Implementation["applyProspectsAction"]>
): ReturnType<Implementation["applyProspectsAction"]> {
  return invokeAction("features/enrichment/prospectApplyActions.applyProspectsAction", args);
}
