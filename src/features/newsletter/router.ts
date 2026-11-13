import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "@/config/env";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { currentNativeActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import { recordAudit } from "@/features/identity/audit";
import type { AppContext } from "@/server/trpc/context";
import { validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { settingsReads, settingsWrites } from "./admin/operations";
import { newsletterAttributionRouter } from "./attribution/router";
import { audienceReads, audienceWrites } from "./audience/operations";
import { campaignReads, campaignWrites } from "./campaigns/operations";
import { crmAudienceReads, crmAudienceWrites } from "./crmAudience/operations";
import { deliveryReads, deliveryWrites } from "./delivery/operations";
import { newsletterIdentityRouter } from "./identity/router";
import { createListmonkClient, newsletterConfigured } from "./listmonkClient";
import { defineLocalOperation, type NewsletterExecution } from "./operation";
import {
  admitNewsletterReceipt,
  finishNewsletterReceipt,
  newsletterIntent,
  newsletterResolutionSchema,
  newsletterUnconfirmed,
  projectNewsletterReceipt,
  readNewsletterReceipt,
  replayNewsletterResult,
  resolveNewsletterReceipt,
} from "./operationReceipts";
import { needsNewsletterReceipt } from "./operationReceiptsPolicy";
import {
  hasNewsletterPermission,
  type NewsletterAccess,
  newsletterOperationAccess,
} from "./permissions";

const status = defineLocalOperation(z.strictObject({}), async (_input, context) => {
  let connected = false;
  let consentVerified = false;
  if (context.configured) {
    try {
      const client = createListmonkClient(context.signal);
      connected = (await client.json("GET", "/api/health")) === true;
      consentVerified = connected && (await client.hasConsentContract());
    } catch {
      // Project service state without disclosing its URL, credentials, or raw diagnostics.
    }
  }
  return {
    configured: context.configured,
    connected,
    consentVerified,
    deliveryEnabled: context.deliveryEnabled && consentVerified,
  };
});

const reads = new Map(
  Object.entries({
    "system.status": status,
    ...campaignReads,
    ...audienceReads,
    ...crmAudienceReads,
    ...deliveryReads,
    ...settingsReads,
  }),
);
const writes = new Map(
  Object.entries({
    ...campaignWrites,
    ...audienceWrites,
    ...crmAudienceWrites,
    ...deliveryWrites,
    ...settingsWrites,
  }),
);

const operationId = z.uuid().transform((value) => value.toLowerCase());

const command = z.strictObject({
  operation: z
    .string()
    .regex(/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/)
    .max(80),
  input: z.record(z.string(), z.unknown()),
});

function execution(
  ctx: AppContext,
  requestSignal: AbortSignal | undefined,
  access: NewsletterAccess,
): NewsletterExecution {
  if (ctx.actor === null || ctx.session === null || !hasNewsletterPermission(ctx.actor, access)) {
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

function publicError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "The campaign service is unavailable.",
  });
}

async function withNewsletterActor<T>(
  context: NewsletterExecution,
  session: NativeSessionRef,
  access: NewsletterAccess,
  run: (current: NewsletterExecution) => Promise<T>,
): Promise<T> {
  try {
    return await withCurrentAuthority(context.db, "read", context.signal, async (tx) => {
      const current = await currentNativeActor(tx, session, context.signal);
      if (
        current === null ||
        current.actor.id !== context.actor.id ||
        !hasNewsletterPermission(current.actor, access)
      ) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return run({ ...context, db: tx, actor: current.actor });
    });
  } catch (error) {
    throw publicError(error);
  }
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
  attribution: newsletterAttributionRouter,
  identity: newsletterIdentityRouter,
  read: protectedProcedure.input(command).query(async ({ ctx, input, signal }) => {
    const context = execution(ctx, signal, newsletterOperationAccess(input.operation, "read"));
    const operation = reads.get(input.operation);
    if (!operation) throw new TRPCError({ code: "NOT_FOUND" });
    try {
      return await operation.run(input.input, context);
    } catch (error) {
      throw publicError(error);
    }
  }),
  receipt: protectedProcedure
    .input(z.strictObject({ operationId }))
    .query(async ({ ctx, input, signal }) => {
      const context = execution(ctx, signal, "view");
      return withNewsletterActor(context, ctx.session, "view", (current) =>
        readNewsletterReceipt(current.db, {
          actorId: current.actor.id,
          operationId: input.operationId,
        }),
      );
    }),
  resolveReceipt: protectedProcedure
    .input(
      newsletterResolutionSchema.extend({ operationId, csrfToken: z.string().max(128).nullable() }),
    )
    .mutation(async ({ ctx, input, signal }) => {
      const context = execution(ctx, signal, "view");
      if (!validateRequestCsrf(ctx.csrf, input.csrfToken).ok)
        throw new TRPCError({ code: "FORBIDDEN" });
      return withNewsletterActor(context, ctx.session, "view", async (current) => {
        const key = { actorId: current.actor.id, operationId: input.operationId };
        const { receipt, recorded } = await resolveNewsletterReceipt(current.db, key, input);
        if (recorded) await audit(current, "operations.resolve", key.operationId, "succeeded");
        return receipt;
      });
    }),
  write: protectedProcedure
    .input(
      command.extend({
        operationId: operationId.optional(),
        csrfToken: z.string().max(128).nullable(),
      }),
    )
    .mutation(async ({ ctx, input, signal }) => {
      const access = newsletterOperationAccess(input.operation, "write");
      const context = execution(ctx, signal, access);
      if (!validateRequestCsrf(ctx.csrf, input.csrfToken).ok)
        throw new TRPCError({ code: "FORBIDDEN" });
      const operation = writes.get(input.operation);
      if (!operation) throw new TRPCError({ code: "NOT_FOUND" });
      const durable = needsNewsletterReceipt(input.operation);
      if (durable && input.operationId === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A campaign operation ID is required.",
        });
      }
      const correlationId = input.operationId ?? randomUUID();
      const key = { actorId: context.actor.id, operationId: correlationId };
      const dispatch = { started: false };
      const executionContext = {
        ...context,
        operationId: correlationId,
        onMutationDispatch: () => {
          dispatch.started = true;
        },
      };
      const prepared = operation.prepare(input.input, executionContext);
      const intent = durable ? newsletterIntent(key, input.operation, prepared.input) : null;
      const { admission, actor } = await withNewsletterActor(
        context,
        ctx.session,
        access,
        async (current) => {
          const receipt = intent === null ? null : await admitNewsletterReceipt(current.db, intent);
          if (receipt?.admitted !== false) {
            await audit(current, input.operation, correlationId, "requested");
          }
          return { admission: receipt, actor: current.actor };
        },
      );
      if (admission?.admitted === false) {
        return replayNewsletterResult(admission.state, admission.result);
      }

      let result: unknown;
      try {
        context.signal.throwIfAborted();
        result = await prepared.execute({ ...executionContext, actor });
        if (durable) {
          await finishNewsletterReceipt(context.db, key, {
            state: "succeeded",
            result: projectNewsletterReceipt(input.operation, result),
          });
        }
      } catch (error) {
        // Any exception after a remote mutation was dispatched is ambiguous, including
        // later validation, subsequent reads, and loss of the local finalization response.
        const state = durable && dispatch.started ? "unknown" : "failed";
        if (durable) {
          await finishNewsletterReceipt(context.db, key, { state, result: null }).catch(
            () => undefined,
          );
        }
        await audit(context, input.operation, correlationId, state).catch(() => undefined);
        throw state === "unknown" ? newsletterUnconfirmed() : publicError(error);
      }
      await audit(context, input.operation, correlationId, "succeeded").catch(() => undefined);
      return result;
    }),
});
