import { Temporal } from "@js-temporal/polyfill";
import { sameManualDeclaration } from "./manualCommunicationEquality";
import { manualContextShapeSchema } from "./manualCommunicationSchemas";
import type {
  ManualAction,
  ManualContext,
  ManualHead,
  ManualReceipt,
} from "./manualCommunicationTypes";

function receiptBindsRequest(request: ManualAction, receipt: ManualReceipt): boolean {
  if (
    receipt.action !== request.action ||
    receipt.mutationIntentId !== request.mutationIntentId ||
    receipt.projectId !== request.projectId ||
    receipt.personId !== request.personId
  )
    return false;
  if (request.action === "record") return true;
  return (
    receipt.logId === request.logId &&
    receipt.previousRevision === request.expectedRevision &&
    receipt.reason === request.reason
  );
}

function receiptFitsHead(
  request: ManualAction,
  receipt: ManualReceipt,
  current: ManualHead,
): boolean {
  if (
    receipt.projectId !== current.projectId ||
    receipt.logId !== current.logId ||
    receipt.revision > current.revision ||
    Temporal.Instant.compare(receipt.recordedAt, current.lastRecordedAt) > 0
  )
    return false;
  if (receipt.revision !== current.revision) return true;
  return (
    receipt.personId === current.personId &&
    receipt.recordedAt === current.lastRecordedAt &&
    sameManualDeclaration(request.declaration, current.declaration)
  );
}

function coherentContext(context: ManualContext): boolean {
  try {
    const { current, priorIntent } = context;
    if (
      current !== null &&
      Temporal.Instant.compare(current.declaration.occurredAt, current.lastRecordedAt) > 0
    ) {
      return false;
    }
    if (priorIntent === null || priorIntent.state === "deleted") return true;
    const { request, receipt } = priorIntent;
    if (
      !receiptBindsRequest(request, receipt) ||
      Temporal.Instant.compare(request.declaration.occurredAt, receipt.recordedAt) > 0
    )
      return false;
    return current === null || receiptFitsHead(request, receipt, current);
  } catch {
    return false;
  }
}

// Local coherence is not evidence of an authorized or atomically complete persisted lookup.
export const manualContextSchema = manualContextShapeSchema.refine(coherentContext, {
  message: "Incoherent manual communication context",
});
