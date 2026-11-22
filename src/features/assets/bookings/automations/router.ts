import { protectedProcedure, router } from "@/server/trpc/trpc";
import { bookingAutomationNoticeInput, bookingAutomationRunInput } from "./inputs";
import { readBookingAutomationNotices, readBookingAutomationRuns } from "./service";

export const bookingAutomationRouter = router({
  notices: protectedProcedure
    .input(bookingAutomationNoticeInput)
    .query(({ ctx, input }) =>
      readBookingAutomationNotices(
        ctx.db,
        ctx.session,
        input.bookingId,
        AbortSignal.timeout(15_000),
      ),
    ),
  runs: protectedProcedure
    .input(bookingAutomationRunInput)
    .query(({ ctx, input }) =>
      readBookingAutomationRuns(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
