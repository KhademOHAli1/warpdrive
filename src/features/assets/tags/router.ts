import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "@/server/trpc/trpc";
import { readAssetTagPublic, readAssetTagWorkspace } from "./service";
import { isAssetTagToken } from "./tagCodes";

export const assetTagsRouter = router({
  workspace: protectedProcedure.query(({ ctx }) =>
    readAssetTagWorkspace(ctx.db, ctx.session, AbortSignal.timeout(15_000)),
  ),
  // Keep opaque tag tokens out of the Core request URL. The hint does not write to the database.
  publicContactHint: publicProcedure
    .input(z.strictObject({ token: z.string().refine(isAssetTagToken) }))
    .mutation(({ ctx, input }) =>
      readAssetTagPublic(ctx.db, input.token, AbortSignal.timeout(10_000)),
    ),
});
