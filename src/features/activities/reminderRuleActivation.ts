import { z } from "zod";
import {
  type AllDayReminderRule,
  DEFAULT_REMINDER_RULES,
  type ReminderDefaults,
  reminderDefaultsSchema,
  type TimedReminderRule,
} from "./reminderPolicy";

export interface ReminderRuleActivation {
  at: number;
  revision: number;
}
export type RuleActivations = Record<string, ReminderRuleActivation>;
type Rule = TimedReminderRule | AllDayReminderRule;
export interface ReminderRuleActivationSource {
  rules: unknown;
  ruleActivations?: unknown;
  updatedAt: Date;
  version: number;
}
const activationSchema = z.object({
  at: z.number().finite().nonnegative(),
  revision: z.number().int().nonnegative(),
});
const activationsSchema = z.record(z.string(), activationSchema);

// Explicit tuple fields keep keys independent from JSONB object-property ordering.
export function reminderRuleKey(rule: Rule): string {
  return "minutesBefore" in rule
    ? JSON.stringify(["timed", rule.method, rule.minutesBefore])
    : JSON.stringify(["allDay", rule.method, rule.daysBefore, rule.time]);
}

export function reminderRuleActivation(
  rule: Rule,
  inherited?: ReminderRuleActivationSource,
): ReminderRuleActivation | null {
  if (inherited === undefined) return null;
  const parsed = activationsSchema.safeParse(inherited.ruleActivations);
  return (
    (parsed.success ? parsed.data[reminderRuleKey(rule)] : undefined) ?? {
      at: inherited.updatedAt.getTime(),
      revision: inherited.version,
    }
  );
}

export function advanceReminderRuleActivations(
  previous: ReminderRuleActivationSource | undefined,
  next: ReminderDefaults,
  revision: number,
  at: number,
): RuleActivations {
  // The product defaults already apply before a user's first saved row. Retaining
  // one of those rules must not revoke work accepted under revision zero.
  const baseline = previous ?? {
    rules: DEFAULT_REMINDER_RULES,
    updatedAt: new Date(0),
    version: 0,
  };
  const old = reminderDefaultsSchema.safeParse(baseline.rules);
  const retained = new Set(
    old.success ? [...old.data.timed, ...old.data.allDay].map(reminderRuleKey) : [],
  );
  const result: RuleActivations = {};
  for (const rule of [...next.timed, ...next.allDay]) {
    result[reminderRuleKey(rule)] =
      // Removed keys are omitted, so a later re-add cannot inherit old eligibility.
      retained.has(reminderRuleKey(rule))
        ? (reminderRuleActivation(rule, baseline) ?? { at, revision })
        : { at, revision };
  }
  return result;
}
