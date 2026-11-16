"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./archiveActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./archiveActions.backend";

export async function archiveDealAction(
  ...args: Parameters<Implementation["archiveDealAction"]>
): ReturnType<Implementation["archiveDealAction"]> {
  return invokeAction("features/deals/archiveActions.archiveDealAction", args);
}

export async function archiveDealsAction(
  ...args: Parameters<Implementation["archiveDealsAction"]>
): ReturnType<Implementation["archiveDealsAction"]> {
  return invokeAction("features/deals/archiveActions.archiveDealsAction", args);
}
