"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./calendarActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./calendarActions.backend";

export async function createCalendarAction(
  ...args: Parameters<Implementation["createCalendarAction"]>
): ReturnType<Implementation["createCalendarAction"]> {
  return invokeAction("features/activities/calendarActions.createCalendarAction", args);
}

export async function setCalendarMemberAction(
  ...args: Parameters<Implementation["setCalendarMemberAction"]>
): ReturnType<Implementation["setCalendarMemberAction"]> {
  return invokeAction("features/activities/calendarActions.setCalendarMemberAction", args);
}

export async function updateCalendarAction(
  ...args: Parameters<Implementation["updateCalendarAction"]>
): ReturnType<Implementation["updateCalendarAction"]> {
  return invokeAction("features/activities/calendarActions.updateCalendarAction", args);
}

export async function setCalendarArchivedAction(
  ...args: Parameters<Implementation["setCalendarArchivedAction"]>
): ReturnType<Implementation["setCalendarArchivedAction"]> {
  return invokeAction("features/activities/calendarActions.setCalendarArchivedAction", args);
}
