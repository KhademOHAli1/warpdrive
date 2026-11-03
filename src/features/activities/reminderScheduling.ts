import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { ActivityReminderIntent } from "@/db/schema/activityReminderIntents";
import { activityReminderIntents } from "@/db/schema/activityReminderIntents";
import { requireBoss } from "@/jobs/requireBoss";

export const NATIVE_ACTIVITY_REMINDER_QUEUE = "activity.reminder.native.v1";
export const NATIVE_ACTIVITY_REMINDER_RECONCILE_QUEUE = "activity.reminder.reconcile.v1";

async function enqueueIntent(boss: PgBoss, intent: ActivityReminderIntent): Promise<void> {
  if (!intent.managed || intent.version !== 1 || intent.channel !== "in_app") return;
  if (intent.status !== "pending" && intent.status !== "failed") return;
  if (intent.fireAt === null) return;
  const start = Math.max(intent.fireAt.getTime(), intent.nextAttemptAt?.getTime() ?? 0);
  if (!Number.isFinite(start)) return;
  await boss.send(
    NATIVE_ACTIVITY_REMINDER_QUEUE,
    { v: 1, activityId: intent.activityId, generationId: intent.generationId },
    {
      startAfter: new Date(start),
      singletonKey: intent.generationId,
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
    },
  );
}

// Queue admission is a nudge of already-committed intent, never the save receipt.
// The worker's real DB scan recovers when this process/boss/response callback fails.
export async function nudgeActivityReminder(
  db: Db,
  activityId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    signal.throwIfAborted();
    const [intent] = await db
      .select()
      .from(activityReminderIntents)
      .where(eq(activityReminderIntents.activityId, activityId));
    signal.throwIfAborted();
    if (
      intent === undefined ||
      !intent.managed ||
      intent.version !== 1 ||
      (intent.status !== "pending" && intent.status !== "failed")
    )
      return;
    const boss = requireBoss();
    if (boss !== null) await enqueueIntent(boss, intent);
  } catch {
    console.warn("Native reminder nudge unavailable; durable intent retained", {
      errorId: ERROR_IDS.JOBS_BOSS_MISSING,
    });
  }
}

// Only due, retry-eligible rows compete for a bounded scan. Future intents cannot
// starve due recovery, and queue completion/singleton keys are not delivery receipts.
export async function reconcileActivityReminders(
  db: Db,
  boss: PgBoss,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const due = await db
    .select()
    .from(activityReminderIntents)
    .where(
      and(
        eq(activityReminderIntents.managed, true),
        eq(activityReminderIntents.version, 1),
        inArray(activityReminderIntents.status, ["pending", "failed"]),
        isNotNull(activityReminderIntents.fireAt),
        lte(activityReminderIntents.fireAt, sql`clock_timestamp()`),
        or(
          isNull(activityReminderIntents.nextAttemptAt),
          lte(activityReminderIntents.nextAttemptAt, sql`clock_timestamp()`),
        ),
      ),
    )
    .orderBy(
      asc(
        sql`coalesce(${activityReminderIntents.nextAttemptAt}, ${activityReminderIntents.fireAt})`,
      ),
      asc(activityReminderIntents.activityId),
    )
    .limit(100);
  for (const intent of due) {
    signal.throwIfAborted();
    await enqueueIntent(boss, intent);
  }
}
