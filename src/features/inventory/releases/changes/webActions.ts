"use server";

import { invokeAction } from "@/frontend/actions";
import type {
  EngineeringChangeCommand,
  EngineeringChangeResult,
  EngineeringChangeWorkspace,
} from "./contracts";

export async function executeEngineeringChangeAction(
  actorId: string,
  input: EngineeringChangeCommand,
  csrfToken: string | null,
): Promise<EngineeringChangeResult<EngineeringChangeWorkspace>> {
  return invokeAction("features/inventory/releases/changes.executeEngineeringChangeAction", [
    actorId,
    input,
    csrfToken,
  ]);
}
