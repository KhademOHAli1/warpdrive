import { eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { activityTypes } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { createCalendar, setCalendarMember } from "./calendars";
import type { ReminderDefaults } from "./reminderPolicy";
import { createActivity } from "./repo";

export const sig = () => AbortSignal.timeout(10_000);
export const customDefaults: ReminderDefaults = {
  timed: [{ method: "notification", minutesBefore: 30 }],
  allDay: [{ method: "email", daysBefore: 1, time: "08:30" }],
};
export async function reminderActor(db: Db): Promise<PermSetUser> {
  const user = await seedUser(db);
  return { id: user.id, type: "regular", isActive: true, flags: new Set(), groupIds: new Set() };
}
export async function reminderFixture(
  db: Db,
  role: "reader" | "editor" | "freeBusy" = "reader",
  eventVisibility: "default" | "private" = "default",
) {
  const owner = await reminderActor(db);
  const reader = await reminderActor(db);
  const created = await createCalendar(
    db,
    owner,
    { name: "Personal reminders", timeZone: "Europe/Berlin" },
    sig(),
  );
  if (!created.ok) throw created.error;
  await setCalendarMember(
    db,
    owner,
    { calendarId: created.value.id, userId: reader.id, role },
    sig(),
  );
  const [type] = await db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "meeting seed absent");
  const input = {
    typeId: type.id,
    subject: "Personal reminder test",
    calendarId: created.value.id,
    eventTimeZone: "Asia/Tehran",
    eventVisibility,
    dueAt: "2030-03-21T09:00:00Z",
  };
  const event = await createActivity(db, owner, input, sig());
  if (!event.ok) throw event.error;
  return { owner, reader, calendar: created.value, event: event.value, input };
}
