import { z } from "zod";
import { NEXT_ACTION_QUEUE_MAX_LIMIT } from "./queueInput";

const link = z.strictObject({ id: z.string(), label: z.string() });
const visibleLink = link.extend({
  ownerId: z.string(),
  visibilityLevel: z.enum(["all", "group", "owner"]),
  visibilityGroupId: z.string().nullable(),
  visibleToUserIds: z.array(z.string()),
});
const timestamp = z.iso.datetime({ offset: true });

const activity = z.strictObject({
  kind: z.literal("activity"),
  id: z.string(),
  title: z.string(),
  dueAt: timestamp,
  endAt: timestamp.nullable(),
  allDay: z.boolean(),
  dueDate: z.iso.date().nullable(),
  endDate: z.iso.date().nullable(),
  assigneeId: z.string(),
  assigneeName: z.string(),
  dealId: z.string().nullable(),
  personId: z.string().nullable(),
  orgId: z.string().nullable(),
  deal: visibleLink
    .extend({
      pipelineVisibilityGroupId: z.string().nullable(),
      pipelineArchived: z.boolean(),
    })
    .nullable(),
  person: visibleLink.nullable(),
  organization: visibleLink.nullable(),
  lead: visibleLink.nullable(),
  participants: z.array(z.string()),
});

const deal = z.strictObject({
  kind: z.literal("deal"),
  id: z.string(),
  title: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  pipeline: link,
  lastActivityAt: timestamp.nullable(),
  createdAt: timestamp,
  person: visibleLink.nullable(),
  organization: visibleLink.nullable(),
});

export const queueEnvelopeSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  missingNextStep: z.number().int().nonnegative(),
  items: z.array(z.discriminatedUnion("kind", [activity, deal])).max(NEXT_ACTION_QUEUE_MAX_LIMIT),
});

export type QueueRawActivity = z.infer<typeof activity>;
export type QueueRawDeal = z.infer<typeof deal>;
export type QueueVisibleLink = z.infer<typeof visibleLink>;
