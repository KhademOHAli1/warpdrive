import { protectedProcedure, router } from "@/server/trpc/trpc";
import { readAssetsWorkspace } from "./service";

export const assetsRouter = router({
  workspace: protectedProcedure.query(({ ctx }) =>
    readAssetsWorkspace(ctx.db, ctx.session, AbortSignal.timeout(15_000)),
  ),
});
