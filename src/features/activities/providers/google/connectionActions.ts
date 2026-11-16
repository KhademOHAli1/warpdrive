"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./connectionActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./connectionActions.backend";

export async function disconnectGoogleCalendarAction(
  ...args: Parameters<Implementation["disconnectGoogleCalendarAction"]>
): ReturnType<Implementation["disconnectGoogleCalendarAction"]> {
  return invokeAction(
    "features/activities/providers/google/connectionActions.disconnectGoogleCalendarAction",
    args,
  );
}
