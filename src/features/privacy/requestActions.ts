"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./requestActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./requestActions.backend";

export async function createOwnPrivacyRequestAction(
  ...args: Parameters<Implementation["createOwnPrivacyRequestAction"]>
): ReturnType<Implementation["createOwnPrivacyRequestAction"]> {
  return invokeAction("features/privacy/requestActions.createOwnPrivacyRequestAction", args);
}

export async function readOwnPrivacyRequestAction(
  ...args: Parameters<Implementation["readOwnPrivacyRequestAction"]>
): ReturnType<Implementation["readOwnPrivacyRequestAction"]> {
  return invokeAction("features/privacy/requestActions.readOwnPrivacyRequestAction", args);
}

export async function verifyOwnPrivacyRequestAction(
  ...args: Parameters<Implementation["verifyOwnPrivacyRequestAction"]>
): ReturnType<Implementation["verifyOwnPrivacyRequestAction"]> {
  return invokeAction("features/privacy/requestActions.verifyOwnPrivacyRequestAction", args);
}
