import { z } from "zod";
import { StripeProviderError } from "./errors";
import {
  type BillingInterval,
  customerIdSchema,
  idempotencyKeySchema,
  priceIdSchema,
  STRIPE_API_VERSION,
  type StripePage,
  stripeIdSchema,
  type stripeSubscriptionSchema,
} from "./schemas";

export type StripeBillingConfig = {
  signal: AbortSignal;
  secretKey: string;
  appOrigin: string;
  portalConfigurationId: string;
  workspacePriceIds: Record<BillingInterval, string>;
  seatPriceIds: Record<BillingInterval, string>;
  includedSeats: number;
  automaticTax?: boolean;
  livemode?: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const pricePairSchema = z.object({ monthly: priceIdSchema, yearly: priceIdSchema });
const configSchema = z.object({
  secretKey: z
    .string()
    .max(4096)
    .regex(/^(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+$/),
  portalConfigurationId: stripeIdSchema("bpc"),
  workspacePriceIds: pricePairSchema,
  seatPriceIds: pricePairSchema,
  includedSeats: z.number().int().min(0).max(10_000),
  automaticTax: z.boolean().default(true),
  livemode: z.boolean().default(false),
  timeoutMs: z.number().int().min(1).max(30_000).default(10_000),
});

function input<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StripeProviderError("invalid_input");
  return parsed.data;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    throw new StripeProviderError("invalid_response");
  }
  if (
    response.headers.get("content-type")?.includes("application/json") !== true ||
    !response.body
  ) {
    throw new StripeProviderError("invalid_response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new StripeProviderError("invalid_response");
      }
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } finally {
    reader.releaseLock();
  }
}

/** Server-only REST adapter. No credentials or raw payment data are exposed in its DTOs. */
export class StripeTransport {
  #secretKey: string;
  protected appOrigin: string;
  protected portalConfigurationId: string;
  protected workspacePrices: Record<BillingInterval, string>;
  protected seatPrices: Record<BillingInterval, string>;
  protected includedSeats: number;
  protected automaticTax: boolean;
  protected livemode: boolean;
  #timeoutMs: number;
  #fetch: typeof fetch;
  #signal: AbortSignal;

  constructor(config: StripeBillingConfig) {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) throw new StripeProviderError("invalid_config");
    const settings = parsed.data;
    let origin: URL;
    try {
      origin = new URL(config.appOrigin);
    } catch {
      throw new StripeProviderError("invalid_config");
    }
    const localHttp =
      !settings.livemode &&
      origin.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (
      (origin.protocol !== "https:" && !localHttp) ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      settings.secretKey.includes("_live_") !== settings.livemode ||
      (config.fetch !== undefined && typeof config.fetch !== "function")
    ) {
      throw new StripeProviderError("invalid_config");
    }
    this.#secretKey = settings.secretKey;
    this.appOrigin = origin.origin;
    this.portalConfigurationId = settings.portalConfigurationId;
    this.workspacePrices = settings.workspacePriceIds;
    this.seatPrices = settings.seatPriceIds;
    this.includedSeats = settings.includedSeats;
    this.automaticTax = settings.automaticTax;
    this.livemode = settings.livemode;
    this.#timeoutMs = settings.timeoutMs;
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#signal = config.signal;
  }

  protected assertMode(value: { livemode: boolean }) {
    if (value.livemode !== this.livemode) throw new StripeProviderError("mode_mismatch");
  }

  protected assertSubscription(value: z.output<typeof stripeSubscriptionSchema>) {
    this.assertMode(value);
    for (const item of value.items.data) this.assertMode(item.price);
  }

  protected async request<T extends z.ZodType>(
    method: "GET" | "POST",
    path: string,
    schema: T,
    parameters = new URLSearchParams(),
    idempotencyKey?: string,
  ): Promise<z.output<T>> {
    this.#signal.throwIfAborted();
    if (method === "POST") input(idempotencyKeySchema, idempotencyKey);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new StripeProviderError("timeout"));
      }, this.#timeoutMs);
    });
    const operation = async () => {
      const query = method === "GET" && parameters.size ? `?${parameters.toString()}` : "";
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.#secretKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
        Accept: "application/json",
      };
      if (method === "POST") {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        headers["Idempotency-Key"] = input(idempotencyKeySchema, idempotencyKey);
      }
      const response = await this.#fetch(`https://api.stripe.com/v1${path}${query}`, {
        method,
        headers,
        ...(method === "POST" ? { body: parameters.toString() } : {}),
        signal: AbortSignal.any([controller.signal, this.#signal]),
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) {
        // Error responses can echo sensitive request fields. Never parse or expose them.
        void response.body?.cancel().catch(() => undefined);
        throw new StripeProviderError(
          "http_error",
          response.status,
          response.headers.get("request-id") ?? undefined,
        );
      }
      const parsed = schema.safeParse(await readBoundedJson(response));
      this.#signal.throwIfAborted();
      if (!parsed.success) throw new StripeProviderError("invalid_response");
      return parsed.data;
    };
    try {
      return await Promise.race([operation(), timeout]);
    } catch (error) {
      this.#signal.throwIfAborted();
      if (error instanceof StripeProviderError) throw error;
      throw new StripeProviderError(controller.signal.aborted ? "timeout" : "unavailable");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  protected page<T extends { id: string }>(value: { data: T[]; has_more: boolean }): StripePage<T> {
    const last = value.data.at(-1);
    if (value.has_more && !last) throw new StripeProviderError("invalid_response");
    return { ...value, next_cursor: value.has_more && last ? last.id : null };
  }

  protected listParams(
    customerId: string,
    cursor: string | undefined,
    cursorSchema: z.ZodType<string>,
  ) {
    const parameters = new URLSearchParams({
      customer: input(customerIdSchema, customerId),
      limit: "25",
    });
    if (cursor !== undefined) parameters.set("starting_after", input(cursorSchema, cursor));
    return parameters;
  }
}
