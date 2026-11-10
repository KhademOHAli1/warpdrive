import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { ReadIntentBinding, ReadIntentReceipt, StoredReadIntent } from "./readIntentTypes";

export interface ReadIntentKey {
  actorId: string;
  operationId: string;
  threadId: string;
}

export const READ_INTENT_COLUMNS = sql`
  actor_id AS "actorId", operation_id AS "operationId", account_id AS "accountId",
  thread_id AS "threadId", mailbox_owner_id AS "mailboxOwnerId",
  account_provider AS "accountProvider", connection_generation AS "connectionGeneration",
  private_copy AS "privateCopy", desired_read AS "desiredRead", read_mode AS "readMode",
  state, created_at AS "createdAt", admit_before AS "admitBefore",
  admitted_at AS "admittedAt", terminal_at AS "terminalAt",
  dispatch_claim AS "dispatchClaim", error_id AS "errorId"`;

export function readIntentRow(rows: readonly Record<string, unknown>[]): StoredReadIntent | null {
  return (rows[0] as unknown as StoredReadIntent | undefined) ?? null;
}

function publicReceiptTimestamp(value: unknown): string {
  // Normalize only the public DTO. Raw SQL timestamps retain their microseconds
  // and remain outside JavaScript's millisecond precision for authority checks.
  const timestamp =
    value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (timestamp === null || !Number.isFinite(timestamp.getTime()))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Read intent receipt timestamp is invalid");
  return timestamp.toISOString();
}

export function readIntentReceipt(intent: StoredReadIntent): ReadIntentReceipt {
  return {
    operationId: intent.operationId,
    threadId: intent.threadId,
    desiredRead: intent.desiredRead,
    state: intent.state,
    admitBefore: publicReceiptTimestamp(intent.admitBefore),
    ...(intent.errorId === null ? {} : { errorId: intent.errorId }),
  };
}

export function sameReadIntentBinding(a: ReadIntentBinding, b: ReadIntentBinding): boolean {
  return (
    a.actorId === b.actorId &&
    a.accountId === b.accountId &&
    a.threadId === b.threadId &&
    a.mailboxOwnerId === b.mailboxOwnerId &&
    a.accountProvider === b.accountProvider &&
    a.connectionGeneration === b.connectionGeneration &&
    a.privateCopy === b.privateCopy &&
    a.desiredRead === b.desiredRead &&
    a.readMode === b.readMode
  );
}
