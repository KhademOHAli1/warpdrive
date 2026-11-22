import { protectedProcedure, router } from "@/server/trpc/trpc";
import { bookingAutomationRouter } from "./automations/router";
import { readBookingMemberships } from "./membershipService";
import { readBookingWorkspace } from "./service";

export const assetBookingsRouter = router({
  automations: bookingAutomationRouter,
  memberships: protectedProcedure.query(({ ctx }) =>
    readBookingMemberships(ctx.db, ctx.session, AbortSignal.timeout(15_000)),
  ),
  workspace: protectedProcedure.query(({ ctx }) =>
    readBookingWorkspace(ctx.db, ctx.session, AbortSignal.timeout(15_000)),
  ),
});
