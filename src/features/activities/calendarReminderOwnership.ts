import { and, eq } from "drizzle-orm";
import { activityReminderIntents, activityReminderSettings } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";

// A calendar rebuild never acquires delivery authority from a native generation.
// Even explicit native "none" remains an authored native choice.
export async function nativeReminderOwnsActivity(
  db: DbOrTx,
  activityId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const [native] = await db
    .select({ managed: activityReminderIntents.managed })
    .from(activityReminderIntents)
    .where(eq(activityReminderIntents.activityId, activityId));
  signal.throwIfAborted();
  return native?.managed === true;
}

export async function personalReminderOwnsAssignee(
  db: DbOrTx,
  activityId: string,
  assigneeId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const [personal] = await db
    .select({ id: activityReminderSettings.id })
    .from(activityReminderSettings)
    .where(
      and(
        eq(activityReminderSettings.activityId, activityId),
        eq(activityReminderSettings.userId, assigneeId),
        eq(activityReminderSettings.source, "personal"),
      ),
    );
  signal.throwIfAborted();
  return personal !== undefined;
}
