import { z } from "zod";
import { err, ok } from "@/types/result";
import { type PrivacyAuthorityTicket, samePrivacyTicket } from "./authorityTicket";
import { PRIVACY_CAPABILITIES } from "./capabilities";
import { decryptPrivacy, encryptPrivacy } from "./crypto";
import { DISCOVERY_ADAPTER_TABLES, type DiscoveryStore } from "./discoveryTypes";

const ticketSchema = z.strictObject({
  userId: z.uuid(),
  sessionId: z.uuid(),
  capability: z.enum(PRIVACY_CAPABILITIES),
  caseId: z.uuid().nullable(),
  authorityGeneration: z.number().int().positive(),
  membershipGeneration: z.number().int().positive().nullable(),
  scopeVersion: z.number().int().positive().nullable(),
  policyVersion: z.number().int().positive().nullable(),
  activePolicyVersion: z.number().int().positive().nullable(),
  policyGeneration: z.number().int().nonnegative(),
  recipientVersion: z.number().int().positive().nullable(),
  verificationVersion: z.number().int().positive().nullable(),
});
const cursorSchema = z.strictObject({
  format: z.literal("privacy-discovery-page-v1"),
  ticket: ticketSchema,
  store: z.enum(DISCOVERY_ADAPTER_TABLES),
  afterId: z
    .string()
    .regex(/^[a-f0-9-]+(?::[a-f0-9-]+)?$/)
    .max(128),
});
export function encodeDiscoveryCursor(
  caseId: string,
  ticket: PrivacyAuthorityTicket,
  store: DiscoveryStore,
  afterId: string,
): string {
  return encryptPrivacy(
    JSON.stringify({ format: "privacy-discovery-page-v1", ticket, store, afterId }),
    { caseId, purpose: "job" },
  ).toString("base64url");
}
export function decodeDiscoveryCursor(raw: string, caseId: string, ticket: PrivacyAuthorityTicket) {
  const packed = Buffer.from(raw, "base64url");
  if (packed.toString("base64url") !== raw) return err("invalid_cursor" as const);
  const clear = decryptPrivacy(packed, { caseId, purpose: "job" });
  if (!clear.ok) return err("invalid_cursor" as const);
  let input: unknown;
  try {
    input = JSON.parse(clear.value);
  } catch {
    return err("invalid_cursor" as const);
  }
  const parsed = cursorSchema.safeParse(input);
  if (!parsed.success) return err("invalid_cursor" as const);
  if (!samePrivacyTicket(parsed.data.ticket, ticket)) return err("forbidden" as const);
  return ok({ store: parsed.data.store, afterId: parsed.data.afterId });
}
