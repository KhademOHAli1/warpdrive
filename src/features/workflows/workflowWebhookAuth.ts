import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { err, ok, type Result } from "@/types/result";
import {
  parseWorkflowWebhookPayload,
  parseWorkflowWebhookQuery,
  type WorkflowWebhookLaunchPayload,
  type WorkflowWebhookPublication,
  workflowWebhookLimits,
  workflowWebhookPublicationSchema,
} from "./workflowWebhookContract";

const signatureDomain = "warpdrive.workflow.webhook.v1";
const replayDomain = "warpdrive.workflow.webhook.replay.v1";
const secretBytes = 32;
const signatureShape = /^v1=[a-f0-9]{64}$/u;
const timestampShape = /^[1-9][0-9]{0,9}$/u;
const jsonContentType = /^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*utf-8)?$/iu;

export type WorkflowWebhookAuthFailure = "invalid-request" | "unauthorized" | "invalid-payload";

export interface WorkflowWebhookRequest {
  method: string;
  contentType: string | null;
  publication: WorkflowWebhookPublication;
  // Epoch seconds and v1=<lowercase hex HMAC-SHA256>, from separate headers.
  timestamp: string | null;
  signature: string | null;
  rawBody: Uint8Array;
  // Exact URL query bytes without the leading question mark. Do not re-encode.
  rawQuery?: string;
}

export interface WorkflowWebhookDelivery extends WorkflowWebhookRequest {
  signingKey: string;
  // The trusted server's current clock. This is never taken from request input.
  nowMs: number;
}

export interface AuthenticatedWorkflowWebhook {
  publication: WorkflowWebhookPublication;
  payload: WorkflowWebhookLaunchPayload;
  signedAtMs: number;
  // Admission must claim this key atomically with run creation. It remains
  // stable across re-signed retries, signing-key rotation and republication.
  replayKey: string;
}

export function mintWorkflowWebhookSigningKey(): string {
  return randomBytes(secretBytes).toString("base64url");
}

function signingBytes(value: unknown): Buffer | null {
  if (typeof value !== "string" || value.length !== 43 || !/^[A-Za-z0-9_-]{43}$/u.test(value))
    return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === secretBytes && bytes.toString("base64url") === value ? bytes : null;
}

function signedAt(timestamp: string | null, nowMs: number): number | null {
  if (
    timestamp === null ||
    timestamp.trim() !== timestamp ||
    !timestampShape.test(timestamp) ||
    !Number.isSafeInteger(nowMs) ||
    nowMs <= 0
  )
    return null;
  const milliseconds = Number(timestamp) * 1000;
  return Math.abs(nowMs - milliseconds) <= workflowWebhookLimits.clockSkewMs ? milliseconds : null;
}

export function workflowWebhookRequestKey(workflowId: string, eventId: string): string {
  const digest = createHash("sha256")
    .update([replayDomain, workflowId.toLowerCase(), eventId.toLowerCase()].join("\n"))
    .digest("hex");
  const variant = ((Number.parseInt(digest.charAt(16), 16) & 3) | 8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

type SignedContent =
  | { method: "GET"; bytes: Uint8Array; eventId: string }
  | { method: "POST"; bytes: Uint8Array };

function signedContent(input: WorkflowWebhookRequest): SignedContent | null {
  const { method, contentType, rawBody, rawQuery = "" } = input;
  if (method === "GET") {
    if (contentType !== null || rawBody.byteLength !== 0) return null;
    const eventId = parseWorkflowWebhookQuery(rawQuery);
    return eventId === null ? null : { method, bytes: Buffer.from(rawQuery), eventId };
  }
  if (
    method !== "POST" ||
    rawQuery !== "" ||
    contentType === null ||
    contentType.length > 64 ||
    !jsonContentType.test(contentType.trim()) ||
    rawBody.byteLength === 0 ||
    rawBody.byteLength > workflowWebhookLimits.bodyBytes
  )
    return null;
  return { method, bytes: rawBody };
}

export function validWorkflowWebhookRequestShape(input: WorkflowWebhookRequest): boolean {
  return signedContent(input) !== null;
}

function readSignedPayload(
  content: SignedContent,
  body: Uint8Array,
): Result<WorkflowWebhookLaunchPayload, "invalid-payload"> {
  if (content.method === "GET")
    return ok({ scope: "webhook", httpMethod: "GET", eventId: content.eventId });
  const payload = parseWorkflowWebhookPayload(body);
  return payload.ok ? ok({ ...payload.value, scope: "webhook", httpMethod: "POST" }) : payload;
}

export function authenticateWorkflowWebhook(
  input: WorkflowWebhookDelivery,
): Result<AuthenticatedWorkflowWebhook, WorkflowWebhookAuthFailure> {
  const { timestamp, signature } = input;
  const content = signedContent(input);
  if (content === null) return err("invalid-request");

  const signedAtMs = signedAt(timestamp, input.nowMs);
  const publication = workflowWebhookPublicationSchema.safeParse(input.publication);
  const key = signingBytes(input.signingKey);
  if (
    !publication.success ||
    timestamp === null ||
    signedAtMs === null ||
    key === null ||
    signature === null ||
    signature.length !== 67 ||
    !signatureShape.test(signature)
  )
    return err("unauthorized");

  // Verify and parse the same byte snapshot. The HTTP entrypoint must enforce
  // the size limit while reading the stream, before calling this helper.
  const body = Buffer.from(content.bytes);
  const prefix = [
    signatureDomain,
    content.method,
    publication.data.workflowId,
    publication.data.versionId,
    timestamp,
    "",
  ].join("\n");
  const expected = createHmac("sha256", key).update(prefix).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(3), "hex")))
    return err("unauthorized");

  const payload = readSignedPayload(content, body);
  if (!payload.ok) return payload;
  return ok({
    publication: publication.data,
    payload: payload.value,
    signedAtMs,
    replayKey: workflowWebhookRequestKey(publication.data.workflowId, payload.value.eventId),
  });
}
