"use server";

import { invokeAction } from "@/frontend/actions";
import type { WarehouseCommand, WarehouseResult } from "./contracts";

export async function executeWarehouseAction(
  actorId: string,
  command: WarehouseCommand,
  csrf: string | null,
): Promise<WarehouseResult> {
  return invokeAction("features/inventory/warehouse/actions.executeWarehouseAction", [
    actorId,
    command,
    csrf,
  ]);
}
