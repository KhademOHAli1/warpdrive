import { sql } from "drizzle-orm";
import { BACKOFF_START_MS, SYNC_CADENCE_SECONDS } from "@/constants/email";
import { EMAIL_JOB_RETRY_LIMIT, PGBOSS_QUEUE_EMAIL_SYNC } from "@/constants/jobNames";
import type { Db } from "@/db/client";

const RETRY_DELAY_SECONDS = Math.ceil(BACKOFF_START_MS / 1000);

export type PendingTickCount = (accountId: string) => Promise<number>;

interface SendsJobs {
  send: (
    queue: string,
    data: { accountId: string },
    options: Record<string, unknown>,
  ) => Promise<string | null>;
}

export function pendingTicksVia(db: Db): PendingTickCount {
  return async (accountId) => {
    const rows = await db.execute(sql`
      SELECT count(*)::int AS n FROM pgboss.job
      WHERE name=${PGBOSS_QUEUE_EMAIL_SYNC} AND singleton_key=${accountId} AND state='created'
    `);
    return (rows.rows[0] as { n: number } | undefined)?.n ?? 0;
  };
}

export async function reEnqueueSync(
  boss: SendsJobs,
  accountId: string,
  pendingTicks: PendingTickCount,
  options: { more?: boolean; deferred?: boolean; isEnabled?: () => Promise<boolean> } = {},
): Promise<void> {
  if (options.isEnabled && !(await options.isEnabled())) return;
  if ((await pendingTicks(accountId)) > 0) return;
  await boss.send(
    PGBOSS_QUEUE_EMAIL_SYNC,
    { accountId },
    {
      startAfter: options.deferred === true ? 5 : options.more === true ? 1 : SYNC_CADENCE_SECONDS,
      singletonKey: accountId,
      retryLimit: EMAIL_JOB_RETRY_LIMIT,
      retryBackoff: true,
      retryDelay: RETRY_DELAY_SECONDS,
    },
  );
}
