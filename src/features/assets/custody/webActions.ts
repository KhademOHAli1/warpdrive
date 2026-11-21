"use server";

import { invokeAction } from "@/frontend/actions";
import type { CustodyCommand, CustodyResult } from "./contracts";

export async function executeCustodyAction(
  actorId: string,
  command: CustodyCommand,
  csrf: string | null,
): Promise<CustodyResult> {
  return invokeAction("features/assets/custody/webActions.executeCustodyAction", [
    actorId,
    command,
    csrf,
  ]);
}
