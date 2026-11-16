"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./calendarCatalogActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./calendarCatalogActions.backend";

export async function discoverGoogleCalendarsAction(
  ...args: Parameters<Implementation["discoverGoogleCalendarsAction"]>
): ReturnType<Implementation["discoverGoogleCalendarsAction"]> {
  return invokeAction(
    "features/activities/providers/google/calendarCatalogActions.discoverGoogleCalendarsAction",
    args,
  );
}

export async function setGoogleCalendarSelectionAction(
  ...args: Parameters<Implementation["setGoogleCalendarSelectionAction"]>
): ReturnType<Implementation["setGoogleCalendarSelectionAction"]> {
  return invokeAction(
    "features/activities/providers/google/calendarCatalogActions.setGoogleCalendarSelectionAction",
    args,
  );
}
