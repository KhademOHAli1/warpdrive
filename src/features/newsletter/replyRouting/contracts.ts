import { z } from "zod";
import { type Campaign, campaignFields } from "../campaigns/model";

export const replyRoutingAttribute = "warpdrive_reply_routing";
const managedReply = z.strictObject({ version: z.literal(1), mailboxId: z.uuid() });
export const routedCampaignFields = campaignFields.extend({
  replyToMailboxId: z.uuid().nullable().optional(),
});
export type RoutedCampaignFields = z.infer<typeof routedCampaignFields>;
export type ReplyMailbox = { id: string; address: string; displayName?: string };
type Attributes = NonNullable<Campaign["attribs"]>;
type Headers = NonNullable<Campaign["headers"]>;

export function managedReplyRouting(attributes: Campaign["attribs"] | undefined) {
  if (attributes == null || !Object.hasOwn(attributes, replyRoutingAttribute))
    return { state: "manual" as const };
  const parsed = managedReply.safeParse(attributes[replyRoutingAttribute]);
  return parsed.success
    ? { state: "managed" as const, mailboxId: parsed.data.mailboxId }
    : { state: "invalid" as const };
}

export function withoutManagedReplyRouting(
  attributes: Campaign["attribs"] | undefined,
): Attributes {
  const result = { ...attributes };
  delete result[replyRoutingAttribute];
  return result;
}

function isReplyTo(key: string) {
  return key.trim().toLowerCase() === "reply-to";
}

export function replyToValues(headers: Headers): string[] {
  return headers.flatMap((header) =>
    Object.entries(header).flatMap(([name, value]) => (isReplyTo(name) ? [value] : [])),
  );
}

export function withoutReplyTo(headers: Headers): Headers {
  return headers
    .map((header) =>
      Object.fromEntries(Object.entries(header).filter(([name]) => !isReplyTo(name))),
    )
    .filter((header) => Object.keys(header).length > 0);
}
