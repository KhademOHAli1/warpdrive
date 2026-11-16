"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./nativeContactActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./nativeContactActions.backend";

export async function createDealOrgAction(
  ...args: Parameters<Implementation["createDealOrgAction"]>
): ReturnType<Implementation["createDealOrgAction"]> {
  return invokeAction("features/deals/nativeContactActions.createDealOrgAction", args);
}

export async function createDealPersonAction(
  ...args: Parameters<Implementation["createDealPersonAction"]>
): ReturnType<Implementation["createDealPersonAction"]> {
  return invokeAction("features/deals/nativeContactActions.createDealPersonAction", args);
}
