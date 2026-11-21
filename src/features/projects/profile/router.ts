import { TRPCError } from "@trpc/server";
import { validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import {
  profileActivityInput,
  profileItemsInput,
  profileSubscriptionInput,
  profileSubscriptionTarget,
} from "./contracts";
import {
  readProjectProfileActivity,
  readProjectProfileItems,
  readProjectProfileSummary,
} from "./service";
import { readProjectSubscription, setProjectSubscription } from "./subscriptions";

export const projectProfileRouter = router({
  summary: protectedProcedure.query(({ ctx }) =>
    readProjectProfileSummary(ctx.db, ctx.session, AbortSignal.timeout(10_000)),
  ),
  assigned: protectedProcedure
    .input(profileItemsInput)
    .query(({ ctx, input }) =>
      readProjectProfileItems(ctx.db, ctx.session, "assigned", input, AbortSignal.timeout(10_000)),
    ),
  created: protectedProcedure
    .input(profileItemsInput)
    .query(({ ctx, input }) =>
      readProjectProfileItems(ctx.db, ctx.session, "created", input, AbortSignal.timeout(10_000)),
    ),
  subscribed: protectedProcedure
    .input(profileItemsInput)
    .query(({ ctx, input }) =>
      readProjectProfileItems(
        ctx.db,
        ctx.session,
        "subscribed",
        input,
        AbortSignal.timeout(10_000),
      ),
    ),
  activity: protectedProcedure
    .input(profileActivityInput)
    .query(({ ctx, input }) =>
      readProjectProfileActivity(ctx.db, ctx.session, input.cursor, AbortSignal.timeout(10_000)),
    ),
  subscriptionStatus: protectedProcedure
    .input(profileSubscriptionTarget)
    .query(({ ctx, input }) =>
      readProjectSubscription(ctx.db, ctx.session, input, AbortSignal.timeout(10_000)),
    ),
  setSubscription: protectedProcedure.input(profileSubscriptionInput).mutation(({ ctx, input }) => {
    if (!validateRequestCsrf(ctx.csrf, input.csrfToken).ok)
      throw new TRPCError({ code: "FORBIDDEN" });
    return setProjectSubscription(ctx.db, ctx.session, input, AbortSignal.timeout(10_000));
  }),
});
