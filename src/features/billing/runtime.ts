import { createHash } from "node:crypto";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { workflowCsrf } from "@/features/auth/better/workflowHttp";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { parseBillingConfig } from "./config";
import { BillingError } from "./contracts";
import { billingFailure, billingJson, boundedBody, createBillingHttp } from "./http";
import { BillingService } from "./service";
import { DrizzleBillingStore } from "./store";
import {
  MAX_STRIPE_WEBHOOK_BYTES,
  StripeGateway,
  StripeProviderError,
  verifyStripeWebhook,
} from "./stripe";

function runtime(signal: AbortSignal) {
  const config = parseBillingConfig(env, env.BASE_URL);
  if (config === null) return null;
  return {
    config,
    service: new BillingService(
      new DrizzleBillingStore(db, signal),
      new StripeGateway({ ...config, signal }),
      config,
    ),
  };
}

export const billingHttp = createBillingHttp({
  service: (signal) => runtime(signal)?.service ?? null,
  async authorized(request, mutation, signal, run) {
    if (mutation && !workflowCsrf(request))
      return billingJson({ ok: false, error: { code: "forbidden" } }, 403);
    // Reuse the durable limiter; authenticated actor-specific buckets avoid cross-user contention.
    const initial = await resolveWorkflowSession(db, request.headers, signal, {
      requireFresh: mutation,
    });
    if (initial === null)
      return billingJson(
        { ok: false, error: { code: mutation ? "fresh_auth_required" : "unauthorized" } },
        401,
      );
    if (!initial.user.isAdmin) return billingJson({ ok: false, error: { code: "forbidden" } }, 403);
    if (!(await enforceAuthRateLimit(db, request.headers, "/billing", initial.user.id, signal)))
      return billingJson({ ok: false, error: { code: "rate_limited" } }, 429);
    // Hold the shared fence across capacity reads AND provider writes. Public user
    // invitation/reactivation writers take its exclusive side before changing users.
    return withCurrentAuthority(db, "read", signal, async (authorityDb) => {
      const authorize = async () => {
        signal.throwIfAborted();
        const live = await resolveWorkflowSession(authorityDb, request.headers, signal, {
          requireFresh: mutation,
        });
        if (live === null || !live.user.isAdmin || live.user.id !== initial.user.id)
          throw new BillingError("forbidden");
      };
      await authorize();
      const response = await run({ id: initial.user.id, authorize });
      await authorize();
      return response;
    });
  },
});

export async function stripeWebhook(request: Request): Promise<Response> {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
  try {
    const billing = runtime(signal);
    if (billing === null) throw new BillingError("not_configured");
    const raw = await boundedBody(request, MAX_STRIPE_WEBHOOK_BYTES, signal);
    const event = verifyStripeWebhook(raw, request.headers.get("stripe-signature"), {
      secret: billing.config.webhookSecret,
      livemode: billing.config.livemode === true,
    });
    // Pin the configured snapshot destination. Different API shapes require an explicit adapter review.
    if (event.api_version !== "2026-10-28.endive")
      return billingJson({ ok: false, error: { code: "unsupported_event_version" } }, 400);
    const result = await billing.service.webhook(
      event,
      createHash("sha256").update(raw).digest("hex"),
    );
    signal.throwIfAborted();
    return billingJson({ ok: true, data: result });
  } catch (error) {
    if (
      error instanceof StripeProviderError &&
      ["invalid_signature", "mode_mismatch"].includes(error.code)
    )
      return billingJson({ ok: false, error: { code: "invalid_signature" } }, 400);
    return billingFailure(error);
  }
}
