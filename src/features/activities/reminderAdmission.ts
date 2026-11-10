import { and, eq } from "drizzle-orm";
import {
  type Activity,
  activityReminderSettings,
  calendarReminderDefaults,
  type calendarReminderIntents,
} from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { nativeReminderOwnsActivity } from "./calendarReminderOwnership";
import { mayReceivePersonalReminder } from "./reminderPolicies";
import {
  DEFAULT_REMINDER_RULES,
  reminderDefaultsSchema,
  reminderTemporalSignature,
} from "./reminderPolicy";
import {
  type PersonalReminderPlan,
  personalReminderPolicyPlans,
  reminderPlanChannelEligible,
} from "./reminderPolicyPlans";

type Intent = typeof calendarReminderIntents.$inferSelect;
function currentPlanAdmits(
  plans: PersonalReminderPlan[],
  intent: Intent,
  channel: "inApp" | "email" | undefined,
): boolean {
  const channels = channel === undefined ? (["inApp", "email"] as const) : [channel];
  return plans.some(
    (plan) =>
      plan.fireAt.getTime() === intent.fireAt.getTime() &&
      channels.some((kind) => intent[kind] && reminderPlanChannelEligible(plan, kind, intent)),
  );
}
// A pre-policy receipt has no revision to compare. Only the known untouched
// assignment default can coexist with it; authored or ambiguous policy waits for rebuild.
export async function canUseLegacyReminderPolicy(
  db: DbOrTx,
  activity: Activity,
  userId: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const [settings] = await db
    .select()
    .from(activityReminderSettings)
    .where(
      and(
        eq(activityReminderSettings.activityId, activity.id),
        eq(activityReminderSettings.userId, userId),
      ),
    );
  signal.throwIfAborted();
  if (
    settings !== undefined &&
    (settings.source !== "assignment" || !settings.useDefault || settings.version !== 0)
  )
    return false;
  if (activity.calendarId === null) return true;
  const [defaults] = await db
    .select({ userId: calendarReminderDefaults.userId })
    .from(calendarReminderDefaults)
    .where(
      and(
        eq(calendarReminderDefaults.calendarId, activity.calendarId),
        eq(calendarReminderDefaults.userId, userId),
      ),
    );
  signal.throwIfAborted();
  return defaults === undefined;
}

async function currentDefaultsPolicy(
  db: DbOrTx,
  activity: Activity,
  userId: string,
  signal: AbortSignal,
): Promise<typeof calendarReminderDefaults.$inferSelect | undefined> {
  if (activity.calendarId === null) return undefined;
  const [defaults] = await db
    .select()
    .from(calendarReminderDefaults)
    .where(
      and(
        eq(calendarReminderDefaults.calendarId, activity.calendarId),
        eq(calendarReminderDefaults.userId, userId),
      ),
    );
  signal.throwIfAborted();
  return defaults;
}

async function currentReminderPolicy(
  db: DbOrTx,
  activity: Activity,
  intent: Intent,
  signal: AbortSignal,
  channel?: "inApp" | "email",
): Promise<boolean> {
  const assigned = activity.assigneeId === intent.assigneeId && activity.reminderAutomationEnabled;
  if (intent.settingsId === null)
    return (
      assigned &&
      intent.settingsVersion === 0 &&
      intent.defaultsVersion === 0 &&
      (await canUseLegacyReminderPolicy(db, activity, intent.assigneeId, signal))
    );
  const [settings] = await db
    .select()
    .from(activityReminderSettings)
    .where(
      and(
        eq(activityReminderSettings.id, intent.settingsId),
        eq(activityReminderSettings.activityId, activity.id),
        eq(activityReminderSettings.userId, intent.assigneeId),
        eq(activityReminderSettings.version, intent.settingsVersion),
      ),
    );
  signal.throwIfAborted();
  if (settings === undefined || (settings.source === "assignment" && !assigned)) return false;
  const defaults = settings.useDefault
    ? await currentDefaultsPolicy(db, activity, intent.assigneeId, signal)
    : undefined;
  // The accepted intent owns its exact fire time while its policy revision is
  // unchanged. Only a newer default requires matching against replanned rules.
  const rules = settings.useDefault ? (defaults?.rules ?? DEFAULT_REMINDER_RULES) : settings.rules;
  if (!settings.useDefault || intent.defaultsVersion === (defaults?.version ?? 0))
    return reminderDefaultsSchema.safeParse(rules).success;
  // An unchanged rule remains valid before the rebuild catches up. Each channel
  // must independently match, so inbox eligibility can never authorize email.
  return currentPlanAdmits(
    personalReminderPolicyPlans(activity, settings, defaults),
    intent,
    channel,
  );
}

export async function admitReminderIntent(
  db: DbOrTx,
  activity: Activity,
  intent: Intent,
  signal: AbortSignal,
  channel?: "inApp" | "email",
): Promise<boolean> {
  signal.throwIfAborted();
  if (await nativeReminderOwnsActivity(db, activity.id, signal)) return false;
  if (channel !== undefined && !intent[channel]) return false;
  if (
    intent.activityId !== activity.id ||
    intent.state === "cancelled" ||
    activity.done ||
    activity.deletedAt !== null ||
    activity.dueAt?.getTime() !== intent.dueAt.getTime() ||
    (activity.allDay && intent.eventSignature === "") ||
    (intent.eventSignature !== "" && intent.eventSignature !== reminderTemporalSignature(activity))
  )
    return false;
  if (!(await currentReminderPolicy(db, activity, intent, signal, channel))) return false;
  return mayReceivePersonalReminder(db, activity, intent.assigneeId, signal);
}
