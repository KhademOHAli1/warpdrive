import { protectedProcedure, router } from "@/server/trpc/trpc";
import { stocktakeQuery } from "./contracts";
import { readStocktakeWorkspace } from "./service";

export const stocktakesRouter = router({
  workspace: protectedProcedure
    .input(stocktakeQuery)
    .query(({ ctx, input }) =>
      readStocktakeWorkspace(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
