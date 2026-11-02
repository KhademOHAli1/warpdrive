import { z } from "zod";

export const providerOperationNames = [
  "authorize",
  "exchange",
  "refresh",
  "listResources",
  "check",
  "disconnect",
  "discoverCapabilities",
] as const;
export type ProviderOperation = (typeof providerOperationNames)[number];

export const providerResourceKinds = [
  "channel",
  "calendar",
  "mailbox",
  "workspace",
  "conference",
  "other",
] as const;

// Rejection codes (unsupported/invalid_input/authorization_expired/forbidden/rate_limited)
// assert an explicit no-effect rejection. Transport uncertainty uses the other failure codes.
export const providerFailureSchema = z.object({
  code: z.enum([
    "unsupported",
    "invalid_input",
    "invalid_response",
    "authorization_expired",
    "forbidden",
    "rate_limited",
    "unavailable",
    "ambiguous_outcome",
    "timed_out",
    "failed",
  ]),
  retryAfterMs: z.number().int().min(1).max(86_400_000).optional(),
  outcome: z.literal("unknown").optional(),
});
export type ProviderFailure = z.infer<typeof providerFailureSchema>;

export const credentialReferenceSchema = z.strictObject({
  id: z.uuid(),
  generation: z.number().int().positive(),
});
export const upstreamScopesSchema = z.array(z.string().min(1).max(256)).max(500);
export const httpUrlSchema = z.url({ protocol: /^https?$/ });

// Server-internal candidate only. Persistence/encryption belongs to the owning connection broker.
export const credentialCandidateSchema = z.strictObject({
  accessToken: z.string().min(1).max(65_536),
  refreshToken: z.string().min(1).max(65_536).optional(),
  tokenType: z.literal("Bearer"),
  expiresAt: z.number().int().nonnegative().optional(),
  grantedScopes: upstreamScopesSchema,
});
