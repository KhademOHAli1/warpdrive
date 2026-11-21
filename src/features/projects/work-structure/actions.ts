"use server";

import { invokeAction } from "@/frontend/actions";
import type { ProjectResult } from "../contracts";
import type {
  ProjectWorkStructure,
  SaveProjectEstimateScale,
  SaveProjectLabels,
  SetProjectEstimateScale,
} from "./contracts";

export async function saveProjectLabelsAction(
  actorId: string,
  input: SaveProjectLabels,
  csrfToken: string | null,
): Promise<ProjectResult<ProjectWorkStructure>> {
  return invokeAction("features/projects/work-structure/actions.saveProjectLabelsAction", [
    actorId,
    input,
    csrfToken,
  ]);
}

export async function saveProjectEstimateScaleAction(
  actorId: string,
  input: SaveProjectEstimateScale,
  csrfToken: string | null,
): Promise<ProjectResult<ProjectWorkStructure>> {
  return invokeAction("features/projects/work-structure/actions.saveProjectEstimateScaleAction", [
    actorId,
    input,
    csrfToken,
  ]);
}

export async function setProjectEstimateScaleAction(
  actorId: string,
  input: SetProjectEstimateScale,
  csrfToken: string | null,
): Promise<ProjectResult<ProjectWorkStructure>> {
  return invokeAction("features/projects/work-structure/actions.setProjectEstimateScaleAction", [
    actorId,
    input,
    csrfToken,
  ]);
}
