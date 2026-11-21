import { TRPCError } from "@trpc/server";
import { type RequestCsrfFacts, validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import {
  inviteProjectGuestInput,
  joinPublicProjectInput,
  saveProjectGuestAccessInput,
} from "./contracts";
import { inviteProjectGuest } from "./invitations";
import { joinPublicInternalProject, saveProjectGuestAccess } from "./service";

function requireCurrentActor(
  ctx: { actor: { id: string }; csrf: RequestCsrfFacts | undefined },
  input: { expectedActorId: string; csrfToken: string | null },
) {
  if (input.expectedActorId !== ctx.actor.id || !validateRequestCsrf(ctx.csrf, input.csrfToken).ok)
    throw new TRPCError({ code: "FORBIDDEN" });
}

export const projectGuestRouter = router({
  joinPublic: protectedProcedure.input(joinPublicProjectInput).mutation(({ ctx, input }) => {
    requireCurrentActor(ctx, input);
    return joinPublicInternalProject(
      ctx.db,
      ctx.session,
      input.projectId,
      AbortSignal.timeout(10_000),
    );
  }),
  saveAccess: protectedProcedure.input(saveProjectGuestAccessInput).mutation(({ ctx, input }) => {
    requireCurrentActor(ctx, input);
    return saveProjectGuestAccess(ctx.db, ctx.session, input, AbortSignal.timeout(10_000));
  }),
  invite: protectedProcedure.input(inviteProjectGuestInput).mutation(({ ctx, input }) => {
    requireCurrentActor(ctx, input);
    return inviteProjectGuest(ctx.db, ctx.session, input, AbortSignal.timeout(10_000));
  }),
});
