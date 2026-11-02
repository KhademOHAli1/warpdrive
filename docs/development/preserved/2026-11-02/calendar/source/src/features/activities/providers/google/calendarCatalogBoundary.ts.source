import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { protectedProcedure } from "@/server/trpc/trpc";
import { listGoogleCalendarCatalog } from "./calendarCatalog";

export const googleCalendarCatalogQuery = protectedProcedure
  .input(z.strictObject({ accountId: z.uuid() }))
  .query(async ({ ctx, input }) => {
    const signal = AbortSignal.timeout(10_000);
    const result = await listGoogleCalendarCatalog(ctx.db, ctx.actor.id, input.accountId, signal);
    signal.throwIfAborted();
    if (result.ok) return result.value;
    if (result.error.kind === "unauthorized")
      throw new TRPCError({ code: "UNAUTHORIZED", message: ERROR_IDS.AUTH_SESSION_DEAD });
    if (result.error.kind === "not_found" || result.error.kind === "forbidden")
      throw new TRPCError({ code: "NOT_FOUND", message: ERROR_IDS.CALENDAR_CATALOG_FAILED });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: ERROR_IDS.CALENDAR_CATALOG_FAILED,
    });
  });
