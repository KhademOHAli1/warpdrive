"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./calendarNativeActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./calendarNativeActions.backend";

export async function createCalendarEventAction(
  ...args: Parameters<Implementation["createCalendarEventAction"]>
): ReturnType<Implementation["createCalendarEventAction"]> {
  return invokeAction("features/activities/calendarNativeActions.createCalendarEventAction", args);
}

export async function editCalendarEventAction(
  ...args: Parameters<Implementation["editCalendarEventAction"]>
): ReturnType<Implementation["editCalendarEventAction"]> {
  return invokeAction("features/activities/calendarNativeActions.editCalendarEventAction", args);
}

export async function completeCalendarEventAction(
  ...args: Parameters<Implementation["completeCalendarEventAction"]>
): ReturnType<Implementation["completeCalendarEventAction"]> {
  return invokeAction(
    "features/activities/calendarNativeActions.completeCalendarEventAction",
    args,
  );
}

export async function deleteCalendarEventAction(
  ...args: Parameters<Implementation["deleteCalendarEventAction"]>
): ReturnType<Implementation["deleteCalendarEventAction"]> {
  return invokeAction("features/activities/calendarNativeActions.deleteCalendarEventAction", args);
}

export async function readCalendarEventAction(
  ...args: Parameters<Implementation["readCalendarEventAction"]>
): ReturnType<Implementation["readCalendarEventAction"]> {
  return invokeAction("features/activities/calendarNativeActions.readCalendarEventAction", args);
}

export async function retryCalendarReminderAction(
  ...args: Parameters<Implementation["retryCalendarReminderAction"]>
): ReturnType<Implementation["retryCalendarReminderAction"]> {
  return invokeAction(
    "features/activities/calendarNativeActions.retryCalendarReminderAction",
    args,
  );
}
