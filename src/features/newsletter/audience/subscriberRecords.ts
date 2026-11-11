import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "@/config/env";
import type { ListmonkClient } from "@/features/newsletter/listmonkClient";
import { defineOperation, type NewsletterExecution } from "@/features/newsletter/operation";
import {
  audienceId,
  listType,
  type Subscriber,
  type SubscriberActivity,
  type SubscriberActivityItem,
  type SubscriberExport,
  type SubscriberExportSection,
  subscriber,
  subscriberExportSections,
  subscriberStatus,
  subscriptionStatus,
} from "./contracts";

const limit = 100;
const text = z.string().transform((value) => value.slice(0, 256));
const count = z.number().int().nonnegative().safe();
const at = z.iso.datetime({ offset: true });
const recordProof = z.string().regex(/^[a-zA-Z0-9_-]{43}$/);
const identity = z.strictObject({ id: audienceId, recordProof, status: subscriberStatus });
const current = z.object({
  id: audienceId,
  uuid: z.uuid(),
  status: subscriberStatus,
  email: z.string().max(254),
  updated_at: at.nullish(),
});
export const engineSubscriberRecord = subscriber
  .omit({ recordProof: true })
  .extend({ uuid: z.uuid().optional(), updated_at: at.nullish() });
type Identity = z.infer<typeof identity>;
type ExactRecord = z.infer<typeof current>;
const recordKey = Buffer.from(
  hkdfSync(
    "sha256",
    Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64"),
    "warpdrive-newsletter",
    "subscriber-record-v1",
    32,
  ),
);

function signRecord(row: ExactRecord, actorId: string): string {
  return createHmac("sha256", recordKey)
    .update(
      JSON.stringify([actorId, row.id, row.uuid, row.status, row.email, row.updated_at ?? null]),
    )
    .digest("base64url");
}

// The engine's subscriber UUID also authorizes recipient-facing links. A native
// selection proves its exact record without returning that upstream bearer.
export function projectSubscriberRecord(
  row: z.infer<typeof engineSubscriberRecord>,
  actorId: string,
): Subscriber {
  const { uuid, updated_at, ...profile } = row;
  return {
    ...profile,
    recordProof:
      uuid === undefined ? undefined : signRecord({ ...profile, uuid, updated_at }, actorId),
  };
}

function requireAdmin(context: NewsletterExecution) {
  if (context.actor.type !== "admin" || !context.actor.isActive) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

function staleSubscriber(): TRPCError {
  return new TRPCError({ code: "CONFLICT", message: "audience_subscriber_changed" });
}

async function exactSubscriber(
  client: ListmonkClient,
  expected: Identity,
  actorId: string,
): Promise<ExactRecord> {
  const row = current.parse(await client.json("GET", `/api/subscribers/${expected.id}`));
  const proof = signRecord(row, actorId);
  if (
    row.id !== expected.id ||
    row.status !== expected.status ||
    !timingSafeEqual(Buffer.from(proof), Buffer.from(expected.recordProof))
  )
    throw staleSubscriber();
  return row;
}

async function withExactSubscriber<T>(
  client: ListmonkClient,
  identity: Identity,
  actorId: string,
  read: (selected: ExactRecord) => Promise<T>,
): Promise<T> {
  const selected = await exactSubscriber(client, identity, actorId);
  const data = await read(selected);
  await exactSubscriber(client, identity, actorId);
  return data;
}

const activityEnvelope = z.object({
  campaign_views: z.array(z.unknown()),
  link_clicks: z.array(z.unknown()),
});
const view = z.object({ id: audienceId, name: text, view_count: count, last_viewed_at: at });
const click = z.object({
  link_id: audienceId,
  campaign_id: audienceId.nullish(),
  campaign_name: text.nullish(),
  click_count: count,
  last_clicked_at: at,
});

export function projectSubscriberActivity(raw: unknown): SubscriberActivity {
  const { campaign_views: views, link_clicks: clicks } = activityEnvelope.parse(raw);
  const items: SubscriberActivityItem[] = [
    ...views.slice(0, limit).map((entry) => {
      const { id, name, view_count, last_viewed_at } = view.parse(entry);
      return {
        key: `view-${id}`,
        kind: "view" as const,
        campaignName: name,
        count: view_count,
        lastAt: last_viewed_at,
      };
    }),
    ...clicks.slice(0, limit).map((entry) => {
      const { link_id, campaign_id, campaign_name, click_count, last_clicked_at } =
        click.parse(entry);
      return {
        key: `click-${link_id}-${campaign_id ?? 0}`,
        kind: "click" as const,
        campaignName: campaign_name ?? null,
        count: click_count,
        lastAt: last_clicked_at,
      };
    }),
  ];
  items.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
  return { items: items.slice(0, limit), truncated: views.length + clicks.length > limit };
}

const exportEnvelope = z.object({
  profile: z.array(z.unknown()).nullish(),
  subscriptions: z.array(z.unknown()).nullish(),
  campaign_views: z.array(z.unknown()).nullish(),
  link_clicks: z.array(z.unknown()).nullish(),
});
const exportProfile = z.object({
  id: audienceId,
  uuid: z.uuid(),
  email: z.string().max(254),
  name: text,
  status: subscriberStatus,
});
const exportMembership = z.object({
  name: text,
  type: listType,
  subscription_status: subscriptionStatus,
  created_at: at,
});
const exportView = z.object({ campaign: text, views: count });
const exportClick = z.object({ clicks: count });

function bounded<T>(source: unknown[], schema: z.ZodType<T>) {
  return {
    items: source.slice(0, limit).map((item) => schema.parse(item)),
    truncated: source.length > limit,
  };
}

export function projectSubscriberExport(
  raw: unknown,
  selected: ExactRecord,
  sections: readonly SubscriberExportSection[],
) {
  const { profile, subscriptions, campaign_views, link_clicks } = exportEnvelope.parse(raw);
  let profileFields: { name: string; email: string; status: Identity["status"] } | undefined;
  if (profile !== undefined && profile !== null) {
    if (profile.length !== 1) throw staleSubscriber();
    const row = exportProfile.parse(profile[0]);
    if (
      row.id !== selected.id ||
      row.uuid !== selected.uuid ||
      row.status !== selected.status ||
      row.email !== selected.email
    ) {
      throw staleSubscriber();
    }
    if (sections.includes("profile"))
      profileFields = { name: row.name, email: row.email, status: row.status };
  }
  return {
    profile: profileFields,
    memberships:
      sections.includes("memberships") && subscriptions != null
        ? bounded(subscriptions, exportMembership)
        : undefined,
    campaignViews:
      sections.includes("activity") && campaign_views != null
        ? bounded(campaign_views, exportView)
        : undefined,
    linkClicks:
      sections.includes("activity") && link_clicks != null
        ? bounded(link_clicks, exportClick)
        : undefined,
  };
}

export const subscriberRecordReads = {
  "subscribers.activity": defineOperation(identity, async (client, expected, context) => {
    requireAdmin(context);
    return withExactSubscriber(client, expected, context.actor.id, async () =>
      projectSubscriberActivity(
        await client.json("GET", `/api/subscribers/${expected.id}/activity`),
      ),
    );
  }),
};

export const subscriberRecordWrites = {
  "subscribers.export": defineOperation(
    identity.extend({
      sections: z
        .array(z.enum(subscriberExportSections))
        .min(1)
        .max(subscriberExportSections.length),
    }),
    async (client, { sections, ...expected }, context): Promise<SubscriberExport> => {
      requireAdmin(context);
      return withExactSubscriber(client, expected, context.actor.id, async (selected) => {
        const raw: unknown = JSON.parse(
          await client.text("GET", `/api/subscribers/${expected.id}/export`),
        );
        const output = projectSubscriberExport(raw, selected, sections);
        if (Object.values(output).every((value) => value === undefined)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "audience_export_unavailable",
          });
        }
        return {
          filename: `newsletter-subscriber-${expected.id}.json`,
          contents: JSON.stringify(output, null, 2),
        };
      });
    },
  ),
};
