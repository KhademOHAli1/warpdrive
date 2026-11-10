import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { calendarMembers, users } from "@/db/schema";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { activityAccountPreferences } from "./accountTimeZone";
import { calendarReminderCatalog } from "./calendarReminderCatalog";
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
      const prefs = await activityAccountPreferences(ctx.db, ctx.actor.id);
      await ensurePersonalCalendar(ctx.db, ctx.actor, prefs.timeZone, signal);
      const calendars = await listCalendars(ctx.db, ctx.actor, signal, input?.includeArchived);
      return calendarReminderCatalog(ctx.db, ctx.actor, calendars, signal);
    }),
  members: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (
        (await calendarRole(ctx.db, ctx.actor, input.id, AbortSignal.timeout(10_000))) !== "owner"
      )
        throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db
        .select({ userId: users.id, name: users.name, role: calendarMembers.role })
        .from(calendarMembers)
        .innerJoin(users, and(eq(users.id, calendarMembers.userId), eq(users.isActive, true)))
        .where(eq(calendarMembers.calendarId, input.id));
    }),
});
