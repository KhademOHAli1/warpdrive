"use server";

import { invokeAction } from "@/frontend/actions";
import type { WarehouseOperationsCommand, WarehouseOperationsResult } from "../contracts";

export async function executeWarehouseOperations(
  actorId: string,
  command: WarehouseOperationsCommand,
  csrf: string | null,
): Promise<WarehouseOperationsResult> {
  return invokeAction(
    "features/inventory/warehouse/operations/actions.executeWarehouseOperationsAction",
    [actorId, command, csrf],
  );
}
