"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./bulkStageAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./bulkStageAction.backend";

export async function bulkStageAction(
  ...args: Parameters<Implementation["bulkStageAction"]>
): ReturnType<Implementation["bulkStageAction"]> {
  return invokeAction("features/deals/bulkStageAction.bulkStageAction", args);
}
