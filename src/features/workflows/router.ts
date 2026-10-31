import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import type { Result } from "@/types/result";
import { getWorkflow, listWorkflows, readRunHistory } from "./queries";

function unwrap<T>(result: Result<T, string>) {
  if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.error });
  return result.value;
}
export const workflowsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) =>
    unwrap(await listWorkflows(ctx.db, ctx.actor, AbortSignal.timeout(10_000))),
  ),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) =>
      unwrap(await getWorkflow(ctx.db, ctx.actor, input.id, AbortSignal.timeout(10_000))),
    ),
  runs: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) =>
      unwrap(await readRunHistory(ctx.db, ctx.actor, input.id, AbortSignal.timeout(10_000))),
    ),
});
