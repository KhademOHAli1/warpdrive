import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { activities, activityTypes, notifications } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import { handleReminderJob } from "./reminders";

// These two regressions intentionally use only the predecessor's public
// activity/job shape and existing tables. The preserved 38-file predecessor cut
// can run the same assertions to witness its domain RED before current GREEN.
it.each(["moved_later", "date_cleared"] as const)(
  "does not publish an obsolete legacy nudge after %s",
  async (change) => {
    const h = await makeTestDb();
    try {
      const user = await seedUser(h.db);
      const [type] = await h.db
        .select()
        .from(activityTypes)
        .where(eq(activityTypes.key, "meeting"));
      if (type === undefined) throw new Error("Meeting fixture missing");
      const clock = await h.db.execute<{ now: Date | string }>(
        sql`SELECT clock_timestamp() AS now`,
      );
      const at = new Date(clock.rows[0]?.now ?? Number.NaN).getTime();
      if (!Number.isFinite(at)) throw new Error("Legacy fixture clock missing");
      const [event] = await h.db
        .insert(activities)
        .values({
          typeId: type.id,
          subject: "Stale legacy reminder",
          ownerId: user.id,
          assigneeId: user.id,
          dueAt: new Date(at + 300_000),
        })
        .returning();
      if (event === undefined) throw new Error("Legacy event fixture missing");
      await h.db
        .update(activities)
        .set({ dueAt: change === "moved_later" ? new Date(at + 3_600_000) : null })
        .where(eq(activities.id, event.id));
      await handleReminderJob(
        h.db,
        { data: { activityId: event.id } },
        AbortSignal.timeout(10_000),
      );
      expect(await h.db.select().from(notifications)).toHaveLength(0);
    } finally {
      await h.close();
    }
  },
);
