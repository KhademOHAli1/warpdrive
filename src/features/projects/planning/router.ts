import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { type RequestCsrfFacts, validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProjectProcedure, router } from "@/server/trpc/trpc";
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
  workspace: protectedProjectProcedure
    .input(planningProjectKey)
    .query(({ ctx, input }) =>
      readWorkspacePlanning(ctx.db, ctx.session, input.projectId, signal()),
    ),
  groups: protectedProjectProcedure
    .input(planningProjectKey.extend({ kind: z.enum(planningGroupKinds) }))
    .query(({ ctx, input }) =>
      listPlanningGroups(ctx.db, ctx.session, input.projectId, input.kind, signal()),
    ),
  group: protectedProjectProcedure
    .input(planningGroupKey)
    .query(({ ctx, input }) => readPlanningGroup(ctx.db, ctx.session, input, signal())),
  views: protectedProjectProcedure
    .input(planningProjectKey)
    .query(({ ctx, input }) => listPlanningViews(ctx.db, ctx.session, input.projectId, signal())),
  view: protectedProjectProcedure
    .input(planningViewKey)
    .query(({ ctx, input }) => readPlanningView(ctx.db, ctx.session, input, signal())),
  saveGroup: protectedProjectProcedure.input(savePlanningGroupInput).mutation(({ ctx, input }) => {
    requirePlanningWrite(ctx, input);
    return savePlanningGroup(ctx.db, ctx.session, input, signal());
  }),
  archiveGroup: protectedProjectProcedure
    .input(setPlanningGroupArchiveInput)
    .mutation(({ ctx, input }) => {
      requirePlanningWrite(ctx, input);
      return setPlanningGroupArchive(ctx.db, ctx.session, input, signal());
    }),
  changeGroupItems: protectedProjectProcedure
    .input(changePlanningGroupItemsInput)
    .mutation(({ ctx, input }) => {
      requirePlanningWrite(ctx, input);
      return changePlanningGroupItems(ctx.db, ctx.session, input, signal());
    }),
  setItemPlanning: protectedProjectProcedure
    .input(setItemPlanningInput)
    .mutation(({ ctx, input }) => {
      requirePlanningWrite(ctx, input);
      return setItemPlanning(ctx.db, ctx.session, input, signal());
    }),
  saveView: protectedProjectProcedure.input(savePlanningViewInput).mutation(({ ctx, input }) => {
    requirePlanningWrite(ctx, input);
    return savePlanningView(ctx.db, ctx.session, input, signal());
  }),
  archiveView: protectedProjectProcedure
    .input(setPlanningViewArchiveInput)
    .mutation(({ ctx, input }) => {
      requirePlanningWrite(ctx, input);
      return setPlanningViewArchive(ctx.db, ctx.session, input, signal());
    }),
  rolloverCycle: protectedProjectProcedure
    .input(rolloverPlanningCycleInput)
    .mutation(({ ctx, input }) => {
      requirePlanningWrite(ctx, input);
      return rolloverPlanningCycle(ctx.db, ctx.session, input, signal());
    }),
  setViewLock: protectedProjectProcedure
    .input(setPlanningViewLockInput)
    .mutation(({ ctx, input }) => {
      requirePlanningWrite(ctx, input);
      return setPlanningViewLock(ctx.db, ctx.session, input, signal());
    }),
  setViewFavorite: protectedProjectProcedure
    .input(setPlanningViewFavoriteInput)
    .mutation(({ ctx, input }) => {
      requirePlanningWrite(ctx, input);
      return setPlanningViewFavorite(ctx.db, ctx.session, input, signal());
    }),
  deleteView: protectedProjectProcedure
    .input(deletePlanningViewInput)
    .mutation(({ ctx, input }) => {
      requirePlanningWrite(ctx, input);
      return deletePlanningView(ctx.db, ctx.session, input, signal());
    }),
});
