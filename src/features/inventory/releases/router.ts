import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import type { ExportIntakeResult } from "./intake/contracts";
import { exportIntakeId, exportIntakeTargetInput } from "./intake/releaseTarget";
import { readExportIntakeJobs } from "./intake/service";
import { readBuildRelease, readReleaseWorkspace } from "./service";

export const manufacturingReleaseRouter = router({
  intake: router({
    jobs: protectedProcedure
      .input(exportIntakeTargetInput.extend({ actorId: exportIntakeId.optional() }))
      .query(({ ctx, input: { actorId, ...target } }) => {
        if (actorId !== undefined && actorId !== ctx.actor.id)
          return {
            ok: false,
            issues: [{ code: "unavailable" }],
          } as const satisfies ExportIntakeResult<never>;
        return readExportIntakeJobs(ctx.db, ctx.session, target, AbortSignal.timeout(10_000));
      }),
  }),
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
