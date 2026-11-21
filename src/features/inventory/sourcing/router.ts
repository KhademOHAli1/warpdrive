import { protectedProcedure, router } from "@/server/trpc/trpc";
import { sourcingQuery } from "./contracts";
import { readSourcingWorkspace } from "./service";

export const inventorySourcingRouter = router({
  workspace: protectedProcedure
    .input(sourcingQuery)
    .query(({ ctx, input }) =>
      readSourcingWorkspace(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
