import { protectedProcedure, router } from "@/server/trpc/trpc";
import { warehouseQuery } from "./contracts";
import { readWarehouseWorkspace } from "./service";

export const inventoryWarehouseRouter = router({
  workspace: protectedProcedure
    .input(warehouseQuery)
    .query(({ ctx, input }) =>
      readWarehouseWorkspace(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
