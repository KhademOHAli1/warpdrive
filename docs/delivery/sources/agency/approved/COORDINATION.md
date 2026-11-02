# Branch/chat coordination and conflict map

31 October 2026, Europe/Berlin. Ali explicitly requested inspection and coordination across other branches/chats, then a new implementation chat. Six owner chats were read and contacted. This package changes none of their goals or dirty files. BRANCH-SNAPSHOT.json is a dated read-only snapshot, not a permanent lock or latest-head guarantee.

## Owner map and observed source

| Owner/chat title | Chat ID | Checkout and observed committed head | Responsibility/status |
| --- | --- | --- | --- |
| Assess Warpdrive Farsi and Bun migration | 01a18868-3300-7dc2-b49d-c3bdb067fae7 | `/Users/ali/Developer/warpdrive-integrations`, `codex/local-integrations`, de74493999dfeac5dc8ebdbf3902e4b5022184ae | MAIL, native mailbox proofs/generations, IMAP/SMTP, drafts/outbox/repair, regional conventions; IG-12/13 quotation/accounting later. Active parser/notification work remains dirty. |
| Warpdrive integration programme: 446-task… | 01a19217-d257-7813-88e0-cf41cb36d93a | `/tmp/warpdrive-integrations-preview-20261031`, `codex/integration-platform-preview`, bc40519b4f8f7147f6232897c26450bb8c478816 | Canonical registry, WF adoption, CONN/EVT/broker design and integrated migration allocator. Broad qualification running, web3160 stopped. |
| Warpdrive — full sales platform implementation | 01a19263-b767-7611-9ee3-f395e66557ac | `/Users/ali/Documents/Codex/2026-10-31/warpdrive-sales-platform-implementation/work/warpdrive-sales`, `codex/sales-platform-20261031`, ad14d47919c68409cbb1a47f14c5e461a69ca44e | Pipelines, saved views/query authority, generic SP-09 handover/renewal. Pipeline/view slice uncommitted. |
| Complete the calendar roadmap | 01a19290-d076-74e2-ac3f-46c9853bc5b5 | `/Users/ali/Developer/warpdrive-calendar`, `codex/calendar-workflows`,2803183809c646a063f78fe954c110adbb2f453f | Activity/calendar schema, ownership/privacy, event revisions, durable reminders, notification stale-state checks. Large active uncommitted slice. |
| Warpdrive privacy and data lifecycle | 01a19263-11f1-7e30-adfb-e418eb02876e | `/Users/ali/Developer/warpdrive`, `codex/privacy-data-lifecycle`,86ea68f6f8680ea67206148c96205a3e90830f99 | Registry/case/lifecycle authority and adapters. Foundation draft PR4; discovery/disclosure/archive work uncommitted. |
| Warpdrive settings UX audit and Mobbin… | 01a19251-a472-7cd1-86cd-8dc245dd5b84 | `/Users/ali/Developer/warpdrive-settings-ux`, `codex/settings-ux`,a1a8f6da1ce366c35002900bf33508356dfbb995 | Current Settings UI and shared presentation adapters/catalogs; frozen for combined tests and native browser acceptance, no backend/schema changes. |

The separate combined MAIL candidate `/Users/ali/Developer/warpdrive-mail-platform`, `codex/mail-platform-candidate`, was observed clean at 571ba2cfd71361dfa886395bd10adc3b90cb0b8d. It is MAIL-owned and not accepted as a universal combined/release baseline merely because it is committed/clean.

GitHub fork main was independently read at a1a8f6da1ce366c35002900bf33508356dfbb995. The primary checkout is currently Privacy-owned, not checked out on main. A running preview or branch label does not prove all latest peer work is present.

## Concrete owner responses

**Sales:** supplied a factual handoff in this conversation. Its committed cut is reviewable; dirty pipeline/saved-view files are protected. Agency projects should reference canonical deal/customer/person UUIDs, intersect existing permissions and preserve acquisition results. SP-09 generic post-sale state is not implemented yet; agree a handover link rather than duplicate its lifecycle/task generator. Saved definitions grant no records. Preserve regional conventions and explicit quotation provenance.

**Privacy:** supplied a factual handoff in this conversation. Its foundation PR is https://github.com/KhademOHAli1/warpdrive/pull/4; CI was still rerunning after the tested PRIVACY-domain correction. Register all new stores/writers/history/caches/recipients. User/contact/author/assignee/address is not automatic subject identity. Reuse actual case authority and identity binding; generalized writer fences remain in development. Registration does not imply lifecycle operations are implemented.

**Integration:** supplied a factual handoff in this conversation. Registry and typed seven-operation provider contract are implemented. Generic broker, richer lifecycle, shared authority evaluator and durable CRM outbox are unimplemented contracts. Reuse actual WF persistence/version/authorization/pg-boss paths and NOTIFY. No agency DDL or shared API is allocated by the reply. Initial statement 93 was unreserved was superseded: MAIL now exclusively owns integrated85..93;94 requires allocator approval.

**Settings:** task-owned written handoff inspected at `/Users/ali/Documents/Codex/2026-10-31/warpdrive-settings-ux/outputs/implementation-coordination.md`. It declares no backend, schema, auth, permission or engine change. Reuse SettingsPage/Card/Heading and Radix adapters, preserving drafts and unknown-result recovery. Its shared PageHeading, optional SecondaryNavLink.onNavigate and ConfirmDialog.secondaryAction additions need a committed handoff before adoption. Same validated import batch cannot be remapped through a fabricated Back path.

**Calendar:** inspected recent chat turns, current source and `/Users/ali/Developer/warpdrive-calendar/docs/calendar-handoff-2026-10-31.md`. The old handoff's reminder-save failure was subsequently addressed in active source: recent chat reports15 real-PG durable-reminder cases and16 notification privacy cases passing. These are owner-reported scoped results, not a committed/qualified integration base. Current exports include reconcileReminderIntent, dispatchReminderIntents, deliverReminderIntent and handoffReminderEmail; they remain dirty owner source. Recheck accepted signatures and visibility before consuming them.

**MAIL:** inspected recent chat turns, committed guides/progress and active source ownership; coordination request delivered. Native mailbox/outbox source cuts are reviewable, but combined migration/acceptance is still open. The owner is addressing Google-free notification dispatch and last-moment pause/invitation/opt-out checks. Do not create another sender or treat draft/provider acceptance as delivery. Quotation IG-12/13 is later shared ownership, not available runtime today.

Later replies should be appended as dated amendments rather than silently rewriting these observations. Unanswered interface choices remain explicit implementation tasks.

## Conflict and coexistence matrix

| Area | Actual collision/risk | Safe agency work | Required resolution |
| --- | --- | --- | --- |
| Drizzle SQL/journal/snapshots | Platform83/84, MAIL local83..88, Privacy local83..85 and Calendar local83/84 conflict. MAIL integrated85..93 reserved. | Domain specification and pure policies without DDL. | One allocator; accepted combined base, exact structural merge/forward timestamps and supported-path tests. Never rename installed history. |
| Activities/calendar/reminders | Calendar edits schema, visibility, CRUD, reminder intent/outbox and notifications. | Assignment policies, briefs and UI specifications. | Calendar-reviewed canonical activity binding and project visibility intersection on every read/write/job surface. |
| Notifications/email | Calendar changes stale reminders; MAIL changes provider-neutral dispatch/authority; Settings edits preferences presentation. | Internal commitment intent and source-local projections. | Owner-adopted unified admission/delivery contract; no parallel queue/sender or notification-kind/link shortcut. |
| Sales handover/deals | Sales owns pipeline archive/create race, saved filters and generic post-sale lifecycle. | Dedicated agency project domain with explicit CRM references. | Agree handover reference/creation seam; don't repurpose won/lost stages for production. |
| Permissions/privacy | Privacy registers new boundaries; shared permission/error-domain files are being extended. | Agency truth tables and domain policies. | Narrow owner-reviewed capability/registry changes, current identity and separate financial DTOs. |
| Settings and shared UI | Settings owns navigation, forms, imports, goals, roles, catalogs, heading/dialog presentation. | Feature-local agency screens using existing adapters and separate catalogs. | Adopt committed UI cut through narrow integration; never overwrite shared files with old versions. |
| Shared app plumbing | env/config, schema barrel, i18n catalog, tRPC root, error IDs, worker registry, WS/notification schemas are common merge points. | New `src/features/agency-projects/**`, feature routes/catalogs and tests in an isolated branch. | Small reviewed additions; unique AGENCY error domain registered in contract tests; actual exports only. |
| Templates/workflows | Sales process templates and WF published-version task execution overlap creation/replay. | Agency template manifests and pure validation/preview. | Reuse existing versioned engines and stable install mappings; no second rule/task/event engine. |
| Finance | IG-12/13 quotation/accounting contracts are later; Sales has broader forecast/renewal semantics. | Provenance, permissions, money fixtures and consumer contract design. | Owner-approved source/version/currency interface before enabled financial summaries. No invoice/ERP scope. |

## Adoption and execution rules

1. Start with a new agency-owned checkout/branch using only exact committed owner cuts. Never switch/reset/stash/clean/bulk-stage peer work or mutate their runtimes. A temporary source checkout must not be the only surviving object store for the new project.
2. Platformbc40519 and the clean MAIL candidate are reviewable candidates, not approved combined releases. Prefer the freshest owner-reviewed combined commit after checking live heads. If unavailable, choose a stable committed base for pure independent increments and keep shared features disabled.
3. No migration reservation is granted here. Consult `/tmp/warpdrive-integrations-preview-20261031/docs/integration-execution/migration-allocation.md` and the platform owner before generation. Preserve immutable SQL/journals and SQL-only workflow guards. Drizzle timestamps must advance the accepted combined head.
4. Agency owns its domain and feature-local UI. Shared edits require a narrow concrete patch and the named owner. Coordination does not pause or replace any other goal.
5. Current previews use MAIL 3106/WS3107, platform 3160/WS8080, Sales 3176/PG55461, Calendar 3169/PG54673 and Settings 3184/3185/PG55480 as observations only. Some are stopped. Recheck actual PID/cwd/listeners before reserving new ports. Never assume a stale PID is safe to stop.
6. Shared host free space recently ranged below 1 GiB to about 7 GiB under concurrent compilation/swap. Coordinate one finite heavy PG/build window, inspect headroom before phases and avoid broad workers against synthetic connected provider rows. Do not delete another chat's outputs or caches.
7. Keep Farsi/German/English and exact region/identity conventions at every seam. Source tests, local runtime, provider qualification, pilot outcomes and production acceptance remain separate.
