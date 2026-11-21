import { protectedProcedure, router } from "@/server/trpc/trpc";
import { returnsQuery } from "./contracts";
import { readReturnsWorkspace } from "./reads";

export const inventoryReturnsRouter = router({
  workspace: protectedProcedure
    .input(returnsQuery)
    .query(({ ctx, input }) =>
      readReturnsWorkspace(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
