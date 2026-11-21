import { TRPCError } from "@trpc/server";
import { type RequestCsrfFacts, validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProcedure, protectedProjectProcedure, router } from "@/server/trpc/trpc";
import { projectIdInput } from "../input";
import {
  archiveProjectItemInput,
  projectAutomationKey,
  saveProjectAutomationInput,
} from "./contracts";
import {
  archiveProjectItem,
  isProjectItemArchived,
  readArchivedProjectItems,
  readProjectAutomation,
  saveProjectAutomation,
} from "./service";

function authorizeWrite(
  ctx: { actor: { id: string }; csrf: RequestCsrfFacts | undefined },
  { expectedActorId, csrfToken }: { expectedActorId: string; csrfToken: string | null },
) {
  if (ctx.actor.id !== expectedActorId || !validateRequestCsrf(ctx.csrf, csrfToken).ok)
    throw new TRPCError({ code: "FORBIDDEN" });
}

const signal = () => AbortSignal.timeout(10_000);

export const projectAutomationRouter = router({
  settings: protectedProcedure
    .input(projectAutomationKey)
    .query(({ ctx, input }) =>
      readProjectAutomation(ctx.db, ctx.session, input.projectId, signal()),
    ),
  archive: protectedProjectProcedure
    .input(projectAutomationKey)
    .query(({ ctx, input }) =>
      readArchivedProjectItems(ctx.db, ctx.session, input.projectId, signal()),
    ),
  archiveLookup: protectedProjectProcedure
    .input(projectAutomationKey.extend({ itemId: projectIdInput }))
    .query(({ ctx, input }) =>
      isProjectItemArchived(ctx.db, ctx.session, input.projectId, input.itemId, signal()),
    ),
  save: protectedProcedure.input(saveProjectAutomationInput).mutation(({ ctx, input }) => {
    authorizeWrite(ctx, input);
    return saveProjectAutomation(ctx.db, ctx.session, input, signal());
  }),
  setItemArchived: protectedProcedure.input(archiveProjectItemInput).mutation(({ ctx, input }) => {
    authorizeWrite(ctx, input);
    return archiveProjectItem(ctx.db, ctx.session, input, signal());
  }),
});
