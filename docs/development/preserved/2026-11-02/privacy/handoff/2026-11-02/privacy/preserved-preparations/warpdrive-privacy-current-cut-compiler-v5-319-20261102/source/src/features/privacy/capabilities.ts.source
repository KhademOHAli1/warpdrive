import { z } from "zod";

export const PRIVACY_CAPABILITIES = [
  "case.intake",
  "case.assign",
  "case.review",
  "case.disclose",
  "case.export",
  "case.restrict",
  "case.erase.approve",
  "case.erase.execute",
  "case.hold",
  "policy.manage",
  "authority.manage",
  "audit.view",
] as const;

export type PrivacyCapability = (typeof PRIVACY_CAPABILITIES)[number];

export const privacyCapabilitiesSchema = z
  .array(z.enum(PRIVACY_CAPABILITIES))
  .max(PRIVACY_CAPABILITIES.length)
  .refine((values) => new Set(values).size === values.length);
