import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { decryptPrivacy, encryptPrivacy, fingerprintPrivacy } from "./crypto";

test("P03A/C10: sensitive case evidence is encrypted with randomized case and purpose binding", () => {
  const context = { caseId: randomUUID(), purpose: "intake" as const };
  const value = "PRIVATE-SYNTHETIC-SENTINEL";
  const first = encryptPrivacy(value, context);
  const second = encryptPrivacy(value, context);
  expect(first.equals(second)).toBe(false);
  expect(first.toString()).not.toContain(value);
  expect(decryptPrivacy(first, context)).toEqual({ ok: true, value });
  expect(decryptPrivacy(first, { ...context, caseId: randomUUID() }).ok).toBe(false);
  expect(decryptPrivacy(first, { ...context, purpose: "decision" }).ok).toBe(false);
});

test("P03B/C10: malformed or modified evidence returns a non-secret operational error", () => {
  const context = { caseId: randomUUID(), purpose: "intake" as const };
  const ciphertext = encryptPrivacy("secret sentinel", context);
  ciphertext[ciphertext.length - 1] = (ciphertext.at(-1) ?? 0) ^ 1;
  for (const input of [ciphertext, Buffer.alloc(0), Buffer.from("untrusted")]) {
    const result = decryptPrivacy(input, context);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret sentinel");
    if (!result.ok) expect(result.error.id).toBe("E_PRIVACY_001");
  }
});

test("P03B: replay fingerprints bind canonical input to a private actor context", () => {
  const context = { caseId: randomUUID(), purpose: "intake" as const };
  const digest = fingerprintPrivacy("synthetic input", context);
  expect(fingerprintPrivacy("synthetic input", context)).toBe(digest);
  expect(fingerprintPrivacy("changed input", context)).not.toBe(digest);
  expect(fingerprintPrivacy("synthetic input", { ...context, caseId: randomUUID() })).not.toBe(
    digest,
  );
});
