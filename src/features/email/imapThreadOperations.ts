import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AuthUser } from "@/features/permissions/types";
import { err, ok, type Result } from "@/types/result";
import { guardImapConnection } from "./imapSyncGuard";
import { imapOperationLocators, loadImapOperation } from "./imapThreadOperationsContext";
import { writeImapMoveState } from "./imapThreadOperationsMove";
import { persistImapMoveState } from "./imapThreadOperationsMoveStore";
import { writeImapReadState } from "./imapThreadOperationsRead";
import { persistImapReadState } from "./imapThreadOperationsStore";
import type {
  ImapNetworkOutcome,
  ImapThreadOperation,
  ImapThreadOperationDeps,
  ImapThreadOperationValue,
} from "./imapThreadOperationsTypes";
import { type ImapConnectionRuntime, isMailConnectionCurrent } from "./mailConnectionRuntime";
import { lockMailRemoteWrites } from "./mailRemoteWriteLock";
import { privateIntakeImapMutationCurrent } from "./privateIntakeImapMutationFence";
import { recordReadIntentRemoteFailure } from "./readIntentRemoteFailure";
import {
  finishReadIntentRemoteOutcome,
  lockReadIntentRemoteOutcome,
  type ReadIntentRemoteDispatch,
  readIntentRemoteCurrent,
  readIntentRemoteRuntimeMatches,
} from "./readIntentRemoteReceipt";
import { readIntentRemoteFailureResult } from "./readIntentRemoteResult";

function writeFailure(outcome: ImapNetworkOutcome): AppError | null {
  if (outcome.failure === null) return null;
  const kind = outcome.failure.kind;
  const id =
    outcome.confirmed.length > 0
      ? ERROR_IDS.MAIL_WRITE_PARTIAL
      : kind === "mutation_unknown"
        ? ERROR_IDS.MAIL_WRITE_UNKNOWN
        : kind === "read_only" || kind === "unsupported"
          ? ERROR_IDS.MAIL_CAPABILITY_DENIED
          : kind === "connection_changed" || kind === "uidvalidity_changed"
            ? ERROR_IDS.MAIL_CONNECTION_CHANGED
            : ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE;
  return new AppError(id, "remote mailbox update unavailable");
}

interface OperationArgs {
  actor: AuthUser;
  threadId: string;
  operation: ImapThreadOperation;
}

async function executeImapThreadOperation(
  db: Db,
  runtime: ImapConnectionRuntime,
  args: OperationArgs,
  signal: AbortSignal,
  state: { attempted: boolean },
  readIntent?: ReadIntentRemoteDispatch,
): Promise<Result<ImapThreadOperationValue, AppError>> {
  return db.transaction(
    async (tx) => {
      const beforeMutation = async (currentSignal: AbortSignal) =>
        (readIntent === undefined ||
          (await readIntentRemoteCurrent(tx, readIntent, currentSignal))) &&
        (await privateIntakeImapMutationCurrent(tx, runtime, args.threadId, currentSignal));
      await lockMailRemoteWrites(tx, runtime.accountId, signal);
      if (!(await isMailConnectionCurrent(tx, runtime, signal)))
        return err(new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "mailbox changed"));
      if (!(await beforeMutation(signal)))
        return err(new AppError(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found"));
      const rows = await imapOperationLocators(tx, runtime.accountId, args.threadId, signal);
      if (!rows.ok) return rows;
      state.attempted = true;
      const outcome =
        args.operation.kind === "read"
          ? await writeImapReadState(
              runtime,
              rows.value,
              args.operation.read,
              signal,
              beforeMutation,
            )
          : await writeImapMoveState(runtime, rows.value, args.operation, signal, beforeMutation);
      // Provider work has ended before acquiring native/session parent locks.
      if (readIntent !== undefined && !(await lockReadIntentRemoteOutcome(tx, readIntent, signal)))
        throw new AppError(ERROR_IDS.MAIL_WRITE_UNKNOWN, "Read outcome authority changed");
      if (!(await guardImapConnection(tx, runtime, signal)))
        return err(new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "mailbox changed"));
      if (args.operation.kind === "read")
        await persistImapReadState(
          tx,
          runtime,
          args.threadId,
          outcome,
          args.operation.read,
          signal,
        );
      else if (!(await persistImapMoveState(tx, runtime, args.threadId, outcome, signal)))
        outcome.failure = { kind: "protocol" };
      if (readIntent !== undefined) {
        const receipt = await finishReadIntentRemoteOutcome(tx, readIntent, outcome, signal);
        if (receipt.state !== "applied")
          return err(
            new AppError(receipt.errorId ?? ERROR_IDS.MAIL_WRITE_UNKNOWN, "Read not confirmed"),
          );
        return ok({ threadId: args.threadId, readIntent: receipt });
      }
      const failure = writeFailure(outcome);
      return failure === null
        ? ok({
            threadId: args.threadId,
            ...(outcome.requiresResync === true ? { requiresResync: true } : {}),
          })
        : err(failure);
    },
    { isolationLevel: "read committed" },
  );
}

export async function runImapThreadOperation(
  db: Db,
  args: OperationArgs,
  signal: AbortSignal,
  deps: ImapThreadOperationDeps = {},
): Promise<Result<ImapThreadOperationValue, AppError>> {
  const state = { attempted: false };
  let result: Result<ImapThreadOperationValue, AppError>;
  try {
    const loaded = await loadImapOperation(db, args.actor, args.threadId, signal, deps);
    if (!loaded.ok) result = loaded;
    else if (
      deps.readIntent !== undefined &&
      !readIntentRemoteRuntimeMatches(deps.readIntent, loaded.value, args.threadId, args.operation)
    )
      result = err(new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "Read intent mailbox changed"));
    else
      result = await executeImapThreadOperation(
        db,
        loaded.value,
        args,
        signal,
        state,
        deps.readIntent,
      );
  } catch {
    if (deps.readIntent === undefined) signal.throwIfAborted();
    result = err(
      new AppError(
        state.attempted ? ERROR_IDS.MAIL_WRITE_UNKNOWN : ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE,
        "remote mailbox update unavailable",
      ),
    );
  }
  if (deps.readIntent !== undefined && !result.ok) {
    const receipt = await recordReadIntentRemoteFailure(
      db,
      deps.readIntent,
      result.error.id,
      state.attempted,
    );
    return readIntentRemoteFailureResult(result, receipt);
  }
  return result;
}
