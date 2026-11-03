import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { READ_INTENT_COLUMNS, type ReadIntentKey, readIntentRow } from "./readIntentRows";
import type { ReadIntentBinding, StoredReadIntent } from "./readIntentTypes";

export { type ReadIntentKey, readIntentReceipt, sameReadIntentBinding } from "./readIntentRows";
export {
  admitReadIntent,
  cancelPreparedReadIntent,
  denyPreparedReadIntent,
  finishReadIntent,
  type ReadIntentDisposition,
} from "./readIntentTransitions";

const READ_INTENT_ADMISSION_MS = 30_000;

export interface PreparedReadIntent {
  kind: "created" | "blocked";
  intent: StoredReadIntent;
}

// The caller holds current parent authority and owns this transaction. The
// partial unique index is the admission barrier, including concurrent prepare.
export async function prepareReadIntent(
  tx: DbOrTx,
  binding: ReadIntentBinding,
  signal: AbortSignal,
): Promise<PreparedReadIntent | null> {
  signal.throwIfAborted();
  await tx.execute(sql`UPDATE email_read_intents
    SET state='cancelled',terminal_at=clock_timestamp()
    WHERE actor_id=${binding.actorId} AND thread_id=${binding.threadId}
      AND state='prepared' AND admit_before<=clock_timestamp()`);
  signal.throwIfAborted();
  const inserted = await tx.execute(sql`WITH instant AS (
      SELECT clock_timestamp() AS observed_at
    ) INSERT INTO email_read_intents (
      actor_id,account_id,thread_id,mailbox_owner_id,account_provider,
      connection_generation,private_copy,desired_read,read_mode,created_at,admit_before
    ) SELECT ${binding.actorId},${binding.accountId},${binding.threadId},
      ${binding.mailboxOwnerId},${binding.accountProvider},${binding.connectionGeneration},
      ${binding.privateCopy},${binding.desiredRead},${binding.readMode},
      instant.observed_at,instant.observed_at+${READ_INTENT_ADMISSION_MS}*interval '1 millisecond'
    FROM instant
    ON CONFLICT (actor_id,thread_id) WHERE state IN ('prepared','admitted','unknown')
    DO NOTHING RETURNING ${READ_INTENT_COLUMNS}`);
  signal.throwIfAborted();
  const created = readIntentRow(inserted.rows);
  if (created !== null) return { kind: "created", intent: created };

  const existing = await tx.execute(sql`SELECT ${READ_INTENT_COLUMNS}
    FROM email_read_intents
    WHERE actor_id=${binding.actorId} AND thread_id=${binding.threadId}
      AND state IN ('prepared','admitted','unknown')
    FOR UPDATE`);
  signal.throwIfAborted();
  const blocked = readIntentRow(existing.rows);
  // A concurrent operation may have become terminal after the insert conflict.
  // Return no capability; never manufacture a new command or take over a claim.
  return blocked === null ? null : { kind: "blocked", intent: blocked };
}

export async function loadReadIntent(
  db: DbOrTx,
  key: ReadIntentKey,
  signal: AbortSignal,
): Promise<StoredReadIntent | null> {
  signal.throwIfAborted();
  const result = await db.execute(sql`SELECT ${READ_INTENT_COLUMNS} FROM email_read_intents
    WHERE actor_id=${key.actorId} AND operation_id=${key.operationId} AND thread_id=${key.threadId}`);
  signal.throwIfAborted();
  return readIntentRow(result.rows);
}

export async function lockReadIntent(
  tx: DbOrTx,
  key: ReadIntentKey,
  signal: AbortSignal,
): Promise<StoredReadIntent | null> {
  signal.throwIfAborted();
  const result = await tx.execute(sql`SELECT ${READ_INTENT_COLUMNS} FROM email_read_intents
    WHERE actor_id=${key.actorId} AND operation_id=${key.operationId} AND thread_id=${key.threadId}
    FOR UPDATE`);
  signal.throwIfAborted();
  return readIntentRow(result.rows);
}
