"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./linkActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./linkActions.backend";

export async function linkThread(
  ...args: Parameters<Implementation["linkThread"]>
): ReturnType<Implementation["linkThread"]> {
  return invokeAction("features/email/linkActions.linkThread", args);
}
