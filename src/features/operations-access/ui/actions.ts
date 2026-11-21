"use server";

import { invokeAction } from "@/frontend/actions";
import type { OperationsAccessCommand, OperationsAccessResult } from "../contracts";

export async function executeOperationsAccessAction(
  actorId: string,
  command: OperationsAccessCommand,
  csrf: string | null,
): Promise<OperationsAccessResult> {
  return invokeAction<OperationsAccessResult>(
    "features/operations-access/actions.executeOperationsAccessAction",
    [actorId, command, csrf],
  );
}
