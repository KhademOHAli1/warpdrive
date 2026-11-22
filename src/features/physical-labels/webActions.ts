"use server";

import { invokeAction } from "@/frontend/actions";
import type { LabelCommand, LabelResult, ScanInput, ScanResult } from "./contracts";

export async function executePhysicalLabelAction(
  actorId: string,
  command: LabelCommand,
  csrf: string | null,
): Promise<LabelResult> {
  return invokeAction("features/physical-labels/webActions.executePhysicalLabelAction", [
    actorId,
    command,
    csrf,
  ]);
}

export async function resolvePhysicalLabelAction(
  actorId: string,
  input: ScanInput,
  csrf: string | null,
): Promise<ScanResult> {
  return invokeAction("features/physical-labels/webActions.resolvePhysicalLabelAction", [
    actorId,
    input,
    csrf,
  ]);
}
