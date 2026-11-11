import type { Db } from "@/db/client";
import type { WorkflowV2Adapters } from "@/features/blocks/contracts";
import type { PersonNewsletterEvent } from "@/features/newsletter/identity/contracts";
import { admitWorkflowV2Event } from "./events";
import { newsletterPersonVisible } from "./newsletterAuthority";

export function admitNewsletterWorkflowEvent(
  db: Db,
  adapters: WorkflowV2Adapters,
  event: PersonNewsletterEvent,
  signal: AbortSignal,
) {
  if (event.event === "newsletter.consent.confirmed" && event.listId === null)
    return Promise.resolve([]);
  return admitWorkflowV2Event(
    db,
    {
      eventKey: `newsletter:${event.id}`,
      eventName: event.event,
      recordId: event.personId,
      changedFields: [],
      payload: {},
      occurredAt: event.occurredAt,
      originRunId: event.originRunId,
    },
    adapters,
    async (tx, actor, _record, eventSignal) =>
      (await newsletterPersonVisible(tx, actor, event.personId, "view", eventSignal))
        ? {
            eventName: event.event,
            personId: event.personId,
            linkId: event.linkId,
            listId: event.listId,
            occurredAt: event.occurredAt.toISOString(),
          }
        : null,
    signal,
  );
}
