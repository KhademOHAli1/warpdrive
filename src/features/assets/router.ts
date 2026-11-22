import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assetBookingsRouter } from "./bookings/router";
import { readAssetsWorkspace } from "./service";
import { assetTagsRouter } from "./tags/router";

export const assetsRouter = router({
  bookings: assetBookingsRouter,
  tags: assetTagsRouter,
  workspace: protectedProcedure.query(({ ctx }) =>
    readAssetsWorkspace(ctx.db, ctx.session, AbortSignal.timeout(15_000)),
  ),
});
