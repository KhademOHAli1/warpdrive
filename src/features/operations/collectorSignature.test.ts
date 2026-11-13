import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type CollectorSignatureAuthority,
  type CollectorSignatureRequest,
  OPERATIONS_COLLECTOR_PATH,
  verifyCollectorSignature,
} from "./collectorSignature";
import {
  admitOperationsBatch,
  OPERATIONS_MAX_BODY_BYTES,
  OPERATIONS_MAX_CLOCK_SKEW_MS,
  OPERATIONS_MAX_TIMESTAMP_MS,
} from "./contracts";

const timestamp = "1794567890123";
const nowMs = Number(timestamp);
const binding = {
  installationId: "10000000-0000-4000-8000-000000000001",
  sourceId: "10000000-0000-4000-8000-000000000002",
  generationId: "10000000-0000-4000-8000-000000000003",
};
const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const authority = {
  installationId: binding.installationId,
  binding,
  signingKey: key.toString("base64url"),
} satisfies CollectorSignatureAuthority;
const signedBody = '{"evidence":"grün"}\n';
const fixedRequest = {
  method: "POST",
  path: "/api/internal/operations/observations",
  timestamp,
  signature: "v1=3ab7bfa19a18a628ccb38a78e23e5b8e055cc0be14a0a1d8ffa2a270055dcba9",
  rawBody: Buffer.from(signedBody),
} satisfies CollectorSignatureRequest;
const unauthorized = { ok: false, error: "unauthorized" };
const invalidRequest = { ok: false, error: "invalid_request" };

function sign(rawBody: Uint8Array, time = timestamp): CollectorSignatureRequest {
  const prefix = `warpdrive.operations.collector.v1\nPOST\n/api/internal/operations/observations\n${binding.installationId}\n${binding.sourceId}\n${binding.generationId}\n${time}\n`;
  const mac = createHmac("sha256", key).update(prefix).update(rawBody).digest("hex");
  return { ...fixedRequest, timestamp: time, signature: `v1=${mac}`, rawBody };
}

describe("Operations collector signature", () => {
  it("verifies a fixed independent HMAC vector over the exact body view", () => {
    const framed = Buffer.from(`!${signedBody}!`);
    expect(OPERATIONS_COLLECTOR_PATH).toBe(fixedRequest.path);
    expect(
      verifyCollectorSignature(
        { ...fixedRequest, rawBody: framed.subarray(1, -1) },
        authority,
        nowMs,
      ),
    ).toEqual({ ok: true, value: { binding, rawBody: signedBody, signedAtMs: nowMs } });
  });

  it("hands the verified raw payload and server-selected binding to existing batch admission", () => {
    const rawBody = JSON.stringify({
      schemaVersion: 2,
      generationId: binding.generationId,
      sequence: 1,
      observedAtMs: nowMs,
      observations: [
        { kind: "observer", observer: "host_collector", state: "healthy", reason: "ok" },
      ],
    });
    const result = verifyCollectorSignature(sign(Buffer.from(rawBody)), authority, nowMs);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(admitOperationsBatch(result.value.rawBody, result.value.binding, nowMs).ok).toBe(true);
    }
  });

  it.each([
    { method: "GET" },
    { method: "post" },
    { path: `${OPERATIONS_COLLECTOR_PATH}?` },
    { path: `${OPERATIONS_COLLECTOR_PATH}?source=other` },
    { path: `${OPERATIONS_COLLECTOR_PATH}/` },
    { path: "/api/internal/operations/%6fbservations" },
    { rawBody: new Uint8Array(0) },
    { rawBody: new Uint8Array(OPERATIONS_MAX_BODY_BYTES + 1) },
  ])("denies a noncanonical request shape ($#)", (changes) => {
    expect(verifyCollectorSignature({ ...fixedRequest, ...changes }, authority, nowMs)).toEqual(
      invalidRequest,
    );
  });

  it("accepts a signed body exactly at the existing byte cap", () => {
    const bytes = Buffer.alloc(OPERATIONS_MAX_BODY_BYTES, 0x20);
    const result = verifyCollectorSignature(sign(bytes), authority, nowMs);
    expect(result.ok && result.value.rawBody.length).toBe(OPERATIONS_MAX_BODY_BYTES);
  });

  it.each([
    { rawBody: Buffer.from(signedBody.replace("ü", "u\u0308")) },
    { rawBody: Buffer.from(signedBody.trimEnd()) },
    { timestamp: String(nowMs + 1) },
    { timestamp: null },
    { signature: null },
    { signature: fixedRequest.signature.toUpperCase() },
    { signature: `${fixedRequest.signature}\n` },
    { signature: `${fixedRequest.signature}, ${fixedRequest.signature}` },
    { signature: `v1=${"0".repeat(64)}` },
  ])("denies changed signed bytes or malformed authentication ($#)", (changes) => {
    expect(verifyCollectorSignature({ ...fixedRequest, ...changes }, authority, nowMs)).toEqual(
      unauthorized,
    );
  });

  it.each([
    { installationId: binding.sourceId },
    {
      installationId: binding.sourceId,
      binding: { ...binding, installationId: binding.sourceId },
    },
    { binding: { ...binding, sourceId: binding.installationId } },
    { binding: { ...binding, generationId: binding.sourceId } },
    { binding: { ...binding, sourceId: `${binding.sourceId}\n` } },
    { signingKey: Buffer.alloc(32, 1).toString("base64url") },
    { signingKey: `${authority.signingKey}=` },
    { signingKey: `${authority.signingKey.slice(0, -1)}9` },
  ])("denies a different or noncanonical server authority ($#)", (changes) => {
    expect(verifyCollectorSignature(fixedRequest, { ...authority, ...changes }, nowMs)).toEqual(
      unauthorized,
    );
  });

  it.each(["01794567890123", "1794567890123\n", " 1794567890123", "1794567890123.0", "1e12"])(
    "denies a signed but noncanonical timestamp (%j)",
    (noncanonical) => {
      expect(
        verifyCollectorSignature(sign(fixedRequest.rawBody, noncanonical), authority, nowMs),
      ).toEqual(unauthorized);
    },
  );

  it("enforces the inclusive skew window on both sides of the trusted clock", () => {
    for (const direction of [-1, 1]) {
      const boundary = nowMs + direction * OPERATIONS_MAX_CLOCK_SKEW_MS;
      expect(verifyCollectorSignature(fixedRequest, authority, boundary).ok).toBe(true);
      expect(verifyCollectorSignature(fixedRequest, authority, boundary + direction)).toEqual(
        unauthorized,
      );
    }
  });

  it.each([Number.NaN, -1, 1.5, OPERATIONS_MAX_TIMESTAMP_MS + 1])(
    "denies an out-of-range trusted clock (%j)",
    (clock) => {
      expect(verifyCollectorSignature(fixedRequest, authority, clock)).toEqual(unauthorized);
    },
  );

  it("denies a correctly signed malformed UTF-8 body after authentication", () => {
    const invalidUtf8 = Buffer.from([0xc0, 0xaf]);
    expect(
      verifyCollectorSignature({ ...fixedRequest, rawBody: invalidUtf8 }, authority, nowMs),
    ).toEqual(unauthorized);
    expect(verifyCollectorSignature(sign(invalidUtf8), authority, nowMs)).toEqual({
      ok: false,
      error: "invalid_payload",
    });
  });

  it("preserves signed UTF-8 BOM bytes for existing JSON admission to evaluate", () => {
    const rawBody = `\uFEFF${signedBody}`;
    expect(verifyCollectorSignature(sign(Buffer.from(rawBody)), authority, nowMs)).toEqual({
      ok: true,
      value: { binding, rawBody, signedAtMs: nowMs },
    });
  });
});
