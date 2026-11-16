"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./calendarRescheduleAction.backend";

type Implementation = typeof ImplementationModule;

export type * from "./calendarRescheduleAction.backend";

export async function rescheduleCalendarEventAction(
  ...args: Parameters<Implementation["rescheduleCalendarEventAction"]>
): ReturnType<Implementation["rescheduleCalendarEventAction"]> {
  return invokeAction(
    "features/activities/calendarRescheduleAction.rescheduleCalendarEventAction",
    args,
  );
}
