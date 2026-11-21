import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { inventoryCatalogRouter } from "./catalog/router";
import { readInventoryWorkspace } from "./reads";
import { manufacturingReleaseRouter } from "./releases/router";

export const inventoryRouter = router({
  catalog: inventoryCatalogRouter,
  releases: manufacturingReleaseRouter,
  workspace: protectedProcedure
    .input(z.strictObject({ dealId: z.uuid().toLowerCase().nullable() }))
    .query(({ ctx, input }) =>
      readInventoryWorkspace(ctx.db, ctx.session, input.dealId, AbortSignal.timeout(10_000)),
    ),
});
