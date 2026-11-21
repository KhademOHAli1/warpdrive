import { TRPCClientError } from "@trpc/client";
import { coreClient } from "@/frontend/trpc";
import { err } from "@/types/result";
import type { ProjectResult } from "../contracts";
import type { PlanningGroupKind } from "./contracts";

async function read<T>(request: () => Promise<ProjectResult<T>>): Promise<ProjectResult<T>> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof TRPCClientError) return err("project_unavailable");
    throw error;
  }
}

export const readWorkspacePlanning = (projectId: string) =>
  read(() => coreClient().internalProjects.planning.workspace.query({ projectId }));

export const readPlanningGroups = (projectId: string, kind: PlanningGroupKind) =>
  read(() => coreClient().internalProjects.planning.groups.query({ projectId, kind }));

export const readPlanningGroup = (projectId: string, kind: PlanningGroupKind, groupId: string) =>
  read(() => coreClient().internalProjects.planning.group.query({ projectId, kind, groupId }));

export const readPlanningViews = (projectId: string) =>
  read(() => coreClient().internalProjects.planning.views.query({ projectId }));

export const readPlanningSavedView = (projectId: string, viewId: string) =>
  read(() => coreClient().internalProjects.planning.view.query({ projectId, viewId }));
