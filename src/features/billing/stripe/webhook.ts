import { createHmac, timingSafeEqual } from "node:crypto";
import { StripeProviderError } from "./errors";
import { stripeEventSchema, type VerifiedStripeEvent } from "./schemas";

export const MAX_STRIPE_WEBHOOK_BYTES = 1024 * 1024;
const MAX_SIGNATURE_HEADER_BYTES = 4096;

export type StripeWebhookVerification = {
  secret: string;
  livemode: boolean;
  nowSeconds?: number;
  toleranceSeconds?: number;
};

function signatureFailure(): never {
  throw new StripeProviderError("invalid_signature");
}
function parseSignature(signature: string) {
  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const entry of signature.split(",")) {
    const separator = entry.indexOf("=");
    if (separator < 1) signatureFailure();
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (key === "t") {
      if (timestamp !== undefined || !/^\d{1,12}$/.test(value)) signatureFailure();
      timestamp = Number(value);
    } else if (key === "v1") {
      if (!/^[a-fA-F0-9]{64}$/.test(value) || candidates.length >= 16) signatureFailure();
      candidates.push(value);
    }
  }
  return { timestamp, candidates };
}

/** Verifies transport authenticity; persistence must independently deduplicate event IDs. */
export function verifyStripeWebhook(
  rawBody: string,
  signature: string | null | undefined,
  options: StripeWebhookVerification,
): VerifiedStripeEvent {
  const fail = (): never => {
    throw new StripeProviderError("invalid_signature");
  };
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? 300;
  if (
    typeof rawBody !== "string" ||
    Buffer.byteLength(rawBody, "utf8") > MAX_STRIPE_WEBHOOK_BYTES ||
    typeof signature !== "string" ||
    Buffer.byteLength(signature, "utf8") > MAX_SIGNATURE_HEADER_BYTES ||
    !/^whsec_[A-Za-z0-9]+$/.test(options.secret) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(tolerance) ||
    tolerance < 1 ||
    tolerance > 300 ||
    typeof options.livemode !== "boolean"
  ) {
    return fail();
  }
  const { timestamp, candidates } = parseSignature(signature);
  if (
    timestamp === undefined ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    Math.abs(now - timestamp) > tolerance ||
    candidates.length === 0
  ) {
    return fail();
  }
  const expected = createHmac("sha256", options.secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest();
  let matches = false;
  for (const candidate of candidates) {
    // All candidates have a checked equal byte length; compare every candidate.
    matches = timingSafeEqual(expected, Buffer.from(candidate, "hex")) || matches;
  }
  if (!matches) return fail();
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody) as unknown;
  } catch {
    return fail();
  }
  const parsed = stripeEventSchema.safeParse(decoded);
  if (!parsed.success) return fail();
  if (parsed.data.livemode !== options.livemode) throw new StripeProviderError("mode_mismatch");
  return parsed.data;
}
