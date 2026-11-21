import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  type ProjectStatus,
  type ProjectWorkflowState,
  projectStateCategories,
  projectStateLegacyStatus,
} from "../contracts";
import { internalProjectStates } from "../schema";

export function orderProjectWorkflowStates(states: readonly ProjectWorkflowState[]) {
  return [...states].sort(
    (left, right) =>
      projectStateCategories.indexOf(left.category) -
        projectStateCategories.indexOf(right.category) ||
      left.position - right.position ||
      left.id.localeCompare(right.id),
  );
}

export async function readProjectWorkflowStates(db: Db, projectId: string) {
  const { id, name, category, position, color, isDefault } = internalProjectStates;
  const states = await db
    .select({ id, name, category, position, color, isDefault })
    .from(internalProjectStates)
    .where(eq(internalProjectStates.projectId, projectId))
    .orderBy(asc(position), asc(id));
  return orderProjectWorkflowStates(states);
}

export function findProjectWorkflowState(
  states: readonly ProjectWorkflowState[],
  stateId?: string,
  status?: ProjectStatus,
) {
  if (stateId !== undefined) return states.find(({ id }) => id === stateId);
  const fallback = states.find(({ isDefault }) => isDefault);
  if (status === undefined) return fallback;
  if (fallback !== undefined && projectStateLegacyStatus(fallback.category) === status)
    return fallback;
  return states.find(({ category }) => projectStateLegacyStatus(category) === status);
}
