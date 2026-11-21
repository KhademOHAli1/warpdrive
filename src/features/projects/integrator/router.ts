import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { canonicalUuidSchema } from "@/features/agency-projects/valueSchemas";
import { type RequestCsrfFacts, validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { projectIntegratorAccess } from "./contracts";
import {
  issueProjectIntegratorKey,
  listProjectIntegratorKeys,
  revokeProjectIntegratorKey,
} from "./management";

const deadline = () => AbortSignal.timeout(10_000);
const identityFields = {
  expectedActorId: canonicalUuidSchema,
  csrfToken: z.string().max(128).nullable(),
};

function requireIntegratorWrite(
  ctx: { actor: { id: string }; csrf: RequestCsrfFacts | undefined },
  input: { expectedActorId: string; csrfToken: string | null },
) {
  if (ctx.actor.id !== input.expectedActorId || !validateRequestCsrf(ctx.csrf, input.csrfToken).ok)
    throw new TRPCError({ code: "FORBIDDEN" });
}

export const projectIntegratorRouter = router({
  keys: protectedProcedure.query(({ ctx }) =>
    listProjectIntegratorKeys(ctx.db, ctx.session, deadline()),
  ),
  issue: protectedProcedure
    .input(
      z.strictObject({
        ...identityFields,
        name: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .refine((name) => !/\p{Cc}|\p{Cs}/u.test(name)),
        access: z.enum(projectIntegratorAccess),
        expiresAt: z.iso.datetime({ offset: true }).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => {
      requireIntegratorWrite(ctx, input);
      return issueProjectIntegratorKey(ctx.db, ctx.session, input, deadline());
    }),
  revoke: protectedProcedure
    .input(
      z.strictObject({
        ...identityFields,
        keyId: canonicalUuidSchema,
      }),
    )
    .mutation(({ ctx, input }) => {
      requireIntegratorWrite(ctx, input);
      return revokeProjectIntegratorKey(ctx.db, ctx.session, input.keyId, deadline());
    }),
});
