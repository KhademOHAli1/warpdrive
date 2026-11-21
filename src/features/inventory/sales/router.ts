import { protectedProcedure, router } from "@/server/trpc/trpc";
import { salesQuery } from "./contracts";
import { readSalesWorkspace } from "./reads";

export const inventorySalesRouter = router({
  workspace: protectedProcedure
    .input(salesQuery)
    .query(({ ctx, input }) =>
      readSalesWorkspace(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
