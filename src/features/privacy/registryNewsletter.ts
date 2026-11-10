import { classifyInventory } from "./registryClassification";
import { newsletterIds } from "./registryIdsNewsletter";

export const newsletterInventoryEntry = classifyInventory(newsletterIds, {
  owner: "Campaigns and Listmonk operations",
  categories: [
    "subscriber email, profile, attributes and list consent",
    "campaign content, templates and uploaded media",
    "aggregated campaign analytics and bounce outcomes",
    "campaign engine settings and installation API credential",
    "native actor, operation, correlation and outcome",
  ],
  subjectRelation:
    "The newsletter subscriber and CRM person remain separate identities. A list assignment, CRM role or authored campaign is not evidence that every person mentioned in a payload consented to marketing.",
  purpose:
    "Operate an installation's newsletter campaigns and audiences through Warpdrive's authenticated screens. Preserve upstream subscription and suppression state and let the Listmonk engine schedule and deliver campaigns.",
  disclosure:
    "A live native administrator session gates reads and writes. Writes require CSRF, a current authority check and an explicit operation schema. The server keeps the service credential and upstream error bodies private. Settings, maintenance exports and audit logs return selected fields. Preview markup runs inside a sandboxed frame.",
  retention:
    "Listmonk owns subscriber, consent, suppression, bounce, delivery and asset storage. Native metadata edits and import preserve existing suppression. Maintenance clears explicitly dated unconfirmed subscriptions or analytics. Warpdrive stores only structured operation receipts in its existing audit store. Neither source registration nor the application operator route confers privacy case erasure or disclosure authority.",
  externalEffects:
    "A bounded server request with redirect refusal contacts only the configured Listmonk engine. The engine may schedule sends, publish public subscriber pages and assets, and invoke its operator-configured transport. The settings execute:sql signature is a local advisory lock. The router query signature is a tRPC read declaration. Browser paths neither accept raw subscriber SQL nor expose engine administration.",
  erasureTask: "DPL-15 / DPL-18 / DPL-21",
});
