"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./mergeDealsAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./mergeDealsAction.backend";

export async function mergeDealsAction(
  ...args: Parameters<Implementation["mergeDealsAction"]>
): ReturnType<Implementation["mergeDealsAction"]> {
  return invokeAction("features/deal-workspace/mergeDealsAction.mergeDealsAction", args);
}
