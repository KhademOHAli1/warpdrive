import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import type { Result } from "@/types/result";
import {
  getWorkflow,
  listWorkflows,
  readRunHistory,
  readWorkflowVersion,
  readWorkflowVersions,
} from "./queries";
import { readRunDetail } from "./runDetail";

function unwrap<T>(result: Result<T, string>) {
  if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.error });
  return result.value;
}
export const workflowsRouter = router({
  run: protectedProcedure
    .input(z.strictObject({ id: z.string().uuid(), runId: z.string().uuid() }))
    .query(async ({ ctx, input }) =>
      unwrap(
        await readRunDetail(ctx.db, ctx.actor, input.id, input.runId, AbortSignal.timeout(10_000)),
      ),
    ),
  list: protectedProcedure.query(async ({ ctx }) =>
    unwrap(await listWorkflows(ctx.db, ctx.actor, AbortSignal.timeout(10_000))),
  ),
  get: protectedProcedure
    .input(z.strictObject({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) =>
      unwrap(await getWorkflow(ctx.db, ctx.actor, input.id, AbortSignal.timeout(10_000))),
    ),
  runs: protectedProcedure
    .input(z.strictObject({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) =>
      unwrap(await readRunHistory(ctx.db, ctx.actor, input.id, AbortSignal.timeout(10_000))),
    ),
  versions: protectedProcedure
    .input(z.strictObject({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) =>
      unwrap(await readWorkflowVersions(ctx.db, ctx.actor, input.id, AbortSignal.timeout(10_000))),
    ),
  version: protectedProcedure
    .input(
      z.strictObject({
        id: z.string().uuid(),
        versionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .query(async ({ ctx, input }) =>
      unwrap(await readWorkflowVersion(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000))),
    ),
});
