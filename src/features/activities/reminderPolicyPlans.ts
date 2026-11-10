import type {
  Activity,
  activityReminderIntents,
  activityReminderSettings,
  calendarReminderDefaults,
} from "@/db/schema";
import {
  type AllDayReminderRule,
  DEFAULT_REMINDER_RULES,
  type PlannedReminder,
  planReminders,
  type ReminderDefaults,
  reminderDefaultsSchema,
  type TimedReminderRule,
} from "./reminderPolicy";
import { type ReminderRuleActivation, reminderRuleActivation } from "./reminderRuleActivation";

export type ReminderPlanChannel = "inApp" | "email";
export interface PersonalReminderPlan extends PlannedReminder {
  settingsId: string;
  settingsVersion: number;
  defaultsVersion: number;
  recipientId: string;
  authoredAt: number;
  activations: Record<ReminderPlanChannel, ReminderRuleActivation | null>;
}
type Entry = typeof activityReminderSettings.$inferSelect;
type Inherited = typeof calendarReminderDefaults.$inferSelect;
type Intent = typeof activityReminderIntents.$inferSelect;

function singleRuleSelection(rule: TimedReminderRule | AllDayReminderRule): ReminderDefaults {
  return "minutesBefore" in rule ? { timed: [rule], allDay: [] } : { timed: [], allDay: [rule] };
}

function mergeActivation(
  previous: ReminderRuleActivation | null,
  next: ReminderRuleActivation | null,
): ReminderRuleActivation | null {
  // Rules resolving to the same instant OR their channel eligibility. The minimum
  // cutoff and introduced revision express that union, including DST gap collisions.
  return previous === null || next === null
    ? null
    : { at: Math.min(previous.at, next.at), revision: Math.min(previous.revision, next.revision) };
}

export function personalReminderPolicyPlans(
  row: Activity,
  entry: Entry,
  inherited: Inherited | undefined,
): PersonalReminderPlan[] {
  const rules = reminderDefaultsSchema.safeParse(
    entry.useDefault ? (inherited?.rules ?? DEFAULT_REMINDER_RULES) : entry.rules,
  );
  if (!rules.success) return [];
  const event = {
    dueAt: row.dueAt,
    dueDate: row.dueDate,
    allDay: row.allDay,
    timeZone: row.eventTimeZone ?? entry.timeZone,
  };
  const authoredAt = Math.max(
    row.reminderAuthoredAt.getTime(),
    entry.source === "personal" ? entry.updatedAt.getTime() : Number.NEGATIVE_INFINITY,
  );
  const grouped = new Map<number, PersonalReminderPlan>();
  for (const rule of row.allDay ? rules.data.allDay : rules.data.timed) {
    const [planned] = planReminders(event, singleRuleSelection(rule));
    if (planned === undefined) continue;
    const channel = rule.method === "email" ? "email" : "inApp";
    const activation = entry.useDefault ? reminderRuleActivation(rule, inherited) : null;
    const plan: PersonalReminderPlan = grouped.get(planned.fireAt.getTime()) ?? {
      fireAt: planned.fireAt,
      inApp: false,
      email: false,
      settingsId: entry.id,
      settingsVersion: entry.version,
      defaultsVersion: entry.useDefault ? (inherited?.version ?? 0) : 0,
      recipientId: entry.userId,
      authoredAt,
      activations: { inApp: null, email: null },
    };
    plan.activations[channel] = plan[channel]
      ? mergeActivation(plan.activations[channel], activation)
      : activation;
    plan[channel] = true;
    grouped.set(plan.fireAt.getTime(), plan);
  }
  return [...grouped.values()].sort(
    (left, right) => left.fireAt.getTime() - right.fireAt.getTime(),
  );
}

export function reminderPlanChannelEligible(
  plan: PersonalReminderPlan,
  channel: ReminderPlanChannel,
  previous?: Intent,
): boolean {
  if (!plan[channel]) return false;
  const activation = plan.activations[channel];
  return (
    activation === null ||
    plan.fireAt.getTime() > activation.at ||
    plan.authoredAt >= activation.at ||
    (previous?.[channel] === true && previous.defaultsVersion >= activation.revision)
  );
}
