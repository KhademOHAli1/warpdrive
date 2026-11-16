"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./moveAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./moveAction.backend";

export async function moveDealAction(
  ...args: Parameters<Implementation["moveDealAction"]>
): ReturnType<Implementation["moveDealAction"]> {
  return invokeAction("features/deals/moveAction.moveDealAction", args);
}
