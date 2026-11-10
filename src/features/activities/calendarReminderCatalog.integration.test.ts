import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import * as schema from "@/db/schema";
import { calendarReminderDefaults, emailAccounts, notificationPreferences } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { createSession } from "@/features/auth/session";
import { type HydratedActor, hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { calendarsRouter } from "./calendarRouter";
import { createCalendar, setCalendarArchived, setCalendarMember } from "./calendars";
import { DEFAULT_REMINDER_RULES } from "./reminderPolicy";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
const signal = () => AbortSignal.timeout(10_000);
beforeAll(async () => {
  ctx = await makeTestDb();
});
afterAll(async () => {
  await ctx.close();
});
async function actor(): Promise<HydratedActor> {
  const user = await seedUser(ctx.db);
  const hydrated = await hydrateActor(ctx.db, user.id, signal());
  if (hydrated === null) throw new AppError(ERROR_IDS.DB_INVARIANT, "actor missing");
  return hydrated;
}
async function calendar(owner: HydratedActor, name: string) {
  const result = await createCalendar(ctx.db, owner, { name, timeZone: "Asia/Tehran" }, signal());
  if (!result.ok) throw result.error;
  return result.value;
}
async function caller(user: HydratedActor, queries: string[] = []) {
  const db = drizzle(ctx.pool, {
    schema,
    logger: {
      logQuery(query) {
        queries.push(query);
      },
    },
  });
  const session = await createSession(ctx.db, user.id, signal());
  if (!session.ok)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Native catalog session fixture missing");
  return calendarsRouter.createCaller({
    db,
    actor: user,
    session: { userId: user.id, sessionId: session.value.sessionId },
  });
}

it("batches the caller's defaults and capability without exposing another user's settings", async () => {
  const user = await actor();
  const other = await actor();
  const own = await calendar(user, "Own");
  const missing = await calendar(user, "No stored defaults");
  const malformed = await calendar(user, "Malformed");
  const shared = await calendar(other, "Shared reader");
  const edited = await calendar(other, "Shared editor");
  const busy = await calendar(other, "Availability only");
  for (const [cal, role] of [
    [shared, "reader"],
    [edited, "editor"],
    [busy, "freeBusy"],
  ] as const) {
    const result = await setCalendarMember(
      ctx.db,
      other,
      { calendarId: cal.id, userId: user.id, role },
      signal(),
    );
    if (!result.ok) throw result.error;
  }
  const ownRules = { timed: [{ method: "notification" as const, minutesBefore: 5 }], allDay: [] };
  await ctx.db.insert(calendarReminderDefaults).values([
    { calendarId: own.id, userId: user.id, rules: ownRules, version: 4 },
    {
      calendarId: own.id,
      userId: other.id,
      rules: { timed: [{ method: "notification", minutesBefore: 999 }], allDay: [] },
      version: 7,
    },
    {
      calendarId: shared.id,
      userId: other.id,
      rules: { timed: [{ method: "email", minutesBefore: 60 }], allDay: [] },
    },
  ]);
  await ctx.db.execute(
    sql`insert into calendar_reminder_defaults(calendar_id,user_id,rules,version) values(${malformed.id},${user.id},${JSON.stringify({ timed: [{ method: "notification", minutesBefore: -1 }], allDay: [] })}::jsonb,6)`,
  );
  await ctx.db
    .insert(notificationPreferences)
    .values({ userId: user.id, type: "activity_reminder", email: true, inApp: true });
  await ctx.db
    .insert(emailAccounts)
    .values({ userId: user.id, emailAddress: user.email, status: "connected" });
  const queries: string[] = [];
  const listed = await (await caller(user, queries)).list();
  expect(listed.find((c) => c.id === own.id)?.personalReminders).toEqual({
    defaults: ownRules,
    revision: 4,
    emailCapability: "available",
  });
  for (const id of [missing.id, shared.id, edited.id])
    expect(listed.find((c) => c.id === id)?.personalReminders).toEqual({
      defaults: DEFAULT_REMINDER_RULES,
      revision: 0,
      emailCapability: "available",
    });
  expect(listed.find((c) => c.id === malformed.id)?.personalReminders).toEqual({
    defaults: { timed: [], allDay: [] },
    revision: 6,
    emailCapability: "available",
  });
  expect(listed.find((c) => c.id === busy.id)?.personalReminders).toBeUndefined();
  expect(
    queries.filter(
      (query) => query.startsWith("select") && query.includes('"calendar_reminder_defaults"'),
    ),
  ).toHaveLength(1);
  expect(
    queries.filter(
      (query) => query.startsWith("select") && query.includes('"notification_preferences"'),
    ),
  ).toHaveLength(1);
  expect(
    queries.filter((query) => query.startsWith("select") && query.includes('"email_accounts"')),
  ).toHaveLength(1);
});

it("drops reminder context immediately on reader downgrade and removes a revoked calendar", async () => {
  const owner = await actor();
  const reader = await actor();
  const cal = await calendar(owner, "Shared");
  let grant = await setCalendarMember(
    ctx.db,
    owner,
    { calendarId: cal.id, userId: reader.id, role: "reader" },
    signal(),
  );
  if (!grant.ok) throw grant.error;
  const api = await caller(reader);
  expect((await api.list()).find((c) => c.id === cal.id)?.personalReminders).toBeDefined();
  grant = await setCalendarMember(
    ctx.db,
    owner,
    { calendarId: cal.id, userId: reader.id, role: "freeBusy" },
    signal(),
  );
  if (!grant.ok) throw grant.error;
  const downgraded = (await api.list()).find((c) => c.id === cal.id);
  expect(downgraded).toBeDefined();
  expect(downgraded?.personalReminders).toBeUndefined();
  grant = await setCalendarMember(
    ctx.db,
    owner,
    { calendarId: cal.id, userId: reader.id, role: null },
    signal(),
  );
  if (!grant.ok) throw grant.error;
  expect((await api.list()).some((c) => c.id === cal.id)).toBe(false);
});

it("shares only the caller's current master-channel/mailbox capability across their list", async () => {
  const user = await actor();
  const cal = await calendar(user, "Capability");
  await ctx.db
    .insert(notificationPreferences)
    .values({ userId: user.id, type: "activity_reminder", email: false, inApp: true });
  const api = await caller(user);
  expect((await api.list()).find((c) => c.id === cal.id)?.personalReminders?.emailCapability).toBe(
    "channelDisabled",
  );
  await ctx.db
    .update(notificationPreferences)
    .set({ email: true })
    .where(eq(notificationPreferences.userId, user.id));
  expect((await api.list()).find((c) => c.id === cal.id)?.personalReminders?.emailCapability).toBe(
    "mailboxMissing",
  );
  await ctx.db
    .insert(emailAccounts)
    .values({ userId: user.id, emailAddress: user.email, status: "connected" });
  expect((await api.list()).find((c) => c.id === cal.id)?.personalReminders?.emailCapability).toBe(
    "available",
  );
  await ctx.db
    .update(emailAccounts)
    .set({ status: "disconnected" })
    .where(eq(emailAccounts.userId, user.id));
  expect((await api.list()).find((c) => c.id === cal.id)?.personalReminders?.emailCapability).toBe(
    "mailboxMissing",
  );
});

it("does not attach usable reminder settings to an archived calendar", async () => {
  const user = await actor();
  const cal = await calendar(user, "Archived");
  const archived = await setCalendarArchived(
    ctx.db,
    user,
    { id: cal.id, archived: true },
    signal(),
  );
  if (!archived.ok) throw archived.error;
  const api = await caller(user);
  expect((await api.list()).some((c) => c.id === cal.id)).toBe(false);
  const listed = (await api.list({ includeArchived: true })).find((c) => c.id === cal.id);
  expect(listed).toBeDefined();
  expect(listed?.personalReminders).toBeUndefined();
});
