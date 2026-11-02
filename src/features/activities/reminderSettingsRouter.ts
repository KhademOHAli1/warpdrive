import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { getCalendarReminderDefaults, getEventReminderSettings } from "./personalReminderSettings";

export const reminderSettingsRouter = router({
  calendarDefaults: protectedProcedure
    .input(z.strictObject({ calendarId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await getCalendarReminderDefaults(
        ctx.db,
        ctx.actor,
        input.calendarId,
        AbortSignal.timeout(10_000),
      );
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.error.id });
      return result.value;
    }),
  eventSettings: protectedProcedure
    .input(z.strictObject({ activityId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await getEventReminderSettings(
        ctx.db,
        ctx.actor,
        input.activityId,
        AbortSignal.timeout(10_000),
      );
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.error.id });
      return result.value;
    }),
});
