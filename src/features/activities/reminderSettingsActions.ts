"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./reminderSettingsActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./reminderSettingsActions.backend";

export async function setCalendarReminderDefaultsAction(
  ...args: Parameters<Implementation["setCalendarReminderDefaultsAction"]>
): ReturnType<Implementation["setCalendarReminderDefaultsAction"]> {
  return invokeAction(
    "features/activities/reminderSettingsActions.setCalendarReminderDefaultsAction",
    args,
  );
}

export async function setEventReminderSettingsAction(
  ...args: Parameters<Implementation["setEventReminderSettingsAction"]>
): ReturnType<Implementation["setEventReminderSettingsAction"]> {
  return invokeAction(
    "features/activities/reminderSettingsActions.setEventReminderSettingsAction",
    args,
  );
}
