import { protectedProcedure, router } from "@/server/trpc/trpc";
import { bomPlanningQuery } from "./contracts";
import { readBomPlanningWorkspace } from "./service";

export const inventoryBomRouter = router({
  workspace: protectedProcedure
    .input(bomPlanningQuery)
    .query(({ ctx, input }) =>
      readBomPlanningWorkspace(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
