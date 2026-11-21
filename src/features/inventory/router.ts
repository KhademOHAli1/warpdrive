import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { inventoryCatalogRouter } from "./catalog/router";
import { readInventoryWorkspace } from "./reads";
import { manufacturingReleaseRouter } from "./releases/router";
import { inventorySourcingRouter } from "./sourcing/router";
import { inventoryWarehouseRouter } from "./warehouse/router";

export const inventoryRouter = router({
  catalog: inventoryCatalogRouter,
  releases: manufacturingReleaseRouter,
  sourcing: inventorySourcingRouter,
  warehouse: inventoryWarehouseRouter,
  workspace: protectedProcedure
    .input(z.strictObject({ dealId: z.uuid().toLowerCase().nullable() }))
    .query(({ ctx, input }) =>
      readInventoryWorkspace(ctx.db, ctx.session, input.dealId, AbortSignal.timeout(10_000)),
    ),
});
