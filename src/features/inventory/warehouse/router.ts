import { protectedProcedure, router } from "@/server/trpc/trpc";
import { warehouseQuery } from "./contracts";
import { readWarehouseInstallations } from "./operations/installationsRead";
import {
  warehouseInstallationsQuery,
  warehouseMovementHistoryQuery,
  warehouseTransfersQuery,
} from "./operations/readContracts";
import { readWarehouseMovementHistory, readWarehouseTransfers } from "./operations/reads";
import { readWarehouseWorkspace } from "./service";
import { stocktakesRouter } from "./stocktakes/router";

export const inventoryWarehouseRouter = router({
  stocktakes: stocktakesRouter,
  installations: protectedProcedure
    .input(warehouseInstallationsQuery)
    .query(({ ctx, input }) =>
      readWarehouseInstallations(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
  history: protectedProcedure
    .input(warehouseMovementHistoryQuery)
    .query(({ ctx, input }) =>
      readWarehouseMovementHistory(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
  transfers: protectedProcedure
    .input(warehouseTransfersQuery)
    .query(({ ctx, input }) =>
      readWarehouseTransfers(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
  workspace: protectedProcedure
    .input(warehouseQuery)
    .query(({ ctx, input }) =>
      readWarehouseWorkspace(ctx.db, ctx.session, input, AbortSignal.timeout(15_000)),
    ),
});
