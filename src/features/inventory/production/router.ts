import { protectedProcedure, router } from "@/server/trpc/trpc";
import { productionQuery } from "./contracts";
import { readProductionWorkspace } from "./service";

export const inventoryProductionRouter = router({
  workspace: protectedProcedure
    .input(productionQuery)
    .query(({ ctx, input }) =>
      readProductionWorkspace(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
