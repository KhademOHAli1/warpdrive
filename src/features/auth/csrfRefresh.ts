"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./csrfRefresh.backend";

type Implementation = typeof ImplementationModule;

export type * from "./csrfRefresh.backend";

export async function ensureCsrfAction(
  ...args: Parameters<Implementation["ensureCsrfAction"]>
): ReturnType<Implementation["ensureCsrfAction"]> {
  return invokeAction("features/auth/csrfRefresh.ensureCsrfAction", args);
}
