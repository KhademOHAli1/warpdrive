"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./kpiActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./kpiActions.backend";

export async function readKpiWorkspaceAction(
  ...args: Parameters<Implementation["readKpiWorkspaceAction"]>
): ReturnType<Implementation["readKpiWorkspaceAction"]> {
  return invokeAction("features/goals/kpiActions.readKpiWorkspaceAction", args);
}

export async function saveKpiDefinitionAction(
  ...args: Parameters<Implementation["saveKpiDefinitionAction"]>
): ReturnType<Implementation["saveKpiDefinitionAction"]> {
  return invokeAction("features/goals/kpiActions.saveKpiDefinitionAction", args);
}

export async function saveKpiSchemeAction(
  ...args: Parameters<Implementation["saveKpiSchemeAction"]>
): ReturnType<Implementation["saveKpiSchemeAction"]> {
  return invokeAction("features/goals/kpiActions.saveKpiSchemeAction", args);
}

export async function createKpiPackAction(
  ...args: Parameters<Implementation["createKpiPackAction"]>
): ReturnType<Implementation["createKpiPackAction"]> {
  return invokeAction("features/goals/kpiActions.createKpiPackAction", args);
}

export async function assignKpiGoalAction(
  ...args: Parameters<Implementation["assignKpiGoalAction"]>
): ReturnType<Implementation["assignKpiGoalAction"]> {
  return invokeAction("features/goals/kpiActions.assignKpiGoalAction", args);
}

export async function createKpiGoalAction(
  ...args: Parameters<Implementation["createKpiGoalAction"]>
): ReturnType<Implementation["createKpiGoalAction"]> {
  return invokeAction("features/goals/kpiActions.createKpiGoalAction", args);
}

export async function previewKpiAction(
  ...args: Parameters<Implementation["previewKpiAction"]>
): ReturnType<Implementation["previewKpiAction"]> {
  return invokeAction("features/goals/kpiActions.previewKpiAction", args);
}

export async function applyKpiSchemeAction(
  ...args: Parameters<Implementation["applyKpiSchemeAction"]>
): ReturnType<Implementation["applyKpiSchemeAction"]> {
  return invokeAction("features/goals/kpiActions.applyKpiSchemeAction", args);
}

export async function archiveKpiGoalAction(
  ...args: Parameters<Implementation["archiveKpiGoalAction"]>
): ReturnType<Implementation["archiveKpiGoalAction"]> {
  return invokeAction("features/goals/kpiActions.archiveKpiGoalAction", args);
}

export async function recordKpiMeasurementAction(
  ...args: Parameters<Implementation["recordKpiMeasurementAction"]>
): ReturnType<Implementation["recordKpiMeasurementAction"]> {
  return invokeAction("features/goals/kpiActions.recordKpiMeasurementAction", args);
}

export async function closeKpiPeriodAction(
  ...args: Parameters<Implementation["closeKpiPeriodAction"]>
): ReturnType<Implementation["closeKpiPeriodAction"]> {
  return invokeAction("features/goals/kpiActions.closeKpiPeriodAction", args);
}
