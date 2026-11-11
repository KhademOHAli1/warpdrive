import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { currentNativeActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import { guardCsrf } from "@/features/identity/actions/shared";
import { recordAudit } from "@/features/identity/audit";
import type { AppContext } from "@/server/trpc/context";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { newsletterPersonAddresses } from "../schema/personAddresses";
import { canonicalNewsletterAddress, requireNewsletterPerson } from "./authority";
import type { IdentityCommandResult } from "./contracts";
import { approveNewsletterErasure, executeNewsletterErasure } from "./erasure";
import { listPersonNewsletterEvents } from "./events";
import { detachNewsletterPersonLinks } from "./lifecycle";
import { readPersonNewsletter } from "./service";
import {
  beginNewsletterProof,
  reconcileNewsletterIdentity,
  requestNewsletterInvite,
  withNewsletterIdentityActor,
} from "./write";

const id = z.uuid().transform((value) => value.toLowerCase());
const person = z.strictObject({ personId: id });
const command = person.extend({ operationId: id, csrfToken: z.string().max(128).nullable() });
const erasure = command.extend({ linkId: id, privacyCaseId: id });
const evidenceReference = z
  .string()
  .trim()
  .max(36)
  .regex(
    /^(?:[1-9][0-9]{0,15}|[A-Z]{2,12}-[0-9]{1,16}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$/,
  );

async function nativeContext(
  ctx: AppContext,
  session: NativeSessionRef,
  signal?: AbortSignal,
  csrfToken?: string | null,
) {
  if (csrfToken !== undefined && !(await guardCsrf(csrfToken)).ok)
    throw new TRPCError({ code: "FORBIDDEN" });
  const timeout = AbortSignal.timeout(15_000);
  const bounded = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  const current = await withCurrentAuthority(ctx.db, "read", bounded, (tx) =>
    currentNativeActor(tx, session, bounded),
  );
  if (current === null || current.actor.id !== ctx.actor?.id)
    throw new TRPCError({ code: "FORBIDDEN" });
  return { actor: current.actor, bounded };
}

export const newsletterIdentityRouter = router({
  person: protectedProcedure.input(person).query(async ({ ctx, input, signal }) => {
    const { actor, bounded } = await nativeContext(ctx, ctx.session, signal);
    return readPersonNewsletter(ctx.db, actor, input.personId, bounded);
  }),
  history: protectedProcedure.input(person).query(async ({ ctx, input, signal }) => {
    const { actor, bounded } = await nativeContext(ctx, ctx.session, signal);
    return listPersonNewsletterEvents(ctx.db, actor, input.personId, bounded);
  }),
  beginProof: protectedProcedure
    .input(command.extend({ address: canonicalNewsletterAddress, evidenceReference }))
    .mutation(async ({ ctx, input, signal }) => {
      const { actor, bounded } = await nativeContext(ctx, ctx.session, signal, input.csrfToken);
      return beginNewsletterProof(ctx.db, actor, input, bounded);
    }),
  reconcile: protectedProcedure
    .input(command.extend({ claimId: id }))
    .mutation(async ({ ctx, input, signal }) => {
      const { actor, bounded } = await nativeContext(ctx, ctx.session, signal, input.csrfToken);
      return reconcileNewsletterIdentity(ctx.db, actor, input.personId, input.claimId, bounded);
    }),
  invite: protectedProcedure
    .input(command.extend({ linkId: id, listId: z.number().int().positive().safe() }))
    .mutation(async ({ ctx, input, signal }) => {
      const { actor, bounded } = await nativeContext(ctx, ctx.session, signal, input.csrfToken);
      return requestNewsletterInvite(ctx.db, actor, input, bounded);
    }),
  detach: protectedProcedure
    .input(command.extend({ linkId: id }))
    .mutation(async ({ ctx, input, signal }): Promise<IdentityCommandResult> => {
      const { actor, bounded } = await nativeContext(ctx, ctx.session, signal, input.csrfToken);
      return withNewsletterIdentityActor(ctx.db, actor, bounded, "consent", async (tx, current) => {
        await requireNewsletterPerson(tx, current, input.personId, bounded, true);
        const [link] = await tx
          .select({ detachedAt: newsletterPersonAddresses.detachedAt })
          .from(newsletterPersonAddresses)
          .where(
            and(
              eq(newsletterPersonAddresses.id, input.linkId),
              eq(newsletterPersonAddresses.personId, input.personId),
            ),
          );
        if (link === undefined) throw new TRPCError({ code: "NOT_FOUND" });
        if (link.detachedAt !== null) return { id: input.linkId, state: "detached" };
        const result = await detachNewsletterPersonLinks(tx, input.personId, bounded, {
          reason: "operator",
          linkId: input.linkId,
        });
        if (!result.ok) return { id: input.linkId, state: "unknown" };
        await recordAudit(
          tx,
          {
            actorId: current.id,
            targetType: "settings",
            targetId: null,
            action: "newsletter.identity.detach",
            correlationId: input.operationId,
            after: { outcome: "succeeded" },
          },
          bounded,
        );
        return { id: input.linkId, state: "detached" };
      });
    }),
  approveErasure: protectedProcedure.input(erasure).mutation(async ({ ctx, input, signal }) => {
    const { actor, bounded } = await nativeContext(ctx, ctx.session, signal, input.csrfToken);
    return approveNewsletterErasure(ctx.db, actor, ctx.session, input, bounded);
  }),
  erase: protectedProcedure.input(erasure).mutation(async ({ ctx, input, signal }) => {
    const { actor, bounded } = await nativeContext(ctx, ctx.session, signal, input.csrfToken);
    return executeNewsletterErasure(ctx.db, actor, ctx.session, input, bounded);
  }),
});
