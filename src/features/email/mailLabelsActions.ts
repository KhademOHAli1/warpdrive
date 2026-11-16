"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./mailLabelsActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./mailLabelsActions.backend";

export async function createMailLabelAction(
  ...args: Parameters<Implementation["createMailLabelAction"]>
): ReturnType<Implementation["createMailLabelAction"]> {
  return invokeAction("features/email/mailLabelsActions.createMailLabelAction", args);
}
