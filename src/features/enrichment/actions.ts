"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function enrichRecordAction(
  ...args: Parameters<Implementation["enrichRecordAction"]>
): ReturnType<Implementation["enrichRecordAction"]> {
  return invokeAction("features/enrichment/actions.enrichRecordAction", args);
}

export async function applyEnrichmentAction(
  ...args: Parameters<Implementation["applyEnrichmentAction"]>
): ReturnType<Implementation["applyEnrichmentAction"]> {
  return invokeAction("features/enrichment/actions.applyEnrichmentAction", args);
}
