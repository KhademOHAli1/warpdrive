"use server";

import { invokeAction } from "@/frontend/actions";
import type { InventoryCommand, InventoryResult } from "./contracts";

export async function executeInventoryAction(
  actorId: string,
  command: InventoryCommand,
  dealId: string | null,
  csrf: string | null,
): Promise<InventoryResult> {
  return invokeAction("features/inventory/actions.executeInventoryAction", [
    actorId,
    command,
    dealId,
    csrf,
  ]);
}
