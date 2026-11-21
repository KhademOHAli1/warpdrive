import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { type RequestCsrfFacts, validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { changePlanningGroupItems, readWorkspacePlanning, setItemPlanning } from "./assignments";
import {
  changePlanningGroupItemsInput,
  planningGroupKey,
  planningGroupKinds,
  planningProjectKey,
  planningViewKey,
  savePlanningGroupInput,
  savePlanningViewInput,
  setItemPlanningInput,
  setPlanningGroupArchiveInput,
  setPlanningViewArchiveInput,
} from "./contracts";
import {
  listPlanningGroups,
  readPlanningGroup,
  savePlanningGroup,
  setPlanningGroupArchive,
} from "./groups";
import {
  listPlanningViews,
  readPlanningView,
  savePlanningView,
  setPlanningViewArchive,
} from "./views";

const signal = () => AbortSignal.timeout(10_000);

function requirePlanningWrite(
  ctx: { actor: { id: string }; csrf: RequestCsrfFacts | undefined },
  input: { expectedActorId: string; csrfToken: string | null },
) {
  if (ctx.actor.id !== input.expectedActorId || !validateRequestCsrf(ctx.csrf, input.csrfToken).ok)
    throw new TRPCError({ code: "FORBIDDEN" });
}

export const projectPlanningRouter = router({
  workspace: protectedProcedure
    .input(planningProjectKey)
    .query(({ ctx, input }) =>
      readWorkspacePlanning(ctx.db, ctx.session, input.projectId, signal()),
    ),
  groups: protectedProcedure
    .input(planningProjectKey.extend({ kind: z.enum(planningGroupKinds) }))
    .query(({ ctx, input }) =>
      listPlanningGroups(ctx.db, ctx.session, input.projectId, input.kind, signal()),
    ),
  group: protectedProcedure
    .input(planningGroupKey)
    .query(({ ctx, input }) => readPlanningGroup(ctx.db, ctx.session, input, signal())),
  views: protectedProcedure
    .input(planningProjectKey)
    .query(({ ctx, input }) => listPlanningViews(ctx.db, ctx.session, input.projectId, signal())),
  view: protectedProcedure
    .input(planningViewKey)
    .query(({ ctx, input }) => readPlanningView(ctx.db, ctx.session, input, signal())),
  saveGroup: protectedProcedure.input(savePlanningGroupInput).mutation(({ ctx, input }) => {
    requirePlanningWrite(ctx, input);
    return savePlanningGroup(ctx.db, ctx.session, input, signal());
  }),
  archiveGroup: protectedProcedure
    .input(setPlanningGroupArchiveInput)
    .mutation(({ ctx, input }) => {
      requirePlanningWrite(ctx, input);
      return setPlanningGroupArchive(ctx.db, ctx.session, input, signal());
    }),
  changeGroupItems: protectedProcedure
    .input(changePlanningGroupItemsInput)
    .mutation(({ ctx, input }) => {
      requirePlanningWrite(ctx, input);
      return changePlanningGroupItems(ctx.db, ctx.session, input, signal());
    }),
  setItemPlanning: protectedProcedure.input(setItemPlanningInput).mutation(({ ctx, input }) => {
    requirePlanningWrite(ctx, input);
    return setItemPlanning(ctx.db, ctx.session, input, signal());
  }),
  saveView: protectedProcedure.input(savePlanningViewInput).mutation(({ ctx, input }) => {
    requirePlanningWrite(ctx, input);
    return savePlanningView(ctx.db, ctx.session, input, signal());
  }),
  archiveView: protectedProcedure.input(setPlanningViewArchiveInput).mutation(({ ctx, input }) => {
    requirePlanningWrite(ctx, input);
    return setPlanningViewArchive(ctx.db, ctx.session, input, signal());
  }),
});
