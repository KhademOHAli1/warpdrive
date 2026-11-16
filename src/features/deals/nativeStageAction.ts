"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./nativeStageAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./nativeStageAction.backend";

export async function moveNativeDealStageAction(
  ...args: Parameters<Implementation["moveNativeDealStageAction"]>
): ReturnType<Implementation["moveNativeDealStageAction"]> {
  return invokeAction("features/deals/nativeStageAction.moveNativeDealStageAction", args);
}

export async function readNativeDealStageAction(
  ...args: Parameters<Implementation["readNativeDealStageAction"]>
): ReturnType<Implementation["readNativeDealStageAction"]> {
  return invokeAction("features/deals/nativeStageAction.readNativeDealStageAction", args);
}
