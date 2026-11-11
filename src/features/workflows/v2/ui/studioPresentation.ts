import type { ActionBlockKind, TriggerBlockKind } from "@/features/blocks/contracts";
import type { WorkflowReferenceIconName } from "@/features/workflows/ui/WorkflowReferenceIcon";

type Group = "data" | "ai" | "flow" | "core" | "human" | "other";
type Appearance = { group: Group; icon: WorkflowReferenceIconName; stroke?: 1.6 };
export const studioActions: Record<ActionBlockKind, Appearance> = {
  CREATE_RECORD: { group: "data", icon: "plus", stroke: 1.6 },
  UPDATE_RECORD: { group: "data", icon: "reload", stroke: 1.6 },
  DELETE_RECORD: { group: "data", icon: "trash", stroke: 1.6 },
  FIND_RECORDS: { group: "data", icon: "search", stroke: 1.6 },
  UPSERT_RECORD: { group: "data", icon: "pencil-plus", stroke: 1.6 },
  PICK_RECORD: { group: "data", icon: "arrows-shuffle", stroke: 1.6 },
  AI_AGENT: { group: "ai", icon: "lego" },
  CLASSIFY: { group: "ai", icon: "lego" },
  ITERATOR: { group: "flow", icon: "repeat" },
  FILTER: { group: "flow", icon: "filter" },
  IF_ELSE: { group: "flow", icon: "arrows-split", stroke: 1.6 },
  DELAY: { group: "flow", icon: "player-pause" },
  WAIT_FOR_EVENT: { group: "flow", icon: "clock" },
  SEND_EMAIL: { group: "core", icon: "send", stroke: 1.6 },
  NEWSLETTER_CONSENT_STATUS: { group: "core", icon: "search", stroke: 1.6 },
  NEWSLETTER_INVITE: { group: "core", icon: "mail-plus", stroke: 1.6 },
  DRAFT_EMAIL: { group: "core", icon: "mail-plus", stroke: 1.6 },
  CREATE_CALENDAR_EVENT: { group: "core", icon: "calendar-event", stroke: 1.6 },
  HTTP_REQUEST: { group: "core", icon: "world", stroke: 1.6 },
  CODE: { group: "core", icon: "code", stroke: 1.6 },
  FORM: { group: "human", icon: "forms" },
  SEND_CHAT_MESSAGE: { group: "human", icon: "send" },
  LOGIC_FUNCTION: { group: "other", icon: "code", stroke: 1.6 },
};

export const studioTriggers: Record<
  TriggerBlockKind,
  { key: string; icon: WorkflowReferenceIconName }
> = {
  manual: { key: "manual", icon: "hand-move" },
  schedule: { key: "cron", icon: "clock" },
  webhook: { key: "webhook", icon: "webhook" },
  "record.created": { key: "created", icon: "playlist-add" },
  "record.updated": { key: "updated", icon: "refresh-dot" },
  "record.deleted": { key: "deleted", icon: "trash" },
  "record.created_or_updated": { key: "upserted", icon: "pencil-plus" },
  "newsletter.identity.verified": { key: "newsletter.identity.verified", icon: "mail-plus" },
  "newsletter.consent.confirmed": { key: "newsletter.consent.confirmed", icon: "mail-plus" },
};

export const studioActionGroups = ["data", "ai", "flow", "core", "human", "other"] as const;

// A saved notification/approval is still supported. The picker does not advertise it as
// Send to Inbox: Warpdrive does not have the workspace conversation that action requires.
export const studioActionChoices = (Object.keys(studioActions) as ActionBlockKind[]).filter(
  (type) => type !== "SEND_CHAT_MESSAGE",
);
