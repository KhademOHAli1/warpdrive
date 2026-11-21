"use server";

import { invokeAction } from "@/frontend/actions";
import type { ReturnCommand, ReturnEffect } from "./contracts";

export async function executeReturnAction(
  actorId: string,
  command: ReturnCommand,
  csrf: string | null,
): Promise<ReturnEffect> {
  return invokeAction("features/inventory/returns/webActions.executeReturnAction", [
    actorId,
    command,
    csrf,
  ]);
}
