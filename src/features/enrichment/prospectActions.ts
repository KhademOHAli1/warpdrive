"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./prospectActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./prospectActions.backend";

export async function revealProspectsAction(
  ...args: Parameters<Implementation["revealProspectsAction"]>
): ReturnType<Implementation["revealProspectsAction"]> {
  return invokeAction("features/enrichment/prospectActions.revealProspectsAction", args);
}
