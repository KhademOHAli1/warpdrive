import {
  type BillingCommand,
  BillingError,
  type BillingErrorCode,
  billingCommandSchema,
} from "./contracts";
import type { BillingService } from "./service";
import { StripeProviderError } from "./stripe/errors";
import { chargeIdSchema, invoiceIdSchema, paymentMethodIdSchema } from "./stripe/schemas";

export const BILLING_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export function billingJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: BILLING_RESPONSE_HEADERS });
}
export type BillingActor = { id: string; authorize: () => Promise<void> };
export type BillingHttpDependencies = {
  service(signal: AbortSignal): BillingService | null;
  authorized(
    request: Request,
    mutation: boolean,
    signal: AbortSignal,
    run: (actor: BillingActor) => Promise<Response>,
  ): Promise<Response>;
};

export async function boundedBody(
  request: Request,
  limit: number,
  signal: AbortSignal,
): Promise<string> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new BillingError("invalid_input");
  if (request.body === null) throw new BillingError("invalid_input");
  const reader = request.body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new BillingError("invalid_input");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

const FAILURE_STATUS: Record<BillingErrorCode, number> = {
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  not_configured: 503,
  provider_unavailable: 503,
  not_ready: 409,
  checkout_in_progress: 409,
  already_subscribed: 409,
  request_conflict: 409,
  reconciliation_required: 409,
};
export function billingFailure(error: unknown): Response {
  if (error instanceof BillingError)
    return billingJson(
      { ok: false, error: { id: error.id, code: error.code } },
      FAILURE_STATUS[error.code],
    );
  if (error instanceof StripeProviderError && error.code === "invalid_input")
    return billingJson({ ok: false, error: { code: "invalid_input" } }, 400);
  return billingJson({ ok: false, error: { code: "provider_unavailable" } }, 503);
}
async function readList(api: BillingService, name: string | undefined, cursor: string | undefined) {
  if (name === undefined) throw new BillingError("not_found");
  const schema =
    name === "invoices"
      ? invoiceIdSchema
      : name === "receipts"
        ? chargeIdSchema
        : paymentMethodIdSchema;
  if (cursor !== undefined && !schema.safeParse(cursor).success)
    throw new BillingError("invalid_input");
  switch (name) {
    case "invoices":
      return api.invoices(cursor);
    case "receipts":
      return api.receipts(cursor);
    case "payment-methods":
      return api.paymentMethods(cursor);
    default:
      throw new BillingError("not_found");
  }
}
async function readRoute(
  api: BillingService,
  request: Request,
  path: string[],
  actor: BillingActor,
  signal: AbortSignal,
) {
  if (path.length === 0 || (path.length === 1 && path[0] === "overview"))
    return billingJson({ ok: true, data: await api.overview() });
  if (path.length === 1)
    return billingJson({
      ok: true,
      data: await readList(
        api,
        path[0],
        new URL(request.url).searchParams.get("cursor") ?? undefined,
      ),
    });
  if (path.length !== 3 || path[2] !== "download") throw new BillingError("not_found");
  if (path[0] !== "invoices" && path[0] !== "receipts") throw new BillingError("not_found");
  const kind = path[0] === "invoices" ? "invoice" : "receipt";
  const id = path[1];
  const schema = kind === "invoice" ? invoiceIdSchema : chargeIdSchema;
  if (id === undefined || !schema.safeParse(id).success) throw new BillingError("invalid_input");
  const url = await api.document(kind, id, actor.id);
  signal.throwIfAborted();
  return new Response(null, {
    status: 303,
    headers: { ...BILLING_RESPONSE_HEADERS, Location: url },
  });
}
function command(api: BillingService, input: BillingCommand, actor: BillingActor) {
  switch (input.action) {
    case "checkout":
      return api.checkout(input, actor);
    case "portal":
      return api.portal(input.intent, actor);
    case "preview_seats":
      return api.previewSeats(input.totalSeats);
    case "change_seats":
      return api.changeSeats(input.quote, input.requestId, actor);
    case "reconcile":
      return api.reconcile(actor);
  }
}

export function createBillingHttp(deps: BillingHttpDependencies) {
  const service = (signal: AbortSignal) => {
    const value = deps.service(signal);
    if (value === null) throw new BillingError("not_configured");
    return value;
  };
  return {
    async GET(request: Request, path: string[]): Promise<Response> {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
      try {
        return await deps.authorized(request, false, signal, (actor) =>
          readRoute(service(signal), request, path, actor, signal),
        );
      } catch (error) {
        return billingFailure(error);
      }
    },
    async POST(request: Request): Promise<Response> {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
      try {
        return await deps.authorized(request, true, signal, async (actor) => {
          let value: unknown;
          try {
            value = JSON.parse(await boundedBody(request, 16_384, signal));
          } catch {
            throw new BillingError("invalid_input");
          }
          const parsed = billingCommandSchema.safeParse(value);
          if (!parsed.success) throw new BillingError("invalid_input");
          const api = service(signal);
          const input = parsed.data;
          const result = await command(api, input, actor);
          signal.throwIfAborted();
          return billingJson({ ok: true, data: result });
        });
      } catch (error) {
        return billingFailure(error);
      }
    },
  };
}
