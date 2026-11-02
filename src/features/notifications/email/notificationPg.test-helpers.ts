import { setTimeout as delay } from "node:timers/promises";
import type { PoolClient } from "pg";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

const FIXTURE_WAIT_MS = 10_000;
const FIXTURE_POLL_MS = 20;

export async function waitForNotificationCondition(
  signal: AbortSignal,
  ready: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + FIXTURE_WAIT_MS;
  while (!(await ready())) {
    signal.throwIfAborted();
    if (Date.now() >= deadline)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Notification fixture barrier was not reached");
    await delay(FIXTURE_POLL_MS, undefined, { signal });
  }
}

export function waitForNotificationWaiters(
  controller: PoolClient,
  minimum: number,
  signal: AbortSignal,
): Promise<void> {
  return waitForNotificationCondition(signal, async () => {
    // This observer transaction predates new pool backends. Refresh its cached
    // backend enumeration before checking the actual lock queue.
    await controller.query("SELECT pg_stat_clear_snapshot()");
    signal.throwIfAborted();
    const rows = await controller.query<{ count: number }>(`SELECT count(*)::int AS count
      FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
      AND wait_event_type='Lock'`);
    return (rows.rows[0]?.count ?? 0) >= minimum;
  });
}

// Run every disposer even if a preceding boss stop or protocol close fails.
export async function disposeNotificationResources(
  ...actions: Array<(() => Promise<unknown>) | undefined>
): Promise<void> {
  const failures: unknown[] = [];
  for (const action of actions) {
    if (action === undefined) continue;
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}
