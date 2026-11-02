import { isIP } from "node:net";
import { z } from "zod";

export const AUTH_STAGING_LOCALES = ["en", "fa", "de"] as const;
export const AUTH_STAGING_GATES = [
  "deployment_revision",
  "https_origin",
  "session_cookies",
  "smtp_tls",
  "external_reset_delivery",
  "external_notice_delivery",
  "physical_passkey",
  "fallback_recovery",
  "localized_recovery",
  "origin_csrf",
  "expiry_replay",
  "provider_boundary",
] as const;
export type AuthStagingGate = (typeof AUTH_STAGING_GATES)[number];
export const stagingRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const stagingOriginSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === ""
      );
    } catch {
      return false;
    }
  })
  .transform((value) => new URL(value).origin);
const reference = z.uuid().nullable().default(null);
const isoInstant = z.iso.datetime({ offset: true });
const evidenceSchema = z
  .object({
    id: z.uuid(),
    gate: z.enum(AUTH_STAGING_GATES),
    origin: stagingOriginSchema,
    revision: stagingRevisionSchema,
    level: z.enum(["synthetic", "installed_claim"]),
    outcome: z.enum(["passed", "failed"]),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    observedAt: isoInstant,
    locales: z.array(z.enum(AUTH_STAGING_LOCALES)).max(3),
    deviceKind: z.enum(["physical", "virtual", "not_applicable"]).default("not_applicable"),
  })
  .strict();
export const authStagingSchema = z
  .object({
    version: z.literal(1).default(1),
    environment: z.enum(["installed", "synthetic"]).default("installed"),
    origin: stagingOriginSchema.nullable().default(null),
    revision: stagingRevisionSchema.nullable().default(null),
    operatorRef: reference,
    secretStoreSetupRef: reference,
    recipientSetRef: reference,
    externalMailAuthorizationRef: reference,
    physicalDeviceSetRef: reference,
    testAccountSetRef: reference,
    deploymentEvidenceRef: reference,
    probeAuthorization: z
      .object({
        id: z.uuid(),
        origin: stagingOriginSchema,
        revision: stagingRevisionSchema,
        expiresAt: isoInstant,
      })
      .strict()
      .nullable()
      .default(null),
    evidence: z.array(evidenceSchema).max(100).default([]),
  })
  .strict()
  .refine((value) => new Set(value.evidence.map((item) => item.id)).size === value.evidence.length)
  .refine((value) => {
    if (value.environment === "synthetic" || value.origin === null) return true;
    try {
      const host = new URL(value.origin).hostname;
      return (
        isIP(host.replace(/^\[|\]$/g, "")) === 0 &&
        host !== "localhost" &&
        !/\.(?:test|invalid|localhost|example)$/.test(host)
      );
    } catch {
      return false;
    }
  });
export type AuthStagingConfig = z.infer<typeof authStagingSchema>;
export type AuthStagingEvidence = AuthStagingConfig["evidence"][number];
