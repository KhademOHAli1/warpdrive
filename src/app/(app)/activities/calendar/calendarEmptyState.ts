import { CALENDAR_MESSAGES } from "@/features/activities/calendarMessages";
import type { CalendarViewName } from "@/features/activities/calendarView";

type CalendarEmptyKind = "none" | "filtered";

export interface CalendarEmpty {
  kind: CalendarEmptyKind;
  title: string;
  body: string;
  action: string;
}

// A blank grid is not a message. This says which window is empty and why, so "this week holds
// nothing" is never mistaken for "the filters hid everything in it".
export function calendarEmptyState({
  view,
  hasFilter,
  hasUnfilteredActivities,
  locale = "en",
}: {
  view: CalendarViewName;
  hasFilter: boolean;
  // Whether the window holds anything at all before the filter runs. The filtered wording states
  // as fact that there is something to exclude, so an empty window must not use it.
  hasUnfilteredActivities: boolean;
  locale?: "en" | "fa" | "de";
}): CalendarEmpty {
  const messages = CALENDAR_MESSAGES[locale];
  if (hasFilter && hasUnfilteredActivities) {
    return {
      kind: "filtered",
      title: view === "week" ? messages.emptyFilteredWeekTitle : messages.emptyFilteredMonthTitle,
      body: messages.emptyFilteredBody,
      action: messages.emptyFilteredAction,
    };
  }
  return {
    kind: "none",
    title: view === "week" ? messages.emptyWeekTitle : messages.emptyMonthTitle,
    body: messages.emptyBody,
    action: messages.emptyAction,
  };
}
