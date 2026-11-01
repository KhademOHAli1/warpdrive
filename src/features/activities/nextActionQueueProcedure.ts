import { TRPCError } from "@trpc/server";
import { env } from "@/config/env";
import { ERROR_IDS } from "@/constants/errorIds";
import { protectedProcedure } from "@/server/trpc/trpc";
import { queueInputSchema } from "./next-action-queue/queueInput";
import { readNextActionQueue } from "./next-action-queue/readNextActionQueue";

export const nextActionQueueProcedure = protectedProcedure
  .input(queueInputSchema)
  .query(async ({ ctx, input }) => {
    if (!env.SALES_NEXT_ACTION_QUEUE_ENABLED) throw new TRPCError({ code: "NOT_FOUND" });
    if (!ctx.actor.isActive)
      throw new TRPCError({ code: "FORBIDDEN", message: ERROR_IDS.PERM_DENIED });
    const result = await readNextActionQueue(ctx.db, ctx.actor, input, AbortSignal.timeout(10_000));
    if (!result.ok)
      throw new TRPCError({
        code: result.error.id === ERROR_IDS.PERM_DENIED ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
        message: result.error.id,
      });
    return result.value;
  });
