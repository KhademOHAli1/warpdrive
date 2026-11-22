import { protectedProcedure, router } from "@/server/trpc/trpc";
import { readLabelWorkspace } from "./service";

export const physicalLabelsRouter = router({
  workspace: protectedProcedure.query(({ ctx }) =>
    readLabelWorkspace(ctx.db, ctx.session, AbortSignal.timeout(15_000)),
  ),
});
