import { z } from "zod";
import type { InboxFilter } from "./emailReads";
import { type FolderKey, parseFolder } from "./inboxFolders";
import { type AttributeFilterState, NO_ATTRIBUTE_FILTER } from "./threadAttributeFilter";

export const INBOX_VIEWS = ["all", "unread", "waiting"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];
export const MAILBOX_FILTERS = [
  "all",
  "unmatched",
  "needs_linking",
  "shared",
  "private",
  "tracked",
  "to_me",
  "from_contact",
  "linked_open_deal",
] as const;
const viewSchema = z.enum(INBOX_VIEWS).catch("all");
const filterSchema = z.enum(MAILBOX_FILTERS).catch("all");
const threadIdSchema = z.string().uuid().nullable().catch(null);
const dateSchema = z.enum(["any", "7d", "30d"]).catch("any");
const statusSchema = z.enum(["", "waiting", "replied", "closed"]).catch("");

export interface InboxLocation {
  folder: FolderKey;
  query: string;
  filter: InboxFilter;
  view: InboxView;
  threadId: string | null;
  attributes: AttributeFilterState;
}

export function readInboxLocation(params: Pick<URLSearchParams, "get">): InboxLocation {
  return {
    folder: parseFolder(params.get("folder")),
    query: (params.get("q") ?? "").slice(0, 200),
    filter: filterSchema.parse(params.get("filter")),
    view: viewSchema.parse(params.get("view")),
    threadId: threadIdSchema.parse(params.get("thread")),
    attributes: {
      ...NO_ATTRIBUTE_FILTER,
      followUp: statusSchema.parse(params.get("followUp") ?? ""),
      label: (params.get("label") ?? "").slice(0, 100),
      hasAttachment: params.get("attachments") === "1",
      unreadOnly: params.get("unread") === "1",
      dateRange: dateSchema.parse(params.get("dateRange")),
    },
  };
}

export function inboxHref(state: InboxLocation): string {
  const params = new URLSearchParams({ folder: state.folder });
  if (state.query !== "") params.set("q", state.query);
  if (state.filter !== "all") params.set("filter", state.filter);
  if (state.view !== "all") params.set("view", state.view);
  if (state.threadId !== null) params.set("thread", state.threadId);
  if (state.attributes.followUp !== "") params.set("followUp", state.attributes.followUp);
  if (state.attributes.label !== "") params.set("label", state.attributes.label);
  if (state.attributes.hasAttachment) params.set("attachments", "1");
  if (state.attributes.unreadOnly) params.set("unread", "1");
  if (state.attributes.dateRange !== "any") params.set("dateRange", state.attributes.dateRange);
  return `/inbox?${params.toString()}`;
}
