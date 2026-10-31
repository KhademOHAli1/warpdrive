import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityTypes, userPreferences } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { buildActivityInput } from "@/features/deal-workspace/composer/composerHelpers";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { updateActivity } from "./activityUpdate";
import { calendarEventDraft, calendarEventPatch } from "./calendarEventDraft";
import { getActivityForEdit } from "./getForEdit";
import { createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeAll(async () => {
  ctx = await makeTestDb();
});
afterAll(async () => {
  await ctx.close();
});
const signal = () => AbortSignal.timeout(10_000);
const actor = (id: string): PermSetUser => ({
  id,
  type: "admin",
  isActive: true,
  groupIds: new Set(),
  flags: new Set(),
});

it("persists an end-only edit without shifting a later repeated-hour start", async () => {
  const user = await seedUser(ctx.db, { name: "DST review" });
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  expect(type).toBeDefined();
  if (type === undefined) return;
  const created = await createActivity(
    ctx.db,
    actor(user.id),
    {
      subject: "Wiederholte Stunde",
      typeId: type.id,
      dueAt: "2026-10-25T01:30:29.123Z",
      durationMinutes: 60,
    },
    signal(),
  );
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const loaded = await getActivityForEdit(ctx.db, actor(user.id), created.value.id, signal());
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const draft = calendarEventDraft({ editing: loaded.value, timeZone: "Europe/Berlin" });
  draft.endTime = "03:45";
  const patch = calendarEventPatch(loaded.value, draft, "Europe/Berlin");
  expect(patch).not.toBeNull();
  if (patch === null) return;
  const updated = await updateActivity(ctx.db, actor(user.id), patch, signal());
  expect(updated.ok).toBe(true);
  if (!updated.ok) return;
  expect(updated.value.dueAt?.toISOString()).toBe("2026-10-25T01:30:29.123Z");
  expect(updated.value.endAt?.toISOString()).toBe("2026-10-25T02:45:00.000Z");
  expect(updated.value.durationMinutes).toBe(75);
});

describe.each([
  {
    locale: "fa",
    zone: "Asia/Tehran",
    title: "جلسهٔ برنامه‌ریزی نوروز",
    note: "<p>هماهنگی با تیم فروش</p>",
  },
  {
    locale: "de",
    zone: "Europe/Berlin",
    title: "Planungsbesprechung",
    note: "<p>Abstimmung mit dem Vertrieb</p>",
  },
])("calendar database round trips in $locale", ({ locale, zone, title, note }) => {
  it("creates, reopens and edits timed and all-day events without shifting civil dates", async () => {
    const user = await seedUser(ctx.db, { name: title });
    await ctx.db.insert(userPreferences).values({
      userId: user.id,
      timezone: zone,
      ui: {
        localePreferences: {
          locale,
          calendar: locale === "fa" ? "persian" : "gregory",
          timeZone: zone,
        },
      },
    });
    const [type] = await ctx.db
      .select()
      .from(activityTypes)
      .where(eq(activityTypes.key, "meeting"));
    expect(type).toBeDefined();
    if (type === undefined) return;
    for (const time of ["09:00", ""]) {
      const draft = calendarEventDraft({ date: "2027-03-21", time, timeZone: zone });
      Object.assign(draft, {
        subject: title,
        typeId: type.id,
        note,
        location: "تهران / Berlin",
        videoCallUrl: "https://meet.example.org/calendar-review",
      });
      if (time === "") draft.endDate = "2027-03-23";
      const created = await createActivity(
        ctx.db,
        actor(user.id),
        buildActivityInput(draft, zone),
        signal(),
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const loaded = await getActivityForEdit(ctx.db, actor(user.id), created.value.id, signal());
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const reopened = calendarEventDraft({ editing: loaded.value, timeZone: zone });
      expect(reopened).toMatchObject({
        subject: title,
        startDate: "2027-03-21",
        startTime: time,
        note,
        location: "تهران / Berlin",
      });
      expect(calendarEventPatch(loaded.value, reopened, zone)).toBeNull();
      reopened.note = "<p>به‌روزرسانی / Aktualisiert</p>";
      const patch = calendarEventPatch(loaded.value, reopened, zone);
      expect(patch).toEqual({ id: loaded.value.id, note: reopened.note });
      if (patch === null) return;
      const updated = await updateActivity(ctx.db, actor(user.id), patch, signal());
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.value.dueAt?.toISOString()).toBe(loaded.value.dueAt);
      if (time === "") {
        const changedZone = calendarEventDraft({
          editing: { ...loaded.value, note: reopened.note },
          timeZone: "Pacific/Honolulu",
        });
        expect(changedZone).toMatchObject({
          startDate: "2027-03-21",
          endDate: "2027-03-23",
          startTime: "",
          endTime: "",
        });
      }
      const other = await seedUser(ctx.db, { name: "Unrelated viewer" });
      const stranger: PermSetUser = { ...actor(other.id), type: "regular" };
      const denied = await getActivityForEdit(ctx.db, stranger, created.value.id, signal());
      expect(denied.ok).toBe(false);
      const forbiddenEdit = await updateActivity(
        ctx.db,
        stranger,
        { id: created.value.id, note: "<p>Unauthorized change</p>" },
        signal(),
      );
      expect(forbiddenEdit.ok).toBe(false);
    }
  });
});
