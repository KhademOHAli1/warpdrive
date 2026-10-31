import { z } from "zod";
import type { ProviderOutput } from "@/features/integrations/providers/contract";
import { upstreamScopesSchema } from "@/features/integrations/providers/models";
import { providerOutputSchemas } from "@/features/integrations/providers/outputSchemas";

const account = providerOutputSchemas.exchange.shape.account.extend({
  scopes: upstreamScopesSchema,
  resources: z.array(providerOutputSchemas.listResources.shape.resources.element).max(500),
});
export const fakeProviderConfigSchema = z.strictObject({
  label: z.string().regex(/^[a-z0-9-]{1,64}$/),
  now: z.number().int().nonnegative(),
  accounts: z
    .array(account)
    .min(1)
    .max(20)
    .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length),
});
export type FakeProviderConfig = z.infer<typeof fakeProviderConfigSchema>;
export type FakeAccount = z.infer<typeof account>;
export type FakeCandidate = ProviderOutput<"refresh">["credentialCandidate"];
export interface FakeAttempt {
  state: string;
  redirectUri: string;
  scopes: string[] | undefined;
  expiresAt: number;
  approved: boolean;
}
export interface FakeCode {
  attemptId: string;
  accountId: string;
  expiresAt: number;
  consumed: boolean;
}
export interface FakeFamily {
  id: string;
  accountId: string;
  generation: number;
  boundGeneration: number;
  revoked: boolean;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  scopes: string[];
}
export interface FakeCursor {
  familyId: string;
  generation: number;
  offset: number;
}
export const FAKE_CODE_TTL_MS = 60_000;
export const FAKE_ACCESS_TTL_MS = 60_000;
export const FAKE_REFRESH_TTL_MS = 86_400_000;

export const fakeProviderFaultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("rate_limited"),
    retryAfterMs: z.number().int().min(1).max(86_400_000),
  }),
  z.strictObject({ kind: z.literal("unavailable") }),
  z.strictObject({ kind: z.literal("ambiguous_outcome"), apply: z.boolean() }),
]);
export type FakeProviderFault = z.infer<typeof fakeProviderFaultSchema>;
