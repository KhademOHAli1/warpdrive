import { protectedProcedure, router } from "@/server/trpc/trpc";
import { readEquipmentAudits } from "./service";

export const assetAuditsRouter = router({
  workspace: protectedProcedure.query(({ ctx }) =>
    readEquipmentAudits(ctx.db, ctx.session, AbortSignal.timeout(15_000)),
  ),
});
