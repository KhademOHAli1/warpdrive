"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function createAgencyProjectAction(
  ...args: Parameters<Implementation["createAgencyProjectAction"]>
): ReturnType<Implementation["createAgencyProjectAction"]> {
  return invokeAction("features/agency-projects/actions.createAgencyProjectAction", args);
}

export async function startAgencyProjectAction(
  ...args: Parameters<Implementation["startAgencyProjectAction"]>
): ReturnType<Implementation["startAgencyProjectAction"]> {
  return invokeAction("features/agency-projects/actions.startAgencyProjectAction", args);
}

export async function listAgencyProjectsAction(
  ...args: Parameters<Implementation["listAgencyProjectsAction"]>
): ReturnType<Implementation["listAgencyProjectsAction"]> {
  return invokeAction("features/agency-projects/actions.listAgencyProjectsAction", args);
}

export async function readAgencyProjectAction(
  ...args: Parameters<Implementation["readAgencyProjectAction"]>
): ReturnType<Implementation["readAgencyProjectAction"]> {
  return invokeAction("features/agency-projects/actions.readAgencyProjectAction", args);
}

export async function agencyProjectOptionsAction(
  ...args: Parameters<Implementation["agencyProjectOptionsAction"]>
): ReturnType<Implementation["agencyProjectOptionsAction"]> {
  return invokeAction("features/agency-projects/actions.agencyProjectOptionsAction", args);
}

export async function enableAgencyProjectsAction(
  ...args: Parameters<Implementation["enableAgencyProjectsAction"]>
): ReturnType<Implementation["enableAgencyProjectsAction"]> {
  return invokeAction("features/agency-projects/actions.enableAgencyProjectsAction", args);
}
