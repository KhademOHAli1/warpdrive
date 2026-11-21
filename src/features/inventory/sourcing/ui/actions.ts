"use server";

import { invokeAction } from "@/frontend/actions";
import type { SourcingCommand, SourcingCommandResult } from "../contracts";

export async function executeSourcingAction(
  actorId: string,
  command: SourcingCommand,
  csrf: string | null,
): Promise<SourcingCommandResult> {
  return invokeAction("features/inventory/sourcing/actions.executeSourcingAction", [
    actorId,
    command,
    csrf,
  ]);
}
