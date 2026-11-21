import { protectedProcedure, router } from "@/server/trpc/trpc";
import { catalogQuery } from "./contracts";
import { readCatalogWorkspace } from "./service";

export const inventoryCatalogRouter = router({
  workspace: protectedProcedure
    .input(catalogQuery)
    .query(({ ctx, input }) =>
      readCatalogWorkspace(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
