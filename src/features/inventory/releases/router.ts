import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { readBuildRelease, readReleaseWorkspace } from "./service";

export const manufacturingReleaseRouter = router({
  workspace: protectedProcedure
    .input(z.strictObject({ itemId: z.uuid().toLowerCase() }))
    .query(({ ctx, input }) =>
      readReleaseWorkspace(ctx.db, ctx.session, input.itemId, AbortSignal.timeout(10_000)),
    ),
  build: protectedProcedure
    .input(z.strictObject({ orderId: z.uuid().toLowerCase() }))
    .query(({ ctx, input }) =>
      readBuildRelease(ctx.db, ctx.session, input.orderId, AbortSignal.timeout(10_000)),
    ),
});
