import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { runCalendarSettingsCommand } from "./calendarSettingsCommand";
import { getCalendarReminderDefaults, getEventReminderSettings } from "./personalReminderSettings";

export const reminderSettingsRouter = router({
  calendarDefaults: protectedProcedure
    .input(z.strictObject({ calendarId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const signal = AbortSignal.timeout(10_000);
      const result = await runCalendarSettingsCommand(ctx, signal, (db, actor) =>
        getCalendarReminderDefaults(db, actor, input.calendarId, signal),
      );
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.error.id });
      return result.value;
    }),
  eventSettings: protectedProcedure
    .input(z.strictObject({ activityId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const signal = AbortSignal.timeout(10_000);
      const result = await runCalendarSettingsCommand(ctx, signal, (db, actor) =>
        getEventReminderSettings(db, actor, input.activityId, signal),
      );
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.error.id });
      return result.value;
    }),
});
