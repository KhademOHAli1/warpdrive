"use server";

import { invokeAction } from "@/frontend/actions";
import type { KitCommand, KitResult } from "./contracts";

export async function executeKitAction(
  actorId: string,
  command: KitCommand,
  csrf: string | null,
): Promise<KitResult> {
  return invokeAction("features/assets/kits/webActions.executeKitAction", [actorId, command, csrf]);
}
