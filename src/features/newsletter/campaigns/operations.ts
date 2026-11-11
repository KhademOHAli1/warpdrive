import { TRPCError } from "@trpc/server";
import sharp from "sharp";
import { z } from "zod";
import { env } from "@/config/env";
import { sealedAudience } from "@/features/newsletter/crmAudience/contracts";
import { requireReadyDelivery } from "@/features/newsletter/delivery/readiness";
import type { ListmonkClient } from "@/features/newsletter/listmonkClient";
import { defineLocalOperation, defineOperation } from "@/features/newsletter/operation";
import {
  managedReplyRouting,
  routedCampaignFields,
  withoutManagedReplyRouting,
  withoutReplyTo,
} from "@/features/newsletter/replyRouting/contracts";
import {
  campaignReplyRouting,
  listReplyMailboxes,
  requireCurrentReplyRouting,
} from "@/features/newsletter/replyRouting/routing";
import {
  analyticsLink,
  analyticsMetric,
  analyticsPoint,
  campaign,
  campaignContentType,
  campaignStatus,
  campaignTransitions,
  canEditCampaign,
  crmApprovalRequiredAttribute,
  deliveryConfig,
  emptyInput,
  id,
  idInput,
  mediaItem,
  pageInput,
  pageResponse,
  templateFields,
  templateItem,
} from "./model";

function queryPage(input: { page: number; search: string }) {
  const query = new URLSearchParams({ page: String(input.page), per_page: "25" });
  if (input.search) query.set("query", input.search);
  return query;
}

function requireState(condition: boolean) {
  if (!condition)
    throw new TRPCError({
      code: "CONFLICT",
      message: "The current status does not allow this action.",
    });
}

function dispatchStarted(campaign: { started_at?: string | null; sent: number }) {
  return campaign.started_at != null || campaign.sent > 0;
}

function checkRecipientHeaders(headers: Record<string, string>[] = []) {
  for (const header of headers) {
    for (const key of Object.keys(header)) {
      const name = key.toLowerCase();
      if (name === "to" || name === "cc" || name === "bcc" || name.startsWith("resent-")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Campaign recipients are selected through lists. Remove recipient headers.",
        });
      }
    }
  }
}

const campaignPage = pageResponse(campaign);
const mediaPage = pageResponse(mediaItem);
const testCandidates = pageResponse(z.object({ email: z.string(), status: z.string() }));
const templateList = z
  .array(templateItem)
  .nullable()
  .transform((rows) => rows ?? []);
async function defaultCampaignTemplate(client: ListmonkClient): Promise<number> {
  const templates = templateList.parse(
    await client.json("GET", "/api/templates", { query: new URLSearchParams({ no_body: "true" }) }),
  );
  const template = templates.find((item) => item.type === "campaign" && item.is_default);
  if (template === undefined) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Set a default campaign template.",
    });
  }
  return template.id;
}

const confirmed = z.literal(true);
const confirmedId = idInput.extend({ confirmed });
const revision = z.iso.datetime({ offset: true }).nullable();
const campaignStatusChange = z.union([
  confirmedId.extend({ status: z.enum(["running", "scheduled"]), expectedUpdatedAt: revision }),
  confirmedId.extend({ status: z.enum(["draft", "paused", "cancelled"]) }),
]);
const dateRange = z
  .object({
    ids: z.array(id).min(1).max(20),
    from: z.iso.date(),
    to: z.iso.date(),
    type: analyticsMetric,
  })
  .strict()
  .refine(({ from, to }) => from <= to);

const maxMediaBytes = 2 * 1024 * 1024;
const maxMediaPixels = 16_000_000;
const allowedImageTypes = {
  "image/png": {
    format: "png",
    extension: /\.png$/i,
    signature: Buffer.from("89504e470d0a1a0a", "hex"),
  },
  "image/jpeg": { format: "jpeg", extension: /\.jpe?g$/i, signature: Buffer.from("ffd8ff", "hex") },
  "image/gif": { format: "gif", extension: /\.gif$/i, signature: Buffer.from("GIF8") },
};

const upload = z
  .object({
    name: z
      .string()
      .min(1)
      .max(240)
      .regex(/^[^/\\\p{Cc}]+$/u),
    contentType: z.enum(["image/png", "image/jpeg", "image/gif"]),
    base64: z
      .string()
      .min(4)
      .max(Math.ceil(maxMediaBytes / 3) * 4)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict();

async function validateImageUpload(input: z.output<typeof upload>): Promise<Buffer> {
  const bytes = Buffer.from(input.base64, "base64");
  const expected = allowedImageTypes[input.contentType];
  const headerMatches =
    bytes.length <= maxMediaBytes &&
    expected.extension.test(input.name) &&
    bytes.subarray(0, expected.signature.length).equals(expected.signature);
  if (headerMatches) {
    const metadata = await sharp(bytes, {
      limitInputPixels: maxMediaPixels,
      failOn: "warning",
    })
      .metadata()
      .catch(() => null);
    if (
      metadata?.format === expected.format &&
      metadata.width * (metadata.pageHeight ?? metadata.height) * (metadata.pages ?? 1) <=
        maxMediaPixels
    )
      return bytes;
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Choose a valid PNG, JPEG or GIF image within the upload limits.",
  });
}

export const campaignReads = {
  "campaigns.list": defineOperation(
    pageInput.extend({ status: campaignStatus.optional() }),
    async (client, input) => {
      const query = queryPage(input);
      query.set("no_body", "true");
      if (input.status) query.set("status", input.status);
      return campaignPage.parse(await client.json("GET", "/api/campaigns", { query }));
    },
  ),
  "campaigns.detail": defineOperation(idInput, async (client, input) =>
    campaign.parse(await client.json("GET", `/api/campaigns/${input.id}`)),
  ),
  "campaigns.config": defineOperation(emptyInput, async (client) =>
    deliveryConfig.parse(await client.json("GET", "/api/config")),
  ),
  "campaigns.replyMailboxes": defineLocalOperation(emptyInput, (_input, context) =>
    listReplyMailboxes(context),
  ),
  "media.list": defineOperation(pageInput, async (client, input) =>
    mediaPage.parse(await client.json("GET", "/api/media", { query: queryPage(input) })),
  ),
  "templates.list": defineOperation(emptyInput, async (client) =>
    templateList.parse(
      await client.json("GET", "/api/templates", {
        query: new URLSearchParams({ no_body: "true" }),
      }),
    ),
  ),
  "templates.detail": defineOperation(idInput, async (client, input) =>
    templateItem.parse(await client.json("GET", `/api/templates/${input.id}`)),
  ),
  "analytics.series": defineOperation(dateRange, async (client, input) => {
    const query = new URLSearchParams({
      from: `${input.from}T00:00:00Z`,
      to: `${input.to}T23:59:59.999999Z`,
    });
    for (const campaignId of input.ids) query.append("id", String(campaignId));
    const response = await client.json("GET", `/api/campaigns/analytics/${input.type}`, { query });
    return input.type === "links"
      ? (z.array(analyticsLink).nullable().parse(response) ?? [])
      : (z.array(analyticsPoint).nullable().parse(response) ?? []);
  }),
};

export const campaignWrites = {
  "campaigns.preview": defineOperation(
    z
      .object({
        id,
        body: z.string().max(500_000),
        content_type: campaignContentType,
        template_id: id.nullish(),
      })
      .strict(),
    async (client, input) => {
      const body = new URLSearchParams({ body: input.body, content_type: input.content_type });
      if (input.content_type !== "visual") {
        const templateId =
          input.template_id === null ? await defaultCampaignTemplate(client) : input.template_id;
        if (templateId !== undefined) body.set("template_id", String(templateId));
      }
      return client.text("POST", `/api/campaigns/${input.id}/preview`, { body });
    },
  ),
  "campaigns.archivePreview": defineOperation(
    idInput.extend({ templateId: id.nullable(), metadata: z.record(z.string(), z.json()) }),
    async (client, input) =>
      client.text("POST", `/api/campaigns/${input.id}/preview/archive`, {
        body: new URLSearchParams({
          template_id: String(input.templateId ?? (await defaultCampaignTemplate(client))),
          archive_meta: JSON.stringify(input.metadata),
        }),
      }),
  ),
  "templates.preview": defineOperation(
    templateFields.pick({ type: true, body: true }),
    async (client, input) =>
      client.text("POST", "/api/templates/preview", {
        body: new URLSearchParams({ template_type: input.type, body: input.body }),
      }),
  ),
  "campaigns.create": defineOperation(
    routedCampaignFields,
    async (client, { replyToMailboxId, headers, attribs, ...input }, context) => {
      const routing = await campaignReplyRouting(context, { replyToMailboxId, headers, attribs });
      checkRecipientHeaders(routing.headers);
      return idInput.strip().parse(
        await client.json("POST", "/api/campaigns", {
          body: { ...input, ...routing, type: "regular" },
        }),
      );
    },
  ),
  "campaigns.clone": defineOperation(
    idInput.extend({ name: z.string().trim().min(1).max(255) }),
    async (client, input) => {
      const source = campaign.parse(await client.json("GET", `/api/campaigns/${input.id}`));
      const seal = sealedAudience.parse(
        await client.json("GET", `/api/warpdrive/audiences/${input.id}`),
      );
      const lists = source.lists.flatMap(({ id }) => (id === null ? [] : [id]));
      requireState(source.type === "regular" && lists.length > 0);
      const headers =
        managedReplyRouting(source.attribs).state === "manual"
          ? source.headers
          : withoutReplyTo(source.headers);
      checkRecipientHeaders(headers);
      return campaign.parse(
        await client.json("POST", "/api/campaigns", {
          body: {
            name: input.name,
            subject: source.subject,
            type: "regular",
            lists,
            media: source.media.flatMap(({ id }) => (id === null ? [] : [id])),
            from_email: source.from_email,
            messenger: source.messenger,
            body: source.body,
            body_source: source.body_source,
            content_type: source.content_type,
            altbody: source.altbody,
            template_id: source.template_id,
            tags: source.tags,
            headers,
            attribs: {
              ...withoutManagedReplyRouting(source.attribs),
              ...(seal === null ? {} : { [crmApprovalRequiredAttribute]: true }),
            },
          },
        }),
      );
    },
  ),
  "campaigns.update": defineOperation(
    routedCampaignFields.extend({ id, expectedUpdatedAt: revision }),
    async (
      client,
      { id: campaignId, expectedUpdatedAt, replyToMailboxId, headers, attribs, ...input },
      context,
    ) => {
      const path = `/api/campaigns/${campaignId}` as const;
      const current = campaign.parse(await client.json("GET", path));
      requireState(canEditCampaign(current.status));
      requireState(current.updated_at === expectedUpdatedAt);
      if (dispatchStarted(current)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Duplicate this campaign to change a message that has started delivery.",
        });
      }
      const protectedAttributes =
        current.attribs?.[crmApprovalRequiredAttribute] === true
          ? {
              ...(attribs ?? withoutManagedReplyRouting(current.attribs)),
              [crmApprovalRequiredAttribute]: true,
            }
          : attribs;
      const routing = await campaignReplyRouting(
        context,
        { replyToMailboxId, headers, attribs: protectedAttributes },
        current,
      );
      checkRecipientHeaders(routing.headers);
      return campaign.parse(
        await client.json("PUT", path, {
          body: {
            ...input,
            ...routing,
            type: current.type,
            expected_updated_at: expectedUpdatedAt,
            media:
              input.media ?? current.media.flatMap((item) => (item.id === null ? [] : [item.id])),
          },
        }),
      );
    },
  ),
  "campaigns.status": defineOperation(campaignStatusChange, async (client, input, context) => {
    const startsDelivery = "expectedUpdatedAt" in input;
    if (startsDelivery) context.requireDelivery();
    const path = `/api/campaigns/${input.id}` as const;
    const current = campaign.parse(await client.json("GET", path));
    requireState(campaignTransitions(current).includes(input.status));
    if (startsDelivery) {
      requireState(input.expectedUpdatedAt === current.updated_at);
      await requireCurrentReplyRouting(context, current);
      if (
        context.actor.type !== "admin" ||
        current.attribs?.[crmApprovalRequiredAttribute] === true
      ) {
        const audience = sealedAudience.parse(
          await client.json("GET", `/api/warpdrive/audiences/${input.id}`),
        );
        if (audience === null) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Approve a CRM audience before starting delivery.",
          });
        }
      }
      await requireReadyDelivery(client);
    }
    return campaign.parse(
      await client.json("PUT", `${path}/status`, {
        body: {
          status: input.status,
          ...(startsDelivery ? { expected_updated_at: input.expectedUpdatedAt } : {}),
        },
      }),
    );
  }),
  "campaigns.test": defineOperation(
    confirmedId.extend({
      subscribers: z.array(z.email().max(254)).min(1).max(10),
    }),
    async (client, input, context) => {
      context.requireDelivery();
      const subscribers = [...new Set(input.subscribers.map((address) => address.toLowerCase()))];
      const approved = new Set(env.NEWSLETTER_TEST_RECIPIENTS);
      if (!subscribers.every((address) => approved.has(address))) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Choose test addresses approved for this installation.",
        });
      }
      const path = `/api/campaigns/${input.id}` as const;
      const current = campaign.parse(await client.json("GET", path));
      requireState(canEditCampaign(current.status));
      const eligible = await Promise.all(
        subscribers.map(async (address) => {
          // Listmonk applies search as a PostgreSQL regular expression.
          const literal = address.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const query = new URLSearchParams({ search: `^${literal}$`, per_page: "25" });
          const rows = testCandidates.parse(
            await client.json("GET", "/api/subscribers", { query }),
          );
          return rows.results.some(
            (row) => row.email.toLowerCase() === address && row.status === "enabled",
          );
        }),
      );
      if (!eligible.every(Boolean)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Use enabled subscriber addresses for test delivery.",
        });
      }
      return client.json("POST", `${path}/test`, {
        body: {
          ...current,
          send_at: null,
          lists: current.lists.flatMap((list) => (list.id === null ? [] : [list.id])),
          media: current.media.flatMap((item) => (item.id === null ? [] : [item.id])),
          subscribers,
        },
      });
    },
  ),
  "campaigns.archive": defineOperation(
    idInput.extend({
      archive: z.boolean(),
      archive_slug: z.string().max(255).default(""),
      archive_template_id: z.number().int().min(0).safe().default(0),
      archive_meta: z.record(z.string(), z.json()).default({}),
    }),
    async (client, { id: campaignId, ...body }) =>
      client.json("PUT", `/api/campaigns/${campaignId}/archive`, { body }),
  ),
  "campaigns.delete": defineOperation(confirmedId, async (client, input) => {
    const path = `/api/campaigns/${input.id}` as const;
    const current = campaign.parse(await client.json("GET", path));
    requireState(current.status !== "running" && current.status !== "scheduled");
    if (dispatchStarted(current)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This campaign is retained for historical recipient unsubscribe links.",
      });
    }
    return client.json("DELETE", path);
  }),
  "campaigns.bulkDelete": defineOperation(
    z.strictObject({ ids: z.array(id).min(1).max(50), confirmed }),
    async (client, input) => {
      const ids = [...new Set(input.ids)];
      const selected = await Promise.all(
        ids.map(async (id) => campaign.parse(await client.json("GET", `/api/campaigns/${id}`))),
      );
      requireState(
        selected.every(
          (item) =>
            !dispatchStarted(item) && item.status !== "running" && item.status !== "scheduled",
        ),
      );
      return z.boolean().parse(
        await client.json("DELETE", "/api/campaigns", {
          query: new URLSearchParams(ids.map((id) => ["id", String(id)])),
        }),
      );
    },
  ),
  "media.upload": defineOperation(upload, async (client, input) => {
    const bytes = await validateImageUpload(input);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: input.contentType }), input.name);
    return mediaItem.parse(await client.multipart("/api/media", form));
  }),
  "media.delete": defineOperation(confirmedId, async (client, input) =>
    client.json("DELETE", `/api/media/${input.id}`),
  ),
  "templates.create": defineOperation(templateFields, async (client, input) =>
    templateItem.parse(await client.json("POST", "/api/templates", { body: input })),
  ),
  "templates.update": defineOperation(
    templateFields.extend({ id }),
    async (client, { id: templateId, ...input }) => {
      const path = `/api/templates/${templateId}` as const;
      const current = templateItem.parse(await client.json("GET", path));
      requireState(current.type === input.type);
      return templateItem.parse(await client.json("PUT", path, { body: input }));
    },
  ),
  "templates.default": defineOperation(idInput, async (client, input) => {
    const path = `/api/templates/${input.id}` as const;
    const current = templateItem.parse(await client.json("GET", path));
    requireState(current.type === "campaign");
    return templateList.parse(await client.json("PUT", `${path}/default`));
  }),
  "templates.delete": defineOperation(confirmedId, async (client, input) =>
    client.json("DELETE", `/api/templates/${input.id}`),
  ),
};
