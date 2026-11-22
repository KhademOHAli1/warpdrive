import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { readAssetAuditHistory } from "./history/service";
import { readEquipmentAudits } from "./service";

export const assetAuditsRouter = router({
  workspace: protectedProcedure.query(({ ctx }) =>
    readEquipmentAudits(ctx.db, ctx.session, AbortSignal.timeout(15_000)),
  ),
  assetHistory: protectedProcedure
    .input(z.object({ assetId: z.uuid().toLowerCase() }))
    .query(({ ctx, input }) =>
      readAssetAuditHistory(ctx.db, ctx.session, input.assetId, AbortSignal.timeout(15_000)),
    ),
});
