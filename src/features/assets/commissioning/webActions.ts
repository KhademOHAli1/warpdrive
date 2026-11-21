"use server";

import { invokeAction } from "@/frontend/actions";
import type { CommissionAssetCommand, CommissionAssetResult } from "./contracts";

export async function executeCommissionAssetAction(
  actorId: string,
  command: CommissionAssetCommand,
  csrf: string | null,
): Promise<CommissionAssetResult> {
  return invokeAction("features/assets/commissioning/webActions.executeCommissionAssetAction", [
    actorId,
    command,
    csrf,
  ]);
}
