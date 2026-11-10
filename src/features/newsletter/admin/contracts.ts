import { z } from "zod";

export const settingsSections = [
  "general",
  "performance",
  "privacy",
  "security",
  "media",
  "smtp",
  "bounces",
  "messengers",
  "appearance",
] as const;

export const settingsSectionSchema = z.enum(settingsSections);
export type SettingsSection = z.infer<typeof settingsSectionSchema>;

const toggle = z.boolean();
const count = (max: number) => z.number().int().min(1).max(max);
const domainLabel = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const domainPattern = new RegExp(`^(?:\\*\\.)?(?:${domainLabel}\\.)+${domainLabel}$`);
const domains = z.array(z.string().trim().toLowerCase().max(253).regex(domainPattern)).max(100);
const imageExtensions = z
  .array(z.enum(["jpg", "jpeg", "png", "gif", "webp", "avif", "pdf"]))
  .min(1)
  .max(7);
const duration = z
  .string()
  .trim()
  .max(32)
  .refine((value) => {
    if (!/^(?:[1-9]\d{0,5}[hms]){1,3}$/.test(value)) return false;
    const units = { h: 3600, m: 60, s: 1 };
    const seconds = [...value.matchAll(/(\d+)([hms])/g)].reduce(
      (sum, [, amount, unit]) => sum + Number(amount) * units[unit as keyof typeof units],
      0,
    );
    return seconds >= 1 && seconds <= 30 * 24 * 3600;
  });
const cron = z.string().trim().max(100).refine(validCron);

function validCron(value: string): boolean {
  const parts = value.split(/\s+/);
  const bounds = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ] as const;
  return (
    parts.length === bounds.length &&
    bounds.every(
      ([min, max], index) =>
        parts[index]?.split(",").every((part) => validCronPart(part, min, max)) === true,
    )
  );
}

function validCronPart(part: string, min: number, max: number): boolean {
  const match = /^(\*|\d{1,2})(?:-(\d{1,2}))?(?:\/(\d{1,2}))?$/.exec(part);
  if (match === null) return false;
  const [, start, end, step] = match;
  if (step !== undefined && (Number(step) < 1 || Number(step) > max - min + 1)) return false;
  if (start === "*") return end === undefined;
  const lower = Number(start);
  const upper = end === undefined ? lower : Number(end);
  return lower >= min && lower <= upper && upper <= max;
}

const sender = z
  .string()
  .trim()
  .max(320)
  .refine((value) => {
    if (/[\p{Cc}]/u.test(value)) return false;
    const named = /^[^<>]{1,64} <([^<>]+)>$/.exec(value);
    return z.email().safeParse(named?.[1] ?? value).success;
  });
const bounceAction = z.enum(["none", "unsubscribe", "blocklist"]);
const bounceRule = z.strictObject({ count: count(1000), action: bounceAction });
export const bouncePolicy = z.strictObject({
  soft: bounceRule,
  hard: bounceRule,
  complaint: bounceRule,
});
const currentBounceRule = bounceRule.extend({ action: bounceAction.or(z.literal("delete")) });
const currentBouncePolicy = z.strictObject({
  soft: currentBounceRule,
  hard: currentBounceRule,
  complaint: currentBounceRule,
});

export const settingSpecs = {
  "app.enable_public_subscription_page": { section: "general", kind: "toggle", value: toggle },
  "app.send_optin_confirmation": { section: "general", kind: "toggle", value: toggle },
  "app.show_optin_page": { section: "general", kind: "toggle", value: toggle },
  "app.enable_public_archive": { section: "general", kind: "toggle", value: toggle },
  "app.enable_public_archive_rss_content": { section: "general", kind: "toggle", value: toggle },
  "app.concurrency": { section: "performance", kind: "number", value: count(100) },
  "app.message_rate": { section: "performance", kind: "number", value: count(10000) },
  "app.batch_size": { section: "performance", kind: "number", value: count(50000) },
  "app.max_send_errors": {
    section: "performance",
    kind: "number",
    value: z.number().int().min(0).max(100000),
  },
  "app.message_sliding_window": { section: "performance", kind: "toggle", value: toggle },
  "app.message_sliding_window_rate": {
    section: "performance",
    kind: "number",
    value: count(10000000),
  },
  "app.message_sliding_window_duration": { section: "performance", kind: "text", value: duration },
  "app.cache_slow_queries": { section: "performance", kind: "toggle", value: toggle },
  "app.cache_slow_queries_interval": { section: "performance", kind: "text", value: cron },
  "privacy.disable_tracking": { section: "privacy", kind: "toggle", value: toggle },
  "privacy.individual_tracking": { section: "privacy", kind: "toggle", value: toggle },
  "privacy.unsubscribe_header": { section: "privacy", kind: "toggle", value: z.literal(true) },
  "privacy.allow_blocklist": { section: "privacy", kind: "toggle", value: toggle },
  "privacy.allow_preferences": { section: "privacy", kind: "toggle", value: toggle },
  "privacy.allow_export": { section: "privacy", kind: "toggle", value: z.literal(false) },
  "privacy.allow_wipe": { section: "privacy", kind: "toggle", value: z.literal(false) },
  "privacy.record_optin_ip": { section: "privacy", kind: "toggle", value: z.literal(false) },
  "privacy.domain_allowlist": { section: "privacy", kind: "list", value: domains },
  "privacy.domain_blocklist": { section: "privacy", kind: "list", value: domains },
  "upload.extensions": { section: "media", kind: "list", value: imageExtensions },
  "app.from_email": { section: "smtp", kind: "text", value: sender },
  "bounce.enabled": { section: "bounces", kind: "toggle", value: toggle },
  "bounce.actions": { section: "bounces", kind: "bounce", value: bouncePolicy },
} as const satisfies Record<string, { section: SettingsSection; kind: string; value: z.ZodType }>;

export const settingKeySchema = z.enum(Object.keys(settingSpecs) as SettingKey[]);
export type SettingKey = keyof typeof settingSpecs;
export const settingKeys = settingKeySchema.options;
const valueShape = z.union([
  toggle,
  z.number().int().min(0).max(10000000),
  z.string().max(320),
  z.array(z.string().max(253)).max(100),
  currentBouncePolicy,
]);
export type SettingValue = z.infer<typeof valueShape>;
export type BouncePolicy = z.infer<typeof currentBouncePolicy>;

export const updateSettingSchema = z.strictObject({
  key: settingKeySchema,
  expected: valueShape,
  value: valueShape,
});

export interface SettingsSnapshot {
  values: Partial<Record<SettingKey, SettingValue>>;
  deliveryEnabled: boolean;
  reloadRequired: boolean;
  publicUrlConfigured: boolean;
  smtpRelays: number;
  enabledSmtpRelays: number;
  relayLimits: SmtpRelayLimits[];
  notifyRecipients: number;
  storage: "s3" | "filesystem" | "unknown";
  captcha: "altcha" | "hcaptcha" | "off";
  trustedOrigins: number;
  bounceWebhooks: boolean;
  bounceMailbox: boolean;
  messengers: number;
  customAppearance: boolean;
}

export interface SmtpRelayLimits {
  id: string;
  enabled: boolean;
  name: string | null;
  tls: "TLS" | "STARTTLS" | "none" | null;
  maxConnections: number | null;
  retries: number | null;
  idleTimeout: string | null;
  waitTimeout: string | null;
  retryDelay: string | null;
  senderRestrictions: number;
}

export const cleanupKinds = ["unconfirmed", "views", "clicks"] as const;
export const cleanupSchema = z.strictObject({
  kind: z.enum(cleanupKinds),
  before: z.iso.date(),
  confirmed: z.literal(true),
});
export const exportSchema = z.strictObject({
  kind: z.enum(["views", "clicks"]),
  since: z.iso.date(),
});
export interface MaintenanceSnapshot {
  orphanedSubscribers: number;
  blocklistedSubscribers: number;
  vacuumEnabled: boolean;
  vacuumSchedule: string | null;
}

export const logOutcomes = ["requested", "succeeded", "failed", "unknown"] as const;
export const logOutcomeSchema = z.enum(logOutcomes);
export type LogOutcome = z.infer<typeof logOutcomeSchema>;
const logCursorSchema = z.strictObject({ at: z.iso.datetime(), id: z.uuid() });
export type LogCursor = z.infer<typeof logCursorSchema>;
export const logsSchema = z.strictObject({
  source: z.enum(["campaigns", "workspace"]).optional(),
  outcome: logOutcomeSchema.optional(),
  cursor: logCursorSchema.optional(),
});
export interface LogEntry {
  id: string;
  at: string;
  action: string;
  source: "campaigns" | "workspace";
  outcome: LogOutcome;
  correlationId: string | null;
}
export interface LogPage {
  rows: LogEntry[];
  next: LogCursor | null;
}

export function isEditableValue(key: SettingKey, value: SettingValue): boolean {
  return settingSpecs[key].value.safeParse(value).success;
}

export function readSettingValue(key: SettingKey, raw: unknown): SettingValue | undefined {
  const shape = valueShape.safeParse(raw);
  if (!shape.success) return undefined;
  const value = shape.data;
  switch (settingSpecs[key].kind) {
    case "toggle":
      return typeof value === "boolean" ? value : undefined;
    case "number":
      return typeof value === "number" ? value : undefined;
    case "text":
      return typeof value === "string" ? value : undefined;
    case "list":
      return Array.isArray(value) ? value : undefined;
    case "bounce":
      return currentBouncePolicy.safeParse(value).data;
  }
}
