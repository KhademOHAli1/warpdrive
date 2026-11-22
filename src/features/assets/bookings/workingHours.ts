import { Temporal } from "@js-temporal/polyfill";
import { civilDateRange } from "@/lib/zonedDateTime";
import type { BookingError, BookingPolicy, BookingRole, BookingWindow } from "./contracts";

type Hours = BookingPolicy["workingHours"]["weekly"][number]["hours"];
type Schedule = {
  weekly: Map<number, Hours>;
  overrides: Map<string, Hours>;
};

const minuteMs = 60_000;

function schedule(policy: BookingPolicy): Schedule {
  return {
    weekly: new Map(policy.workingHours.weekly.map(({ weekday, hours }) => [weekday, hours])),
    overrides: new Map(policy.workingHours.overrides.map(({ date, hours }) => [date, hours])),
  };
}

function hoursOn(date: Temporal.PlainDate, rules: Schedule): Hours {
  const key = date.toString();
  if (rules.overrides.has(key)) return rules.overrides.get(key) ?? null;
  return rules.weekly.get(date.dayOfWeek) ?? null;
}

function atCounter(at: Temporal.ZonedDateTime, rules: Schedule) {
  const hours = hoursOn(at.toPlainDate(), rules);
  if (hours === null) return false;
  const time = at.toPlainTime().toString({ smallestUnit: "millisecond" });
  return time >= `${hours.opensAt}:00.000` && time <= `${hours.closesAt}:00.000`;
}

function spanOn(
  date: Temporal.PlainDate,
  next: Temporal.PlainDate,
  pickup: Temporal.ZonedDateTime,
  due: Temporal.ZonedDateTime,
) {
  const { from, to } = civilDateRange(date.toString(), next.toString(), pickup.timeZoneId);
  const start = Math.max(from.getTime(), pickup.epochMilliseconds);
  const end = Math.min(to.getTime(), due.epochMilliseconds);
  return Math.max(0, end - start);
}

function openDaysExceed(
  pickup: Temporal.ZonedDateTime,
  due: Temporal.ZonedDateTime,
  limit: number,
  rules: Schedule,
) {
  const start = pickup.toPlainDate();
  const end = due.toPlainDate();
  let elapsed = 0;
  if ([...rules.weekly.values()].every((hours) => hours === null)) {
    for (const [key, hours] of rules.overrides) {
      if (hours === null) continue;
      const day = Temporal.PlainDate.from(key);
      if (Temporal.PlainDate.compare(day, start) < 0 || Temporal.PlainDate.compare(day, end) > 0)
        continue;
      elapsed += spanOn(day, day.add({ days: 1 }), pickup, due);
    }
    return elapsed > limit;
  }
  for (let day = start; Temporal.PlainDate.compare(day, end) <= 0; day = day.add({ days: 1 })) {
    if (hoursOn(day, rules) === null) continue;
    elapsed += spanOn(day, day.add({ days: 1 }), pickup, due);
    if (elapsed > limit) return true;
  }
  return false;
}

export function validateBookingWindow(
  policy: BookingPolicy,
  window: BookingWindow,
  role: BookingRole,
  at: string,
): Extract<BookingError, "invalid" | "closed_hours" | "insufficient_notice" | "duration"> | null {
  const pickup = Temporal.Instant.from(window.startAt).toZonedDateTimeISO(policy.timeZone);
  const due = Temporal.Instant.from(window.endAt).toZonedDateTimeISO(policy.timeZone);
  const now = Temporal.Instant.from(at).epochMilliseconds;
  if (pickup.epochMilliseconds >= due.epochMilliseconds || due.epochMilliseconds <= now)
    return "invalid";
  const rules = schedule(policy);
  if (policy.workingHours.enabled && (!atCounter(pickup, rules) || !atCounter(due, rules)))
    return "closed_hours";
  if (role === "manager") return null;
  const notice = pickup.epochMilliseconds - now;
  if (notice < policy.minNoticeMinutes * minuteMs) return "insufficient_notice";
  if (policy.maxDurationMinutes === null) return null;
  const limit = policy.maxDurationMinutes * minuteMs;
  const exceeds =
    policy.workingHours.enabled && policy.skipClosedDays
      ? openDaysExceed(pickup, due, limit, rules)
      : due.epochMilliseconds - pickup.epochMilliseconds > limit;
  return exceeds ? "duration" : null;
}
