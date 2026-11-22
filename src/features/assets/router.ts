import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assetAuditsRouter } from "./audits/router";
import { assetBookingsRouter } from "./bookings/router";
import { readAssetsWorkspace } from "./service";
import { assetTagsRouter } from "./tags/router";

export const assetsRouter = router({
  audits: assetAuditsRouter,
  bookings: assetBookingsRouter,
  tags: assetTagsRouter,
  workspace: protectedProcedure.query(async ({ ctx }) => {
    const result = await readAssetsWorkspace(ctx.db, ctx.session, AbortSignal.timeout(15_000));
    return result.ok && result.value.sites.length > 0
      ? { ...result, value: { ...result.value, mediaAvailable: true as const } }
      : result;
  }),
});
