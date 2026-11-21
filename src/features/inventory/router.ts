import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { inventoryBomRouter } from "./bom/router";
import { inventoryCatalogRouter } from "./catalog/router";
import { inventoryProductionRouter } from "./production/router";
import { inventoryPurchasingRouter } from "./purchasing/router";
import { inventoryQualityRouter } from "./quality/router";
import { readInventoryWorkspace } from "./reads";
import { manufacturingReleaseRouter } from "./releases/router";
import { inventorySalesRouter } from "./sales/router";
import { inventorySourcingRouter } from "./sourcing/router";
import { inventoryWarehouseRouter } from "./warehouse/router";

export const inventoryRouter = router({
  bom: inventoryBomRouter,
  catalog: inventoryCatalogRouter,
  production: inventoryProductionRouter,
  purchasing: inventoryPurchasingRouter,
  quality: inventoryQualityRouter,
  releases: manufacturingReleaseRouter,
  sales: inventorySalesRouter,
  sourcing: inventorySourcingRouter,
  warehouse: inventoryWarehouseRouter,
  workspace: protectedProcedure
    .input(z.strictObject({ dealId: z.uuid().toLowerCase().nullable() }))
    .query(({ ctx, input }) =>
      readInventoryWorkspace(ctx.db, ctx.session, input.dealId, AbortSignal.timeout(10_000)),
    ),
});
