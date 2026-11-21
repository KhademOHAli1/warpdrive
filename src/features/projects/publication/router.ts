import { type RequestCsrfFacts, validateRequestCsrf } from "@/server/trpc/request-csrf";
import {
  protectedProcedure,
  protectedProjectProcedure,
  publicProcedure,
  router,
} from "@/server/trpc/trpc";
import { err } from "@/types/result";
import {
  myPublishedIntakeRequestsInput,
  publicationSettingsInput,
  publishedBoardInput,
  publishedCoverInput,
  publishedIntakeRequestInput,
  saveProjectPublicationInput,
  submitPublishedIntakeInput,
  updatePublishedIntakeInput,
  withdrawPublishedIntakeInput,
} from "./input";
import {
  readMyPublishedIntakeRequests,
  readProjectPublicationSettings,
  readPublishedIntakeRequest,
  readPublishedProjectBoard,
  readPublishedProjectCover,
  saveProjectPublication,
  submitPublishedProjectIntake,
  updatePublishedIntakeRequest,
  withdrawPublishedIntakeRequest,
} from "./service";

const deadline = () => AbortSignal.timeout(10_000);

function acceptsPublicationWrite(
  ctx: { actor: { id: string }; csrf: RequestCsrfFacts | undefined },
  input: { expectedActorId: string; csrfToken: string | null },
) {
  return (
    ctx.actor.id === input.expectedActorId && validateRequestCsrf(ctx.csrf, input.csrfToken).ok
  );
}

export const projectPublicationRouter = router({
  board: publicProcedure
    .input(publishedBoardInput)
    .query(({ ctx, input }) =>
      readPublishedProjectBoard(ctx.db, input.anchor, input.page, deadline()),
    ),
  cover: publicProcedure
    .input(publishedCoverInput)
    .query(({ ctx, input }) =>
      readPublishedProjectCover(ctx.db, input.anchor, input.version, deadline()),
    ),
  settings: protectedProcedure
    .input(publicationSettingsInput)
    .query(({ ctx, input }) =>
      readProjectPublicationSettings(ctx.db, ctx.session, input.projectId, deadline()),
    ),
  save: protectedProcedure.input(saveProjectPublicationInput).mutation(({ ctx, input }) => {
    if (!acceptsPublicationWrite(ctx, input)) return err("project_forbidden" as const);
    const {
      projectId,
      revision,
      published,
      listEnabled,
      boardEnabled,
      showWorkItems,
      showBranding,
      allowIntake,
    } = input;
    return saveProjectPublication(
      ctx.db,
      ctx.session,
      {
        projectId,
        revision,
        published,
        listEnabled,
        boardEnabled,
        showWorkItems,
        showBranding,
        allowIntake,
      },
      deadline(),
    );
  }),
  submit: protectedProjectProcedure.input(submitPublishedIntakeInput).mutation(({ ctx, input }) => {
    if (!acceptsPublicationWrite(ctx, input)) return err("project_forbidden" as const);
    const { anchor, intentId, title, description, priority } = input;
    return submitPublishedProjectIntake(
      ctx.db,
      ctx.session,
      { anchor, intentId, title, description, priority },
      deadline(),
    );
  }),
  mine: protectedProjectProcedure.input(myPublishedIntakeRequestsInput).query(({ ctx, input }) => {
    if (ctx.actor.id !== input.expectedActorId) return err("project_unavailable" as const);
    return readMyPublishedIntakeRequests(ctx.db, ctx.session, input.anchor, input.page, deadline());
  }),
  request: protectedProjectProcedure.input(publishedIntakeRequestInput).query(({ ctx, input }) => {
    if (ctx.actor.id !== input.expectedActorId) return err("project_unavailable" as const);
    return readPublishedIntakeRequest(ctx.db, ctx.session, input, deadline());
  }),
  update: protectedProjectProcedure.input(updatePublishedIntakeInput).mutation(({ ctx, input }) => {
    if (!acceptsPublicationWrite(ctx, input)) return err("project_forbidden" as const);
    const { anchor, requestId, revision, title, description, priority } = input;
    return updatePublishedIntakeRequest(
      ctx.db,
      ctx.session,
      { anchor, requestId, revision, title, description, priority },
      deadline(),
    );
  }),
  withdraw: protectedProjectProcedure
    .input(withdrawPublishedIntakeInput)
    .mutation(({ ctx, input }) => {
      if (!acceptsPublicationWrite(ctx, input)) return err("project_forbidden" as const);
      const { anchor, requestId, revision } = input;
      return withdrawPublishedIntakeRequest(
        ctx.db,
        ctx.session,
        { anchor, requestId, revision },
        deadline(),
      );
    }),
});
