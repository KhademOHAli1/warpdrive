"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./duplicateDealAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./duplicateDealAction.backend";

export async function duplicateDealAction(
  ...args: Parameters<Implementation["duplicateDealAction"]>
): ReturnType<Implementation["duplicateDealAction"]> {
  return invokeAction("features/deal-workspace/duplicateDealAction.duplicateDealAction", args);
}
