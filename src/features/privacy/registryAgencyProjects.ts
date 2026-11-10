import { classifyInventory } from "./registryClassification";
import { agencyProjectIds } from "./registryIdsAgencyProjects";

export const agencyProjectInventoryEntry = classifyInventory(agencyProjectIds, {
  owner: "internal agency projects",
  categories: [
    "authored project titles and canonical CRM anchors",
    "internal owners and explicit project memberships",
    "immutable create/start history and native recorder identities",
    "actor-bound intent receipts, keyed comparisons and terminal payload state",
    "workspace module gate and transient private forms and list continuations",
  ],
  subjectRelation:
    "Project ownership, creator identity, membership, linked CRM visibility and staff eligibility are product authority facts. They do not establish that the requesting actor is every person mentioned in project titles, CRM anchors, communication references, supplied review history or template contents. Customer and workforce subjects require separate provenance and disclosure review.",
  purpose:
    "Create a planned internal project linked to visible CRM records, list and reopen permitted workspaces, and start work once with revision CAS. The native module gate defaults false. The initial creation UI selects a client organization and eligible internal owner. Preserved pure assignment, communication, review and template helpers supply supporting source only; this increment binds no persistence, effect or enabled journey for those future features.",
  disclosure:
    "Native credential-established sessions, accepted active staff, the persisted module gate and current authority fence gate every project path. Both creator and selected owner must independently see every creation anchor. Ownership or explicit membership is required even for an administrator; every linked CRM record remains independently visible. List predicates precede filters, microsecond keyset ordering and limit. Server actions validate expected account and strict inputs and require CSRF before writes. Session expiry is checked again after database waits before private projections or committing writes. Picker labels are scoped active-staff names and visible organization names, without email or provider credentials. The current applicable extra record-processing ceiling is empty because Main has no activated restriction adapter; this grants no privacy-case disclosure or future restriction bypass.",
  retention:
    "Project rows, restrictive CRM/user references, explicit memberships, immutable history and actor/operation/intent identities persist in PostgreSQL and backups. HMAC comparison bytes bind complete receipt context and normalized intent under an Agency-domain key derived from the installation key; plaintext commands are not retained in that payload. Cleared, disposed, malformed or wrong-key receipts never permit fresh writes. Key rotation, terminal disposition jobs and automatic expiry are not implemented. Mounted forms retain uncertain attempts by context; confirmed creation alone permits a fresh intent. Unmounting browser state is not physical memory erasure. No subject discovery, export, rectification, restriction, erasure or retention adapter is enabled.",
  externalEffects:
    "Same-origin authenticated server actions read PostgreSQL and atomically write only the module gate, projects, creator membership, create/start history and request receipts. Lock execute:sql signatures and the list query are bounded internal SQL, not browser-selected SQL. The HMAC update signatures and local Set.delete operations are in-memory computation, not record mutation or erasure. There is no new provider, mail send, queue, object namespace or persistent browser store. Lexically scanned .test-support and projectPersistence.seeds files are reachable only from synthetic test scaffolding and use isolated PostgreSQL fixtures; they do not supply runtime authority or lifecycle execution. Review-history and template-preview components require future authorized loaders before their own journeys can be exposed.",
  erasureTask: "DPL-15 / DPL-18 / DPL-21",
});
