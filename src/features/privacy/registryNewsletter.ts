import { classifyInventory } from "./registryClassification";
import { newsletterIds } from "./registryIdsNewsletter";

export const newsletterInventoryEntry = classifyInventory(newsletterIds, {
  owner: "Campaigns and Listmonk operations",
  categories: [
    "subscriber email, profile, attributes and list consent",
    "campaign content, templates and uploaded media",
    "aggregated campaign analytics and bounce outcomes",
    "campaign engine settings and installation API credential",
    "native actor, operation UUID, keyed intent fingerprint, outcome and reviewed evidence reference",
    "verified Person mailbox bindings, purpose-bound consent and contact lifecycle",
    "CRM audience selection, workflow effects, delivery acceptance and attributed outcomes",
  ],
  subjectRelation:
    "A CRM Person and an engine subscriber are linked only by verified mailbox control and exact binding evidence. An active purpose grant comes from its own affirmative opt-in. Shared, changed or suppressed mailboxes are excluded from approved CRM audiences. An operator-authored campaign, imported contact or ordinary list assignment grants no CRM consent.",
  purpose:
    "Operate an installation's newsletter campaigns and audiences through Warpdrive's authenticated screens. Preserve upstream subscription and suppression state and let the Listmonk engine schedule and deliver campaigns.",
  disclosure:
    "Live native session authority and permission-set scopes gate access. Global subscriber data and settings require an administrator. Person consent and audience reads use the existing record visibility predicates. Writes require CSRF, a current authority check and an explicit operation schema. The server keeps the service credential and upstream error bodies private. Settings, maintenance exports and audit logs return selected fields. Preview markup runs inside a sandboxed frame.",
  retention:
    "Listmonk owns subscriber, consent, suppression, bounce, delivery and asset storage. Native metadata edits and import preserve existing suppression. Maintenance clears explicitly dated unconfirmed subscriptions or analytics. Warpdrive retains actor-scoped receipts for replay protection and audit, with a keyed intent fingerprint and a minimal acknowledgement or opaque engine ID. Review adds only an outcome, evidence type and a constrained reference. The database stores no raw request or response payload in receipts. Tab storage holds operation UUIDs under actor and operation keys, with a campaign ID and finite destination status for campaign transitions until acknowledged or the tab is closed. Person links and events retain opaque bindings and verified timestamps for campaign consent and Workflow delivery. Approved exact-mailbox erasure revokes and deletes the scoped engine identity while retaining a keyed suppression record. Lead, deal and outcome links retain explicit acceptance provenance. Generic privacy lifecycle routes require separately reviewed scope.",
  externalEffects:
    "A bounded server request with redirect refusal contacts only the configured Listmonk engine. The engine issues scoped mailbox challenges, seals exact consent grants, schedules delivery, publishes subscriber pages and assets, and applies configured relay and provider feedback. Native workers reconcile bounded event data to the existing CRM and Workflow stores. The settings execute:sql signature is a local advisory lock. The router query and execute signatures dispatch allowlisted procedures. Receipt writers use the actor and operation composite key. The browser import fetch reads the selected local Blob before staging an operation. Browser storage retains pending operation UUIDs with actor, operation and record keys for the affected form.",
  erasureTask: "DPL-15 / DPL-18 / DPL-21",
});
