"use server";

import { invokeAction } from "@/frontend/actions";
import type { SalesCommand, SalesEffect } from "./contracts";

export async function executeSalesAction(
  actorId: string,
  command: SalesCommand,
  csrf: string | null,
): Promise<SalesEffect> {
  return invokeAction("features/inventory/sales/webActions.executeSalesAction", [
    actorId,
    command,
    csrf,
  ]);
}
