import { z } from "zod";
import { err, ok, type Result } from "@/types/result";

export interface AuthPolicy {
  requireMfaForAll: boolean;
  idleMinutes: number;
  absoluteHours: number;
  freshMinutes: number;
}

export const DEFAULT_AUTH_POLICY: AuthPolicy = {
  requireMfaForAll: false,
  idleMinutes: 30,
  absoluteHours: 168,
  freshMinutes: 5,
};
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
export const INVITATION_TOKEN_BYTES = 32;
export const MAIL_LEASE_MS = 2 * 60 * 1000;
export const MAIL_MAX_ATTEMPTS = 5;
export const MANAGEMENT_PAGE_SIZE = 25;
export const RESET_MAIL_TTL_MS = 15 * 60 * 1000;
export const VERIFICATION_MAIL_TTL_MS = 30 * 60 * 1000;

export type InvitationState = "pending" | "accepted" | "revoked" | "expired";

export function invitationState(
  row: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now = new Date(),
): InvitationState {
  if (row.acceptedAt !== null) return "accepted";
  if (row.revokedAt !== null) return "revoked";
  return row.expiresAt <= now ? "expired" : "pending";
}

// The audit contract is an allowlist so new caller fields cannot accidentally log credentials.
export function redactSecurityMetadata(
  value: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const key of ["reason", "method", "count", "provider", "operation", "changed"] as const) {
    const field = value[key];
    if (typeof field === "string") result[key] = field.slice(0, 120);
    else if (typeof field === "number" && Number.isFinite(field)) result[key] = field;
    else if (typeof field === "boolean") result[key] = field;
  }
  return result;
}

export const authPolicyInput = z
  .strictObject({
    requireMfaForAll: z.boolean(),
    idleMinutes: z.number().int().min(5).max(1440),
    absoluteHours: z.number().int().min(1).max(720),
    freshMinutes: z.number().int().min(1).max(15),
  })
  .refine((value) => value.freshMinutes <= value.idleMinutes);

export function validatePolicy(value: unknown): Result<AuthPolicy, "invalid_policy"> {
  const parsed = authPolicyInput.safeParse(value);
  return parsed.success ? ok(parsed.data) : err("invalid_policy");
}
