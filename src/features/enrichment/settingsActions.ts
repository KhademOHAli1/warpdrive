"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./settingsActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./settingsActions.backend";

export async function setProviderKeyAction(
  ...args: Parameters<Implementation["setProviderKeyAction"]>
): ReturnType<Implementation["setProviderKeyAction"]> {
  return invokeAction("features/enrichment/settingsActions.setProviderKeyAction", args);
}

export async function clearProviderKeyAction(
  ...args: Parameters<Implementation["clearProviderKeyAction"]>
): ReturnType<Implementation["clearProviderKeyAction"]> {
  return invokeAction("features/enrichment/settingsActions.clearProviderKeyAction", args);
}

export async function setProviderEnabledAction(
  ...args: Parameters<Implementation["setProviderEnabledAction"]>
): ReturnType<Implementation["setProviderEnabledAction"]> {
  return invokeAction("features/enrichment/settingsActions.setProviderEnabledAction", args);
}

export async function setMappingAction(
  ...args: Parameters<Implementation["setMappingAction"]>
): ReturnType<Implementation["setMappingAction"]> {
  return invokeAction("features/enrichment/settingsActions.setMappingAction", args);
}

export async function clearMappingAction(
  ...args: Parameters<Implementation["clearMappingAction"]>
): ReturnType<Implementation["clearMappingAction"]> {
  return invokeAction("features/enrichment/settingsActions.clearMappingAction", args);
}

export async function setCacheTtlAction(
  ...args: Parameters<Implementation["setCacheTtlAction"]>
): ReturnType<Implementation["setCacheTtlAction"]> {
  return invokeAction("features/enrichment/settingsActions.setCacheTtlAction", args);
}

export async function testProviderAction(
  ...args: Parameters<Implementation["testProviderAction"]>
): ReturnType<Implementation["testProviderAction"]> {
  return invokeAction("features/enrichment/settingsActions.testProviderAction", args);
}
