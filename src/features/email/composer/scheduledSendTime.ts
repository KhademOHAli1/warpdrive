import { isValidHm } from "@/components/ui/timeFormat";
import { wallTimeToInstant } from "@/lib/zonedDateTime";
import { err, ok, type Result } from "@/types/result";

export interface ScheduledSendDraft {
  date: string;
  time: string;
  timeZone: string;
}
export type ScheduleTimeError = "incomplete" | "invalid" | "nonexistent" | "past";
export interface ScheduledSendTime {
  at: Date;
  offset: string;
  ambiguous: boolean;
}

export function scheduledSendTime(
  draft: ScheduledSendDraft,
): Result<ScheduledSendTime, ScheduleTimeError> {
  if (draft.date === "" || draft.time === "") return err("incomplete");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !isValidHm(draft.time)) return err("invalid");
  try {
    const resolved = wallTimeToInstant(draft.date, draft.time, draft.timeZone);
    return ok({
      at: new Date(resolved.iso),
      offset: resolved.offset,
      ambiguous: resolved.ambiguous,
    });
  } catch (error) {
    return err(
      error instanceof RangeError && error.message === "nonexistent activity wall time"
        ? "nonexistent"
        : "invalid",
    );
  }
}

export function futureScheduledSendTime(
  draft: ScheduledSendDraft,
  now = Date.now(),
): Result<ScheduledSendTime, ScheduleTimeError> {
  const result = scheduledSendTime(draft);
  if (!result.ok) return result;
  if (!Number.isFinite(now) || result.value.at.getTime() <= now) return err("past");
  return result;
}
