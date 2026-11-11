import { z } from "zod";

export const audiencePageSize = 25;
export const importMaxBytes = 2 * 1024 * 1024;

export const audienceId = z.number().int().positive().max(2_147_483_647);
export const listType = z.enum(["private", "public"]);
export const listOptin = z.enum(["single", "double"]);
export const listStatus = z.enum(["active", "archived"]);
export const subscriberStatus = z.enum(["enabled", "disabled", "blocklisted"]);
export const newSubscriberStatus = z.enum(["enabled", "blocklisted"]);
export const subscriptionStatus = z.enum(["unconfirmed", "confirmed", "unsubscribed"]);
export const bounceType = z.enum(["hard", "soft", "complaint"]);
export const importStatus = z.enum([
  "none",
  "importing",
  "stopping",
  "finished",
  "failed",
  "stopped",
]);
export const importMode = z.enum(["subscribe", "blocklist"]);
export const csvDelimiter = z.enum([",", ";", "\t", "|"]);

export const minimalList = z.object({ id: audienceId, name: z.string() });
export type MinimalList = z.infer<typeof minimalList>;

export const mailingList = minimalList.extend({
  type: listType,
  optin: listOptin,
  status: listStatus,
  description: z.string(),
  tags: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  subscriber_count: z.number().int().nonnegative(),
});
export type MailingList = z.infer<typeof mailingList>;

const membership = minimalList.extend({
  optin: listOptin,
  status: listStatus,
  subscription_status: subscriptionStatus,
});
export const subscriber = z.object({
  id: audienceId,
  recordProof: z.string().optional(),
  email: z.string(),
  name: z.string(),
  status: subscriberStatus,
  attribs: z
    .record(z.string(), z.unknown())
    .nullish()
    .transform((value) => value ?? {}),
  lists: z
    .array(membership)
    .nullish()
    .transform((value) => value ?? []),
});
export type Subscriber = z.infer<typeof subscriber>;

export const subscriberExportSections = ["profile", "memberships", "activity"] as const;
export type SubscriberExportSection = (typeof subscriberExportSections)[number];

export type SubscriberActivityItem = {
  key: string;
  kind: "view" | "click";
  campaignName: string | null;
  count: number;
  lastAt: string;
};

export type SubscriberActivity = { items: SubscriberActivityItem[]; truncated: boolean };
export type SubscriberExport = { filename: string; contents: string };

export type ListSignupEmbed =
  | { status: "ready"; url: string; html: string }
  | {
      status:
        | "signupDisabled"
        | "listUnavailable"
        | "originMismatch"
        | "verificationRequired"
        | "serviceUnsupported";
    };

export const bounce = z.object({
  id: audienceId,
  type: bounceType,
  email: z.string().optional(),
  source: z.string(),
  campaign: minimalList.nullish(),
  created_at: z.iso.datetime({ offset: true }),
});
export type Bounce = z.infer<typeof bounce>;

export const importProgress = z.object({
  name: z.string(),
  total: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  status: importStatus,
});
export type ImportProgress = z.infer<typeof importProgress>;

export interface AudiencePage<T> {
  results: T[];
  total: number;
}

export type ImportLogEntry =
  | { kind: "started" | "ignoredColumn" | "finished" | "stopped" | "failed" }
  | { kind: "skippedRow" | "invalidAttributes" | "committed"; count: number };

export type ImportLogEvent = ImportLogEntry & { id: number };

export function canRequestOptin(row: Subscriber): boolean {
  return (
    row.status === "enabled" &&
    row.lists.some(
      (list) =>
        list.status === "active" &&
        list.optin === "double" &&
        list.subscription_status === "unconfirmed",
    )
  );
}
