import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";
import { canonicalScopeJson } from "@/features/privacy/scopeDraftCanonical";

export const audienceApprovalLifetimeMs = 10 * 60_000;

const key = Buffer.from(
  hkdfSync(
    "sha256",
    Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64"),
    "warpdrive-newsletter",
    "crm-audience-approval-v1",
    32,
  ),
);

export const audienceApprovalPattern = /^\d{13}\.[0-9a-f]{64}$/;

function sign(scope: unknown, issuedAt: number): string {
  return createHmac("sha256", key)
    .update(canonicalScopeJson([1, issuedAt, scope]))
    .digest("hex");
}

export function signAudienceApproval(scope: unknown, now: number): string {
  return `${now}.${sign(scope, now)}`;
}

export function verifyAudienceApproval(token: string, scope: unknown, now: number): boolean {
  if (!audienceApprovalPattern.test(token)) return false;
  const separator = token.indexOf(".");
  const issuedAt = Number(token.slice(0, separator));
  if (now < issuedAt || now - issuedAt > audienceApprovalLifetimeMs) return false;
  return timingSafeEqual(
    Buffer.from(token.slice(separator + 1), "hex"),
    Buffer.from(sign(scope, issuedAt), "hex"),
  );
}
