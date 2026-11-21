"use server";

import { invokeAction } from "@/frontend/actions";
import type { ProductionCommand, ProductionEffect } from "../contracts";

export async function executeProductionAction(
  actorId: string,
  command: ProductionCommand,
  csrf: string | null,
): Promise<ProductionEffect> {
  return invokeAction("features/inventory/production/actions.executeProductionAction", [
    actorId,
    command,
    csrf,
  ]);
}
