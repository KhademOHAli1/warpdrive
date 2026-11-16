"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function saveLocalePreferencesAction(
  ...args: Parameters<Implementation["saveLocalePreferencesAction"]>
): ReturnType<Implementation["saveLocalePreferencesAction"]> {
  return invokeAction("features/i18n/actions.saveLocalePreferencesAction", args);
}
