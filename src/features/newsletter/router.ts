import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "@/config/env";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { currentNativeActor } from "@/features/auth/currentNativeActor";
import { guardCsrf } from "@/features/identity/actions/shared";
import { recordAudit } from "@/features/identity/audit";
import type { AppContext } from "@/server/trpc/context";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { settingsReads, settingsWrites } from "./admin/operations";
import { audienceReads, audienceWrites } from "./audience/operations";
import { campaignReads, campaignWrites } from "./campaigns/operations";
import {
  createListmonkClient,
  NewsletterConnectionError,
  newsletterConfigured,
} from "./listmonkClient";
import { defineLocalOperation, type NewsletterExecution } from "./operation";

const status = defineLocalOperation(z.strictObject({}), async (_input, context) => {
  let connected = false;
  if (context.configured) {
    try {
      const client = createListmonkClient(context.signal);
      connected = (await client.json("GET", "/api/health")) === true;
    } catch {
      // Project service state without disclosing its URL, credentials, or raw diagnostics.
    }
  }
  return { configured: context.configured, connected, deliveryEnabled: context.deliveryEnabled };
});

const reads = new Map(
  Object.entries({ "system.status": status, ...campaignReads, ...audienceReads, ...settingsReads }),
);
const writes = new Map(Object.entries({ ...campaignWrites, ...audienceWrites, ...settingsWrites }));

const command = z.strictObject({
  operation: z
    .string()
    .regex(/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/)
    .max(80),
  input: z.record(z.string(), z.unknown()),
});

function execution(ctx: AppContext, requestSignal: AbortSignal | undefined): NewsletterExecution {
  if (ctx.actor?.type !== "admin" || !ctx.actor.isActive || ctx.session === null) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  const timeout = AbortSignal.timeout(15_000);
  const signal = requestSignal ? AbortSignal.any([timeout, requestSignal]) : timeout;
  const configured = newsletterConfigured();
  const deliveryEnabled = configured && env.NEWSLETTER_DELIVERY_ENABLED;
  return {
    db: ctx.db,
    actor: ctx.actor,
    signal,
    configured,
    deliveryEnabled,
    requireDelivery() {
      if (!deliveryEnabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Campaign delivery is disabled.",
        });
      }
    },
  };
}

function publicError(error: unknown, unknownWrite = false): TRPCError {
  if (unknownWrite) {
    return new TRPCError({
      code: "BAD_GATEWAY",
      message: "The campaign service could not confirm the result. Refresh before trying again.",
    });
  }
  if (error instanceof TRPCError) return error;
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "The campaign service is unavailable.",
  });
}

async function audit(
  context: NewsletterExecution,
  operation: string,
  correlationId: string,
  outcome: "requested" | "succeeded" | "failed" | "unknown",
): Promise<void> {
  await recordAudit(
    context.db,
    {
      actorId: context.actor.id,
      targetType: "settings",
      targetId: null,
      action: `newsletter.${operation}`,
      correlationId,
      after: { outcome },
    },
    AbortSignal.timeout(5000),
  );
}

export const newsletterRouter = router({
  read: protectedProcedure.input(command).query(async ({ ctx, input, signal }) => {
    const context = execution(ctx, signal);
    const operation = reads.get(input.operation);
    if (!operation) throw new TRPCError({ code: "NOT_FOUND" });
    try {
      return await operation.run(input.input, context);
    } catch (error) {
      throw publicError(error);
    }
  }),
  write: protectedProcedure
    .input(command.extend({ csrfToken: z.string().max(128).nullable() }))
    .mutation(async ({ ctx, input, signal }) => {
      const context = execution(ctx, signal);
      if (!(await guardCsrf(input.csrfToken)).ok) throw new TRPCError({ code: "FORBIDDEN" });
      const operation = writes.get(input.operation);
      if (!operation) throw new TRPCError({ code: "NOT_FOUND" });
      const correlationId = randomUUID();
      await withCurrentAuthority(context.db, "read", context.signal, async (tx) => {
        const current = await currentNativeActor(tx, ctx.session, context.signal);
        if (current?.actor.type !== "admin" || current.actor.id !== context.actor.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await audit({ ...context, db: tx }, input.operation, correlationId, "requested");
      });
      context.signal.throwIfAborted();
      let result: unknown;
      try {
        result = await operation.run(input.input, context);
      } catch (error) {
        const outcome =
          error instanceof TRPCError ||
          (error instanceof NewsletterConnectionError && !error.uncertain)
            ? "failed"
            : "unknown";
        await audit(context, input.operation, correlationId, outcome).catch(() => undefined);
        throw publicError(error, outcome === "unknown");
      }
      // The initial receipt survives an audit storage failure after the upstream accepted the write.
      await audit(context, input.operation, correlationId, "succeeded").catch(() => undefined);
      return result;
    }),
});
