"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./preferencesActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./preferencesActions.backend";

export async function setSavedViewSelectionAction(
  ...args: Parameters<Implementation["setSavedViewSelectionAction"]>
): ReturnType<Implementation["setSavedViewSelectionAction"]> {
  return invokeAction("features/identity/preferencesActions.setSavedViewSelectionAction", args);
}

export async function updateProfilePreferencesAction(
  ...args: Parameters<Implementation["updateProfilePreferencesAction"]>
): ReturnType<Implementation["updateProfilePreferencesAction"]> {
  return invokeAction("features/identity/preferencesActions.updateProfilePreferencesAction", args);
}

export async function setDensityAction(
  ...args: Parameters<Implementation["setDensityAction"]>
): ReturnType<Implementation["setDensityAction"]> {
  return invokeAction("features/identity/preferencesActions.setDensityAction", args);
}

export async function setDealHeaderBlocksAction(
  ...args: Parameters<Implementation["setDealHeaderBlocksAction"]>
): ReturnType<Implementation["setDealHeaderBlocksAction"]> {
  return invokeAction("features/identity/preferencesActions.setDealHeaderBlocksAction", args);
}

export async function setSidebarSectionsAction(
  ...args: Parameters<Implementation["setSidebarSectionsAction"]>
): ReturnType<Implementation["setSidebarSectionsAction"]> {
  return invokeAction("features/identity/preferencesActions.setSidebarSectionsAction", args);
}

export async function setLeadsViewAction(
  ...args: Parameters<Implementation["setLeadsViewAction"]>
): ReturnType<Implementation["setLeadsViewAction"]> {
  return invokeAction("features/identity/preferencesActions.setLeadsViewAction", args);
}

export async function setBoardViewAction(
  ...args: Parameters<Implementation["setBoardViewAction"]>
): ReturnType<Implementation["setBoardViewAction"]> {
  return invokeAction("features/identity/preferencesActions.setBoardViewAction", args);
}

export async function setColumnViewAction(
  ...args: Parameters<Implementation["setColumnViewAction"]>
): ReturnType<Implementation["setColumnViewAction"]> {
  return invokeAction("features/identity/preferencesActions.setColumnViewAction", args);
}

export async function setAppearanceAction(
  ...args: Parameters<Implementation["setAppearanceAction"]>
): ReturnType<Implementation["setAppearanceAction"]> {
  return invokeAction("features/identity/preferencesActions.setAppearanceAction", args);
}

export async function setScheduleFollowUpAfterWonAction(
  ...args: Parameters<Implementation["setScheduleFollowUpAfterWonAction"]>
): ReturnType<Implementation["setScheduleFollowUpAfterWonAction"]> {
  return invokeAction(
    "features/identity/preferencesActions.setScheduleFollowUpAfterWonAction",
    args,
  );
}

export async function setDailyActivityTargetAction(
  ...args: Parameters<Implementation["setDailyActivityTargetAction"]>
): ReturnType<Implementation["setDailyActivityTargetAction"]> {
  return invokeAction("features/identity/preferencesActions.setDailyActivityTargetAction", args);
}

export async function setUiFlagAction(
  ...args: Parameters<Implementation["setUiFlagAction"]>
): ReturnType<Implementation["setUiFlagAction"]> {
  return invokeAction("features/identity/preferencesActions.setUiFlagAction", args);
}

export async function setOpenDetailsAfterCreateAction(
  ...args: Parameters<Implementation["setOpenDetailsAfterCreateAction"]>
): ReturnType<Implementation["setOpenDetailsAfterCreateAction"]> {
  return invokeAction("features/identity/preferencesActions.setOpenDetailsAfterCreateAction", args);
}
