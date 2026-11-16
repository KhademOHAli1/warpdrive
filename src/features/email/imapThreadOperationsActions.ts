"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./imapThreadOperationsActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./imapThreadOperationsActions.backend";

export async function listThreadMoveFoldersAction(
  ...args: Parameters<Implementation["listThreadMoveFoldersAction"]>
): ReturnType<Implementation["listThreadMoveFoldersAction"]> {
  return invokeAction(
    "features/email/imapThreadOperationsActions.listThreadMoveFoldersAction",
    args,
  );
}

export async function moveThreadAction(
  ...args: Parameters<Implementation["moveThreadAction"]>
): ReturnType<Implementation["moveThreadAction"]> {
  return invokeAction("features/email/imapThreadOperationsActions.moveThreadAction", args);
}
