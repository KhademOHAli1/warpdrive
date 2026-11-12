import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { currentNativeActor } from "@/features/auth/currentNativeActor";
import { validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { createLeadFromNewsletterExposure } from "./native";
import { readPersonNewsletterAttribution } from "./service";

const id = z.uuid().transform((value) => value.toLowerCase());
const person = z.strictObject({ personId: id });

function bound(signal: AbortSignal | undefined) {
  const timeout = AbortSignal.timeout(15_000);
  return signal === undefined ? timeout : AbortSignal.any([timeout, signal]);
}

export const newsletterAttributionRouter = router({
  person: protectedProcedure.input(person).query(async ({ ctx, input, signal }) => {
    const bounded = bound(signal);
    const current = await withCurrentAuthority(ctx.db, "read", bounded, (tx) =>
      currentNativeActor(tx, ctx.session, bounded),
    );
    if (current === null) throw new TRPCError({ code: "FORBIDDEN" });
    return readPersonNewsletterAttribution(ctx.db, current.actor, input.personId, bounded);
  }),
  createLead: protectedProcedure
    .input(
      person.extend({
        bindingId: id,
        deliveryId: id,
        operationId: id,
        title: z.string().trim().min(1).max(255),
        csrfToken: z.string().max(128).nullable(),
      }),
    )
    .mutation(async ({ ctx, input, signal }) => {
      if (!validateRequestCsrf(ctx.csrf, input.csrfToken).ok)
        throw new TRPCError({ code: "FORBIDDEN" });
      return createLeadFromNewsletterExposure(ctx.db, ctx.session, input, bound(signal));
    }),
});
