"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./readIntentActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./readIntentActions.backend";

export async function prepareThreadReadIntentAction(
  ...args: Parameters<Implementation["prepareThreadReadIntentAction"]>
): ReturnType<Implementation["prepareThreadReadIntentAction"]> {
  return invokeAction("features/email/readIntentActions.prepareThreadReadIntentAction", args);
}

export async function reconcileThreadReadIntentAction(
  ...args: Parameters<Implementation["reconcileThreadReadIntentAction"]>
): ReturnType<Implementation["reconcileThreadReadIntentAction"]> {
  return invokeAction("features/email/readIntentActions.reconcileThreadReadIntentAction", args);
}
