"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function sendEmail(
  ...args: Parameters<Implementation["sendEmail"]>
): ReturnType<Implementation["sendEmail"]> {
  return invokeAction("features/email/actions.sendEmail", args);
}

export async function trashThreadAction(
  ...args: Parameters<Implementation["trashThreadAction"]>
): ReturnType<Implementation["trashThreadAction"]> {
  return invokeAction("features/email/actions.trashThreadAction", args);
}

export async function connectGmailStart(
  ...args: Parameters<Implementation["connectGmailStart"]>
): ReturnType<Implementation["connectGmailStart"]> {
  return invokeAction("features/email/actions.connectGmailStart", args);
}

export async function disconnectMailboxAction(
  ...args: Parameters<Implementation["disconnectMailboxAction"]>
): ReturnType<Implementation["disconnectMailboxAction"]> {
  return invokeAction("features/email/actions.disconnectMailboxAction", args);
}
