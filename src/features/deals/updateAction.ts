"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./updateAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./updateAction.backend";

export async function updateDealAction(
  ...args: Parameters<Implementation["updateDealAction"]>
): ReturnType<Implementation["updateDealAction"]> {
  return invokeAction("features/deals/updateAction.updateDealAction", args);
}
