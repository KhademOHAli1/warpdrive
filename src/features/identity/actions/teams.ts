"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./teams.backend";

type Implementation = typeof ImplementationModule;

export type * from "./teams.backend";

export async function createTeamAction(
  ...args: Parameters<Implementation["createTeamAction"]>
): ReturnType<Implementation["createTeamAction"]> {
  return invokeAction("features/identity/actions/teams.createTeamAction", args);
}

export async function setTeamMembersAction(
  ...args: Parameters<Implementation["setTeamMembersAction"]>
): ReturnType<Implementation["setTeamMembersAction"]> {
  return invokeAction("features/identity/actions/teams.setTeamMembersAction", args);
}

export async function updateTeamAction(
  ...args: Parameters<Implementation["updateTeamAction"]>
): ReturnType<Implementation["updateTeamAction"]> {
  return invokeAction("features/identity/actions/teams.updateTeamAction", args);
}

export async function deleteTeamAction(
  ...args: Parameters<Implementation["deleteTeamAction"]>
): ReturnType<Implementation["deleteTeamAction"]> {
  return invokeAction("features/identity/actions/teams.deleteTeamAction", args);
}
