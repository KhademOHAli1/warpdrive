import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

// Supplied metadata and hold lists are simulation facts, never proof of live authority.
export type LegacyAuthMailStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "captured"
  | "cancelled";
export type RetentionHoldKind = "legal" | "operational";

interface RetentionMetadataBase {
  readonly recordRef: string;
  readonly createdAt: string;
  // Missing/null means unknown. An empty list means none supplied for this simulation only.
  readonly holds?: readonly RetentionHoldKind[] | null;
}
export interface LegacyAuthMailMetadata extends RetentionMetadataBase {
  readonly store: "auth_mail_outbox";
  readonly status: LegacyAuthMailStatus;
  readonly bodyPresent: boolean;
}
export interface LegacyAuthSecurityMetadata extends RetentionMetadataBase {
  readonly store: "auth_security_events";
}
export type RetentionMetadataRow = LegacyAuthMailMetadata | LegacyAuthSecurityMetadata;
export interface RetentionPreviewInput {
  readonly asOf: string;
  readonly cutoffs: {
    readonly authBodyBefore: string;
    readonly authMetadataBefore: string;
  };
  readonly rows: readonly RetentionMetadataRow[];
}
export type RetentionTarget = "auth_mail_body" | "auth_mail_metadata" | "auth_security_metadata";

export interface RetentionRulePreview {
  readonly target: RetentionTarget;
  readonly anchor: "created_at";
  // Descriptors of current housekeeping, not durations used for cutoff arithmetic.
  readonly period: { readonly days: 7 | 180 };
  readonly comparison: "strictly_before";
  readonly statuses: readonly LegacyAuthMailStatus[] | null;
  readonly before: string;
  readonly matches: number;
  readonly heldMatches: number;
  readonly unknownHoldMatches: number;
  readonly unheldMatches: number;
  readonly noOpMatches: number;
}
export interface RetentionPreview {
  readonly formatVersion: 1;
  readonly executable: false;
  readonly scope: "supplied_metadata_only";
  readonly asOf: string;
  readonly cutoffs: RetentionPreviewInput["cutoffs"];
  readonly legacyDefaults: { readonly authBodyDays: 7; readonly authMetadataDays: 180 };
  readonly sampleRows: number;
  readonly holdCoverage: { readonly held: number; readonly unknown: number; readonly none: number };
  readonly rules: readonly RetentionRulePreview[];
  readonly uniqueMatches: {
    readonly total: number;
    readonly held: number;
    readonly unknownHold: number;
    readonly unheld: number;
  };
  readonly blockers: readonly "unknown_hold_data"[];
}
export type RetentionPreviewFailure = "invalid_input";

const instantSchema = z
  .string()
  .max(35)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u)
  .transform((value, context) => {
    try {
      return Temporal.Instant.from(value).toString();
    } catch {
      context.addIssue({ code: "custom", message: "Invalid instant" });
      return z.NEVER;
    }
  });
const holdsSchema = z
  .preprocess(
    (value) => (Array.isArray(value) && value.length > 2 ? false : value),
    z
      .array(z.enum(["legal", "operational"]))
      .max(2)
      .refine((holds) => new Set(holds).size === holds.length),
  )
  .nullable()
  .optional();
const rowFields = {
  recordRef: z.uuid().transform((value) => value.toLowerCase()),
  createdAt: instantSchema,
  holds: holdsSchema,
};
const mailMetadataSchema = z.strictObject({
  ...rowFields,
  store: z.literal("auth_mail_outbox"),
  status: z.enum(["pending", "sending", "sent", "failed", "captured", "cancelled"]),
  bodyPresent: z.boolean(),
});
const securityMetadataSchema = z.strictObject({
  ...rowFields,
  store: z.literal("auth_security_events"),
});

export const retentionPreviewInputSchema = z
  .strictObject({
    asOf: instantSchema,
    cutoffs: z.strictObject({
      authBodyBefore: instantSchema,
      authMetadataBefore: instantSchema,
    }),
    rows: z.preprocess(
      (value) => (Array.isArray(value) && value.length > 100 ? false : value),
      z.array(z.discriminatedUnion("store", [mailMetadataSchema, securityMetadataSchema])).max(100),
    ),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    for (const row of input.rows) {
      const key = `${row.store}:${row.recordRef}`;
      if (seen.has(key)) {
        context.addIssue({ code: "custom", path: ["rows"], message: "Duplicate record reference" });
        return;
      }
      seen.add(key);
    }
  });
