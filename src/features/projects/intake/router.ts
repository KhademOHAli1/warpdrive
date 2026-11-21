import { TRPCError } from "@trpc/server";
import { type RequestCsrfFacts, validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProjectProcedure, router } from "@/server/trpc/trpc";
import {
  createProjectIntakeInput,
  findIntakeWorkItemsInput,
  projectIntakeWorkspaceInput,
  reviewProjectIntakeInput,
  setProjectIntakeEnabledInput,
  updateProjectIntakeInput,
  withdrawProjectIntakeInput,
} from "./input";
import {
  createProjectIntake,
  findIntakeWorkItems,
  readProjectIntake,
  reviewProjectIntake,
  setProjectIntakeEnabled,
  updateProjectIntake,
  withdrawProjectIntake,
} from "./service";

const deadline = () => AbortSignal.timeout(10_000);

function requireIntakeWrite(
  ctx: { actor: { id: string }; csrf: RequestCsrfFacts | undefined },
  input: { expectedActorId: string; csrfToken: string | null },
) {
  if (ctx.actor.id !== input.expectedActorId || !validateRequestCsrf(ctx.csrf, input.csrfToken).ok)
    throw new TRPCError({ code: "FORBIDDEN" });
}

export const projectIntakeRouter = router({
  workspace: protectedProjectProcedure
    .input(projectIntakeWorkspaceInput)
    .query(({ ctx, input }) => readProjectIntake(ctx.db, ctx.session, input, deadline())),
  workItems: protectedProjectProcedure
    .input(findIntakeWorkItemsInput)
    .query(({ ctx, input }) =>
      findIntakeWorkItems(ctx.db, ctx.session, input.projectId, input.search, deadline()),
    ),
  create: protectedProjectProcedure.input(createProjectIntakeInput).mutation(({ ctx, input }) => {
    requireIntakeWrite(ctx, input);
    return createProjectIntake(ctx.db, ctx.session, input, deadline());
  }),
  update: protectedProjectProcedure.input(updateProjectIntakeInput).mutation(({ ctx, input }) => {
    requireIntakeWrite(ctx, input);
    return updateProjectIntake(ctx.db, ctx.session, input, deadline());
  }),
  withdraw: protectedProjectProcedure
    .input(withdrawProjectIntakeInput)
    .mutation(({ ctx, input }) => {
      requireIntakeWrite(ctx, input);
      return withdrawProjectIntake(ctx.db, ctx.session, input, deadline());
    }),
  review: protectedProjectProcedure.input(reviewProjectIntakeInput).mutation(({ ctx, input }) => {
    requireIntakeWrite(ctx, input);
    return reviewProjectIntake(ctx.db, ctx.session, input, deadline());
  }),
  setEnabled: protectedProjectProcedure
    .input(setProjectIntakeEnabledInput)
    .mutation(({ ctx, input }) => {
      requireIntakeWrite(ctx, input);
      return setProjectIntakeEnabled(ctx.db, ctx.session, input, deadline());
    }),
});
