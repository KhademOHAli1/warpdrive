import { protectedProcedure, router } from "@/server/trpc/trpc";
import { qualityQuery } from "./contracts";
import { readQualityWorkspace } from "./reads";

export const inventoryQualityRouter = router({
  workspace: protectedProcedure
    .input(qualityQuery)
    .query(({ ctx, input }) =>
      readQualityWorkspace(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
