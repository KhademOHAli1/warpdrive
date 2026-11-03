import { after } from "next/server";
import { db } from "@/db/client";
import type { Activity } from "@/db/schema/activities";
import { SIG } from "@/features/identity/actions/sig";
import { notifyOnActivityCreated } from "./notifyHelpers";
import { nudgeActivityReminder } from "./reminderScheduling";

// Use only after the native authority transaction has committed. The callback
// does not acknowledge notification/email delivery and cannot change event-save
// success. Boot/minutely reconciliation covers an absent/interrupted callback.
export function afterCalendarCommit(
  activityId: string,
  created?: { activity: Activity; actorId: string },
): void {
  try {
    after(async () => {
      await nudgeActivityReminder(db, activityId, SIG());
      if (created !== undefined) await notifyOnActivityCreated(db, { ...created, signal: SIG() });
    });
  } catch {
    console.warn("Calendar post-response callback unavailable; durable reminder intent retained");
  }
}
