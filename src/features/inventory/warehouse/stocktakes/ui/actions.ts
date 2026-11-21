"use server";

import { invokeAction } from "@/frontend/actions";
import type { StocktakeCommand, StocktakeCommandResult } from "../contracts";

export async function executeStocktakeAction(
  actorId: string,
  command: StocktakeCommand,
  csrf: string | null,
): Promise<StocktakeCommandResult> {
  return invokeAction("features/inventory/warehouse/stocktakes/actions.executeStocktakeAction", [
    actorId,
    command,
    csrf,
  ]);
}
