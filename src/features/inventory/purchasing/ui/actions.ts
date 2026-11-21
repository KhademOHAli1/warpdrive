"use server";

import { invokeAction } from "@/frontend/actions";
import type { PurchasingCommand, PurchasingCommandResult } from "../contracts";

export async function executePurchasingAction(
  actorId: string,
  command: PurchasingCommand,
  csrf: string | null,
): Promise<PurchasingCommandResult> {
  return invokeAction("features/inventory/purchasing/actions.executePurchasingAction", [
    actorId,
    command,
    csrf,
  ]);
}
