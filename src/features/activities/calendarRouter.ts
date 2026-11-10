import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { calendarMembers, users } from "@/db/schema";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { ok } from "@/types/result";
import { activityAccountPreferences } from "./accountTimeZone";
import { calendarReminderCatalog } from "./calendarReminderCatalog";
import { runCalendarSettingsCommand } from "./calendarSettingsCommand";
import { calendarRole, ensurePersonalCalendar, listCalendars } from "./calendars";
import { googleCalendarCatalogQuery } from "./providers/google/calendarCatalogBoundary";
import { googleCalendarAccountsQuery } from "./providers/google/connectionQuery";
import { reminderSettingsRouter } from "./reminderSettingsRouter";
export const calendarsRouter = router({
  googleAccounts: googleCalendarAccountsQuery,
  googleCatalog: googleCalendarCatalogQuery,
  reminders: reminderSettingsRouter,
  list: protectedProcedure
    .input(z.object({ includeArchived: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const signal = AbortSignal.timeout(10_000);
      const result = await runCalendarSettingsCommand(ctx, signal, async (db, actor) => {
        const prefs = await activityAccountPreferences(db, actor.id);
        await ensurePersonalCalendar(db, actor, prefs.timeZone, signal);
        const calendars = await listCalendars(db, actor, signal, input?.includeArchived);
        return ok(await calendarReminderCatalog(db, actor, calendars, signal));
      });
      if (!result.ok) throw new TRPCError({ code: "UNAUTHORIZED", message: result.error.id });
      return result.value;
    }),
  members: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const signal = AbortSignal.timeout(10_000);
      const result = await runCalendarSettingsCommand(ctx, signal, async (db, actor) => {
        if ((await calendarRole(db, actor, input.id, signal)) !== "owner")
          throw new TRPCError({ code: "NOT_FOUND" });
        return ok(
          await db
            .select({ userId: users.id, name: users.name, role: calendarMembers.role })
            .from(calendarMembers)
            .innerJoin(users, and(eq(users.id, calendarMembers.userId), eq(users.isActive, true)))
            .where(eq(calendarMembers.calendarId, input.id)),
        );
      });
      if (!result.ok) throw new TRPCError({ code: "UNAUTHORIZED", message: result.error.id });
      return result.value;
    }),
});
