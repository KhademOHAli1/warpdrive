import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import type { Result } from "@/types/result";
import { createWorkflowV2Adapters } from "./adapters";
import { listWorkflowAllEngines, workflowAllEnginesInputSchema } from "./library";
import { listWorkflowV2, readWorkflowV2 } from "./persistence";
import { listWorkflowV2Runs, readWorkflowV2Run, resolveWorkflowEngine } from "./queries";
import { lookupWorkflowV2Records, readWorkflowV2Studio } from "./studio";

function unwrap<T>(result: Result<T, string>) {
  if (!result.ok) throw new TRPCError({ code: "FORBIDDEN", message: result.error });
  return result.value;
}
const id = z.strictObject({ id: z.uuid() });
export const workflowsV2Router = router({
  library: protectedProcedure
    .input(workflowAllEnginesInputSchema.optional())
    .query(async ({ ctx, input }) =>
      unwrap(await listWorkflowAllEngines(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000))),
    ),
  list: protectedProcedure.query(async ({ ctx }) =>
    unwrap(await listWorkflowV2(ctx.db, ctx.actor, AbortSignal.timeout(10_000))),
  ),
  get: protectedProcedure
    .input(id)
    .query(async ({ ctx, input }) =>
      unwrap(await readWorkflowV2(ctx.db, ctx.actor, input.id, AbortSignal.timeout(10_000))),
    ),
  engine: protectedProcedure
    .input(id)
    .query(async ({ ctx, input }) =>
      unwrap(await resolveWorkflowEngine(ctx.db, ctx.actor, input.id, AbortSignal.timeout(10_000))),
    ),
  runs: protectedProcedure
    .input(id)
    .query(async ({ ctx, input }) =>
      unwrap(await listWorkflowV2Runs(ctx.db, ctx.actor, input.id, AbortSignal.timeout(10_000))),
    ),
  run: protectedProcedure
    .input(id)
    .query(async ({ ctx, input }) =>
      unwrap(await readWorkflowV2Run(ctx.db, ctx.actor, input.id, AbortSignal.timeout(10_000))),
    ),
  studio: protectedProcedure.query(async ({ ctx }) =>
    unwrap(
      await readWorkflowV2Studio(
        ctx.db,
        ctx.actor,
        createWorkflowV2Adapters(),
        AbortSignal.timeout(15_000),
      ),
    ),
  ),
  records: protectedProcedure
    .input(
      z.strictObject({
        objectName: z.enum(["deal", "lead", "person", "organization", "activity"]),
        search: z.string().max(200).default(""),
      }),
    )
    .query(async ({ ctx, input }) =>
      unwrap(await lookupWorkflowV2Records(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000))),
    ),
});
