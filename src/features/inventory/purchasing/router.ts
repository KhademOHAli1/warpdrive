import { protectedProcedure, router } from "@/server/trpc/trpc";
import { purchasingQuery } from "./contracts";
import { readPurchasingScope, readPurchasingWorkspace } from "./reads";

export const inventoryPurchasingRouter = router({
  scope: protectedProcedure.query(({ ctx }) =>
    readPurchasingScope(ctx.db, ctx.session, AbortSignal.timeout(15_000)),
  ),
  workspace: protectedProcedure
    .input(purchasingQuery)
    .query(({ ctx, input }) =>
      readPurchasingWorkspace(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
