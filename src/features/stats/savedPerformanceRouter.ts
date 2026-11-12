import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { type RequestCsrfFacts, validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import {
  createSavedPerformanceReport,
  listSavedPerformanceReports,
  loadSavedPerformanceReport,
  removeSavedPerformanceReport,
  savedPerformanceDefinition,
} from "./savedPerformanceReports";

const id = z.strictObject({ id: z.uuid() });
const csrfToken = z.string().max(128).nullable();
const save = z.strictObject({
  name: z.string().max(120),
  definition: savedPerformanceDefinition,
  csrfToken,
});
const remove = id.extend({ csrfToken });
const signal = () => AbortSignal.timeout(15_000);

function requireCsrf(facts: RequestCsrfFacts | undefined, token: string | null): void {
  if (!validateRequestCsrf(facts, token).ok) throw new TRPCError({ code: "FORBIDDEN" });
}

export const savedPerformanceRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    listSavedPerformanceReports(ctx.db, { actor: ctx.actor, session: ctx.session }, signal()),
  ),
  load: protectedProcedure
    .input(id)
    .query(({ ctx, input }) =>
      loadSavedPerformanceReport(
        ctx.db,
        { actor: ctx.actor, session: ctx.session },
        input.id,
        signal(),
      ),
    ),
  create: protectedProcedure.input(save).mutation(async ({ ctx, input }) => {
    requireCsrf(ctx.csrf, input.csrfToken);
    return createSavedPerformanceReport(
      ctx.db,
      { actor: ctx.actor, session: ctx.session },
      { name: input.name, definition: input.definition },
      signal(),
    );
  }),
  remove: protectedProcedure.input(remove).mutation(async ({ ctx, input }) => {
    requireCsrf(ctx.csrf, input.csrfToken);
    return removeSavedPerformanceReport(
      ctx.db,
      { actor: ctx.actor, session: ctx.session },
      input.id,
      signal(),
    );
  }),
});
