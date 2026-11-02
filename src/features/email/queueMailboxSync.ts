import { EMAIL_JOB_RETRY_LIMIT, PGBOSS_QUEUE_EMAIL_SYNC } from "@/constants/jobNames";
import { getBoss } from "@/jobs/boss";

export async function queueMailboxSync(accountId: string, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const boss = getBoss();
  if (!boss) return false;
  await boss.createQueue(PGBOSS_QUEUE_EMAIL_SYNC);
  signal.throwIfAborted();
  const id = await boss.send(
    PGBOSS_QUEUE_EMAIL_SYNC,
    { accountId },
    {
      singletonKey: accountId,
      retryLimit: EMAIL_JOB_RETRY_LIMIT,
      retryBackoff: true,
    },
  );
  signal.throwIfAborted();
  return id !== null;
}
