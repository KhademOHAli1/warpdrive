import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import {
  activities,
  activityReminderIntents,
  activityReminderSettings,
  activityTypes,
  calendarReminderIntents,
  notifications,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { deliverReminderIntent } from "./calendarReminderDelivery";
import { reconcileReminderIntent } from "./calendarReminderIntent";
import { setEventReminderSettings } from "./personalReminderSettings";
import { processActivityReminder } from "./reminderDelivery";
import { createActivity } from "./repo";

it("keeps native generation ownership when an obsolete calendar intent is delivered", async () => {
  const h = await makeTestDb();
  const signal = AbortSignal.timeout(10_000);
  try {
    const user = await seedUser(h.db, { isAdmin: true });
    const actor: PermSetUser = {
      id: user.id,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set(),
    };
    const [type] = await h.db.select().from(activityTypes).limit(1);
    assert(type !== undefined);
    const dueAt = new Date(Date.now() + 5 * 60_000);
    const created = await createActivity(
      h.db,
      actor,
      {
        typeId: type.id,
        subject: "One reminder owner",
        dueAt: dueAt.toISOString(),
        durationMinutes: 60,
        authoredTimeZone: "UTC",
        reminderTimeZone: "UTC",
        reminder: { kind: "before_start", channel: "in_app", leadMinutes: 10 },
      },
      signal,
    );
    assert(created.ok);
    const activity = created.value;
    const [native] = await h.db
      .select()
      .from(activityReminderIntents)
      .where(eq(activityReminderIntents.activityId, activity.id));
    assert(native !== undefined);
    await reconcileReminderIntent(h.db, activity, signal);
    expect(
      await h.db
        .select()
        .from(calendarReminderIntents)
        .where(eq(calendarReminderIntents.activityId, activity.id)),
    ).toHaveLength(0);
    const [obsolete] = await h.db
      .insert(calendarReminderIntents)
      .values({
        activityId: activity.id,
        assigneeId: user.id,
        dueAt,
        fireAt: new Date(dueAt.getTime() - 10 * 60_000),
      })
      .returning();
    assert(obsolete !== undefined);
    await processActivityReminder(h.db, activity.id, native.generationId, signal);
    await deliverReminderIntent(h.db, { intentId: obsolete.id }, signal, null);
    await processActivityReminder(h.db, activity.id, undefined, signal);
    expect(await h.db.select().from(notifications)).toHaveLength(1);
    expect((await h.db.select().from(calendarReminderIntents))[0]?.state).toBe("cancelled");
  } finally {
    await h.close();
  }
});

it("preserves legacy delivery until a caller explicitly chooses calendar reminders", async () => {
  const h = await makeTestDb();
  const signal = AbortSignal.timeout(10_000);
  try {
    const user = await seedUser(h.db, { isAdmin: true });
    const actor: PermSetUser = {
      id: user.id,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set(),
    };
    const [type] = await h.db.select().from(activityTypes).limit(1);
    assert(type !== undefined);
    const saved = await createActivity(
      h.db,
      actor,
      {
        typeId: type.id,
        subject: "Legacy activity",
        dueAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
      signal,
    );
    assert(saved.ok);
    expect(saved.value.reminderEngine).toBe("legacy");
    expect(await h.db.select().from(calendarReminderIntents)).toHaveLength(0);
  } finally {
    await h.close();
  }
});

it("hands the legacy assignee to an explicit personal policy without changing the event revision", async () => {
  const h = await makeTestDb();
  const signal = AbortSignal.timeout(10_000);
  try {
    const user = await seedUser(h.db, { isAdmin: true });
    const actor: PermSetUser = {
      id: user.id,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set(),
    };
    const [type] = await h.db.select().from(activityTypes).limit(1);
    assert(type !== undefined);
    const created = await createActivity(
      h.db,
      actor,
      {
        typeId: type.id,
        subject: "Explicit personal handoff",
        dueAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        durationMinutes: 60,
      },
      signal,
    );
    assert(created.ok);
    const saved = await setEventReminderSettings(
      h.db,
      actor,
      {
        activityId: created.value.id,
        expectedRevision: 0,
        selection: {
          useDefault: false,
          timed: [{ method: "notification", minutesBefore: 10 }],
          allDay: [],
        },
      },
      signal,
    );
    assert(saved.ok);
    const [intent] = await h.db.select().from(calendarReminderIntents);
    assert(intent !== undefined);
    expect((await h.db.select().from(activities))[0]?.version).toBe(created.value.version);
    expect(await processActivityReminder(h.db, created.value.id, undefined, signal)).toMatchObject({
      state: "cancelled",
    });
    await deliverReminderIntent(h.db, { intentId: intent.id }, signal, null);
    await deliverReminderIntent(h.db, { intentId: intent.id }, signal, null);
    expect(await h.db.select().from(notifications)).toHaveLength(1);
  } finally {
    await h.close();
  }
});

it("rejects a personal-policy write while the native generation owns the activity", async () => {
  const h = await makeTestDb();
  const signal = AbortSignal.timeout(10_000);
  try {
    const user = await seedUser(h.db, { isAdmin: true });
    const actor: PermSetUser = {
      id: user.id,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set(),
    };
    const [type] = await h.db.select().from(activityTypes).limit(1);
    assert(type !== undefined);
    const created = await createActivity(
      h.db,
      actor,
      {
        typeId: type.id,
        subject: "Native reminder policy",
        authoredTimeZone: "UTC",
        reminder: { kind: "none" },
      },
      signal,
    );
    assert(created.ok);
    expect(
      await setEventReminderSettings(
        h.db,
        actor,
        {
          activityId: created.value.id,
          expectedRevision: 0,
          selection: { useDefault: true },
        },
        signal,
      ),
    ).toMatchObject({ ok: false, error: { id: "E_ACTIVITY_012" } });
    expect(await h.db.select().from(activityReminderSettings)).toHaveLength(0);
  } finally {
    await h.close();
  }
});

it.each(["empty assignee policy", "other reader policy"] as const)(
  "keeps per-recipient legacy ownership for %s",
  async (kind) => {
    const h = await makeTestDb();
    const signal = AbortSignal.timeout(10_000);
    try {
      const owner = await seedUser(h.db, { isAdmin: true });
      const reader = await seedUser(h.db, { isAdmin: true });
      const actor: PermSetUser = {
        id: owner.id,
        type: "admin",
        isActive: true,
        flags: new Set(),
        groupIds: new Set(),
      };
      const [type] = await h.db.select().from(activityTypes).limit(1);
      assert(type !== undefined);
      const created = await createActivity(
        h.db,
        actor,
        {
          typeId: type.id,
          subject: "Recipient ownership",
          dueAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        },
        signal,
      );
      assert(created.ok);
      const policyActor = kind === "other reader policy" ? { ...actor, id: reader.id } : actor;
      const policy = await setEventReminderSettings(
        h.db,
        policyActor,
        {
          activityId: created.value.id,
          expectedRevision: 0,
          selection: { useDefault: false, timed: [], allDay: [] },
        },
        signal,
      );
      assert(policy.ok);
      const delivered = await processActivityReminder(h.db, created.value.id, undefined, signal);
      if (kind === "empty assignee policy") {
        expect(delivered).toMatchObject({ state: "cancelled" });
        expect(await h.db.select().from(notifications)).toHaveLength(0);
      } else {
        expect(await h.db.select().from(notifications)).toEqual([
          expect.objectContaining({ userId: owner.id }),
        ]);
      }
    } finally {
      await h.close();
    }
  },
);
