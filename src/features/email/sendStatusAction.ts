"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./sendStatusAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./sendStatusAction.backend";

export async function getSendStatusAction(
  ...args: Parameters<Implementation["getSendStatusAction"]>
): ReturnType<Implementation["getSendStatusAction"]> {
  return invokeAction("features/email/sendStatusAction.getSendStatusAction", args);
}
