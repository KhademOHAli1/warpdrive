"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./nativeCreateAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./nativeCreateAction.backend";

export async function createNativeDealAction(
  ...args: Parameters<Implementation["createNativeDealAction"]>
): ReturnType<Implementation["createNativeDealAction"]> {
  return invokeAction("features/deals/nativeCreateAction.createNativeDealAction", args);
}

export async function readNativeDealCreationAction(
  ...args: Parameters<Implementation["readNativeDealCreationAction"]>
): ReturnType<Implementation["readNativeDealCreationAction"]> {
  return invokeAction("features/deals/nativeCreateAction.readNativeDealCreationAction", args);
}
