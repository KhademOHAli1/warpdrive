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
  ],
  subjectRelation:
    "The newsletter subscriber and CRM person remain separate identities. A list assignment, CRM role or authored campaign is not evidence that every person mentioned in a payload consented to marketing.",
  purpose:
    "Operate an installation's newsletter campaigns and audiences through Warpdrive's authenticated screens. Preserve upstream subscription and suppression state and let the Listmonk engine schedule and deliver campaigns.",
  disclosure:
    "A live native administrator session gates reads and writes. Writes require CSRF, a current authority check and an explicit operation schema. The server keeps the service credential and upstream error bodies private. Settings, maintenance exports and audit logs return selected fields. Preview markup runs inside a sandboxed frame.",
  retention:
    "Listmonk owns subscriber, consent, suppression, bounce, delivery and asset storage. Native metadata edits and import preserve existing suppression. Maintenance clears explicitly dated unconfirmed subscriptions or analytics. Warpdrive retains actor-scoped receipts for replay protection and audit, with a keyed intent fingerprint and a minimal acknowledgement or opaque engine ID. Review adds only an outcome, evidence type and a constrained reference. The database stores no raw request or response payload in receipts. Tab storage holds operation UUIDs under actor and operation keys, with a campaign ID and finite destination status for campaign transitions until acknowledged or the tab is closed. The generic privacy case lifecycle requires separately reviewed scope.",
  externalEffects:
    "A bounded server request with redirect refusal contacts only the configured Listmonk engine. The engine may schedule sends, publish public subscriber pages and assets, and invoke its operator-configured transport. The settings execute:sql signature is a local advisory lock. The router query and execute signatures dispatch allowlisted procedures. Receipt writers use the actor and operation composite key. The browser import fetch reads the selected local Blob before staging an operation, and browser storage writes only pending UUIDs.",
  erasureTask: "DPL-15 / DPL-18 / DPL-21",
});
