"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function connectSlackAction(
  ...args: Parameters<Implementation["connectSlackAction"]>
): ReturnType<Implementation["connectSlackAction"]> {
  return invokeAction("features/integrations/actions.connectSlackAction", args);
}

export async function slackChannelsAction(
  ...args: Parameters<Implementation["slackChannelsAction"]>
): ReturnType<Implementation["slackChannelsAction"]> {
  return invokeAction("features/integrations/actions.slackChannelsAction", args);
}

export async function configureSlackAction(
  ...args: Parameters<Implementation["configureSlackAction"]>
): ReturnType<Implementation["configureSlackAction"]> {
  return invokeAction("features/integrations/actions.configureSlackAction", args);
}

export async function testSlackAction(
  ...args: Parameters<Implementation["testSlackAction"]>
): ReturnType<Implementation["testSlackAction"]> {
  return invokeAction("features/integrations/actions.testSlackAction", args);
}

export async function disconnectSlackAction(
  ...args: Parameters<Implementation["disconnectSlackAction"]>
): ReturnType<Implementation["disconnectSlackAction"]> {
  return invokeAction("features/integrations/actions.disconnectSlackAction", args);
}
