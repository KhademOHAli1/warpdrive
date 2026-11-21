"use server";

import { invokeAction } from "@/frontend/actions";
import type { ProjectResult, ProjectSummary, ProjectWorkspace } from "./contracts";

export async function createProjectAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
): Promise<ProjectResult<ProjectSummary>> {
  return invokeAction("features/projects/actions.createProjectAction", [
    expectedActorId,
    raw,
    csrfToken,
  ]);
}

export async function createProjectItemAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
): Promise<ProjectResult<ProjectWorkspace>> {
  return invokeAction("features/projects/actions.createProjectItemAction", [
    expectedActorId,
    raw,
    csrfToken,
  ]);
}

export async function updateProjectItemAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
): Promise<ProjectResult<ProjectWorkspace>> {
  return invokeAction("features/projects/actions.updateProjectItemAction", [
    expectedActorId,
    raw,
    csrfToken,
  ]);
}

export async function setProjectMemberAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
): Promise<ProjectResult<ProjectWorkspace>> {
  return invokeAction("features/projects/actions.setProjectMemberAction", [
    expectedActorId,
    raw,
    csrfToken,
  ]);
}
