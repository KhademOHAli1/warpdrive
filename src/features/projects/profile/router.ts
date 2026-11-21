import { protectedProcedure, router } from "@/server/trpc/trpc";
import { profileItemsInput } from "./contracts";
import { readProjectProfileItems, readProjectProfileSummary } from "./service";

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
});
