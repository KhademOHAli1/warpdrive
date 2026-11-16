"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./createDealAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./createDealAction.backend";

export async function createDealAction(
  ...args: Parameters<Implementation["createDealAction"]>
): ReturnType<Implementation["createDealAction"]> {
  return invokeAction("features/deals/createDealAction.createDealAction", args);
}
