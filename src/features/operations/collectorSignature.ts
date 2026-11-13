import { createHmac, timingSafeEqual } from "node:crypto";
import { err, ok, type Result } from "@/types/result";
import {
  OPERATIONS_MAX_BODY_BYTES,
  OPERATIONS_MAX_CLOCK_SKEW_MS,
  OPERATIONS_MAX_TIMESTAMP_MS,
  type OperationsSourceBinding,
  operationsSourceBindingSchema,
} from "./contracts";

export const OPERATIONS_COLLECTOR_PATH = "/api/internal/operations/observations";
export const OPERATIONS_COLLECTOR_HOST = "warpdrive-operations.local";
const signatureDomain = "warpdrive.operations.collector.v1";
const signatureShape = /^v1=[a-f0-9]{64}$/u;
const signingKeyShape = /^[A-Za-z0-9_-]{43}$/u;
const timestampShape = /^(?:0|[1-9][0-9]{0,15})$/u;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export interface CollectorSignatureRequest {
  method: string;
  /** Exact request target, including any query delimiter. */
  path: string;
  /** Canonical decimal Unix time in milliseconds. */
  timestamp: string | null;
  /** `v1=` followed by the lowercase hexadecimal HMAC. */
  signature: string | null;
  rawBody: Uint8Array;
}

/** Supply from server configuration and the selected enrollment. */
export interface CollectorSignatureAuthority {
  installationId: string;
  binding: OperationsSourceBinding;
  /** A dedicated 32-byte enrollment key encoded as unpadded base64url. */
  signingKey: string;
}

interface VerifiedCollectorSignature {
  binding: OperationsSourceBinding;
  rawBody: string;
  signedAtMs: number;
}

type CollectorSignatureError = "invalid_request" | "unauthorized" | "invalid_payload";

function readSigningKey(value: string): Buffer | null {
  if (value.length !== 43 || !signingKeyShape.test(value)) return null;
  const key = Buffer.from(value, "base64url");
  return key.toString("base64url") === value ? key : null;
}

function validTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= OPERATIONS_MAX_TIMESTAMP_MS;
}

function readSignedAt(timestamp: string, receivedAtMs: number): number | null {
  if (timestamp.length > 16 || !timestampShape.test(timestamp) || !validTimestamp(receivedAtMs))
    return null;
  const signedAtMs = Number(timestamp);
  return validTimestamp(signedAtMs) &&
    String(signedAtMs) === timestamp &&
    Math.abs(receivedAtMs - signedAtMs) <= OPERATIONS_MAX_CLOCK_SKEW_MS
    ? signedAtMs
    : null;
}

function sign(
  binding: OperationsSourceBinding,
  key: Buffer,
  timestamp: string,
  rawBody: Uint8Array,
) {
  const prefix = [
    signatureDomain,
    "POST",
    OPERATIONS_COLLECTOR_PATH,
    binding.installationId,
    binding.sourceId,
    binding.generationId,
    timestamp,
    "",
  ].join("\n");
  return createHmac("sha256", key).update(prefix).update(rawBody).digest();
}

/** Sign the exact serialized batch. Retain its generation and sequence before submitting it. */
export function signOperationsCollectorBatch(
  authority: CollectorSignatureAuthority,
  rawBody: Uint8Array,
  signedAtMs: number,
): Result<{ timestamp: string; signature: string }, "invalid_request"> {
  const binding = operationsSourceBindingSchema.safeParse(authority.binding);
  const key = readSigningKey(authority.signingKey);
  if (
    !binding.success ||
    binding.data.installationId !== authority.installationId ||
    key === null ||
    !validTimestamp(signedAtMs) ||
    rawBody.byteLength === 0 ||
    rawBody.byteLength > OPERATIONS_MAX_BODY_BYTES
  )
    return err("invalid_request");
  const timestamp = String(signedAtMs);
  return ok({
    timestamp,
    signature: `v1=${sign(binding.data, key, timestamp, rawBody).toString("hex")}`,
  });
}

/** Verify HMAC-SHA256 over the LF-separated fields below and the original body bytes.
 * The caller bounds the incoming stream before invoking this helper and passes the
 * returned body and binding to the existing sequence and scope admission.
 */
export function verifyCollectorSignature(
  request: CollectorSignatureRequest,
  authority: CollectorSignatureAuthority,
  receivedAtMs: number,
): Result<VerifiedCollectorSignature, CollectorSignatureError> {
  const { method, path, rawBody, signature, timestamp } = request;
  const bodyLength = rawBody.byteLength;
  if (
    method !== "POST" ||
    path !== OPERATIONS_COLLECTOR_PATH ||
    bodyLength === 0 ||
    bodyLength > OPERATIONS_MAX_BODY_BYTES
  )
    return err("invalid_request");
  if (
    timestamp === null ||
    signature === null ||
    signature.length !== 67 ||
    !signatureShape.test(signature)
  )
    return err("unauthorized");

  const binding = operationsSourceBindingSchema.safeParse(authority.binding);
  const signingKey = readSigningKey(authority.signingKey);
  const signedAtMs = readSignedAt(timestamp, receivedAtMs);
  if (
    !binding.success ||
    binding.data.installationId !== authority.installationId ||
    signingKey === null ||
    signedAtMs === null
  )
    return err("unauthorized");

  const body = Buffer.from(rawBody.subarray(0, bodyLength));
  const expected = sign(binding.data, signingKey, timestamp, body);
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(3), "hex")))
    return err("unauthorized");

  try {
    return ok({ binding: binding.data, rawBody: utf8.decode(body), signedAtMs });
  } catch {
    return err("invalid_payload");
  }
}
