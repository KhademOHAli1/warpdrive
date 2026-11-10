import { Temporal } from "@js-temporal/polyfill";
import { err, ok, type Result } from "@/types/result";
import { sameManualAction } from "./manualCommunicationEquality";
import type {
  ManualCommand,
  ManualContext,
  ManualFailure,
  ManualHead,
  ManualMutation,
  ManualReceipt,
} from "./manualCommunicationTypes";

function priorReplay(
  context: ManualContext,
  command: ManualCommand,
): Result<ManualMutation, ManualFailure> | null {
  const prior = context.priorIntent;
  if (prior === null) return null;
  const key = prior.state === "applied" ? prior.receipt : prior.key;
  if (
    key.recordedByUserId !== command.recordedByUserId ||
    key.action !== command.action ||
    key.mutationIntentId !== command.mutationIntentId ||
    prior.state === "deleted" ||
    context.current === null
  ) {
    return err("manual_intent_unavailable");
  }
  if (!sameManualAction(prior.request, command)) return err("manual_intent_conflict");
  return ok({
    snapshot: context.current,
    receipt: prior.receipt,
    appendEvent: null,
    replayed: true,
  });
}

function freshFailure(current: ManualHead, command: ManualCommand): ManualFailure | null {
  if (
    current.projectId !== command.projectId ||
    (command.action === "correct" && current.logId !== command.logId)
  ) {
    return "manual_target_conflict";
  }
  if (command.action === "record") return "manual_log_exists";
  if (current.revision !== command.expectedRevision) return "manual_revision_conflict";
  if (Temporal.Instant.compare(command.recordedAt, current.lastRecordedAt) < 0)
    return "manual_time_conflict";
  if (current.revision >= Number.MAX_SAFE_INTEGER) return "manual_revision_exhausted";
  return null;
}

function mutation(current: ManualHead | null, command: ManualCommand): ManualMutation {
  const previousRevision = current?.revision ?? 0;
  const receipt: ManualReceipt = {
    policyVersion: 1,
    provenance: "staff-recorded",
    action: command.action,
    mutationIntentId: command.mutationIntentId,
    projectId: command.projectId,
    logId: current?.logId ?? command.logId,
    personId: command.personId,
    previousPersonId: current?.personId ?? null,
    recordedByUserId: command.recordedByUserId,
    recordedAt: command.recordedAt,
    previousRevision,
    revision: previousRevision + 1,
    reason: command.action === "correct" ? command.reason : null,
  };
  const snapshot: ManualHead = {
    projectId: receipt.projectId,
    logId: receipt.logId,
    personId: receipt.personId,
    provenance: "staff-recorded",
    revision: receipt.revision,
    lastRecordedAt: command.recordedAt,
    declaration: command.declaration,
  };
  return {
    snapshot,
    receipt,
    replayed: false,
    appendEvent: {
      receipt,
      before:
        current === null ? null : { personId: current.personId, declaration: current.declaration },
      after: { personId: command.personId, declaration: command.declaration },
    },
  };
}

// Only validated private context/commands belong here. Native scope and atomic storage remain caller gates.
export function applyManualCommunicationCommand(
  context: ManualContext,
  command: ManualCommand,
): Result<ManualMutation, ManualFailure> {
  const replay = priorReplay(context, command);
  if (replay !== null) return replay;
  if (context.current === null) {
    return command.action === "record" ? ok(mutation(null, command)) : err("manual_log_missing");
  }
  const failure = freshFailure(context.current, command);
  return failure === null ? ok(mutation(context.current, command)) : err(failure);
}
