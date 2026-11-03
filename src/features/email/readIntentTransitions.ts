import { sql } from "drizzle-orm";
import type { ErrorId } from "@/constants/errorIds";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { READ_INTENT_COLUMNS, type ReadIntentKey, readIntentRow } from "./readIntentRows";
import type { StoredReadIntent } from "./readIntentTypes";

export type ReadIntentDisposition =
  | { state: "applied" }
  | { state: "denied" | "unknown"; errorId: ErrorId };

// Cancellation is a disposition of an unadmitted capability, never a claim
// that an already admitted database/provider operation has stopped.
export async function cancelPreparedReadIntent(
  tx: DbOrTx,
  key: ReadIntentKey,
  signal: AbortSignal,
): Promise<StoredReadIntent | null> {
  signal.throwIfAborted();
  const result = await tx.execute(sql`UPDATE email_read_intents
    SET state='cancelled',terminal_at=clock_timestamp()
    WHERE actor_id=${key.actorId} AND operation_id=${key.operationId} AND thread_id=${key.threadId}
      AND state='prepared'
    RETURNING ${READ_INTENT_COLUMNS}`);
  signal.throwIfAborted();
  return readIntentRow(result.rows);
}

export async function denyPreparedReadIntent(
  tx: DbOrTx,
  key: ReadIntentKey,
  errorId: ErrorId,
  signal: AbortSignal,
): Promise<StoredReadIntent | null> {
  signal.throwIfAborted();
  const result = await tx.execute(sql`UPDATE email_read_intents
    SET state='denied',terminal_at=clock_timestamp(),error_id=${errorId}
    WHERE actor_id=${key.actorId} AND operation_id=${key.operationId} AND thread_id=${key.threadId}
      AND state='prepared'
    RETURNING ${READ_INTENT_COLUMNS}`);
  signal.throwIfAborted();
  return readIntentRow(result.rows);
}

// The server caller creates this UUID before its owning transaction, so it can
// reconcile an uncertain claim COMMIT without dispatching a provider request.
export async function admitReadIntent(
  tx: DbOrTx,
  key: ReadIntentKey,
  serverClaim: string,
  signal: AbortSignal,
): Promise<StoredReadIntent | null> {
  signal.throwIfAborted();
  const result = await tx.execute(sql`UPDATE email_read_intents
    SET state='admitted',admitted_at=clock_timestamp(),dispatch_claim=${serverClaim}
    WHERE actor_id=${key.actorId} AND operation_id=${key.operationId} AND thread_id=${key.threadId}
      AND state='prepared' AND admit_before>clock_timestamp()
    RETURNING ${READ_INTENT_COLUMNS}`);
  signal.throwIfAborted();
  return readIntentRow(result.rows);
}

// Local marker + applied receipt share their caller's transaction. Remote
// uncertainty keeps its unique barrier; this helper cannot reassign a claim.
export async function finishReadIntent(
  tx: DbOrTx,
  key: ReadIntentKey,
  serverClaim: string,
  disposition: ReadIntentDisposition,
  signal: AbortSignal,
): Promise<StoredReadIntent | null> {
  signal.throwIfAborted();
  const errorId = disposition.state === "applied" ? null : disposition.errorId;
  const terminalAt = disposition.state === "unknown" ? sql`NULL` : sql`clock_timestamp()`;
  const result = await tx.execute(sql`UPDATE email_read_intents
    SET state=${disposition.state},terminal_at=${terminalAt},error_id=${errorId}
    WHERE actor_id=${key.actorId} AND operation_id=${key.operationId} AND thread_id=${key.threadId}
      AND state='admitted' AND dispatch_claim=${serverClaim}
    RETURNING ${READ_INTENT_COLUMNS}`);
  signal.throwIfAborted();
  return readIntentRow(result.rows);
}
