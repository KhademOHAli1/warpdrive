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
} from "./imapThreadOperationsTypes";
import { type ImapConnectionRuntime, isMailConnectionCurrent } from "./mailConnectionRuntime";
import { lockMailRemoteWrites } from "./mailRemoteWriteLock";

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
): Promise<Result<{ threadId: string; requiresResync?: boolean }, AppError>> {
  return db.transaction(async (tx) => {
    await lockMailRemoteWrites(tx, runtime.accountId, signal);
    if (!(await isMailConnectionCurrent(tx, runtime, signal)))
      return err(new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "mailbox changed"));
    const rows = await imapOperationLocators(tx, runtime.accountId, args.threadId, signal);
    if (!rows.ok) return rows;
    state.attempted = true;
    const outcome =
      args.operation.kind === "read"
        ? await writeImapReadState(tx, runtime, rows.value, args.operation.read, signal)
        : await writeImapMoveState(tx, runtime, rows.value, args.operation, signal);
    if (!(await guardImapConnection(tx, runtime, signal)))
      return err(new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "mailbox changed"));
    if (args.operation.kind === "read")
      await persistImapReadState(tx, runtime, args.threadId, outcome, args.operation.read, signal);
    else if (!(await persistImapMoveState(tx, runtime, args.threadId, outcome, signal)))
      outcome.failure = { kind: "protocol" };
    const failure = writeFailure(outcome);
    return failure === null
      ? ok({
          threadId: args.threadId,
          ...(outcome.requiresResync === true ? { requiresResync: true } : {}),
        })
      : err(failure);
  });
}

export async function runImapThreadOperation(
  db: Db,
  args: OperationArgs,
  signal: AbortSignal,
  deps: ImapThreadOperationDeps = {},
): Promise<Result<{ threadId: string; requiresResync?: boolean }, AppError>> {
  const state = { attempted: false };
  try {
    const loaded = await loadImapOperation(db, args.actor, args.threadId, signal, deps);
    if (!loaded.ok) return loaded;
    return await executeImapThreadOperation(db, loaded.value, args, signal, state);
  } catch {
    signal.throwIfAborted();
    return err(
      new AppError(
        state.attempted ? ERROR_IDS.MAIL_WRITE_UNKNOWN : ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE,
        "remote mailbox update unavailable",
      ),
    );
  }
}
