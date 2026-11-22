import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { engineeringFailure } from "./changes/errors";
import { engineeringReviewInput, engineeringWorkspaceInput } from "./changes/nativeContracts";
import { readEngineeringChangeReview, readEngineeringWorkspace } from "./changes/service";
import type { ExportIntakeResult } from "./intake/contracts";
import { exportIntakeId, exportIntakeTargetInput } from "./intake/releaseTarget";
import { readExportIntakeJobs } from "./intake/service";
import { readBuildRelease, readReleaseWorkspace } from "./service";

export const manufacturingReleaseRouter = router({
  changes: router({
    workspace: protectedProcedure.input(engineeringWorkspaceInput).query(({ ctx, input }) => {
      if (input.actorId !== undefined && input.actorId !== ctx.actor.id)
        return engineeringFailure("unavailable");
      return readEngineeringWorkspace(
        ctx.db,
        ctx.session,
        input.itemId,
        AbortSignal.timeout(10_000),
      );
    }),
    review: protectedProcedure.input(engineeringReviewInput).query(({ ctx, input }) => {
      if (input.actorId !== undefined && input.actorId !== ctx.actor.id)
        return engineeringFailure("unavailable");
      return readEngineeringChangeReview(
        ctx.db,
        ctx.session,
        input.itemId,
        input.candidateReleaseId,
        AbortSignal.timeout(15_000),
      );
    }),
  }),
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
