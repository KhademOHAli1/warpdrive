import { z } from "zod";
import { isTimeZone } from "@/features/i18n/preferences";
export const calendarInput = z.object({
  name: z.string().trim().min(1).max(100),
  timeZone: z.string().max(100).refine(isTimeZone),
});
export const calendarMemberInput = z.object({
  calendarId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["freeBusy", "reader", "editor"]).nullable(),
});
export type CalendarRole = "owner" | "freeBusy" | "reader" | "editor";
