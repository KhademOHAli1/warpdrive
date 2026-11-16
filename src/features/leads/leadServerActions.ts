"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./leadServerActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./leadServerActions.backend";

export async function createLeadAction(
  ...args: Parameters<Implementation["createLeadAction"]>
): ReturnType<Implementation["createLeadAction"]> {
  return invokeAction("features/leads/leadServerActions.createLeadAction", args);
}

export async function archiveLeadAction(
  ...args: Parameters<Implementation["archiveLeadAction"]>
): ReturnType<Implementation["archiveLeadAction"]> {
  return invokeAction("features/leads/leadServerActions.archiveLeadAction", args);
}

export async function convertLeadAction(
  ...args: Parameters<Implementation["convertLeadAction"]>
): ReturnType<Implementation["convertLeadAction"]> {
  return invokeAction("features/leads/leadServerActions.convertLeadAction", args);
}

export async function bulkUpdateLeadsAction(
  ...args: Parameters<Implementation["bulkUpdateLeadsAction"]>
): ReturnType<Implementation["bulkUpdateLeadsAction"]> {
  return invokeAction("features/leads/leadServerActions.bulkUpdateLeadsAction", args);
}

export async function updateLeadAction(
  ...args: Parameters<Implementation["updateLeadAction"]>
): ReturnType<Implementation["updateLeadAction"]> {
  return invokeAction("features/leads/leadServerActions.updateLeadAction", args);
}

export async function bulkConvertLeadsAction(
  ...args: Parameters<Implementation["bulkConvertLeadsAction"]>
): ReturnType<Implementation["bulkConvertLeadsAction"]> {
  return invokeAction("features/leads/leadServerActions.bulkConvertLeadsAction", args);
}
