import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { auditEvents } from "@/db/schema";
import { parseCsv } from "@/features/import/csvParse";
import { escapeCsv } from "@/features/import/csvSafe";
import {
  type ListmonkClient,
  NewsletterConnectionError,
} from "@/features/newsletter/listmonkClient";
import {
  defineLocalOperation,
  defineOperation,
  type NewsletterExecution,
} from "@/features/newsletter/operation";
import { operationalNoticeSchema } from "../delivery/operationalContracts";
import {
  cleanupSchema,
  exportSchema,
  type LogEntry,
  type LogPage,
  logOutcomeSchema,
  logsSchema,
  type MaintenanceSnapshot,
  readSettingValue,
  type SettingKey,
  type SettingsSnapshot,
  type SmtpRelayLimits,
  settingKeys,
  settingSpecs,
  updateSettingSchema,
} from "./contracts";

const object = z.record(z.string(), z.unknown());
const objects = z.array(object).max(100);
const empty = z.strictObject({});
const upstreamDate = (date: string): string => `${date}T00:00:00.000Z`;
const safeCount = z.number().int().nonnegative();
const relayName = z
  .string()
  .max(100)
  .regex(/^email-[a-z0-9-]+$/);
const smtpDuration = z
  .string()
  .max(32)
  .regex(/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/);
const smtpTls = z.enum(["TLS", "STARTTLS", "none"]);

function settingObject(value: unknown): Record<string, unknown> {
  return object.safeParse(value).data ?? {};
}

function settingObjects(value: unknown): Record<string, unknown>[] {
  return objects.safeParse(value).data ?? [];
}

async function getSettings(client: ListmonkClient): Promise<Record<string, unknown>> {
  const raw = object.safeParse(await client.json("GET", "/api/settings"));
  if (!raw.success) throw new NewsletterConnectionError(false);
  return raw.data;
}

function projectRelayLimits(relay: Record<string, unknown>, index: number): SmtpRelayLimits {
  return {
    id: z.uuid().safeParse(relay.uuid).data ?? `relay-${index + 1}`,
    enabled: relay.enabled === true,
    name: relayName.safeParse(relay.name).data ?? null,
    tls: smtpTls.safeParse(relay.tls_type).data ?? null,
    maxConnections: safeCount.safeParse(relay.max_conns).data ?? null,
    retries: safeCount.safeParse(relay.max_msg_retries).data ?? null,
    idleTimeout: smtpDuration.safeParse(relay.idle_timeout).data ?? null,
    waitTimeout: smtpDuration.safeParse(relay.wait_timeout).data ?? null,
    retryDelay: smtpDuration.safeParse(relay.msg_retry_delay).data ?? null,
    senderRestrictions: Array.isArray(relay.from_addresses) ? relay.from_addresses.length : 0,
  };
}

function settingsSnapshot(
  raw: Record<string, unknown>,
  deliveryEnabled: boolean,
  reloadRequired: boolean,
): SettingsSnapshot {
  const values: SettingsSnapshot["values"] = {};
  for (const key of settingKeys) {
    const value = readSettingValue(key, raw[key]);
    if (value !== undefined) values[key] = value;
  }
  const smtp = settingObjects(raw.smtp);
  const captcha = settingObject(raw["security.captcha"]);
  const storage = raw["upload.provider"];
  const storageType = storage === "s3" || storage === "filesystem" ? storage : "unknown";
  const altcha = settingObject(captcha.altcha).enabled === true;
  const hcaptcha = settingObject(captcha.hcaptcha).enabled === true;
  return {
    values,
    deliveryEnabled,
    reloadRequired,
    publicUrlConfigured: typeof raw["app.root_url"] === "string" && raw["app.root_url"] !== "",
    smtpRelays: smtp.length,
    enabledSmtpRelays: smtp.filter((relay) => relay.enabled === true).length,
    relayLimits: smtp.map(projectRelayLimits),
    notifyRecipients: Array.isArray(raw["app.notify_emails"]) ? raw["app.notify_emails"].length : 0,
    storage: storageType,
    captcha: altcha ? "altcha" : hcaptcha ? "hcaptcha" : "off",
    trustedOrigins: Array.isArray(raw["security.trusted_urls"])
      ? raw["security.trusted_urls"].length
      : 0,
    bounceWebhooks: raw["bounce.webhooks_enabled"] === true,
    bounceMailbox: settingObjects(raw["bounce.mailboxes"]).some(
      (mailbox) => mailbox.enabled === true,
    ),
    messengers: settingObjects(raw.messengers).filter((messenger) => messenger.enabled === true)
      .length,
    customAppearance: [
      "appearance.admin.custom_css",
      "appearance.admin.custom_js",
      "appearance.public.custom_css",
      "appearance.public.custom_js",
    ].some((key) => typeof raw[key] === "string" && raw[key] !== ""),
  };
}

function requirePastDate(value: string): void {
  if (value > new Date().toISOString().slice(0, 10)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a date that has already started.",
    });
  }
}

function allowSettingChange(key: SettingKey, value: unknown, context: NewsletterExecution): void {
  if (
    value === true &&
    (key === "app.enable_public_subscription_page" || key === "app.send_optin_confirmation")
  ) {
    context.requireDelivery();
  }
}

const restartResponse = z.union([z.literal(true), z.strictObject({ needs_restart: z.boolean() })]);

const updateSetting = defineOperation(updateSettingSchema, async (client, input, context) => {
  const value = settingSpecs[input.key].value.safeParse(input.value);
  if (!value.success)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Check the setting value." });
  allowSettingChange(input.key, value.data, context);

  // One change per request keeps each engine reload attributable to an explicit save.
  return context.db.transaction(async (tx) => {
    const lock = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('warpdrive-newsletter-settings')) as locked`,
    );
    if (lock.rows[0]?.locked !== true) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Another campaign setting is being saved.",
      });
    }
    const raw = await getSettings(client);
    if (
      input.key === "app.enable_public_subscription_page" &&
      value.data === true &&
      settingsSnapshot(raw, context.deliveryEnabled, false).captcha === "off"
    ) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Configure public form verification before enabling signups.",
      });
    }
    const current = readSettingValue(input.key, raw[input.key]);
    if (JSON.stringify(current) !== JSON.stringify(input.expected)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "The setting changed. Refresh it before saving.",
      });
    }
    if (JSON.stringify(current) === JSON.stringify(value.data)) {
      return { reloadDeferred: false, unchanged: true };
    }
    const result = restartResponse.safeParse(
      await client.json("PUT", `/api/settings/${input.key}`, { body: value.data }),
    );
    if (!result.success) throw new NewsletterConnectionError(true);
    return {
      reloadDeferred: result.data !== true && result.data.needs_restart,
      unchanged: false,
    };
  });
});

const countSnapshot = z.strictObject({ count: safeCount });
const cleanup = defineOperation(cleanupSchema, async (client, input) => {
  requirePastDate(input.before);
  const before = new URLSearchParams({ before_date: upstreamDate(input.before) });
  if (input.kind === "unconfirmed") {
    const result = countSnapshot.safeParse(
      await client.json("DELETE", "/api/maintenance/subscriptions/unconfirmed", { query: before }),
    );
    if (!result.success) throw new NewsletterConnectionError(true);
    return { deleted: result.data.count };
  }
  const result = await client.json("DELETE", `/api/maintenance/analytics/${input.kind}`, {
    query: before,
  });
  if (result !== true) throw new NewsletterConnectionError(true);
  return { deleted: null };
});

const exportColumns = ["campaign_id", "campaign_uuid", "campaign_name", "created_at"] as const;
const maxCsvSize = 3 * 1024 * 1024;
const exportAnalytics = defineOperation(exportSchema, async (client, input) => {
  requirePastDate(input.since);
  const raw = await client.text("GET", `/api/maintenance/analytics/${input.kind}/export`, {
    query: new URLSearchParams({ since: upstreamDate(input.since) }),
  });
  if (raw.length > maxCsvSize) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a more recent date for the export.",
    });
  }
  const parsed = parseCsv(raw);
  // The upstream writer only flushes after a nonempty batch, so an empty result is a 200
  // with no body even though its handler wrote the CSV header into the buffer.
  if (raw !== "" && !exportColumns.every((key) => parsed.headers.includes(key))) {
    throw new NewsletterConnectionError(false);
  }
  // Newsletter maintenance exports omit recipient identities and link URLs.
  const rows = parsed.rows.map((row) =>
    exportColumns.map((key) => escapeCsv(row[key] ?? "")).join(","),
  );
  return {
    filename: `campaign-${input.kind}-${input.since}.csv`,
    csv: [exportColumns.join(","), ...rows].join("\r\n"),
  };
});

const maintenance = defineOperation(empty, async (client): Promise<MaintenanceSnapshot> => {
  const [raw, response] = await Promise.all([
    getSettings(client),
    client.json("GET", "/api/dashboard/counts"),
  ]);
  const subscribers = settingObject(settingObject(response).subscribers);
  const maintenance = settingObject(raw["maintenance.db"]);
  const schedule = z.string().max(100).safeParse(maintenance.vacuum_cron_interval);
  return {
    orphanedSubscribers: safeCount.safeParse(subscribers.orphans).data ?? 0,
    blocklistedSubscribers: safeCount.safeParse(subscribers.blocklisted).data ?? 0,
    vacuumEnabled: maintenance.vacuum === true,
    vacuumSchedule: schedule.data ?? null,
  };
});

const logLimit = 30;
const actionPattern = /^newsletter\.[a-zA-Z]+\.[a-zA-Z]+$/;
const workspaceActions = [
  "company.archive_legal_entity",
  "company.asset_uploaded",
  "company.cancel_operation",
  "company.save_branding",
  "company.save_details",
  "company.save_legal_entity",
  "company.save_payer_preferences",
  "permission_set.create",
  "permission_set.update",
  "pipeline.archive",
  "pipeline.rename",
  "pipeline.restore",
  "user.activate",
  "user.assign_permission_set",
  "user.deactivate",
  "user.invite",
  "user.set_admin",
  "visibility_group.create",
  "visibility_group.member_added",
  "visibility_group.member_removed",
];
const campaignEvents = and(
  eq(auditEvents.targetType, "settings"),
  like(auditEvents.action, "newsletter.%"),
);
const workspaceEvents = inArray(auditEvents.action, workspaceActions);
const outcome = sql<string>`case when ${campaignEvents} then ${auditEvents.after}->>'outcome' else 'succeeded' end`;
const exactTimestamp = sql<string>`to_char(
  ${auditEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
)`;
const logs = defineLocalOperation(logsSchema, async (input, context): Promise<LogPage> => {
  context.signal.throwIfAborted();
  const boundary = input.cursor;
  const source =
    input.source === "campaigns"
      ? campaignEvents
      : input.source === "workspace"
        ? workspaceEvents
        : or(campaignEvents, workspaceEvents);
  const records = await context.db
    .select({
      id: auditEvents.id,
      at: exactTimestamp,
      action: auditEvents.action,
      outcome,
      correlationId: auditEvents.correlationId,
      operational: sql<unknown>`${auditEvents.after}->'operational'`,
    })
    .from(auditEvents)
    .where(
      and(
        source,
        sql`${auditEvents.createdAt} >= now() - interval '90 days'`,
        input.outcome === undefined ? undefined : sql`${outcome} = ${input.outcome}`,
        boundary === undefined
          ? undefined
          : sql`(${auditEvents.createdAt}, ${auditEvents.id}) < (${boundary.at}::timestamptz, ${boundary.id}::uuid)`,
      ),
    )
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(logLimit + 1);
  context.signal.throwIfAborted();
  const window = records.slice(0, logLimit);
  const last = window.at(-1);
  return {
    rows: window.flatMap<LogEntry>((row) => {
      const state = logOutcomeSchema.safeParse(row.outcome);
      if (!state.success) return [];
      const entry = {
        id: row.id,
        at: row.at,
        action: row.action,
        correlationId: row.correlationId,
        outcome: state.data,
      };
      if (actionPattern.test(row.action)) {
        const detail = row.action.startsWith("newsletter.delivery.")
          ? operationalNoticeSchema.safeParse(row.operational)
          : null;
        return [
          {
            ...entry,
            source: "campaigns" as const,
            ...(detail?.success === true ? { detail: detail.data } : {}),
          },
        ];
      }
      if (workspaceActions.includes(row.action))
        return [{ ...entry, source: "workspace" as const }];
      return [];
    }),
    next: records.length > logLimit && last ? { at: last.at, id: last.id } : null,
  };
});

export const settingsReads = {
  "admin.settings": defineOperation(empty, async (client, _input, context) => {
    const [raw, config] = await Promise.all([
      getSettings(client),
      client.json("GET", "/api/config"),
    ]);
    return settingsSnapshot(
      raw,
      context.deliveryEnabled,
      settingObject(config).needs_restart === true,
    );
  }),
  "admin.maintenance": maintenance,
  "admin.logs": logs,
};

export const settingsWrites = {
  "admin.update": updateSetting,
  "admin.cleanup": cleanup,
  "admin.export": exportAnalytics,
};
