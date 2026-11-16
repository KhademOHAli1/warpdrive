"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function markWonAction(
  ...args: Parameters<Implementation["markWonAction"]>
): ReturnType<Implementation["markWonAction"]> {
  return invokeAction("features/deal-workspace/actions.markWonAction", args);
}

export async function reopenDealAction(
  ...args: Parameters<Implementation["reopenDealAction"]>
): ReturnType<Implementation["reopenDealAction"]> {
  return invokeAction("features/deal-workspace/actions.reopenDealAction", args);
}

export async function markLostAction(
  ...args: Parameters<Implementation["markLostAction"]>
): ReturnType<Implementation["markLostAction"]> {
  return invokeAction("features/deal-workspace/actions.markLostAction", args);
}

export async function changeStageAction(
  ...args: Parameters<Implementation["changeStageAction"]>
): ReturnType<Implementation["changeStageAction"]> {
  return invokeAction("features/deal-workspace/actions.changeStageAction", args);
}

export async function changeOwnerAction(
  ...args: Parameters<Implementation["changeOwnerAction"]>
): ReturnType<Implementation["changeOwnerAction"]> {
  return invokeAction("features/deal-workspace/actions.changeOwnerAction", args);
}

export async function deleteDealAction(
  ...args: Parameters<Implementation["deleteDealAction"]>
): ReturnType<Implementation["deleteDealAction"]> {
  return invokeAction("features/deal-workspace/actions.deleteDealAction", args);
}

export async function followDealAction(
  ...args: Parameters<Implementation["followDealAction"]>
): ReturnType<Implementation["followDealAction"]> {
  return invokeAction("features/deal-workspace/actions.followDealAction", args);
}

export async function unfollowDealAction(
  ...args: Parameters<Implementation["unfollowDealAction"]>
): ReturnType<Implementation["unfollowDealAction"]> {
  return invokeAction("features/deal-workspace/actions.unfollowDealAction", args);
}

export async function addParticipantAction(
  ...args: Parameters<Implementation["addParticipantAction"]>
): ReturnType<Implementation["addParticipantAction"]> {
  return invokeAction("features/deal-workspace/actions.addParticipantAction", args);
}

export async function removeParticipantAction(
  ...args: Parameters<Implementation["removeParticipantAction"]>
): ReturnType<Implementation["removeParticipantAction"]> {
  return invokeAction("features/deal-workspace/actions.removeParticipantAction", args);
}
