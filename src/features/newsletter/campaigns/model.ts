import { z } from "zod";

export const id = z.number().int().positive().max(2_147_483_647);
export const emptyInput = z.object({}).strict();
export const crmApprovalRequiredAttribute = "warpdrive_crm_approval_required";
export const idInput = z.object({ id }).strict();
export const pageInput = z
  .object({
    page: z.number().int().min(1).max(10_000).default(1),
    search: z.string().trim().max(200).default(""),
  })
  .strict();
export const campaignStatus = z.enum([
  "draft",
  "scheduled",
  "running",
  "paused",
  "finished",
  "cancelled",
]);
export const campaignContentType = z.enum(["richtext", "html", "markdown", "plain", "visual"]);
export const templateType = z.enum(["campaign", "campaign_visual", "tx"]);
const nonemptyName = z.string().trim().min(1).max(255);
const contentBody = z.string().max(500_000);
const attributes = z.record(z.string(), z.json());

export const campaignFields = z
  .object({
    name: nonemptyName,
    subject: z.string().trim().min(1).max(5_000),
    lists: z.array(id).min(1).max(1_000),
    media: z.array(id).max(50).optional(),
    from_email: z.string().trim().max(500).optional(),
    messenger: z.string().trim().min(1).max(100).optional(),
    body: contentBody.optional(),
    body_source: contentBody.nullable().optional(),
    content_type: campaignContentType.optional(),
    altbody: contentBody.nullable().optional(),
    send_at: z.iso.datetime({ offset: true }).nullable().optional(),
    template_id: id.nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    headers: z
      .array(
        z.record(
          z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
          z
            .string()
            .max(2_000)
            .regex(/^[^\r\n]*$/),
        ),
      )
      .max(30)
      .optional(),
    attribs: attributes.optional(),
  })
  .strict();

const reference = z.object({ id: id.nullable(), name: z.string() });
const mediaReference = z.object({ id: id.nullable(), filename: z.string() });
export const campaign = z.object({
  id,
  name: z.string(),
  subject: z.string(),
  type: z.enum(["regular", "optin"]),
  status: campaignStatus,
  body: z.string(),
  body_source: z.string().nullish(),
  altbody: z.string().nullish(),
  content_type: campaignContentType,
  from_email: z.string(),
  messenger: z.string(),
  lists: z
    .array(reference)
    .nullable()
    .transform((rows) => rows ?? []),
  media: z
    .array(mediaReference)
    .nullable()
    .transform((rows) => rows ?? []),
  send_at: z.string().nullable(),
  started_at: z.string().nullish(),
  template_id: id.nullable(),
  tags: z
    .array(z.string())
    .nullable()
    .transform((rows) => rows ?? []),
  headers: z
    .array(z.record(z.string(), z.string()))
    .nullable()
    .transform((rows) => rows ?? []),
  attribs: attributes.nullable(),
  archive: z.boolean(),
  archive_slug: z.string().nullable(),
  archive_template_id: id.nullable(),
  archive_meta: attributes.nullable(),
  sent: z.number().int().nonnegative(),
  to_send: z.number().int().nonnegative(),
  views: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  bounces: z.number().int().nonnegative(),
  updated_at: z.string().nullable(),
});
export type Campaign = z.infer<typeof campaign>;
export type CampaignStatus = z.infer<typeof campaignStatus>;
export type CampaignFields = z.infer<typeof campaignFields>;

export const mediaItem = z.object({
  id,
  filename: z.string(),
  content_type: z.string(),
  url: z.string(),
  thumb_url: z.string().nullish(),
  created_at: z.string().nullish(),
});
export type MediaItem = z.infer<typeof mediaItem>;

export const templateItem = z.object({
  id,
  name: z.string(),
  subject: z.string(),
  type: templateType,
  body: z.string().optional(),
  body_source: z.string().nullish(),
  is_default: z.boolean(),
  updated_at: z.string().nullish(),
});
export type TemplateItem = z.infer<typeof templateItem>;
export const templateFields = z
  .object({
    name: nonemptyName,
    type: templateType,
    subject: z.string().max(5_000).optional(),
    body: contentBody,
    body_source: contentBody.nullable().optional(),
  })
  .strict();
export type TemplateFields = z.infer<typeof templateFields>;

export const deliveryConfig = z.object({
  from_email: z.string(),
  messengers: z.array(z.string()),
});
export type DeliveryConfig = z.infer<typeof deliveryConfig>;

export const analyticsMetric = z.enum(["views", "clicks", "bounces", "links"]);
export type AnalyticsMetric = z.infer<typeof analyticsMetric>;
export const analyticsPoint = z.object({
  campaign_id: id,
  count: z.number().int().nonnegative(),
  timestamp: z.string(),
});
export const analyticsLink = z.object({
  url: z.string(),
  count: z.number().int().nonnegative(),
});
export type AnalyticsRow = z.infer<typeof analyticsPoint> | z.infer<typeof analyticsLink>;

export interface Page<T> {
  results: T[];
  total: number;
  page: number;
  per_page: number;
}
export function pageResponse<T extends z.ZodType>(item: T) {
  return z.object({
    results: z
      .array(item)
      .nullable()
      .transform((rows) => rows ?? []),
    total: z.number().int().nonnegative(),
    page: z.number().int().nonnegative(),
    per_page: z.number().int().nonnegative(),
  });
}

const editableStatuses = new Set<CampaignStatus>(["draft", "scheduled", "paused"]);
export function canEditCampaign(status: CampaignStatus) {
  return editableStatuses.has(status);
}

export const transitionTargets = ["running", "scheduled", "paused", "cancelled", "draft"] as const;
const transitions: Record<CampaignStatus, readonly (typeof transitionTargets)[number][]> = {
  draft: ["running", "scheduled"],
  scheduled: ["draft"],
  running: ["paused", "cancelled"],
  paused: ["running", "scheduled", "cancelled"],
  cancelled: [],
  finished: [],
};
export function campaignTransitions(
  campaign: Pick<Campaign, "status" | "send_at">,
  now = Date.now(),
) {
  const futureSchedule = campaign.send_at !== null && Date.parse(campaign.send_at) > now;
  return transitions[campaign.status].filter((status) => {
    if (status === "scheduled") return futureSchedule;
    if (status === "running") return !futureSchedule;
    return true;
  });
}

export function safeNewsletterLink(value: string) {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
    ? url.href
    : null;
}
