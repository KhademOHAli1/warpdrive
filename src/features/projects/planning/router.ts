import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { type RequestCsrfFacts, validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { changePlanningGroupItems, readWorkspacePlanning, setItemPlanning } from "./assignments";
import {
  changePlanningGroupItemsInput,
  deletePlanningViewInput,
  planningGroupKey,
  planningGroupKinds,
  planningProjectKey,
  planningViewKey,
  rolloverPlanningCycleInput,
  savePlanningGroupInput,
  savePlanningViewInput,
  setItemPlanningInput,
  setPlanningGroupArchiveInput,
  setPlanningViewArchiveInput,
  setPlanningViewFavoriteInput,
  setPlanningViewLockInput,
} from "./contracts";
import {
  listPlanningGroups,
  readPlanningGroup,
  savePlanningGroup,
  setPlanningGroupArchive,
} from "./groups";
import { rolloverPlanningCycle } from "./rollover";
import {
  deletePlanningView,
  listPlanningViews,
  readPlanningView,
  savePlanningView,
  setPlanningViewArchive,
  setPlanningViewFavorite,
  setPlanningViewLock,
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
  rolloverCycle: protectedProcedure.input(rolloverPlanningCycleInput).mutation(({ ctx, input }) => {
    requirePlanningWrite(ctx, input);
    return rolloverPlanningCycle(ctx.db, ctx.session, input, signal());
  }),
  setViewLock: protectedProcedure.input(setPlanningViewLockInput).mutation(({ ctx, input }) => {
    requirePlanningWrite(ctx, input);
    return setPlanningViewLock(ctx.db, ctx.session, input, signal());
  }),
  setViewFavorite: protectedProcedure
    .input(setPlanningViewFavoriteInput)
    .mutation(({ ctx, input }) => {
      requirePlanningWrite(ctx, input);
      return setPlanningViewFavorite(ctx.db, ctx.session, input, signal());
    }),
  deleteView: protectedProcedure.input(deletePlanningViewInput).mutation(({ ctx, input }) => {
    requirePlanningWrite(ctx, input);
    return deletePlanningView(ctx.db, ctx.session, input, signal());
  }),
});
