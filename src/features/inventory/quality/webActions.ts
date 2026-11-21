"use server";

import { invokeAction } from "@/frontend/actions";
import type { QualityCommand, QualityCommandResult } from "./contracts";

export async function executeInventoryQualityAction(
  actorId: string,
  command: QualityCommand,
  csrf: string | null,
): Promise<QualityCommandResult> {
  return invokeAction("features/inventory/quality/webActions.executeInventoryQualityAction", [
    actorId,
    command,
    csrf,
  ]);
}
