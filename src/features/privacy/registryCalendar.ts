import { classifyInventory } from "./registryClassification";
import { calendarFixtureIds, calendarLocalIds, calendarProviderIds } from "./registryIdsCalendar1";

export const calendarInventoryEntries = [
  classifyInventory(calendarLocalIds, {
    owner: "owned and shared Calendar events and personal reminders",
    categories: [
      "calendar names, owner and member references",
      "event schedule, visibility and availability",
      "per-recipient reminder selections and defaults",
      "revision-bound intents, rebuild markers and notification receipts",
      "transient editor drafts and neutral refresh diagnostics",
    ],
    subjectRelation:
      "Calendar ownership and member roles authorize an event view; they do not establish subject identity for everyone named in an event. CRM-linked events retain their existing CRM visibility boundary. A reader's personal reminder choice belongs to that reader and never changes the assignee's policy or shared event revision.",
    purpose:
      "Create native calendars, share explicit owner/editor/reader/free-busy roles, preserve current event editing and version conflict checks, and deliver multiple explicit calendar reminder rules through a separate durable outbox. Existing native in-app generations keep their ownership and queue contract. Legacy assignee delivery remains until that assignee explicitly selects a personal policy, including an empty policy.",
    disclosure:
      "Interactive mutations and private settings/catalog reads re-admit the exact current native session under the authority fence. Calendar roles and current CRM visibility are separately checked. Free-busy viewers receive availability rather than event details. Native-managed events reject personal event-policy writes and do not offer unsupported personal controls. Notification feed and durable email admission recheck current visibility and receipt policy; immutable native in-app history cannot authorize email.",
    retention:
      "Calendar/member rows, personal/default rules, intents and rebuild state are durable PostgreSQL data. Calendar archive and membership withdrawal restrict ordinary reads and delivery; they are not physical erasure. Existing notification, durable mail, provider and backup copies have separate retention. No Calendar discovery/export/rectification/restriction/erasure/retention lifecycle adapter or installed deletion acceptance is introduced.",
    externalEffects:
      "PostgreSQL transactions write local calendars, selections and intents. calendar.reminder and activity.reminder.dispatch use pg-boss; eligible email is handed to the existing durable notification mail path and current mailbox policy. No invitation or newsletter send is created. Editor values live in component memory. The scanner's derived values and query/update signatures include transient maps and pure computations, not additional stores. Warn logs contain fixed cache-refresh messages without event content.",
    erasureTask: "DPL-15 / DPL-17",
  }),
  classifyInventory(calendarProviderIds, {
    owner: "separate owned Google Calendar grants and catalog metadata",
    categories: [
      "owner/provider account identifiers and email",
      "encrypted refresh tokens and PKCE verifiers",
      "hashed one-use OAuth state and browser binding",
      "connection generation, status and neutral error codes",
      "opaque provider calendar IDs, names, zones, access roles and explicit local selections",
    ],
    subjectRelation:
      "A Calendar grant belongs to the exact active native account that initiated authorization. It is separate from Gmail and Google sign-in. A provider calendar, catalog match or role does not establish a CRM subject, shared workspace authority or consent to contact participants.",
    purpose:
      "Authorize and reconnect a dedicated Calendar connection, fence stale callbacks and token refresh with owner/generation checks, discover a bounded complete provider catalog, and bind explicitly selected catalog calendars to local metadata. Event parsing, validation, reconciliation and sync-budget helpers are contracts only; no event sync worker, event push or two-way Calendar synchronization is registered by this increment.",
    disclosure:
      "Native sessions are re-admitted before final callback binding or interactive catalog publication/return, after provider I/O. Background grant maintenance remains independent of the initiating session while checking current owner and connection generation. Refresh tokens and verifiers are authenticated-encrypted server values; access tokens are short-lived memory values. Public DTOs exclude tokens, verifiers, raw provider payloads and sync cursors. No credential may enter logs, generic subject archives or browser storage.",
    retention:
      "Ordinary logout denies the initiating interactive operation but retains independent existing Calendar grants. Disconnect and native offboarding clear local usable credentials and outstanding authorization attempts through generation-aware transactions. Catalog and local binding history may remain. Local credential purge is not proof of Google token revocation or remote deletion. No automatic OAuth-attempt reclamation, provider erasure receipt, key rotation, backup erasure or Calendar lifecycle adapter is established.",
    externalEffects:
      "Dedicated OAuth authorization/token and identity endpoints receive the explicit authorization flow; bounded Google Calendar calendarList requests receive access-token authentication. Interactive discovery performs provider HTTP outside the native authority fence, then atomically publishes a complete catalog only after current admission. Same-origin browser fetch starts authorization; a browser cookie binds the one-use callback. No Gmail scope reuse, provider event import/export, outgoing invitation or live-provider acceptance follows from synthetic-transport tests. Digest update and browser Set/delete matches are transient calculations. Warn diagnostics contain fixed messages only.",
    erasureTask: "DPL-15 / DPL-17",
  }),
  classifyInventory(calendarFixtureIds, {
    owner: "historical Calendar migration proposal fixture",
    categories: [
      "archived repository SQL and journal metadata",
      "temporary fixture directories",
      "disposable test database schema",
    ],
    subjectRelation:
      "The archived unadmitted proposal and generated fixture paths are source history, not runtime subject data or an installed migration receipt.",
    purpose:
      "Exercise the old connection-generation transition in a uniquely owned t_UUID test database while preserving historical proposal bytes. Canonical installed upgrades use forward migration 0111 after admitted 0110, with a separate populated upgrade regression.",
    disclosure:
      "The destructive fixture helper refuses database names outside the unique test-clone pattern. Archived ordinal collisions must never be applied to a customer installation. Temporary SQL files contain repository source only and no runtime credentials or personal records.",
    retention:
      "Temporary fixture directories are removed after use and test clones are dropped by the native test harness. Archived source remains versioned history. This fixture grants no production cleanup or migration-history rewrite authority.",
    externalEffects:
      "Reads archived/canonical source, writes a private temporary migration subset, and rebuilds only the guarded disposable PostgreSQL schema. It does not contact Google, send mail or apply the archived proposal to an installed database.",
    erasureTask: "DPL-35",
  }),
];
