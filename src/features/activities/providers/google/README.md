# Google Calendar transport contract

This document describes the local transport contract layer. The separate
[account, catalog and selection services](authorizationREADME.md) supply consent/token
infrastructure, durable CalendarList metadata and explicit local selection. Their local
tests use synthetic provider transport and real PostgreSQL. No real provider account
or OAuth app was used. Event import, background synchronization, invitation delivery
and actual Meet provisioning remain separate work.

## Implemented boundary

- Calendar-list pages preserve access role, deletion and supported conference types.
  The full-discovery collector returns calendars and a final cursor only after all
  pages succeed, rejecting duplicate IDs, cyclic or mixed cursors and results beyond
  its 1,000-page limit. The transport collector is in-memory; the separate catalog
  owner persists complete snapshots, and selection has its own atomic calendar/binding transaction.
  The documented restricted-writer role is recognized during discovery, but writes
  remain conservatively denied until private-event authority has its own adapter.
- Event sync uses the same unexpanded, deletion-inclusive query for full and incremental
  pages. The promoted collector source returns a final cursor only after every page
  succeeds and rejects exact duplicate event IDs, cyclic/mixed cursors and PostgreSQL-unsafe
  Unicode. Warpdrive operational policies cap a result at 1,000 pages, 50,000 events,
  1 MiB of UTF8 JSON per event, 32 MiB of aggregate event JSON and depth 32, with 64 KiB
  per returned cursor and 1 MiB of retained page-token text. These are not Google API
  limits, streaming HTTP-body bounds or bounds on peak validation memory. HTTP 410 from
  event listing requests a mirror rebuild; a gone single event is a missing record.
- Provider event fields remain available in the validated read object, including sparse
  deleted exceptions, original occurrence identity, ETags and conference signatures.
- Create requires a caller-persisted, Google-compatible event ID. Patch and delete require
  an ETag and return conflicts without a retry that overwrites a remote change.
- Every write requires an explicit `sendUpdates` decision and a writable calendar role.
  The provider remains authoritative for access and notification policy. `none` is not a
  promise that Google will suppress every account-policy email or preserve guest sync.
- Meet requests require calendar support, use the supplied durable request ID and set
  `conferenceDataVersion=1`. An actual new request needs a new ID; a retry of the same
  durable operation reuses its ID. Returned pending/failure states never synthesize a URL.
- Existing-cache modifications require the caller to establish a complete
  conference-aware sync first. `conferenceCacheReady` is an explicit integration gate,
  not evidence that this transport performed or persisted a full sync.
- Network, HTTP, malformed JSON/schema and cancellation paths are tested. Abort propagates.
  Operational errors omit access tokens and response payloads. Numeric `Retry-After` is
  bounded; scheduling retries is the future durable worker's responsibility.

The supported scope set is intentionally explicit: Calendar/Calendar read-only,
CalendarList/CalendarList read-only, and Calendar Events/Events read-only. Gmail and OIDC
scopes grant none of these capabilities. Limited owned/app-created/public scopes are not
currently advertised as supported. OAuth identity, token refresh/encryption, offboarding
and owner authorization live in the separate account foundation. Real consent, refresh,
tenant policy and external revocation acceptance remain separate gates.

The initial write payload covers ordinary title, description, location, timed/all-day
bounds, visibility and busy/free fields. All-day end dates are provider-exclusive. Native
Warpdrive date conversion, recurrence and Iranian rule conversion, attendees, attachments,
resource bookings and special types need their own adapters and acceptance. Event replay,
event-sync cursor persistence and watch renewal remain unimplemented. Durable CalendarList
publication/cursor state does not establish event synchronization. The compact inline
account/catalog panel is implemented separately in Settings > Connections; see the
authorization README for its local qualification and remaining acceptance gates. Only the documented
403 `userRateLimitExceeded` and `rateLimitExceeded` reasons are classified for backoff;
other 403 responses remain forbidden. A complete calendar metadata catalog does not
establish a staged event mirror.

## Local metadata and selection qualification

The durable catalog publishes only a complete, still-authorized discovery run. Account
generation, latest-run authority, expiry and revision checks fence older or interrupted
work. Stable catalog identities use generated SHA-256 keys plus exact identifier checks;
partial batches and identity conflicts roll back. Entry JSON/Unicode, per-entry size,
aggregate count/size and finite-page bounds are Warpdrive operational limits.

Explicit selection creates a new non-primary provider-source calendar and stable binding
in one transaction. Existing personal/CRM calendars are not targets. Remove preserves the
source marker and selection tombstone; generic native read/write/sharing paths remain
guarded until projection/outbound adapters exist. Selection does not import events.

The current affected PostgreSQL selection passed 152/152 cases across 25 files in
25.31 seconds. The affected account/UI selection passed 53/53 cases across seven files
in 2.21 seconds, including the 25 panel/query cases and the disconnect-cache regression.
These checks cover explicit discovery, database-only reads on open, shared pending controls,
CAS, safe text, error/retry/commit-receipt behavior and invalid-zone admission. They are not
real Google acceptance. Synthetic browser/server/database acceptance subsequently covered
Farsi and German at 1512 by 771 and 390 by 844, keyboard disclosure, Add/Remove/re-Add
with stable binding/calendar identities, availability-only Add denial and local disconnect
hiding provider metadata. Saved selection still does not display events or enable sync/Meet.
Backend Remove supports known local IDs offline, but disconnected-account UI hides metadata
and selection controls; separate local-binding management remains future work.

Candidate migration 0092 is unreserved. Its guarded upgrade of the preserved synthetic
fixture passed in 0.196 seconds, preserving every original event/calendar field and version, native
source markers and zero provider state. After browser acceptance, exact cleanup restored
all original shared fields/versions and zero provider state; preferences and viewport
were restored, while environment and frozen source stayed unchanged. The preview stopped,
with its process group and port independently confirmed empty. The shutdown wrapper returned exit 1 on an EPERM
group probe after app shutdown, a harness limitation rather than an app failure or clean
wrapper pass. See the acceptance register for screenshots and exact proof bounds.
No accepted combined cut or installed upgrade is established. Two OAuth lock-wait
expiry regressions passed in 0.915 seconds after their observed failures and clock
correction, then passed within the broader 152-case return. Fresh full types and scoped translation/Biome/typed
ESLint on 50 TypeScript plus three JSON files passed after the clock/cache corrections.

## Promoted event-collector qualification boundary

The raw-event bounds package is promoted into local application source. Its initial
twelve-case run produced nine intended policy failures and three preservation/abort
controls. Four added cursor regressions then failed while those twelve controls passed,
followed by an ignored 16/16 candidate GREEN in 384 ms. The promoted test file was split
without changing its twelve case bodies, leaving six source files and sixteen new cases
across three test files.

The current affected pure-transport return passed 53/53 cases across seven files in
715 ms: sixteen new cases plus 37 existing controls. Biome and typed ESLint passed for
all six current TypeScript files, and full types passed in a 3.04-second owned wrapper.
All 64 frozen inputs were conserved and the owned process groups were empty. Exact
qualification is `.runtime/calendar-google-event-sync-final-qualification.json`.
This does not repeat native database, build or browser acceptance. There is no durable
event mirror, event import, cursor publication, background synchronization or real-provider
acceptance from this transport package. Sparse cancellation, recurrence identity and
unknown raw fields remain preserved for a future authorized mirror.

The next ignored preparations remain unrun: nine OAuth-retention cases across two files
(eight behavioral cases plus a physical global-index case), and eleven page-visitor cases.
They are outside this qualified pure-collector scope.

## Primary contract references

- [Calendar-list pagination and scopes](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)
- [Calendar-list roles and conference capabilities](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList)
- [Event-list sync tokens, deleted events and 410](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Event fields and sparse cancellation records](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Conditional modifications with ETags](https://developers.google.com/workspace/calendar/api/guides/version-resources)
- [Create events and asynchronous conference support](https://developers.google.com/workspace/calendar/api/guides/create-events)
- [Patch semantics and notification choices](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)

- [Provider error reasons and retry policy](https://developers.google.com/workspace/calendar/api/guides/errors)
