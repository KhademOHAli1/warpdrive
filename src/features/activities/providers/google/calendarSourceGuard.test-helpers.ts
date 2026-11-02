import { eq, inArray, sql } from "drizzle-orm";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import { activities, activityTypes, calendars } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import type { TestDb } from "@/test/db";
import type { Result } from "@/types/result";
import { deleteActivity } from "../../activityDelete";
import { updateActivity } from "../../activityUpdate";
import { createCalendar } from "../../calendars";
import { completeActivity, createActivity } from "../../repo";

export const sourceGuardSignal = () => AbortSignal.timeout(10_000);
export function sourceGuardOk<T, E>(result: Result<T, E>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, "source guard fixture failed");
  return result.value;
}
function sourceActor(id: string, type: "regular" | "admin"): PermSetUser {
  return {
    id,
    type,
    isActive: true,
    flags: new Set<PermissionFlagKey>([
      "activity.create",
      "activity.edit_own",
      "activity.delete_own",
    ]),
    groupIds: new Set(),
  };
}
export async function nativeSourceFixture(ctx: TestDb) {
  const ownerUser = await seedUser(ctx.db);
  const adminUser = await seedUser(ctx.db, { isAdmin: true });
  const owner = sourceActor(ownerUser.id, "regular");
  const admin = sourceActor(adminUser.id, "admin");
  const calendar = sourceGuardOk(
    await createCalendar(
      ctx.db,
      owner,
      {
        name: "تقویم مبدأ / Quellkalender",
        timeZone: "Asia/Tehran",
      },
      sourceGuardSignal(),
    ),
  );
  const nativeCalendar = sourceGuardOk(
    await createCalendar(
      ctx.db,
      owner,
      {
        name: "Native CRM",
        timeZone: "Europe/Berlin",
      },
      sourceGuardSignal(),
    ),
  );
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "meeting type missing");
  const draft = { typeId: type.id, subject: "جلسه / Termin", dueAt: "2027-03-21T09:00:00Z" };
  const event = sourceGuardOk(
    await createActivity(
      ctx.db,
      owner,
      {
        ...draft,
        calendarId: calendar.id,
      },
      sourceGuardSignal(),
      { scheduleReminder: false },
    ),
  );
  const nativeEvent = sourceGuardOk(
    await createActivity(
      ctx.db,
      owner,
      {
        ...draft,
        calendarId: nativeCalendar.id,
      },
      sourceGuardSignal(),
      { scheduleReminder: false },
    ),
  );
  return { owner, admin, calendar, nativeCalendar, event, nativeEvent, draft };
}
export async function providerSourceFixture(ctx: TestDb) {
  const fixture = await nativeSourceFixture(ctx);
  // Exercise the actual future source column, including the missing-column baseline RED.
  await ctx.db.execute(
    sql`UPDATE calendars SET source = 'provider' WHERE id = ${fixture.calendar.id}`,
  );
  return fixture;
}
export type SourceFixture = Awaited<ReturnType<typeof nativeSourceFixture>>;
export async function sourceMutation(
  ctx: TestDb,
  fixture: SourceFixture,
  actor: PermSetUser,
  kind: string,
) {
  const input = { id: fixture.event.id, expectedVersion: fixture.event.version };
  switch (kind) {
    case "create":
      return createActivity(
        ctx.db,
        actor,
        { ...fixture.draft, calendarId: fixture.calendar.id },
        sourceGuardSignal(),
      );
    case "edit":
      return updateActivity(
        ctx.db,
        actor,
        { ...input, subject: "Forbidden edit" },
        sourceGuardSignal(),
      );
    case "complete":
      return completeActivity(
        ctx.db,
        actor,
        input.id,
        true,
        sourceGuardSignal(),
        input.expectedVersion,
      );
    case "delete":
      return deleteActivity(ctx.db, actor, input.id, sourceGuardSignal(), input.expectedVersion);
    case "moveOut":
      return updateActivity(
        ctx.db,
        actor,
        { ...input, calendarId: fixture.nativeCalendar.id },
        sourceGuardSignal(),
      );
    case "moveIn":
      return updateActivity(
        ctx.db,
        actor,
        {
          id: fixture.nativeEvent.id,
          expectedVersion: fixture.nativeEvent.version,
          calendarId: fixture.calendar.id,
        },
        sourceGuardSignal(),
      );
    default:
      throw new AppError(ERROR_IDS.DB_INVARIANT, "unknown source mutation");
  }
}
export async function sourceRows(ctx: TestDb, fixture: SourceFixture) {
  return {
    calendars: await ctx.db
      .select()
      .from(calendars)
      .where(inArray(calendars.id, [fixture.calendar.id, fixture.nativeCalendar.id]))
      .orderBy(calendars.id),
    activities: await ctx.db
      .select()
      .from(activities)
      .where(inArray(activities.id, [fixture.event.id, fixture.nativeEvent.id]))
      .orderBy(activities.id),
  };
}
