import { classifyInventory } from "./registryClassification";
import { newsletterOperationalIds } from "./registryIdsNewsletterOperations";

export const newsletterOperationalInventoryEntry = classifyInventory(newsletterOperationalIds, {
  owner: "newsletter internal operational visibility",
  categories: [
    "opaque installation namespace and fixed health fingerprints/reasons",
    "native operational event UUIDs, fixed kinds/reasons and occurrence/record timestamps",
    "worker-check and successful event-poll timestamps",
    "bounded aggregate category/reason/count notices and system audit correlation UUIDs",
    "active staff recipient identifiers held in the separately classified notification store",
  ],
  subjectRelation:
    "Health state has no direct subscriber, Person, campaign or staff foreign key. Receipts store only an opaque installation key, native event UUID, fixed kind/reason and timestamps; an event UUID may correlate to engine facts and is not automatically anonymous or proof of subject identity. Staff notification recipients are workforce metadata, not identified newsletter subscribers. Unmatched feedback indicates review only and establishes no Person attribution or suppression claim.",
  purpose:
    "Deduplicate engine operational facts across concurrent workers, restart and lost ACKs; record readiness outage/recovery and expose failed, uncertain, resolved, bounce and complaint facts in CRM logs and in-app notices. Keep delivery review facts distinct from service readiness. Provider acceptance means confirmed handoff only, not inbox delivery.",
  disclosure:
    "The strict native event envelope and three-field notice reject addresses, record references, provider bodies, campaign content, credentials and extra fields. Only an active newsletter operator can receive an in-app notice, subject to in-app preference; current authority is rehydrated for feed, unread and read access. Realtime contains notification UUID and kind only. Logs explicitly project validated safe operational details. Maintenance returns only last-check/successful-poll timestamps and computed freshness through a read-only local operation; fixed links retain ordinary route authorization.",
  retention:
    "Health rows replace current state while preserving an open incident across deliberate pauses until an actual ready probe. Exact event receipt UUID/kind/reason/timestamp tombstones remain durable for replay and conflict detection; no expiry or purge is scheduled. State, audit and direct in-app rows commit atomically, and ACK follows the successful receipt transaction. Deleting a replay tombstone requires separately reviewed retention and restore semantics. Native notification/audit and engine copies retain their own policies; no generic privacy lifecycle capability or automatic erasure is granted.",
  externalEffects:
    "The existing private engine adapter fetches capability and bounded event pages, then POSTs opaque UUID ACKs only after Core commit. Polling continues for late feedback while sending is paused. The dedicated minute pg-boss job contains an empty payload. Local SQL uses transaction-scoped advisory locking and bounded waits; stdout/stderr emits fixed readiness JSON only after durable change. No email queue helper, SMTP alarm, email subscription or provider alert is invoked. The notification kind hard-disables email even for stale stored preferences. Source classification does not prove installed delivery, provider acceptance, storage erasure or backup deletion.",
  erasureTask: "DPL-16 / DPL-21",
});
