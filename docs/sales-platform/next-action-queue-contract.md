# Next-action queue contract

This is a partial SP-03.4 implementation on the task-owned Sales candidate.
All 128 parent tasks and release acceptance remain open.

## Exposure and source

`SALES_NEXT_ACTION_QUEUE_ENABLED` defaults to false at the single environment
boundary. When false, native list/calendar navigation omits the queue, the route
returns not found and the protected RPC refuses the read. When enabled,
`/activities/queue` uses the existing Activities layout and native session context.
No schema, dependency, provider, background worker or automatic task is added.

The strict RPC accepts only `scope`, `limit` and `offset`. Actor, account timezone,
clock and response read ID are server-owned. My work narrows activities to their
assignee and opportunities to their owner. All I can access retains current
record, parent, pipeline, team, group and additive-allowlist visibility.

## Eligibility and data

Overdue means an unfinished, nondeleted activity whose timed due instant is
before the server clock, or whose final all-day civil date has passed in the
saved account timezone. Canonical dates, legacy placeholders and all-day ranges
reuse the existing policy. Individually archived deals, deleted dominant parents
and archived pipelines do not contribute active work. Won/lost nonarchived deal
activities can still be overdue; missing-next-step opportunities must be open.

An opportunity needs a next activity only if no nondeleted unfinished activity
links to it. Undated or colleague-assigned open work therefore prevents that
reason. The read never uses the nullable next-activity timestamp as a substitute
for existence and never manufactures an activity from a missing-step row.

One authorized SQL selection supplies totals, reason counts and the bounded page.
Overdue work precedes missing-step opportunities, with time and stable IDs for
ordering. Native parent visibility dominates activity access. Secondary person,
organization and lead IDs and labels are independently redacted. Final DTOs omit
internal visibility columns, notes, credentials, money and raw errors.

The existing owner/assignee fields are nonnullable. Literal unassigned work needs
a separate ownership/storage decision; undated work is not called unassigned.

## Client and actions

Farsi, German and English copy uses existing direction, calendar and number
formatting. The server's timezone governs displayed queue dates. Actor, narrowing,
pagination and preference context scope the cache. Loading, failed or mismatched
reads hide rows and counts together. An empty successful read is distinct from
an unavailable read and from an emptied later page.

An optimistic preference save hides the queue and blocks reads until settlement.
Dialog saves and explicit refresh cancel old reads and advance a local request
revision. Late pre-save responses cannot become a current confirmation, even if
transport cancellation loses a race. The revision is client presentation state,
not server authority or a durable mutation receipt.

Edit opens the existing fresh `getForEdit` dialog; scheduling uses the existing
native add-activity form for the canonical opportunity. Queue hints grant no
write authority. Queue quick completion is not connected. The reused edit dialog
still contains existing completion, reopen and delete controls. Their captured
actor/current-session admission and unknown-outcome behavior remain unqualified;
see `activity-command-admission-review.md`. Do not enable this feature as a
qualified release until those affected native journeys and broader gates pass.

Operational read failures return `E_DB_004`, without SQL or customer labels.
Permission refusal is separate from an ordinary empty page. Abort signals are
checked before and after non-signal-aware database awaits; database statement
cancellation and installed load limits are not established by that alone.

## Evidence limits

Scoped behavioral tests, actual PostgreSQL results and source hashes are recorded
in the queue evidence record after their terminal runs. No full latest-candidate
typecheck, lint, production build, browser, accessibility, performance, retained
installation or provider qualification follows from a scoped pass. No rollout,
push, deployment or release has been performed.
