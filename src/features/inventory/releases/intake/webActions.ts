"use server";

import { invokeAction } from "@/frontend/actions";
import type {
  ExportIntakeJob,
  ExportIntakeResult,
  PreparedExportIntake,
  PrepareExportIntakeInput,
  QueueExportIntakeInput,
  RetryExportIntakeInput,
} from "./contracts";

export async function prepareExportIntakeAction(
  actorId: string,
  input: PrepareExportIntakeInput,
  csrfToken: string | null,
): Promise<ExportIntakeResult<PreparedExportIntake>> {
  return invokeAction("features/inventory/releases/intake.prepareExportIntakeAction", [
    actorId,
    input,
    csrfToken,
  ]);
}

export async function queueExportIntakeAction(
  actorId: string,
  input: QueueExportIntakeInput,
  csrfToken: string | null,
): Promise<ExportIntakeResult<ExportIntakeJob>> {
  return invokeAction("features/inventory/releases/intake.queueExportIntakeAction", [
    actorId,
    input,
    csrfToken,
  ]);
}

export async function retryExportIntakeAction(
  actorId: string,
  input: RetryExportIntakeInput,
  csrfToken: string | null,
): Promise<ExportIntakeResult<ExportIntakeJob>> {
  return invokeAction("features/inventory/releases/intake.retryExportIntakeAction", [
    actorId,
    input,
    csrfToken,
  ]);
}
