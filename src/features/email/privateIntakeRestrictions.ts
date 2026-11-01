import { type SQLWrapper, sql } from "drizzle-orm";

// A local review never changes this restriction. Only canonical confirmation
// can release it; purged observations keep their minimal protected tombstone.
export function privateIntakeBlocksThread(
  accountId: SQLWrapper | string,
  threadId: SQLWrapper | string,
) {
  return sql<boolean>`EXISTS(SELECT 1 FROM email_private_intake private_intake
    WHERE private_intake.account_id=${accountId} AND private_intake.baseline_thread_id=${threadId}
      AND private_intake.intake_state<>'confirmed_notification')`;
}
